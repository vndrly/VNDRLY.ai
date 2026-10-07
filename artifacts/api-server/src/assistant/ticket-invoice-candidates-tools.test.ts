import { expect, it, vi } from "vitest";
import {
  createTicketInvoiceCandidatesHandler,
  TICKET_INVOICE_CANDIDATES_TOOL,
} from "./ticket-invoice-candidates-tools";
import { createPlanTicketInvoiceCandidatesRead } from "./plan-execution-ticket-invoice-candidates";
import { chatGptReadableTools } from "./chatgpt-tool-access";
import { resolveExecutableWorkHubToolRequest } from "./work-hub-tool-runtime";
import type {
  PlanExecutionAuthorization,
  PlanExecutionStep,
} from "./plan-execution";
const uuid = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const session = {
  userId: 17,
  role: "vendor",
  vendorId: 4,
  membershipRole: "member",
  activeMembershipId: 12,
  sv: 1,
};
const output = {
  company: { type: "vendor", id: 4 },
  observedAt: "2026-10-07T12:00:00.000Z",
  source: "canonical_approved_uninvoiced_tickets",
  tickets: [
    {
      ticketId: 100007,
      siteLocationId: 392,
      status: "approved",
      expectedUpdatedAt: "2026-10-07T10:00:00.123Z",
    },
  ],
  page: { limit: 20, nextAfterTicketId: null, truncated: false },
  automaticApprovalCreated: false,
  invoicesPrepared: false,
};
const step: PlanExecutionStep = {
  id: "selection",
  adapter: "authorized_read",
  toolName: "query_ticket_invoice_candidates",
  arguments: { limit: 20, afterTicketId: 0 },
  dependsOn: [],
  operationId: uuid(4),
};
const authorization: PlanExecutionAuthorization = {
  id: uuid(1),
  requester: {
    userId: 17,
    organizationKey: "vendor:4",
    membershipId: 12,
    sessionVersion: 1,
  },
  grantReference: "private",
  taskId: uuid(2),
  taskVersion: 1,
  planId: uuid(3),
  planVersion: 1,
  planFingerprint: "a".repeat(64),
  approvedAt: 1,
  expiresAt: 900000,
  maxAttempts: 1,
  steps: [step],
  notificationOperationId: uuid(5),
};
const request = () =>
  vi.fn(
    async (
      _path: string,
      _method: string,
      _body: unknown,
      _session: unknown,
    ): Promise<Record<string, unknown> | Record<string, unknown>[]> => output,
  );
it("advertises a bounded read and preserves actual exact selected versions without any generation request", async () => {
  const call = request();
  const result = await createTicketInvoiceCandidatesHandler(call)({}, session, [
    "finance:read",
  ]);
  expect(result).toEqual(output);
  expect(call).toHaveBeenCalledExactlyOnceWith(
    "/invoices/ticket-preparation/candidates?limit=20&afterTicketId=0",
    "GET",
    {},
    session,
  );
  expect(TICKET_INVOICE_CANDIDATES_TOOL.annotations.readOnlyHint).toBe(true);
  expect(
    resolveExecutableWorkHubToolRequest(
      step.toolName,
      { limit: 20, afterTicketId: 0 },
      false,
    ),
  ).toMatchObject({
    method: "GET",
    path: "/invoices/ticket-preparation/candidates?limit=20&afterTicketId=0",
  });
});
it("requires finance read even when WorkHub read granted and denies cross-company/malformed projections", async () => {
  expect(
    chatGptReadableTools(session, ["finance:read"]).some(
      (tool) => tool.name === step.toolName,
    ),
  ).toBe(true);
  expect(
    chatGptReadableTools(session, ["work_hub:read"]).some(
      (tool) => tool.name === step.toolName,
    ),
  ).toBe(false);
  const call = request();
  await expect(
    createTicketInvoiceCandidatesHandler(call)({}, session, ["work_hub:read"]),
  ).rejects.toThrow();
  expect(call).not.toHaveBeenCalled();
  for (const value of [
    { ...output, company: { type: "vendor", id: 99 } },
    {
      ...output,
      tickets: [{ ...output.tickets[0], expectedUpdatedAt: "bad" }],
    },
    { ...output, page: { ...output.page, truncated: true } },
    { ...output, privateToken: "secret" },
  ]) {
    call.mockResolvedValueOnce(value);
    await expect(
      createTicketInvoiceCandidatesHandler(call)({}, session, ["finance:read"]),
    ).rejects.toThrow();
  }
});
it("durable read binds exact approved input, emits version references and rechecks authority after reading", async () => {
  const authorize = vi.fn(async () => ({
    session,
    scopes: ["finance:read"],
    current: {
      ...authorization.requester,
      grantReference: "private",
      grantRevoked: false,
      taskId: uuid(2),
      taskVersion: 1,
      planId: uuid(3),
      planVersion: 1,
      planFingerprint: authorization.planFingerprint,
      availableTools: [step.toolName],
    },
  }));
  const call = request();
  const read = createPlanTicketInvoiceCandidatesRead({
    authorize,
    request: call,
    now: () => Date.parse(output.observedAt),
  });
  const result = await read(authorization, step);
  expect(result.sourceReferences).toContain(
    "ticket:100007:updatedAt:2026-10-07T10:00:00.123Z",
  );
  expect(JSON.parse(result.summary)).toMatchObject({
    automaticApprovalCreated: false,
    invoicesPrepared: false,
  });
  expect(authorize).toHaveBeenCalledTimes(2);
  await expect(
    read(authorization, { ...step, arguments: { limit: 21 } }),
  ).rejects.toThrow();
  expect(call).toHaveBeenCalledTimes(1);
  authorize.mockRejectedValueOnce(Error("revoked"));
  await expect(read(authorization, step)).rejects.toThrow("revoked");
});
