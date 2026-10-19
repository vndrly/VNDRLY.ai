import { expect, it, vi } from "vitest";
import {
  FleetWorkCommandSchema,
  FleetWorkScopeSchema,
  type FleetWorkReceipt,
  type FleetWorkCommand,
  type FleetReconciliationCase,
} from "@workspace/api-zod";
import {
  createFleetWorkService,
  type FleetWorkRepository,
  type FleetWorkTransaction,
  type FleetWorkExecution,
} from "./fleet-work";
import { FleetError } from "./fleet-repository";
const id = (n: number) =>
  `44444444-4444-4444-8444-${String(n).padStart(12, "0")}`;
const scope = FleetWorkScopeSchema.parse({
  owner: { type: "vendor", id: 7 },
  userId: 2,
  membershipId: 8,
  sessionVersion: 3,
  deviceId: "test-device",
  provisioningId: id(1),
});
const actor = {
  userId: 2,
  companyId: 7,
  sv: 3,
  activeMembershipId: 8,
  role: "field_employee",
  membershipRole: "field_employee",
  vendorPeopleId: 5,
};
const command = (n = 2) =>
  FleetWorkCommandSchema.parse({
    version: 2,
    operationId: id(n),
    scope,
    capturedAt: "2026-10-16T18:00:00Z",
    timeZone: "America/Chicago",
    dependencies: [],
    kind: "activity.note",
    payload: {
      activity: { type: "canonical", kind: "activity", id: id(10), version: 2 },
      ticket: { type: "canonical", kind: "ticket", id: 123, version: 1 },
      notes: "Actual performed-work observation",
    },
  }) as Extract<FleetWorkCommand, { kind: "activity.note" }>;
