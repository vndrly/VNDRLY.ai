import { expect, it, vi } from "vitest";
import { createPlanOpportunityRead } from "./plan-execution-opportunities";
import type { PlanExecutionAuthorization, PlanExecutionStep } from "./plan-execution";
vi.mock("./workday-opportunity-chatgpt", () => ({ handleWorkdayOpportunityTool: vi.fn(), workdayOpportunityAvailable: (_name: unknown, _session: unknown, scopes: string[]) => scopes.includes("catalog:read") }));
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const step: PlanExecutionStep = { id: "opportunities", adapter: "authorized_read", toolName: "query_qualified_hotlist_jobs", arguments: { limit: 25, afterJobId: 0 }, dependsOn: [], operationId: uuid(4) };
const authorization: PlanExecutionAuthorization = { id: uuid(1), requester: { userId: 17, organizationKey: "vendor:4", membershipId: 12, sessionVersion: 1 }, grantReference: "private", taskId: uuid(2), taskVersion: 1, planId: uuid(3), planVersion: 1, planFingerprint: "a".repeat(64), approvedAt: 1, expiresAt: 900000, maxAttempts: 1, steps: [step], notificationOperationId: uuid(5) };
function harness() {
  const authorize = vi.fn(async () => ({ session: { userId: 17, role: "vendor", vendorId: 4, activeMembershipId: 12, sv: 1 }, scopes: ["catalog:read"], current: { ...authorization.requester, grantReference: "private", grantRevoked: false, taskId: uuid(2), taskVersion: 1, planId: uuid(3), planVersion: 1, planFingerprint: authorization.planFingerprint, availableTools: [step.toolName] } }));
  const read = vi.fn(async (): Promise<any> => ({ observedAt: "2026-10-07T12:00:00Z", opportunities: Array.from({ length: 20 }, (_, index) => ({ jobId: index + 1, partnerId: 2, workTypeId: 3, title: "A".repeat(500), serviceMatch: "exact_vendor_catalog_work_type", derivedRelationshipStatus: "approved", complianceFloor: "passed", geography: "within_radius", deadlineState: "recorded_future_or_today", eligibleRecordedOpportunity: true, capacity: "unknown", workerQualifications: "unknown" })) }));
  return { authorize, read, execute: createPlanOpportunityRead({ authorize, read, now: () => Date.parse("2026-10-07T12:00:01Z") }) };
}
it("bounds long canonical records without turning a successful read into failure", async () => {
  const h = harness(), result = await h.execute(authorization, step), summary = JSON.parse(result.summary);
  expect(result.summary.length).toBeLessThanOrEqual(7800);
  expect(summary.partial).toBe(true); expect(summary.omittedFromSummary).toBeGreaterThan(0);
  expect(result.sourceReferences.slice(1)).toEqual(summary.records.map((row: { jobId: number }) => `hotlist-job:${row.jobId}`));
  expect(h.authorize).toHaveBeenCalledTimes(2);
});
it("refuses changed arguments before reading and revoked access after reading", async () => {
  const h = harness(); await expect(h.execute(authorization, { ...step, arguments: { limit: 1 } })).rejects.toThrow(); expect(h.read).not.toHaveBeenCalled();
  h.authorize.mockRejectedValueOnce(Error("Revoked")); await expect(h.execute(authorization, step)).rejects.toThrow("Revoked");
  const second = harness(); second.authorize.mockResolvedValueOnce(await second.authorize()).mockRejectedValueOnce(Error("Revoked after read"));
  await expect(second.execute(authorization, step)).rejects.toThrow("Revoked after read");
});
