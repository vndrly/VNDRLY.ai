import { expect, it, vi } from "vitest";
vi.mock("@workspace/db", () => ({ pool: {} }));
import { createPlanExecution } from "./plan-execution";
import { createPrivatePlanExecutionRepository, type PrivatePlanExecutionStore } from "./plan-execution-repository";

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
function fixture() {
  const run = createPlanExecution({
    id: uuid(1), requester: { userId: 17, organizationKey: "vendor:4", membershipId: 12, sessionVersion: 1 },
    grantReference: "private-grant", taskId: uuid(2), taskVersion: 3,
    planId: uuid(3), planVersion: 2, planFingerprint: "a".repeat(64),
    approvedAt: 1000, expiresAt: 10000, maxAttempts: 3,
    steps: [{ id: "read", adapter: "authorized_read", toolName: "query_asset_custody", arguments: {}, dependsOn: [], operationId: uuid(4) }],
    notificationOperationId: uuid(5),
  });
  const records = [{ run, fence: 0, leaseUntil: 0 }];
  const reportInvalidRecord = vi.fn();
  let tail = Promise.resolve();
  const store: PrivatePlanExecutionStore = {
    reportInvalidRecord,
    async eligibleOwnerIds() { return [17]; },
    withRecords(userId, operation) {
      if (userId !== 17) throw Error("Wrong owner");
      const next = tail.then(() => operation(records));
      tail = next.then(() => undefined, () => undefined);
      return next;
    },
  };
  return { records, reportInvalidRecord, repository: createPrivatePlanExecutionRepository(store) };
}

it("only one worker claims a current lease", async () => {
  const f = fixture();
  const claims = await Promise.all([f.repository.claimNext(2000, 3000), f.repository.claimNext(2000, 3000)]);
  expect(claims.filter(Boolean)).toHaveLength(1);
});

it("fences an expired owner and preserves running state for reconciliation", async () => {
  const f = fixture();
  const old = (await f.repository.claimNext(2000, 3000))!;
  f.records[0].run.steps[0].state = "running";
  const recovered = (await f.repository.claimNext(3000, 4000))!;
  expect(recovered.fence).toBe(old.fence + 1);
  expect(recovered.run.steps[0].state).toBe("running");
  expect(await f.repository.commit(old, 0, { ...old.run, revision: 1 }, 3001)).toBe(false);
  await f.repository.release(old);
  expect(f.records[0].leaseUntil).toBe(4000);
});

it("refuses cancellation races and immutable authorization drift", async () => {
  const f = fixture();
  const claim = (await f.repository.claimNext(2000, 3000))!;
  const next = structuredClone(claim.run);
  next.revision++;
  next.authorization.steps[0].arguments = { different: true };
  expect(await f.repository.commit(claim, 0, next, 2001)).toBe(false);
  f.records[0].run.cancelRequested = true;
  expect(await f.repository.commit(claim, 0, { ...claim.run, revision: 1 }, 2001)).toBe(false);
  expect(f.records[0].run.revision).toBe(0);
});

it("preserves and reports a corrupt entry while allowing valid work after it", async () => {
  const f = fixture();
  f.records.unshift({ obsolete: true } as never);
  const claim = (await f.repository.claimNext(2000, 3000))!;
  expect(claim.run.authorization.requester.userId).toBe(17);
  expect(f.reportInvalidRecord).toHaveBeenCalledWith(17, 0);
  expect(f.records[0]).toEqual({ obsolete: true });
  expect(await f.repository.commit(claim, 0, { ...claim.run, revision: 1 }, 2001)).toBe(true);
  await f.repository.release(claim);
  expect(f.records[1].leaseUntil).toBe(0);
});
