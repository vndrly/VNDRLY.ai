import { expect, it, vi } from "vitest";
import { createPlanInvoiceActivityRead } from "./plan-execution-invoice-activity";
import type { PlanExecutionAuthorization, PlanExecutionStep } from "./plan-execution";
import type { readInvoiceActivity } from "./invoice-activity-read";
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const selected: PlanExecutionStep = { id: "billing", adapter: "authorized_read", toolName: "query_invoice_activity", arguments: { basis: "recorded_invoice_activity" }, dependsOn: [], operationId: uuid(4) };
const authorization: PlanExecutionAuthorization = { id: uuid(1), requester: { userId: 17, organizationKey: "vendor:4", membershipId: 12, sessionVersion: 1 }, grantReference: "private", taskId: uuid(2), taskVersion: 1, planId: uuid(3), planVersion: 1, planFingerprint: "a".repeat(64), approvedAt: 1, expiresAt: 900000, maxAttempts: 1, steps: [selected], notificationOperationId: uuid(5) };
const observed: Awaited<ReturnType<typeof readInvoiceActivity>> = { basis: "recorded_invoice_activity", observedAt: "2026-10-07T12:00:00Z", company: { type: "vendor", id: 4 }, events: ["manual_issue", "ticket_send_attempt", "provider_acceptance"].map(kind => ({ kind: kind as "manual_issue" | "ticket_send_attempt" | "provider_acceptance", observedRecords: 0, undatedRecords: 0, latestAt: null, sourceReference: null })), state: "no_recorded_event", latestAt: null, elapsedDays: null, thresholdDays: 15, exceeds15Days: null, preparationRecommended: false, draftPrepared: false, deliveryVerified: false, limitations: [] };
function harness(value = observed) {
  const session = { userId: 17, role: "vendor", vendorId: 4, membershipRole: "admin", activeMembershipId: 12, sv: 1 };
  const authorize = vi.fn(async () => ({ session, scopes: ["finance:read"], current: { ...authorization.requester, grantReference: "private", grantRevoked: false, taskId: uuid(2), taskVersion: 1, planId: uuid(3), planVersion: 1, planFingerprint: authorization.planFingerprint, availableTools: [selected.toolName] } }));
  const read = vi.fn(async () => value);
  return { authorize, read, execute: createPlanInvoiceActivityRead({ authorize, read, now: () => Date.parse(observed.observedAt) }) };
}
it("binds exact approved basis and returns observed-only source evidence with fresh checks before and after", async () => {
  const h = harness(), result = await h.execute(authorization, selected);
  expect(result.operationId).toBe(selected.operationId); expect(result.sourceReferences).toEqual(["query:query_invoice_activity:vendor:4:2026-10-07T12:00:00Z"]);
  expect(JSON.parse(result.summary)).toMatchObject({ state: "no_recorded_event", draftPrepared: false, preparationRecommended: false });
  expect(h.authorize).toHaveBeenCalledTimes(2); expect(h.read.mock.calls[0]).toEqual([{ basis: "recorded_invoice_activity" }, expect.objectContaining({ userId: 17 }), ["finance:read"]]);
});
it("refuses altered approved arguments before any canonical read", async () => {
  const h = harness(); await expect(h.execute(authorization, { ...selected, arguments: { basis: "provider_acceptance" } })).rejects.toThrow("exact approved"); expect(h.read).not.toHaveBeenCalled();
});
it("withholds results when originating authority is revoked during read", async () => {
  const h = harness(); h.authorize.mockImplementationOnce(async () => ({ session: { userId: 17, role: "vendor", vendorId: 4, membershipRole: "admin", activeMembershipId: 12, sv: 1 }, scopes: ["finance:read"], current: { ...authorization.requester, grantReference: "private", grantRevoked: false, taskId: uuid(2), taskVersion: 1, planId: uuid(3), planVersion: 1, planFingerprint: authorization.planFingerprint, availableTools: [selected.toolName] } })).mockRejectedValueOnce(Error("Grant revoked"));
  await expect(h.execute(authorization, selected)).rejects.toThrow("Grant revoked"); expect(h.read).toHaveBeenCalledTimes(1);
});
it("rejects stale, cross-company or private-field read output without a successful observation", async () => {
  for (const value of [{ ...observed, observedAt: "2026-10-06T12:00:00Z" }, { ...observed, company: { type: "vendor" as const, id: 9 } }, { ...observed, privateGrant: "secret" }]) await expect(harness(value).execute(authorization, selected)).rejects.toThrow();
});
