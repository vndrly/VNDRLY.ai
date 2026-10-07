import { describe, it, expect, vi } from "vitest";
import { createPlanExecutionConsentService } from "./plan-execution-consent";
import { planExecutionAuthorizationSchema } from "./plan-execution";
import { storedPlanExecutionSchema } from "./plan-execution-repository";
import type { withPlanExecutionRecords } from "./plan-execution-store";
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const proposal = planExecutionAuthorizationSchema.parse({ id: uuid(1), requester: { userId: 17, organizationKey: "vendor:4", membershipId: 12, sessionVersion: 1 }, grantReference: "grant", taskId: uuid(2), taskVersion: 3, planId: uuid(3), planVersion: 2, planFingerprint: "a".repeat(64), approvedAt: 1000, expiresAt: 900000, maxAttempts: 3, steps: [{ id: "read", adapter: "authorized_read", toolName: "query_asset_custody", arguments: {}, dependsOn: [], operationId: uuid(4) }], notificationOperationId: uuid(5) });
const session = { userId: 17, role: "vendor", vendorId: 4, activeMembershipId: 12, sv: 1 };
function harness() {
  let now = 2000; const records: unknown[] = [];
  const authorize = vi.fn(async () => ({ session, scopes: [], current: { ...proposal.requester, grantReference: "grant", grantRevoked: false, taskId: proposal.taskId, taskVersion: 3, planId: proposal.planId, planVersion: 2, planFingerprint: proposal.planFingerprint, availableTools: ["query_asset_custody"] } }));
  const withRecords: typeof withPlanExecutionRecords = async (_userId, operation) => operation(records);
  const service = createPlanExecutionConsentService({ secret: "s".repeat(64), now: () => now, authorize, withRecords });
  return { records, authorize, service, setNow(value: number) { now = value; } };
}
describe("signed execution consent", () => {
  it("prepares without a runnable record and persists actual approval time and stable operations exactly once", async () => {
    const h = harness(), prepared = await h.service.prepare(proposal, session);
    expect(prepared).toMatchObject({ state: "prepared", executionStarted: false, reviewExpiresAt: 302000 });
    expect(prepared.proposal).not.toHaveProperty("approvedAt"); expect(h.records).toEqual([]);
    expect(prepared.proposal).not.toHaveProperty("grantReference");
    const review = await h.service.getPrepared(prepared.token, session);
    expect(review).not.toHaveProperty("token"); expect(review.proposal).toEqual(prepared.proposal); expect(h.records).toEqual([]);
    h.setNow(3000); const approved = await h.service.approve(prepared.token, session);
    expect(approved.authorization.approvedAt).toBe(3000); expect(approved.authorization.steps).toEqual(proposal.steps);
    h.setNow(4000); expect(await h.service.approve(prepared.token, session)).toEqual(approved); expect(h.records).toHaveLength(1);
  });
  it("rejects tampering, expiration, wrong account, membership and session before persisting", async () => {
    const h = harness(), prepared = await h.service.prepare(proposal, session);
    await expect(h.service.approve(`x${prepared.token}`, session)).rejects.toThrow();
    for (const actor of [{ ...session, userId: 18 }, { ...session, vendorId: 5 }, { ...session, activeMembershipId: 13 }, { ...session, sv: 2 }]) await expect(h.service.approve(prepared.token, actor)).rejects.toThrow("account changed");
    h.setNow(302000); await expect(h.service.approve(prepared.token, session)).rejects.toThrow("expired"); expect(h.records).toEqual([]);
  });
  it("rechecks revoked grant at approval and rejects conflicting signed proposals", async () => {
    const h = harness(), prepared = await h.service.prepare(proposal, session);
    h.authorize.mockRejectedValueOnce(Error("Revoked")); await expect(h.service.approve(prepared.token, session)).rejects.toThrow("Revoked"); expect(h.records).toEqual([]);
    await h.service.approve(prepared.token, session);
    const conflict = await h.service.prepare({ ...proposal, notificationOperationId: uuid(6) }, session);
    await expect(h.service.approve(conflict.token, session)).rejects.toThrow("conflict"); expect(h.records).toHaveLength(1);
  });
  it("status is exact owner and cancellation invalidates claim while preserving unknown evidence", async () => {
    const h = harness(), prepared = await h.service.prepare(proposal, session); await h.service.approve(prepared.token, session);
    const record = storedPlanExecutionSchema.parse(h.records[0]); record.fence = 7; record.leaseUntil = 50000; record.run.steps[0].state = "outcome_unknown"; record.run.steps[0].attempts = 1; h.records[0] = record;
    await expect(h.service.status(proposal.id, { ...session, activeMembershipId: 13 })).rejects.toThrow();
    const cancelled = await h.service.cancel(proposal.id, session);
    expect(cancelled).toMatchObject({ revision: 1, cancelRequested: true, state: "outcome_unknown", steps: [{ state: "outcome_unknown", attempts: 1 }] });
    expect(h.records[0]).toMatchObject({ fence: 8, leaseUntil: 0 });
    expect(await h.service.cancel(proposal.id, session)).toEqual(cancelled);
    h.authorize.mockRejectedValueOnce(Error("Revoked")); await expect(h.service.status(proposal.id, session)).rejects.toThrow("Revoked");
  });
  it("preserves corrupt unrelated records and allows owner revocation after expiry and grant or plan changes", async () => {
    const h = harness(), prepared = await h.service.prepare(proposal, session);
    const invalid = { unrelated: "preserve" }; h.records.push(invalid);
    const approved = await h.service.approve(prepared.token, session);
    expect(await h.service.status(proposal.id, session)).toEqual(approved);
    h.setNow(proposal.expiresAt + 1); h.authorize.mockRejectedValue(Error("Grant revoked or plan edited"));
    await expect(h.service.cancel(proposal.id, { ...session, userId: 18 })).rejects.toThrow();
    expect(await h.service.cancel(proposal.id, session)).toMatchObject({ cancelRequested: true, state: "cancelled" });
    expect(h.records[0]).toEqual(invalid);
  });
  it("returns only owner-bound status metadata after delegation authority expires or is revoked", async () => {
    const h = harness(), prepared = await h.service.prepare(proposal, session); await h.service.approve(prepared.token, session);
    const record = storedPlanExecutionSchema.parse(h.records[0]);
    record.run.state = "completed"; record.run.brief = "Private observed record"; record.run.notificationSaved = true;
    record.run.steps[0].attempts = 1; record.run.steps[0].state = "completed";
    record.run.steps[0].result = { operationId: uuid(4), summary: "Private asset", sourceReferences: ["asset:private"] }; h.records[0] = record;
    h.setNow(proposal.expiresAt + 1); h.authorize.mockRejectedValue(Error("Revoked or plan changed"));
    await expect(h.service.status(proposal.id, session)).rejects.toThrow();
    expect(await h.service.statusMetadata(proposal.id, session, proposal.grantReference)).toEqual({ reference: proposal.id, state: "completed", revision: 0, cancelRequested: false, workerAttemptStarted: true, notificationSaved: true, delegationExpiresAt: proposal.expiresAt, steps: [{ id: "read", state: "completed", attempts: 1, reconciliationAttempts: 0 }] });
    await expect(h.service.statusMetadata(proposal.id, session, "another-connection")).rejects.toThrow("connection changed");
    await expect(h.service.statusMetadata(proposal.id, { ...session, activeMembershipId: 13 })).rejects.toThrow();
    await expect(h.service.statusMetadata(proposal.id, { ...session, userId: 18 })).rejects.toThrow();
  });
});
