import { expect, it, vi } from "vitest";
import type { Pool } from "pg";
import { readGateStaffingCandidates, GATE_STAFFING_CANDIDATE_OUTPUT } from "./gate-staffing-candidates";
import type { requireChangeOverAccess } from "../services/gate-change-over";
const id = "00000000-0000-4000-8000-000000000001";
const session = { userId: 17, role: "vendor", vendorId: 4, activeMembershipId: 8, membershipRole: "admin", sv: 2 };
const shift = { id, version: 1, site_id: 392, starts_at: "2026-10-08T08:00:00Z", ends_at: "2026-10-08T16:00:00Z", qualification_codes: ["Site training"], required_count: 2, assigned_count: 1, actual_count: 0, coverage_state: "understaffed" };
function harness(options: { cert?: boolean; available?: boolean; conflict?: boolean; person?: boolean; contract?: boolean; missingExpiry?: boolean; expiry?: string | Date } = {}) {
  const query = vi.fn(async (text: string) => ({ rows: text.includes("FROM work_hub_shifts s JOIN gate_stations") ? [shift]
    : text.startsWith("SELECT a.id FROM site_work_assignments") ? options.contract === false ? [] : [{ id: 1 }]
    : text.startsWith("SELECT p.id") ? options.person === false ? [] : [{ id: 9, user_id: 18, first_name: "Synthetic", last_name: "Gate" }]
    : text.startsWith("SELECT id,name") ? options.cert ? [{ id: 5, name: "Site training", expiration_date: options.missingExpiry ? null : options.expiry ?? "2026-12-31", vendor_verified_at: new Date() }] : []
    : text.startsWith("SELECT s.id,s.starts_at") ? options.conflict ? [{ id, starts_at: shift.starts_at, ends_at: shift.ends_at }] : []
    : text.startsWith("SELECT id,starts_at") ? options.available ? [{ id, starts_at: shift.starts_at, ends_at: shift.ends_at, available: true, recurrence: null }] : [] : [] }));
  const release = vi.fn(), database = { connect: vi.fn(async () => ({ query, release })) } as unknown as Pick<Pool, "connect">;
  const authorize = vi.fn(async () => ({ supervisor: true, site: { id: 392 }, user: { id: 17 } })) as unknown as typeof requireChangeOverAccess;
  return { query, database, authorize, release, read: () => readGateStaffingCandidates({ shiftId: id }, session, ["gate:read", "workforce:read"], database, authorize, new Date("2026-10-07T12:00:00Z")) };
}
it("returns recorded configured qualifications/availability with unknown reachability and no assignment", async () => {
  const h = harness({ cert: true, available: true }), result = await h.read();
  expect(result).toMatchObject({ shiftVersion: 1, assignmentMade: false, messageSent: false, candidates: [{ qualificationState: "recorded_requirements_verified", availability: "recorded_available", contact: { workHubUserId: 18, reachability: "unknown" } }] });
  expect(h.authorize).toHaveBeenCalledTimes(2);
  const sql = h.query.mock.calls.find(([text]) => text.startsWith("SELECT p.id"))![0];
  for (const boundary of ["p.vendor_id=$1", "p.deleted_at IS NULL", "u.suspended_at IS NULL", "a.is_active=true", "r.is_active=true", "NOT EXISTS"]) expect(sql).toContain(boundary);
  expect(JSON.stringify(result)).not.toContain("phone");
  expect(() => GATE_STAFFING_CANDIDATE_OUTPUT.parse({ ...result, secret: "private" })).toThrow();
  expect(() => GATE_STAFFING_CANDIDATE_OUTPUT.parse({ ...result, assignmentMade: true })).toThrow();
});
it("does not substitute roster identity for qualifications, availability or contact reachability", async () => {
  expect((await harness().read()).candidates[0]).toMatchObject({ qualificationState: "missing_or_unverified", availability: "unknown_no_window", eligibility: { allowed: false, code: "workforce.credentials_expired" } });
  expect((await harness({ cert: true, available: true, conflict: true }).read()).candidates[0]).toMatchObject({ availability: "recorded_conflict", eligibility: { allowed: false, code: "workforce.shift_overlap" } });
  expect((await harness({ person: false }).read()).candidates).toEqual([]);
  expect((await harness({ cert: true, missingExpiry: true }).read()).candidates[0]).toMatchObject({ qualificationState: "missing_or_unverified", requirements: [{ currentRecorded: false, vendorVerified: false }] });
  expect((await harness({ cert: true, expiry: new Date("2020-01-01T00:00:00Z") }).read()).candidates[0].qualificationState).toBe("missing_or_unverified");
  expect((await harness({ cert: true, expiry: new Date("2026-12-31T00:00:00Z") }).read()).candidates[0].qualificationState).toBe("recorded_requirements_verified");
  expect((await harness({ cert: true, expiry: "invalid" }).read()).candidates[0].qualificationState).toBe("missing_or_unverified");
});
it("fails closed for revoked contract or actor authority before/after the candidate read", async () => {
  const h = harness({ contract: false }); await expect(h.read()).rejects.toThrow("contract_required"); expect(h.query.mock.calls.some(([text]) => text.startsWith("SELECT p.id"))).toBe(false); expect(h.release).toHaveBeenCalled();
  const revoked = harness(); vi.mocked(revoked.authorize).mockRejectedValueOnce(Error("Permission revoked")); await expect(revoked.read()).rejects.toThrow("Permission revoked");
  const ordinary = harness(); vi.mocked(ordinary.authorize).mockResolvedValueOnce({ supervisor: false, site: { id: 392 }, user: { id: 17 } } as Awaited<ReturnType<typeof requireChangeOverAccess>>); await expect(ordinary.read()).rejects.toThrow("supervisor_required"); expect(ordinary.query.mock.calls.some(([text]) => text.startsWith("SELECT p.id"))).toBe(false);
  const changed = harness(); vi.mocked(changed.authorize).mockImplementationOnce(async () => ({ supervisor: true, site: { id: 392 }, user: { id: 17 } }) as Awaited<ReturnType<typeof requireChangeOverAccess>>).mockRejectedValueOnce(Error("Permission revoked")); await expect(changed.read()).rejects.toThrow("Permission revoked");
});
it("refuses field staff without Gate scope and caller-selected company/interval overrides", async () => {
  const h = harness(); await expect(readGateStaffingCandidates({ shiftId: id }, session, [], h.database, h.authorize)).rejects.toThrow();
  await expect(readGateStaffingCandidates({ shiftId: id }, session, ["gate:read"], h.database, h.authorize)).rejects.toThrow();
  await expect(readGateStaffingCandidates({ shiftId: id }, session, ["workforce:read"], h.database, h.authorize)).rejects.toThrow();
  await expect(readGateStaffingCandidates({ shiftId: id, vendorId: 9 }, session, ["gate:read", "workforce:read"], h.database, h.authorize)).rejects.toThrow(); expect(h.database.connect).not.toHaveBeenCalled();
});
