import { expect, it, vi } from "vitest";
import type { PoolClient } from "pg";
import { requireLiveTicketAssignment } from "./live-ticket-assignment";
it("locks live person and exact roster before mutation; removed crew denied", async () => {
  const query = vi.fn(async (sql: string) => ({
    rows: sql.includes("FROM tickets")
      ? [{ vendor_id: 1, field_employee_id: 9 }]
      : sql.includes("FROM vendor_people")
        ? [{ id: 8 }]
        : [],
  }));
  await expect(
    requireLiveTicketAssignment(
      { query } as unknown as PoolClient,
      { userId: 20, vendorId: 1, role: "field_employee" },
      7,
    ),
  ).rejects.toThrow("native.ticket_scope_required");
  expect(
    query.mock.calls
      .map(([sql]) => sql)
      .filter((sql) => sql.includes("FOR SHARE")),
  ).toHaveLength(2);
  expect(query.mock.calls[2]?.[0]).toContain("removed_at IS NULL");
  expect(query.mock.calls[1]?.[0]).toContain(
    "is_active=true AND deleted_at IS NULL",
  );
});
