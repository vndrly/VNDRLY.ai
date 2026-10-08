import { describe, it, expect, vi } from "vitest";
import { randomUUID } from "node:crypto";
import {
  OfflineGateObservationSchema,
  authorizeOfflineGateObservation,
  createOfflineGateObservationService,
} from "./gate-offline-observation";
const command = () => ({
  operationId: randomUUID(),
  siteLocationId: 1,
  direction: "entry" as const,
  source: "gatekeeper" as const,
  observedAt: new Date().toISOString(),
  reportedVisitor: { firstName: "Synthetic", lastName: "Visitor" },
});
describe("offline gate recorded observation", () => {
  it("requires supplied visitor and exact exit identity instead of matching the newest plate", () => {
    expect(
      OfflineGateObservationSchema.safeParse({
        ...command(),
        reportedVisitor: undefined,
      }).success,
    ).toBe(false);
    expect(
      OfflineGateObservationSchema.safeParse({
        ...command(),
        direction: "exit",
        plate: "SYNTHETIC",
        reportedVisitor: undefined,
      }).success,
    ).toBe(false);
    expect(
      OfflineGateObservationSchema.safeParse({
        ...command(),
        direction: "exit",
        originalVisitId: 5,
        reportedVisitor: undefined,
      }).success,
    ).toBe(true);
    expect(
      OfflineGateObservationSchema.safeParse({
        ...command(),
        direction: "exit",
        originalVisitId: 5,
        entryOperationId: randomUUID(),
      }).success,
    ).toBe(false);
  });
  it("rejects invented camera provenance and future observations", async () => {
    expect(
      OfflineGateObservationSchema.safeParse({ ...command(), source: "camera" })
        .success,
    ).toBe(false);
    const service = createOfflineGateObservationService(
      { connect: vi.fn() } as any,
      vi.fn(),
    );
    await expect(
      service.execute(
        { userId: 1, vendorId: 2 },
        {
          ...command(),
          observedAt: new Date(Date.now() + 86400000).toISOString(),
        },
      ),
    ).rejects.toThrow("gate.observation_future");
  });
  it("rechecks current role and site instead of accepting stale signed admin claim", async () => {
    const c = {
      query: vi.fn(async (sql: string) => ({
        rows: sql.includes("FROM users")
          ? [{ session_version: 1 }]
          : sql.includes("site_work_assignments")
            ? [{ id: 1 }]
            : sql.includes("user_org_memberships")
              ? [{ role: "member" }]
              : [],
      })),
    };
    await expect(
      authorizeOfflineGateObservation(
        c as any,
        {
          userId: 1,
          vendorId: 2,
          sv: 1,
          membershipRole: "admin",
          role: "vendor",
        },
        3,
      ),
    ).rejects.toThrow("gate.person_no_access");
  });
  it("rejects revoked user session before site access", async () => {
    const c = {
      query: vi.fn(async () => ({ rows: [{ session_version: 2 }] })),
    };
    await expect(
      authorizeOfflineGateObservation(
        c as any,
        { userId: 1, vendorId: 2, sv: 1 },
        3,
      ),
    ).rejects.toThrow("gate.current_session_required");
    expect(c.query).toHaveBeenCalledTimes(1);
  });
  it("rejects canonical op retry changed payload under the same operation UUID", async () => {
    const input = command(),
      release = vi.fn(),
      query = vi.fn(async (sql: string) => ({
        rows: sql.includes("SELECT user_id,vendor_id,tool_input")
          ? [
              {
                user_id: 1,
                vendor_id: 2,
                tool_input: { fingerprint: "different" },
                tool_output: { id: 7 },
              },
            ]
          : [],
      }));
    const auth = vi.fn();
    const service = createOfflineGateObservationService(
      { connect: async () => ({ query, release }) } as any,
      auth,
    );
    await expect(
      service.execute({ userId: 1, vendorId: 2 }, input),
    ).rejects.toThrow("gate.observation_operation_conflict");
    expect(query).toHaveBeenCalledWith("ROLLBACK");
    expect(query.mock.calls.some((c) => c[0].includes("INSERT"))).toBe(false);
    expect(auth).toHaveBeenCalledBefore(release);
  });
  it("never serves retry receipt after authority has been revoked", async () => {
    const query = vi.fn(async (_sql: string) => ({ rows: [] })),
      release = vi.fn(),
      auth = vi.fn(async () => {
        throw new Error("revoked");
      });
    const service = createOfflineGateObservationService(
      { connect: async () => ({ query, release }) } as any,
      auth,
    );
    await expect(
      service.execute({ userId: 1, vendorId: 2 }, command()),
    ).rejects.toThrow("revoked");
    expect(
      query.mock.calls.some((c) => c[0].includes("assistant_action_audit")),
    ).toBe(false);
  });
});

it("native Gate authority used by identity capture honors vendor and site owner opt-out", async () => {
  for (const optedOut of ["vendors", "partners"]) {
    const c = {
      query: vi.fn(async (sql: string) => ({
        rows: sql.includes("FROM users")
          ? [{ session_version: 1 }]
          : sql.includes("native_operations_policy")
            ? [
                {
                  native_operations_policy: {
                    enabled: !sql.includes("FROM " + optedOut),
                  },
                },
              ]
            : [],
      })),
    };
    await expect(
      authorizeOfflineGateObservation(
        c as any,
        { userId: 1, vendorId: 2, sv: 1 },
        3,
      ),
    ).rejects.toThrow("native.company_opted_out");
  }
});
