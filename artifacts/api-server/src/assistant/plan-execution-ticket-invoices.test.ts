import { expect, it, vi } from "vitest";
import { createPlanTicketInvoicePreparation } from "./plan-execution-ticket-invoices";
import { planExecutionAuthorizationSchema, planExecutionFingerprint, type PlanExecutionAuthorization, type PlanExecutionStep } from "./plan-execution";
import { ticketInvoicePreparationCommand } from "./ticket-invoice-preparation-tools";
import { resolveExecutableWorkHubToolRequest } from "./work-hub-tool-runtime";
import { chatGptActionTools } from "./chatgpt-tool-access";
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const step: PlanExecutionStep = { id: "prepare", adapter: "ticket_invoice_preparation", toolName: "prepare_ticket_invoices", arguments: { basis: "recorded_invoice_activity", tickets: [{ ticketId: 100007, expectedUpdatedAt: "2026-10-07T10:00:00.123Z" }] }, dependsOn: ["history"], operationId: uuid(4) };
const authorization: PlanExecutionAuthorization = { id: uuid(1), requester: { userId: 17, organizationKey: "vendor:4", membershipId: 12, sessionVersion: 1 }, grantReference: "private", taskId: uuid(2), taskVersion: 1, planId: uuid(3), planVersion: 1, planFingerprint: "a".repeat(64), approvedAt: 1, expiresAt: 900000, maxAttempts: 1, steps: [{ id: "history", adapter: "authorized_read", toolName: "query_invoice_activity", arguments: { basis: "recorded_invoice_activity" }, dependsOn: [], operationId: uuid(6) }, step], notificationOperationId: uuid(5) };
function fixture() {
  const session = { userId: 17, role: "vendor", vendorId: 4, membershipRole: "admin", activeMembershipId: 12, sv: 1 };
  const scopes = ["finance:read", "finance:write"];
  const authorize = vi.fn(async () => ({ session, scopes, current: { ...authorization.requester, grantReference: "private", grantRevoked: false, taskId: uuid(2), taskVersion: 1, planId: uuid(3), planVersion: 1, planFingerprint: authorization.planFingerprint, availableTools: [step.toolName] } }));
  const command = ticketInvoicePreparationCommand(step.arguments, step.operationId);
  const receipt = { operationId: step.operationId, actorUserId: 17, vendorId: 4, fingerprint: planExecutionFingerprint({command, actor: {userId:17,vendorId:4,membershipId:12,sessionVersion:1}}), status: "prepared", basis: "recorded_invoice_activity", activityObservedAt: "2026-10-07T10:00:00Z", lastRecordedInvoiceAt: "2026-09-20T10:00:00Z", acceptedAt: "2026-10-07T10:00:00Z", invoices: [{ ticketId: 100007, invoiceId: 55, lineCount: 2 }], emailSent: false, issued: false, paymentRecorded: false };
  const request = vi.fn(async (_path: string, _method: string, _body: unknown, _session: unknown): Promise<Record<string, unknown> | Record<string, unknown>[]> => ({ receipt }));
  return { authorize, request, receipt, command, scopes, run: createPlanTicketInvoicePreparation({ authorize, request }) };
}
it("binds approved chronology dependency and same exact server operation for effect and recovery", async () => {
  const f = fixture();
  expect((await f.run(authorization, step, false)).state).toBe("completed");
  expect((await f.run(authorization, step, true)).state).toBe("completed");
  expect(f.request.mock.calls.map(call => call.slice(0, 3))).toEqual([["/invoices/ticket-preparation/execute", "POST", f.command], ["/invoices/ticket-preparation/readback", "POST", f.command]]);
  expect(f.authorize).toHaveBeenCalledTimes(4);
});
it("rejects unapproved arguments, missing consent or mismatched prerequisite before a request", async () => {
  const f = fixture();
  await expect(f.run(authorization, {...step, arguments: {...step.arguments, sendEmail:true}}, false)).rejects.toThrow();
  f.scopes.pop();
  await expect(f.run(authorization, step, false)).rejects.toThrow();
  expect(f.request).not.toHaveBeenCalled();
  expect(planExecutionAuthorizationSchema.safeParse({...authorization,steps:[{...authorization.steps[0],arguments:{basis:"provider_acceptance"}},step]}).success).toBe(false);
});
it("accepts proven absence only from readback and refuses forged/mismatched receipts", async () => {
  const f = fixture(); f.request.mockResolvedValueOnce({receipt:null});
  expect(await f.run(authorization,step,true)).toEqual({state:"not_found"});
  for(const receipt of [{...f.receipt,actorUserId:99},{...f.receipt,fingerprint:"b".repeat(64)},{...f.receipt,invoices:[{ticketId:99,invoiceId:55,lineCount:2}]},{...f.receipt,emailSent:true}]) {
    f.request.mockResolvedValueOnce({receipt});
    expect(await f.run(authorization,step,true)).toEqual({state:"unknown"});
  }
});
it("withholds effect result when current authority is revoked during the response", async () => {
  const f=fixture(); const current=await f.authorize(); f.authorize.mockResolvedValueOnce(current).mockRejectedValueOnce(Error("revoked"));
  await expect(f.run(authorization,step,false)).rejects.toThrow("revoked");
  expect(f.request).toHaveBeenCalledTimes(1);
});
it("requires both finance scopes and vendor context even when work_hub write is granted", () => {
  const vendor={userId:17,role:"vendor",vendorId:4,membershipRole:"admin",activeMembershipId:12,sv:1};
  expect(chatGptActionTools(vendor,["finance:read","finance:write"]).some(tool=>tool.name===step.toolName)).toBe(true);
  for(const scopes of [["finance:write"],["finance:read"],["work_hub:write"]])expect(chatGptActionTools(vendor,scopes).some(tool=>tool.name===step.toolName)).toBe(false);
  expect(chatGptActionTools({...vendor,role:"admin"},["finance:read","finance:write"]).some(tool=>tool.name===step.toolName)).toBe(false);
});
it("maps the approved server operation into the real generator route and rejects arbitrary money or send fields", () => {
  expect(resolveExecutableWorkHubToolRequest(step.toolName,{...step.arguments,operationId:step.operationId},false)).toMatchObject({requiresConfirmation:true});
  expect(resolveExecutableWorkHubToolRequest(step.toolName,{...step.arguments,operationId:step.operationId},true)).toMatchObject({method:"POST",path:"/invoices/ticket-preparation/execute",body:ticketInvoicePreparationCommand(step.arguments,step.operationId)});
  expect(resolveExecutableWorkHubToolRequest(step.toolName,{...step.arguments,operationId:step.operationId,amount:20},true)).toHaveProperty("error");
});
