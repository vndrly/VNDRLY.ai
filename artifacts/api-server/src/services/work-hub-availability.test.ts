import { describe, expect, it } from "vitest";
import { createWorkHubAvailabilityService } from "./work-hub-availability";
import { emptyFleetState, type FleetRepository } from "./fleet-repository";
import type { PoolClient } from "pg";
import type { SessionPayload } from "../lib/session";
const session = {
  userId: 2,
  vendorId: 7,
  role: "field_employee",
  membershipRole: "field_employee",
  activeMembershipId: 12,
  vendorPeopleId: 22,
  sv: 3,
} as SessionPayload;
const window = {
  plannedStartAt: "2026-10-10T10:00:00Z",
  plannedEndAt: "2026-10-10T11:00:00Z",
  timezone: "UTC",
};
function fixture() {
  let rows: Record<string, unknown>[] = [];
  const audits: Record<string, unknown>[] = [];
  let active = true;
  const writes: string[] = [];
  const client = {
    query: async (text: string, params: unknown[]) => {
      if (text.includes("FROM vendor_people")) return { rows: [{ id: 22 }] };
      if (text.startsWith("SELECT id,starts_at"))
        return {
          rows: rows
            .slice()
            .sort((a, b) => String(a.id).localeCompare(String(b.id))),
        };
      if (text.includes("SELECT tool_output"))
        return {
          rows: audits
            .filter((r) => r.savedOperationId === params[0])
            .map((r) => {
              const { savedOperationId, ...tool_output } = r;
              return { tool_output };
            }),
        };
      if (text.startsWith("SELECT s.starts_at")) return { rows: [] };
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
      if (text.startsWith("INSERT INTO assistant_action_audit"))
        audits.push({
          ...JSON.parse(String(params[3])),
          savedOperationId: params[2],
        });
      return { rows: [] };
    },
  } as unknown as PoolClient;
  const repo = {
    transaction: async (companyId, userId, op, authority) => {
      if (
        !active ||
        companyId !== 7 ||
        userId !== 2 ||
        authority?.sv !== 3 ||
        authority.activeMembershipId !== 12
      )
        throw Error("current authority refused");
      return op(emptyFleetState(), client);
    },
  } satisfies FleetRepository;
  return {
    service: createWorkHubAvailabilityService(repo),
    writes,
    corrupt: (field: string, value: unknown) => {
      audits[0][field] = value;
    },
    revoked: () => {
      active = false;
    },
  };
}
describe("personal WorkHub availability uses shared Fleet evidence engine", () => {
  it("allows an active nonFleet worker exact own interval/replay/readback and refuses changed operation body", async () => {
    const f = fixture(),
      snapshot = await f.service.read(session);
    const body = {
      operationId: "11111111-1111-4111-8111-111111111111",
      recordId: null,
      expectedFingerprint: snapshot.fingerprint,
      window,
      available: true,
    };
    const first = await f.service.save(session, body);
    expect(first).toMatchObject({
      userId: 2,
      companyId: 7,
      actorMembershipId: 12,
      actorSessionVersion: 3,
      physicalReadinessVerified: false,
    });
    expect(await f.service.save(session, body)).toEqual(first);
    expect(await f.service.readOperation(session, body.operationId)).toEqual({
      receipt: first,
    });
    expect(f.writes).toHaveLength(1);
    await expect(
      f.service.save(session, { ...body, available: false }),
    ).rejects.toThrow("operation_conflict");
  });
  it("rechecks current authority before first/replay/readback and rejects model other-user/admin/partner targets", async () => {
    const f = fixture(),
      snapshot = await f.service.read(session),
      body = {
        operationId: "22222222-2222-4222-8222-222222222222",
        recordId: null,
        expectedFingerprint: snapshot.fingerprint,
        window,
        available: true,
      };
    await expect(
      f.service.save(session, { ...body, userId: 99 }),
    ).rejects.toThrow();
    for (const s of [
      { ...session, role: "partner", vendorId: undefined, partnerId: 8 },
      { ...session, role: "vendor", membershipRole: "admin" },
    ] as SessionPayload[])
      await expect(f.service.read(s)).rejects.toThrow("forbidden");
    await f.service.save(session, body);
    f.revoked();
    await expect(f.service.save(session, body)).rejects.toThrow(
      "current authority",
    );
    await expect(
      f.service.readOperation(session, body.operationId),
    ).rejects.toThrow("current authority");
    expect(f.writes).toHaveLength(1);
  });
  it("rejects substituted operation and company in saved replay receipts", async () => {
    for (const [field, value] of [
      ["operationId", "99999999-9999-4999-8999-999999999999"],
      ["companyId", 99],
    ] as const) {
      const f = fixture(),
        snapshot = await f.service.read(session),
        body = {
          operationId: "66666666-6666-4666-8666-666666666666",
          recordId: null,
          expectedFingerprint: snapshot.fingerprint,
          window,
          available: true,
        };
      await f.service.save(session, body);
      f.corrupt(field, value);
      await expect(f.service.save(session, body)).rejects.toThrow(
        "operation_conflict",
      );
      expect(f.writes).toHaveLength(1);
    }
  });
  it("refuses stale fingerprint and overlapping new records without effects", async () => {
    const f = fixture(),
      snapshot = await f.service.read(session),
      body = {
        operationId: "33333333-3333-4333-8333-333333333333",
        recordId: null,
        expectedFingerprint: snapshot.fingerprint,
        window,
        available: true,
      };
    await f.service.save(session, body);
    await expect(
      f.service.save(session, {
        ...body,
        operationId: "44444444-4444-4444-8444-444444444444",
      }),
    ).rejects.toThrow("version_conflict");
    const fresh = await f.service.read(session);
    await expect(
      f.service.save(session, {
        ...body,
        operationId: "55555555-5555-4555-8555-555555555555",
        expectedFingerprint: fresh.fingerprint,
      }),
    ).rejects.toThrow("record_conflict");
    expect(f.writes).toHaveLength(1);
  });
});
