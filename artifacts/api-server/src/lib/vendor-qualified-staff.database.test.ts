import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { db, vendorsTable, vendorPeopleTable, vendorPersonOperationalRolesTable } from "@workspace/db";
import { qualifiedVendorStaffCondition } from "./vendor-qualified-staff.js";
import { assertFreshLocalTestDatabaseEnvironment } from "../../../../scripts/fresh-test-database.mjs";

describe.runIf(process.env.VNDRLY_TEST_DB_MODE === "fresh-local")("qualified vendor operational staffing", () => {
  it("counts Gate and foreman staff while excluding inactive, deleted, foreign and downgraded workers", async () => {
    assertFreshLocalTestDatabaseEnvironment(process.env);
    const tag = randomUUID();
    const vendors = await db.insert(vendorsTable).values([1, 2].map(n => ({
      name: `qualified-${n}-${tag}`, contactName: "Synthetic", contactEmail: `${n}-${tag}@example.invalid`,
    }))).returning();
    const rows = [
      { key: "admin", vendorRole: "admin" },
      { key: "gate", vendorRole: "gatekeeper" },
      { key: "supervisor", vendorRole: "gate_supervisor" },
      { key: "foreman", vendorRole: "foreman" },
      { key: "normalized", vendorRole: "office", grant: "gatekeeper" as const },
      { key: "downgraded", vendorRole: "gatekeeper", grant: "office" as const },
      { key: "inactive", vendorRole: "gatekeeper", isActive: false },
      { key: "deleted", vendorRole: "gatekeeper", deletedAt: new Date() },
      { key: "office", vendorRole: "office" },
      { key: "foreign", vendorRole: "gatekeeper", vendorId: vendors[1].id },
    ];
    const people = await db.insert(vendorPeopleTable).values(rows.map(row => ({
      vendorId: row.vendorId ?? vendors[0].id, vendorRole: row.vendorRole,
      firstName: row.key, email: `${row.key}-${tag}@example.invalid`,
      isActive: row.isActive ?? true, deletedAt: row.deletedAt ?? null,
    }))).returning();
    for (const [index, row] of rows.entries()) {
      if (row.grant) await db.insert(vendorPersonOperationalRolesTable).values({
        vendorPeopleId: people[index].id, role: row.grant, isActive: true,
      });
    }
    const qualified = await db.select({ name: vendorPeopleTable.firstName }).from(vendorPeopleTable)
      .where(qualifiedVendorStaffCondition(vendors[0].id));
    expect(qualified.map(row => row.name).sort()).toEqual(["admin", "foreman", "gate", "normalized", "supervisor"]);
  });
});
