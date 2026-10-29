import { beforeEach, expect, it, vi } from "vitest";
import { getTableName } from "drizzle-orm";
const state = vi.hoisted(() => ({ issue: vi.fn(), admin: true }));
vi.mock("./account-invitations", () => ({ issueAccountInvitation: state.issue, resendAccountInvitation: vi.fn() }));
vi.mock("@workspace/db", async () => {
 const schema = await vi.importActual<typeof import("@workspace/db/schema")>("@workspace/db/schema");
 const select = () => {
  let table: any;
  const builder: any = { from(t: any) { table = t; return builder; }, innerJoin() { return builder; }, orderBy() { return builder; }, where() { return builder; }, limit() { return builder; }, then(resolve: any) {
   const name = getTableName(table);
   resolve(name === "user_org_memberships" ? state.admin ? [{ id: 1 }] : [] : name === "managed_subcontractor_sponsors" ? [{ id: "sponsor" }] : name === "managed_subcontractor_organizations" ? [{ id: "org", name: "StaffGO", status: "managed" }] : name === "managed_subcontractor_worker_sponsorships" ? [{ id: "worker", organizationId: "org", userId: 25, name: "Demo", email: "demo@unenrolled.invalid", status: "active" }] : name === "managed_subcontractor_role_grants" ? [{ sponsorshipId: "worker", role: "gatekeeper", siteId: 3 }] : name === "account_invitations" ? [] : [{ id: 3, name: "Main Gate" }]);
  } }; return builder;
 }; return { ...schema, db: { select, selectDistinct: select } };
});
import { createManagedWorker } from "./managed-subcontractors";
beforeEach(() => { state.admin = true; state.issue.mockReset().mockResolvedValue({ userId: 25, invitationId: "invite", rawToken: "test-only" }); });
it("creates an unenrolled roster entry with no email delivery when explicitly requested", async () => {
 const result = await createManagedWorker({ userId: 1, vendorId: 7 }, "org", { name: "Demo", role: "gatekeeper", siteIds: [3], sendInvitation: false });
 expect(state.issue).toHaveBeenCalledWith({ userId: 1, vendorId: 7 }, expect.objectContaining({ email: expect.stringMatching(/@unenrolled\.invalid$/) }), { role: "gatekeeper", siteIds: [3] }, "manual");
 expect(result.userId).toBe(25);
});
it("retains explicit email enrollment and rejects non-administrators", async () => {
 await createManagedWorker({ userId: 1, vendorId: 7 }, "org", { name: "Demo", email: "demo@example.invalid", role: "gatekeeper", siteIds: [3], sendInvitation: true });
 expect(state.issue.mock.calls[0][3]).toBe("email");
 state.admin = false; state.issue.mockClear();
 await expect(createManagedWorker({ userId: 2, vendorId: 7 }, "org", { name: "Demo", role: "gatekeeper", siteIds: [3], sendInvitation: false })).rejects.toThrow("administrator");
 expect(state.issue).not.toHaveBeenCalled();
});