function fixture() {
  let receipts: FleetWorkReceipt[] = [],
    cases: FleetReconciliationCase[] = [],
    effects = 0;
  const trace: string[] = [],
    afterCommit = vi.fn(async () => {}),
    execute = vi.fn(
      async (c: FleetWorkCommand): Promise<FleetWorkExecution> => {
        effects++;
        return {
          mappings: [],
          canonicalReferences: [
            {
              type: "canonical" as const,
              kind: "activity" as const,
              id: id(10),
              version: 3,
            },
          ],
          afterCommit: [afterCommit],
        };
      },
    );
  let failCommit = false,
    provisionCurrent = true;
  const repository: FleetWorkRepository = {
    async transaction(_actor, operation) {
      const before = {
        receipts: structuredClone(receipts),
        cases: structuredClone(cases),
        effects,
      };
      const tx: FleetWorkTransaction = {
        requireProvisioning: async (_scope, write) => {
          trace.push("provision");
          if (write && !provisionCurrent)
            throw new FleetError("fleet.work_provisioning_expired", 403);
        },
        readReceipt: async (_scope, operationId) => {
          trace.push("receipt");
          return receipts.find((r) => r.operationId === operationId) ?? null;
        },
        saveReceipt: async (r) => {
          trace.push("save-receipt");
          receipts.push(structuredClone(r));
        },
        saveCase: async (c) => {
          cases.push(structuredClone(c));
        },
        execute: async (c) => {
          trace.push("execute");
          return execute(c);
        },
      };
      try {
        const result = await operation(tx);
        if (failCommit) throw Error("Injected commit failure");
        trace.push("commit");
        return result;
      } catch (e) {
        ({ receipts, cases, effects } = before);
        trace.push("rollback");
        throw e;
      }
    },
  };
  const service = createFleetWorkService(
    repository,
    () => new Date("2026-10-16T18:01:00Z"),
  );
  return {
    service,
    trace,
    execute,
    afterCommit,
    get receipts() {
      return receipts;
    },
    get cases() {
      return cases;
    },
    get effects() {
      return effects;
    },
    failCommit: () => {
      failCommit = true;
    },
    expire: () => {
      provisionCurrent = false;
    },
  };
}
it("returns the canonical receipt before re-executing a lost-response command", async () => {
  const f = fixture(),
    original = command();
  const first = await f.service.apply(actor, original);
  const retry = await f.service.apply(actor, original);
  expect(first.status).toBe("applied");
  expect(retry).toMatchObject({ ...first, status: "duplicate" });
  expect(f.execute).toHaveBeenCalledOnce();
  expect(f.effects).toBe(1);
  expect(f.receipts).toHaveLength(1);
  expect(f.afterCommit).toHaveBeenCalledOnce();
  expect(f.trace.indexOf("commit")).toBeLessThan(
    f.trace.lastIndexOf("provision"),
  );
});
it("rejects reused operation identities and cross-account/company/membership/session/provisioning readback", async () => {
  const f = fixture(),
    original = command();
  await f.service.apply(actor, original);
  await expect(
    f.service.apply(actor, {
      ...original,
      payload: { ...original.payload, notes: "Different facts" },
    }),
  ).rejects.toMatchObject({ code: "fleet.operation_conflict" });
  for (const changed of [
    { ...actor, userId: 3 },
    { ...actor, companyId: 9 },
    { ...actor, activeMembershipId: 9 },
    { ...actor, sv: 4 },
  ])
    await expect(f.service.apply(changed, original)).rejects.toMatchObject({
      status: 403,
    });
  await expect(
    f.service.read(
      actor,
      { ...scope, provisioningId: id(99) },
      original.operationId,
    ),
  ).rejects.toMatchObject({ status: 403 });
  expect(f.execute).toHaveBeenCalledOnce();
});
it("rolls back canonical changes and receipt together and never delivers before commit", async () => {
  const f = fixture();
  f.failCommit();
  await expect(f.service.apply(actor, command())).rejects.toThrow(
    "Injected commit failure",
  );
  expect(f.effects).toBe(0);
  expect(f.receipts).toHaveLength(0);
  expect(f.afterCommit).not.toHaveBeenCalled();
});
it("retains a definite business conflict as a safe case while independent work still applies", async () => {
  const f = fixture();
  f.execute.mockRejectedValueOnce(new FleetError("fleet.version_conflict"));
  const refused = await f.service.apply(actor, command());
  expect(refused).toMatchObject({
    status: "needs_reconciliation",
    reason: "stale_revision",
  });
  expect(f.cases).toHaveLength(1);
  expect(f.cases[0].originalReferences).toContainEqual(
    command().payload.activity,
  );
  expect(JSON.stringify(f.receipts)).not.toContain("Actual performed-work");
  expect((await f.service.apply(actor, command(3))).status).toBe("applied");
  expect(f.afterCommit).toHaveBeenCalledOnce();
});
it("does not permanently refuse a pending dependency or convert an outage to an empty successful result", async () => {
  const f = fixture();
  const pending = { ...command(), dependencies: [id(98)] };
  expect(await f.service.apply(actor, pending)).toMatchObject({
    status: "retry_later",
    reason: "invalid_dependency",
  });
  expect(f.execute).not.toHaveBeenCalled();
  expect(f.receipts).toHaveLength(0);
  f.execute.mockRejectedValueOnce(Error("Store unreachable"));
  await expect(f.service.apply(actor, command(3))).rejects.toThrow(
    "Store unreachable",
  );
  expect(f.receipts).toHaveLength(0);
});
it("allows exact receipt recovery after provision expiry without allowing a new write", async () => {
  const f = fixture(),
    original = command();
  const receipt = await f.service.apply(actor, original);
  f.expire();
  expect(await f.service.read(actor, scope, original.operationId)).toEqual(
    receipt,
  );
  expect((await f.service.apply(actor, original)).status).toBe("duplicate");
  await expect(f.service.apply(actor, command(3))).rejects.toMatchObject({
    code: "fleet.work_provisioning_expired",
  });
});
it("does not turn a post-commit notification failure into an unknown failed mutation", async () => {
  const f = fixture();
  f.afterCommit.mockRejectedValueOnce(Error("Provider unavailable"));
  expect((await f.service.apply(actor, command())).status).toBe("applied");
  expect(f.receipts).toHaveLength(1);
  expect(f.effects).toBe(1);
});
it("refuses a receipt mapping for an identity absent from the original command", async () => {
  const f = fixture();
  f.execute.mockResolvedValueOnce({
    canonicalReferences: [],
    mappings: [
      {
        local: { type: "local", kind: "evidence", id: id(70) },
        canonical: {
          type: "canonical",
          kind: "evidence",
          id: id(71),
          version: 1,
        },
      },
    ],
  });
  await expect(f.service.apply(actor, command())).rejects.toThrow(
    /identity absent/,
  );
  expect(f.receipts).toHaveLength(0);
});
it("limits a closed-ticket case to explicit ticket replacement or retention without offering implicit reopen", async () => {
  const f = fixture();
  f.execute.mockRejectedValueOnce(new FleetError("fleet.ticket_closed"));
  expect(await f.service.apply(actor, command())).toMatchObject({
    status: "needs_reconciliation",
    reason: "closed_ticket",
  });
  expect(f.cases[0].allowedResolutions).toEqual([
    "link_open_ticket",
    "create_ticket",
    "retain_record_only",
  ]);
});
it("keeps an unresolved media/reference dependency retryable without recording a permanent business refusal", async () => {
  const f = fixture();
  f.execute.mockRejectedValueOnce(
    new FleetError("fleet.work_dependency_unresolved"),
  );
  expect(await f.service.apply(actor, command())).toMatchObject({
    status: "retry_later",
    reason: "invalid_dependency",
  });
  expect(f.receipts).toHaveLength(0);
  expect(f.cases).toHaveLength(0);
  expect((await f.service.apply(actor, command(3))).status).toBe("applied");
});
