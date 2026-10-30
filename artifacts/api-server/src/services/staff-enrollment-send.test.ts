import { beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ reads: [] as any[], pending: [] as any[], committed: [] as any[], email: vi.fn(), membership: vi.fn() }));
vi.mock("../lib/staff-enrollment-email", () => ({ renderStaffEnrollmentEmail: vi.fn(), sendStaffEnrollmentEmail: state.email }));
vi.mock("../lib/membership-sync", () => ({ addMembership: state.membership }));
vi.mock("@workspace/db", async () => {
  const schema = await vi.importActual<typeof import("@workspace/db/schema")>("@workspace/db/schema");
  const { getTableName } = await import("drizzle-orm");
  function query(mode: string, table?: any) {
    let values: any;
    const builder: any = {
      from(t: any) { table = t; return builder; }, where() { return builder; }, limit() { return builder; }, for() { return builder; }, returning() { return builder; },
      set(v: any) { values = v; return builder; }, values(v: any) { values = v; return builder; },
      then(resolve: any) {
        if (mode === "select") { if (!state.reads.length) throw Error("Unexpected database read"); resolve(state.reads.shift()); return; }
        state.pending.push({ mode, table: getTableName(table), values });
        resolve(mode === "insert" ? [{ id: 400, ...values }] : []);
      },
    }; return builder;
  }
  const db: any = { select: () => query("select"), insert: (table: any) => query("insert", table), update: (table: any) => query("update", table), execute: vi.fn(), transaction: async (fn: any) => { state.pending = []; try { const value = await fn(db); state.committed.push(...state.pending); return value; } catch (error) { state.pending = []; throw error; } } };
  return { ...schema, db };
});
import { sendStaffEnrollment } from "./staff-enrollment";
const person = { id: 21, vendorId: 7, userId: null, firstName: "New", lastName: "Worker", isActive: true, deletedAt: null, vendorRole: "gatekeeper", staffEnrollment: null };
beforeEach(() => {
  vi.clearAllMocks(); state.reads = [[{ name: "GateGo", logo: null, color: "#f0b827" }], [{ logo: null }]]; state.pending = []; state.committed = [];
  state.email.mockResolvedValue({ messageId: "test-message" }); state.membership.mockResolvedValue(22);
  delete process.env.SENDGRID_SANDBOX_MODE;
});
it("creates only a new login with a hashed eight-character password, mandatory change and correct company membership", async () => {
  state.reads.push([person], []);
  expect(await sendStaffEnrollment(7, 1, "person:21", "worker@example.com")).toMatchObject({ state: "sent" });
  const account = state.committed.find(row => row.table === "users");
  const delivery = state.email.mock.calls[0][0];
  expect(delivery.temporaryPassword).toHaveLength(8); expect(account.values.passwordHash).not.toBe(delivery.temporaryPassword); expect(account.values.mustChangePassword).toBe(true);
  expect(account.values.role).toBe("field_employee");
  expect(state.membership).toHaveBeenCalledWith(expect.objectContaining({ userId: 400, orgId: 7, vendorPeopleId: 21, role: "field_employee" }), expect.anything());
  expect(JSON.stringify(state.committed)).not.toContain(delivery.temporaryPassword);
});
it("keeps an existing employee's password, email, role and permissions unchanged", async () => {
  state.reads.push([{ ...person, userId: 42 }], [{ id: 42, username: "worker@example.com", email: "worker@example.com", displayName: "Existing", passwordHash: "existing-hash" }], [{ id: 22 }]);
  await sendStaffEnrollment(7, 1, "person:21", "worker@example.com");
  expect(state.email.mock.calls[0][0].temporaryPassword).toBeUndefined();
  expect(state.committed.some(row => row.table === "users")).toBe(false); expect(state.membership).not.toHaveBeenCalled();
});
it("rolls back new account creation and invitation state when delivery fails", async () => {
  state.reads.push([person], []); state.email.mockRejectedValue(new Error("Email unavailable"));
  await expect(sendStaffEnrollment(7, 1, "person:21", "worker@example.com")).rejects.toThrow("Email unavailable");
  expect(state.committed).toEqual([]);
});
it("does not attach another person's existing login by matching an email", async () => {
  state.reads.push([person], [{ id: 55 }]);
  await expect(sendStaffEnrollment(7, 1, "person:21", "worker@example.com")).rejects.toThrow("already has an account");
  expect(state.email).not.toHaveBeenCalled(); expect(state.committed).toEqual([]);
});
