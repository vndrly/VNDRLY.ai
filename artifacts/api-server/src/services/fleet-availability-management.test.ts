import { describe, expect, it } from "vitest";
import type { PoolClient } from "pg";
import { createFleetAvailabilityManagement } from "./fleet-availability-management";
import { emptyFleetState, type FleetState } from "./fleet-repository";
import type { FleetActor } from "./fleet-ops";

const fleetId = "11111111-1111-4111-8111-111111111111";
const manager = { userId: 1, companyId: 7 } as FleetActor;
const driver = { userId: 2, companyId: 7 } as FleetActor;
const window = {
  plannedStartAt: "2026-10-10T10:00:00Z",
  plannedEndAt: "2026-10-10T11:00:00Z",
  timezone: "America/Chicago",
};
function fixture() {
  const state: FleetState = {
    ...emptyFleetState(),
    enabled: true,
    fleets: [
      {
        id: fleetId,
        name: "Fictional",
        equipmentAssetIds: [],
        requiredCertifications: [],
        siteIds: [9],
      },
    ],
    grants: [
      {
        userId: 1,
        fleetIds: [fleetId],
        siteIds: [9],
        roles: ["dispatcher"],
        safetyRelease: false,
        financeRead: false,
      },
      {
        userId: 2,
        fleetIds: [fleetId],
        siteIds: [9],
        roles: ["driver"],
        safetyRelease: false,
        financeRead: false,
      },
    ],
  };
  let rows: Record<string, unknown>[] = [],
    audits: Record<string, unknown>[] = [],
    gate: Record<string, unknown>[] = [];
  const writes: string[] = [];
  const client = {
    query: async (text: string, params: unknown[]) => {
      if (text.startsWith("SELECT s.starts_at,s.ends_at"))
        return { rows: gate };
      if (text.includes("FROM vendor_people")) return { rows: [{ id: 2 }] };
      if (text.startsWith("SELECT id,starts_at"))
        return {
          rows: rows
            .slice()
            .sort((a, b) => String(a.id).localeCompare(String(b.id))),
        };
      if (text.includes("SELECT tool_output"))
        return {
          rows: audits
            .filter((row) => row.operationId === params[0])
            .map((row) => ({ tool_output: row })),
        };
      if (text.startsWith("INSERT INTO work_hub_availability")) {
        writes.push(text);
        rows.push({
          id: params[0],
          starts_at: params[3],
          ends_at: params[4],
          available: params[5],
          recurrence: null,
        });
      }
      if (text.startsWith("UPDATE work_hub_availability")) {
        writes.push(text);
        rows = rows.map((row) =>
          row.id === params[0]
            ? {
                ...row,
                starts_at: params[3],
                ends_at: params[4],
                available: params[5],
              }
            : row,
        );
      }
      if (text.startsWith("INSERT INTO assistant_action_audit")) {
        writes.push(text);
        audits.push(JSON.parse(String(params[3])));
      }
      return { rows: [] };
    },
  } as unknown as PoolClient;
  const service = createFleetAvailabilityManagement(
    async (actor, operation) => {
      if (actor.companyId !== 7) throw new Error("foreign company");
      actor.currentSiteIds = [9];
      return operation(state, client);
    },
  );
  return {
    state,
    service,
    writes,
    rows: () => rows,
    audits: () => audits,
    gate: (value: Record<string, unknown>[]) => {
      gate = value;
    },
  };
}
describe("Fleet recorded availability commands", () => {
  it("preserves covering evidence for assigned Gate shifts while allowing nonoverlapping edits", async () => {
    const f = fixture(),
      initial = await f.service.driverAvailability(manager, 2);
    const saved = await f.service.recordDriverAvailability(manager, {
      operationId: crypto.randomUUID(),
      driverUserId: 2,
      recordId: null,
      expectedFingerprint: initial.fingerprint,
      window,
      available: true,
    });
    f.gate([
      { starts_at: window.plannedStartAt, ends_at: window.plannedEndAt },
    ]);
    const current = await f.service.driverAvailability(manager, 2);
    await expect(
      f.service.recordDriverAvailability(manager, {
        operationId: crypto.randomUUID(),
        driverUserId: 2,
        recordId: saved.record.id,
        expectedFingerprint: current.fingerprint,
        window,
        available: false,
      }),
    ).rejects.toThrow("fleet.driver_schedule_conflict");
    expect(f.rows()[0].available).toBe(true);
    const other = {
      plannedStartAt: "2026-10-11T10:00:00Z",
      plannedEndAt: "2026-10-11T11:00:00Z",
      timezone: "UTC",
    };
    await f.service.recordDriverAvailability(manager, {
      operationId: crypto.randomUUID(),
      driverUserId: 2,
      recordId: null,
      expectedFingerprint: current.fingerprint,
      window: other,
      available: false,
    });
    expect(f.rows()).toHaveLength(2);
  });
  it("scopes reads to current own driver and forbids driver managing evidence", async () => {
    const f = fixture();
    expect((await f.service.driverAvailability(driver, 2)).canManage).toBe(
      false,
    );
    await expect(f.service.driverAvailability(driver, 1)).rejects.toThrow(
      "fleet.dispatch_required",
    );
    const current = await f.service.driverAvailability(driver, 2);
    await expect(
      f.service.recordDriverAvailability(driver, {
        operationId: crypto.randomUUID(),
        driverUserId: 2,
        recordId: null,
        expectedFingerprint: current.fingerprint,
        window,
        available: true,
      }),
    ).rejects.toThrow("fleet.dispatch_required");
    expect(f.writes).toEqual([]);
  });
  it("saves an exact row and audit once, replays immutable receipt, rejects altered payload", async () => {
    const f = fixture(),
      current = await f.service.driverAvailability(manager, 2);
    const command = {
      operationId: crypto.randomUUID(),
      driverUserId: 2,
      recordId: null,
      expectedFingerprint: current.fingerprint,
      window,
      available: true,
    };
    const saved = await f.service.recordDriverAvailability(manager, command);
    expect(saved.record).toMatchObject({
      startsAt: new Date(window.plannedStartAt).toISOString(),
      endsAt: new Date(window.plannedEndAt).toISOString(),
      available: true,
      recurring: false,
    });
    expect(await f.service.recordDriverAvailability(manager, command)).toEqual(
      saved,
    );
    expect(
      (
        await f.service.driverAvailabilityOperation(
          manager,
          2,
          command.operationId,
        )
      ).receipt,
    ).toEqual(saved);
    expect(f.rows()).toHaveLength(1);
    expect(f.audits()).toHaveLength(1);
    await expect(
      f.service.recordDriverAvailability(manager, {
        ...command,
        available: false,
      }),
    ).rejects.toThrow("fleet.operation_conflict");
    f.state.grants[0].roles = [];
    await expect(
      f.service.recordDriverAvailability(manager, command),
    ).rejects.toThrow("fleet.dispatch_required");
  });
  it("refuses stale CAS or overlapping new evidence without writes", async () => {
    const f = fixture(),
      initial = await f.service.driverAvailability(manager, 2);
    const command = {
      operationId: crypto.randomUUID(),
      driverUserId: 2,
      recordId: null,
      expectedFingerprint: initial.fingerprint,
      window,
      available: true,
    };
    await f.service.recordDriverAvailability(manager, command);
    await expect(
      f.service.recordDriverAvailability(manager, {
        ...command,
        operationId: crypto.randomUUID(),
      }),
    ).rejects.toThrow("fleet.version_conflict");
    const current = await f.service.driverAvailability(manager, 2);
    await expect(
      f.service.recordDriverAvailability(manager, {
        ...command,
        operationId: crypto.randomUUID(),
        expectedFingerprint: current.fingerprint,
      }),
    ).rejects.toThrow("fleet.availability_record_conflict");
    expect(f.rows()).toHaveLength(1);
    expect(f.audits()).toHaveLength(1);
  });
  it("updates only the explicitly selected current record", async () => {
    const f = fixture(),
      initial = await f.service.driverAvailability(manager, 2);
    const saved = await f.service.recordDriverAvailability(manager, {
      operationId: crypto.randomUUID(),
      driverUserId: 2,
      recordId: null,
      expectedFingerprint: initial.fingerprint,
      window,
      available: true,
    });
    const current = await f.service.driverAvailability(manager, 2);
    const updated = await f.service.recordDriverAvailability(manager, {
      operationId: crypto.randomUUID(),
      driverUserId: 2,
      recordId: saved.record.id,
      expectedFingerprint: current.fingerprint,
      window,
      available: false,
    });
    expect(updated.record.id).toBe(saved.record.id);
    expect(updated.record.available).toBe(false);
    expect(f.rows()).toHaveLength(1);
  });
});
