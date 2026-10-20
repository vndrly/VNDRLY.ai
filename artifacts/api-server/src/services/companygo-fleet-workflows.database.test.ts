import { describe, expect, it } from "vitest";
import { COMPANYGO_FLEET_ACCEPTANCE_SQL, COMPANYGO_FLEET_ACCOUNTS, COMPANYGO_FLEET_SEED_SQL, stableCompanyGoUuid } from "../../scripts/seed-companygo-fleet-workflows";

describe("CompanyGo Fleet workflow fixture plan", () => {
  it("is additive, repeatable, and scoped by stable natural keys", () => {
    const sql = COMPANYGO_FLEET_SEED_SQL.join("\n").toLowerCase();
    expect(sql).not.toMatch(/\b(delete|truncate|drop|update)\b/);
    expect(sql).toContain("on conflict");
    expect(sql).toContain("lower(name) = 'fleetgo'");
    expect(sql).toMatch(/lower\(coalesce\([^)]*email[^)]*username[^)]*\)\)/);
    expect(sql).toContain("responsible_org_type = 'vendor'");
    expect(sql).not.toContain("vendor_id=1114");
  });

  it("covers every Fleet persona with composable small-shop capabilities", () => {
    expect(COMPANYGO_FLEET_ACCOUNTS).toEqual([
      { login: "vendor_admin@fleetgo.com", capabilities: ["admin", "office", "dispatch", "yard", "driver", "self_dispatch"] },
      { login: "vendor_office@fleetgo.com", capabilities: ["office"] },
      { login: "vendor_fleet_dispatch@fleetgo.com", capabilities: ["dispatch"] },
      { login: "vendor_fleet_driver@fleetgo.com", capabilities: ["yard", "driver", "self_dispatch"] },
    ]);
  });

  it("read-only acceptance checks the surrounding 30-day and seven-day operational history", () => {
    const sql = COMPANYGO_FLEET_ACCEPTANCE_SQL.toLowerCase();
    expect(sql).toContain("current_date - 29");
    expect(sql).toContain("current_date + 6");
    expect(sql).toContain("ticket_line_items");
    expect(sql).toContain("assistant_action_audit");
    expect(sql).not.toMatch(/\b(insert|update|delete|truncate|drop)\b/);
  });

  it("derives stable UUIDs without reusing identities", () => {
    const first = stableCompanyGoUuid("yard:home");
    expect(first).toBe(stableCompanyGoUuid("yard:home"));
    expect(first).not.toBe(stableCompanyGoUuid("yard-order:ready"));
    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});
