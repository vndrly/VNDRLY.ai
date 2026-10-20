import { describe, expect, it } from "vitest";
import { COMPANYGO_FLEET_ACCEPTANCE_SQL, COMPANYGO_FLEET_ACCOUNTS, COMPANYGO_FLEET_SEED_SQL, selectCompanyGoAssetRoles, stableCompanyGoUuid } from "../../scripts/seed-companygo-fleet-workflows";

describe("CompanyGo Fleet workflow fixture plan", () => {
  it("is additive, repeatable, and scoped by stable natural keys", () => {
    const sql = COMPANYGO_FLEET_SEED_SQL.join("\n").toLowerCase();
    expect(sql).not.toMatch(/\b(delete|truncate|drop)\b/);
    expect(sql.match(/\bupdate\b/g)).toHaveLength(1);
    expect(sql).toContain("current.capabilities || resolved.capabilities");
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

  it("read-only acceptance checks authoritative Fleet state, Details, and compliance", () => {
    const sql = COMPANYGO_FLEET_ACCEPTANCE_SQL.toLowerCase();
    expect(sql).toContain("current_date - 29");
    expect(sql).toContain("current_date + 6");
    expect(sql).toContain("ticket_line_items");
    expect(sql).toContain("fleet_ops_state");
    expect(sql).toContain("fleet_resources");
    expect(sql).toContain("fleet_compliance_configuration");
    expect(sql).not.toContain("assistant_action_audit");
    expect(sql).not.toMatch(/\b(insert|update|delete|truncate|drop)\b/);
  });

  it("backfills ticket and billing rows without manufacturing audit stand-ins", () => {
    const sql = COMPANYGO_FLEET_SEED_SQL.join("\n").toLowerCase();
    expect(sql).toContain("generate_series(0,29)");
    expect(sql).toContain("generate_series(0,6)");
    expect(sql).toContain("insert into tickets");
    expect(sql).toContain("insert into ticket_line_items");
    expect(sql).not.toContain("assistant_action_audit");
    expect(sql).toContain("on conflict(id) do nothing");
    expect(sql).not.toContain("password_hash=");
  });

  it("derives stable UUIDs without reusing identities", () => {
    const first = stableCompanyGoUuid("yard:home");
    expect(first).toBe(stableCompanyGoUuid("yard:home"));
    expect(first).not.toBe(stableCompanyGoUuid("yard-order:ready"));
    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("selects canonical truck and trailer roles independently of UUID ordering", () => {
    const roles = selectCompanyGoAssetRoles([
      { id: "00000000-0000-4000-8000-000000000001", name: "Rigging first by UUID", category: "rigging" },
      { id: "00000000-0000-4000-8000-000000000004", name: "FleetGo Truck 1", category: "truck" },
      { id: "00000000-0000-4000-8000-000000000002", name: "FleetGo Trailer 1", category: "trailer" },
      { id: "00000000-0000-4000-8000-000000000003", name: "Other vehicle", category: "vehicle" },
    ]);

    expect(roles).toEqual({
      vehicleAssetId: "00000000-0000-4000-8000-000000000004",
      trailerAssetId: "00000000-0000-4000-8000-000000000002",
    });
  });

  it("fails safely when FleetGo lacks a canonical truck or trailer/rigging asset", () => {
    expect(() => selectCompanyGoAssetRoles([
      { id: "00000000-0000-4000-8000-000000000001", name: "Rigging only", category: "rigging" },
    ])).toThrow(/vehicle\/truck/i);
    expect(() => selectCompanyGoAssetRoles([
      { id: "00000000-0000-4000-8000-000000000002", name: "Truck only", category: "truck" },
    ])).toThrow(/trailer\/rigging/i);
    expect(() => selectCompanyGoAssetRoles([
      { id: "00000000-0000-4000-8000-000000000001", name: "FleetGo Truck 1", category: "truck" },
      { id: "00000000-0000-4000-8000-000000000002", name: "fleetgo truck 1", category: "truck" },
      { id: "00000000-0000-4000-8000-000000000003", name: "FleetGo Trailer 1", category: "trailer" },
    ])).toThrow(/ambiguous duplicate vehicle\/truck natural key/i);
  });
});
