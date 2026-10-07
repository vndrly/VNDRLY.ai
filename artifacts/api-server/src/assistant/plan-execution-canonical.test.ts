import { describe, expect, it, vi } from "vitest";
import { createPlanExecutionCanonicalApi, createPlanExecutionSelfNotifier } from "./plan-execution-canonical";
import { planExecutionAuthorizationSchema } from "./plan-execution";
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const authorization = planExecutionAuthorizationSchema.parse({ id: uuid(1), requester: { userId: 17, organizationKey: "vendor:4", membershipId: 12, sessionVersion: 1 }, grantReference: "private-grant", taskId: uuid(2), taskVersion: 3, planId: uuid(3), planVersion: 2, planFingerprint: "a".repeat(64), approvedAt: 1000, expiresAt: 10000, maxAttempts: 3, steps: [{ id: "read", adapter: "authorized_read", toolName: "query_asset_custody", arguments: {}, dependsOn: [], operationId: uuid(4) }, { id: "draft", adapter: "personal_draft", toolName: "manage_work_hub_task", arguments: { title: "Review recorded custody" }, dependsOn: ["read"], operationId: uuid(5) }], notificationOperationId: uuid(6) });
const authority = { session: { userId: 17, role: "vendor", vendorId: 4, membershipRole: "admin", activeMembershipId: 12, sv: 1 }, scopes: ["work_hub:read", "work_hub:write", "operations:read"], current: { ...authorization.requester, grantReference: authorization.grantReference, grantRevoked: false, taskId: authorization.taskId, taskVersion: 3, planId: authorization.planId, planVersion: 2, planFingerprint: authorization.planFingerprint, availableTools: ["query_asset_custody", "list_work_hub_tasks", "manage_work_hub_task"] } };
const command = { operationId: uuid(5), title: "Review recorded custody", description: "Recorded read results — review before taking action.\nAsset observed.", assigneeUserId: 17 };
function draftHarness() {
  let saved: Record<string, unknown> | null = null;
  const authorize = vi.fn(async () => authority);
  const receipt = vi.fn(async () => saved ? { userId: 17, commandKind: "task.create", operationId: command.operationId, ownerOrgType: "vendor", ownerOrgId: 4, resultJson: saved, appliedAt: new Date() } : null);
  const request = vi.fn(async (path: string, method: string, body: Record<string, unknown>) => {
    if (method === "POST") { saved = { ...(body.payload as Record<string, unknown>), id: uuid(7), createdById: 17, ownerOrgType: "vendor", ownerOrgId: 4, version: 1, status: "open", dueAt: null, channelId: null, recurrence: null }; return { operationId: command.operationId, resource: saved }; }
    if (path === `/work-hub/search/items/task/${uuid(7)}` && saved) return saved;
    throw Error("Unexpected canonical path");
  });
  return { authorize, receipt, request, api: createPlanExecutionCanonicalApi({ authorize, receipt, request }), get saved() { return saved; } };
}
describe("canonical bounded plan execution effects", () => {
  it("saves only a self-assigned company draft and reads the exact durable receipt before reporting completion", async () => {
    const h = draftHarness();
    const result = await h.api.savePersonalDraft(authorization, command);
    expect(result.sourceReferences).toEqual([`task:${uuid(7)}:v1`]);
    expect(h.saved?.description).toContain("not a guaranteed confidential personal note");
    expect(h.request.mock.calls.find(call => call[1] === "POST")?.[2]).toMatchObject({ operationId: command.operationId, owner: { type: "vendor", id: 4 }, context: { kind: "organization", id: 4 }, payload: { assigneeUserId: 17, title: command.title, priority: "normal" } });
    await h.api.savePersonalDraft(authorization, command);
    expect(h.request.mock.calls.filter(call => call[1] === "POST")).toHaveLength(1);
  });
  it("reconciles a committed dropped response without another task creation, and refuses changed task contents", async () => {
    const h = draftHarness(), actual = h.request.getMockImplementation()!;
    h.request.mockImplementation(async (path, method, body) => { const result = await actual(path, method, body); if (method === "POST") throw Error("Response dropped"); return result; });
    await expect(h.api.savePersonalDraft(authorization, command)).rejects.toThrow("Response dropped");
    expect(await h.api.readbackDraft(authorization, command)).toMatchObject({ state: "completed" });
    h.request.mockImplementation(async (path, method, body) => ({ ...await actual(path, method, body), title: "Changed by user" }));
    expect(await h.api.readbackDraft(authorization, command)).toEqual({ state: "unknown" });
    expect(h.request.mock.calls.filter(call => call[1] === "POST")).toHaveLength(1);
  });
  it("stops revoked authority immediately before write and denies members lacking canonical task.assign", async () => {
    const h = draftHarness();
    h.authorize.mockResolvedValueOnce(authority).mockResolvedValueOnce(authority).mockRejectedValueOnce(Error("Grant revoked"));
    await expect(h.api.savePersonalDraft(authorization, command)).rejects.toThrow("Grant revoked");
    expect(h.request).not.toHaveBeenCalled();
    const member = draftHarness(); member.authorize.mockResolvedValue({ ...authority, session: { ...authority.session, membershipRole: "member" } });
    await expect(member.api.savePersonalDraft(authorization, command)).rejects.toThrow("forbidden");
    expect(member.receipt).not.toHaveBeenCalled(); expect(member.request).not.toHaveBeenCalled();
    await expect(member.api.savePersonalDraft(authorization, { ...command, assigneeUserId: 18 })).rejects.toThrow();
  });
  it("treats receipt errors as unknown effects rather than absent operations", async () => {
    const h = draftHarness(); h.receipt.mockRejectedValue(Error("Database unavailable"));
    await expect(h.api.savePersonalDraft(authorization, command)).rejects.toThrow("Database unavailable"); expect(h.request).not.toHaveBeenCalled();
  });
  it("refuses reused receipt actor, company and payload without exposing or retrying another operation", async () => {
    for (const changed of [{ userId: 18 }, { ownerOrgId: 5 }, { resultJson: { id: uuid(7), title: "Other confidential task" } }]) {
      const h = draftHarness(); await h.api.savePersonalDraft(authorization, command);
      const original = await h.receipt(); h.receipt.mockResolvedValue({ ...original!, ...changed }); h.request.mockClear();
      expect(await h.api.readbackDraft(authorization, command)).toEqual({ state: "unknown" });
      expect(h.request).not.toHaveBeenCalled();
    }
  });
  it("projects authorized recorded metadata only and rechecks authority before releasing read results", async () => {
    const authorize = vi.fn(async () => authority), request = vi.fn(async () => ({ assets: [{ id: uuid(8), name: "Synthetic radio", status: "held", condition: "missing", secret: "private secret", holderEmail: "private@example.invalid" }] }));
    const api = createPlanExecutionCanonicalApi({ authorize, request });
    const result = await api.read(authorization, authorization.steps[0]);
    expect(result.summary).toContain("Synthetic radio"); expect(JSON.stringify(result)).not.toContain("private"); expect(authorize).toHaveBeenCalledTimes(2);
    authorize.mockResolvedValueOnce(authority).mockRejectedValueOnce(Error("Revoked during read"));
    await expect(api.read(authorization, authorization.steps[0])).rejects.toThrow("Revoked during read");
    await expect(api.read(authorization, { ...authorization.steps[0], arguments: { recipientUserId: 18 } })).rejects.toThrow();
  });
  it("does not project tasks or an exact asset from another approved company context", async () => {
    const step = { ...authorization.steps[0], toolName: "list_work_hub_tasks" };
    const approved = { ...authorization, steps: [step, authorization.steps[1]] };
    const task = { id: uuid(8), title: "Foreign confidential task", description: "Private", ownerOrgType: "vendor", ownerOrgId: 5, assigneeUserId: 18, version: 1, status: "open" };
    const api = createPlanExecutionCanonicalApi({ authorize: async () => authority, request: async () => [task] });
    expect(JSON.stringify(await api.read(approved, step))).not.toContain("Foreign confidential");
    const assetStep = { ...authorization.steps[0], arguments: { assetId: uuid(8) } };
    const assetApproved = { ...authorization, steps: [assetStep, authorization.steps[1]] };
    const foreign = createPlanExecutionCanonicalApi({ authorize: async () => authority, request: async () => ({ id: uuid(8), name: "Private asset", responsibleOwner: { type: "vendor", id: 5 } }) });
    await expect(foreign.read(assetApproved, assetStep)).rejects.toThrow("another approved context");
  });
});
describe("self-only durable brief notification", () => {
  it("reconciles a dropped insert response with exact dedupe and refuses a changed brief", async () => {
    const rows = new Map<string, { userId: number; type: string; title: string; body: string | null; link: string | null; dedupeKey: string | null }>();
    const insert = vi.fn(async (row: NonNullable<ReturnType<typeof rows.get>>) => { rows.set(row.dedupeKey!, row); throw Error("Response dropped"); });
    const notify = createPlanExecutionSelfNotifier({ authorize: async () => authority, enabled: async () => true, find: async (user, key) => { const row = rows.get(key); return row?.userId === user ? row : null; }, insert });
    await expect(notify(authorization, uuid(6), "Recorded results only")).rejects.toThrow("Response dropped");
    expect(await notify(authorization, uuid(6), "Recorded results only")).toEqual({ saved: true, operationId: uuid(6) });
    expect(insert).toHaveBeenCalledOnce(); expect(insert.mock.calls[0][0].userId).toBe(17);
    await expect(notify(authorization, uuid(6), "Changed brief")).rejects.toThrow("reused");
    await expect(notify(authorization, uuid(9), "Different operation")).rejects.toThrow();
  });
  it("respects disabled preferences and fresh authority before an insertion", async () => {
    const insert = vi.fn(async () => {}), authorize = vi.fn(async () => authority);
    const notify = createPlanExecutionSelfNotifier({ authorize, enabled: async () => false, find: async () => null, insert });
    await expect(notify(authorization, uuid(6), "Brief")).rejects.toThrow("preference disabled"); expect(insert).not.toHaveBeenCalled();
    const revoked = createPlanExecutionSelfNotifier({ authorize: vi.fn().mockResolvedValueOnce(authority).mockRejectedValueOnce(Error("Revoked")), enabled: async () => true, find: async () => null, insert });
    await expect(revoked(authorization, uuid(6), "Brief")).rejects.toThrow("Revoked"); expect(insert).not.toHaveBeenCalled();
  });
});
