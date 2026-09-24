import { expect, it } from "vitest";
import { requireChangeOverAccess } from "./gate-change-over";

it("keeps an inactive stop-work site readable only while its gate assignment remains current", async () => {
  let gateRoleCurrent = true;
  const client = {
    query: async (sql: string, values: unknown[]) => {
      if (sql.startsWith("SELECT id, role, session_version"))
        return { rows: [{ id: 7, role: "field_employee", session_version: 4 }], rowCount: 1 };
      if (sql.startsWith("SELECT id, name, partner_id"))
        return values[1] === true
          ? { rows: [{ id: 3, name: "Stopped site", partner_id: 22 }], rowCount: 1 }
          : { rows: [], rowCount: 0 };
      if (sql.startsWith("SELECT id FROM site_work_assignments"))
        return { rows: [{ id: 10 }], rowCount: 1 };
      if (sql.startsWith("SELECT id, vendor_people_id FROM user_org_memberships"))
        return { rows: [{ id: 8, vendor_people_id: 70 }], rowCount: 1 };
      if (sql.startsWith("SELECT vendor_role"))
        return gateRoleCurrent
          ? { rows: [{ vendor_role: "gatekeeper" }], rowCount: 1 }
          : { rows: [], rowCount: 0 };
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
  const session = { userId: 7, role: "field_employee", vendorId: 11, activeMembershipId: 8, vendorRole: "gatekeeper", sv: 4 };

  await expect(requireChangeOverAccess(client as never, session, 3)).rejects.toMatchObject({ code: "change_over.forbidden" });
  await expect(requireChangeOverAccess(client as never, session, 3, { allowInactiveSite: true })).resolves.toMatchObject({ supervisor: false });
  gateRoleCurrent = false;
  await expect(requireChangeOverAccess(client as never, session, 3, { allowInactiveSite: true })).rejects.toMatchObject({ code: "change_over.forbidden" });
});
