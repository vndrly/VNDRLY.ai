import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { COMPANYGO_FLEET_ACCEPTANCE_SQL, COMPANYGO_FLEET_ACCOUNTS, COMPANYGO_FLEET_SEED_SQL, buildCompanyGoRunOrders, mergeCompanyGoCompliance, selectCompanyGoAssetRoles, stableCompanyGoUuid } from "../../scripts/seed-companygo-fleet-workflows";

const objectStore = vi.hoisted(() => ({ putObject: vi.fn(async () => undefined) }));
vi.mock("../lib/objectStore", () => ({ getObjectStore: () => objectStore }));

describe("CompanyGo Fleet workflow fixture plan", () => {
  it("is additive, repeatable, and scoped by stable natural keys", () => {
    const sql = COMPANYGO_FLEET_SEED_SQL.join("\n").toLowerCase();
    expect(sql).not.toMatch(/\b(delete|truncate|drop)\b/);
    expect(sql.match(/\bupdate\b/g)).toHaveLength(3);
    expect(sql).toContain("update ticket_line_items set type='other'");
    expect(sql).toContain("update tickets t set fleet_plan=");
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

  it("repairs the CompanyGo Fleet persona fixtures during every API deployment", () => {
    const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));
    expect(pkg.scripts["seed:companygo-fleet-workflows"]).toBe("tsx scripts/seed-companygo-fleet-workflows.ts --apply");

    const workflow = readFileSync(new URL("../../../../.github/workflows/deploy-api.yml", import.meta.url), "utf8");
    const migration = workflow.indexOf("run migrate:fleet-mobile-workflows");
    const productionSeed = "(cd /var/www/vndrly/artifacts/api-server && sudo -u vndrly env HOME=/home/vndrly node --env-file=/var/www/vndrly/.env.production --import tsx scripts/seed-companygo-fleet-workflows.ts --apply)";
    const fixtures = workflow.indexOf(productionSeed);
    expect(migration).toBeGreaterThan(-1);
    expect(fixtures).toBeGreaterThan(migration);
  });

  it("rematerializes canonical private compliance evidence when its index entry already exists", async () => {
    objectStore.putObject.mockClear();
    const recordId = stableCompanyGoUuid("compliance:driver-license");
    const at = "2026-10-20T16:00:00.000Z";
    const context = {
      companyId: 1114,
      siteId: 399,
      driverUserId: 1135,
      dispatcherUserId: 1132,
      accountUserIds: [1129, 1130, 1132, 1135],
      vehicleAssetId: "00000000-0000-4000-8000-000000000004",
      trailerAssetId: "00000000-0000-4000-8000-000000000002",
      billingLineIds: {},
      fleetOpsState: {},
      fleetResources: {},
      compliance: {
        version: 1,
        reviewerUserIds: [1132],
        entries: [{ id: recordId, revision: 1, subject: { kind: "driver", id: 1135 }, requirementId: "companygo-driver-license", requirementVersion: 1, status: "reviewed", validFrom: at, validUntil: "2027-10-20T16:00:00.000Z", verifiedAt: at, verifiedByUserId: 1132, attributeKind: "driver_license", objectPath: `/objects/fleet-compliance-private/1114/${recordId}/1/${"a".repeat(64)}`, updatedAt: at }],
        requirements: [], facts: [], scoreHistory: [], partnerScorePreview: null,
      },
    };
    const updates: unknown[][] = [];
    const client = { query: vi.fn(async (sql: string, values?: unknown[]) => { if (sql.startsWith("UPDATE vendors")) updates.push(values ?? []); return { rows: [], rowCount: 0 }; }) };

    await mergeCompanyGoCompliance(client, context);

    expect(objectStore.putObject).toHaveBeenCalledOnce();
    expect(updates).toHaveLength(1);
  });

  it("read-only acceptance checks authoritative Fleet state, Details, and compliance", () => {
    const sql = COMPANYGO_FLEET_ACCEPTANCE_SQL.toLowerCase();
    expect(sql).toContain("current_date - 29");
    expect(sql).toContain("current_date + 6");
    expect(sql).toContain("ticket_line_items");
    expect(sql).toContain("fleet_ops_state");
    expect(sql).toContain("fleet_resources");
    expect(sql).toContain("fleet_compliance_configuration");
    expect(sql).toContain("assistant_action_audit");
    expect(sql).toContain("fleet-run-order");
    expect(sql).not.toMatch(/\b(insert|update|delete|truncate|drop)\b/);
  });

  it("builds reusable saved Runs from FleetGo's real destination directory", () => {
    const destination = (id: string, name: string, kind: "yard" | "delivery" | "disposal", ownerType: "vendor" | "partner", ownerId: number) => ({
      id, revision: 1, name, kind, address: `${name}, synthetic`, latitude: 32.1, longitude: -101.9,
      materials: [], hours: "24/7", instructions: "Synthetic testing only.", active: true, ownerType, ownerId,
    });
    const orders = buildCompanyGoRunOrders(1114, [
      destination("00000000-0000-4000-8000-000000000001", "FleetGo Stanton Yard", "yard", "vendor", 1114),
      destination("00000000-0000-4000-8000-000000000002", "Lone Mesa SWD", "disposal", "vendor", 1114),
      destination("00000000-0000-4000-8000-000000000003", "GasGo Antelope Draw", "delivery", "partner", 614),
    ]);
    expect(orders).toHaveLength(3);
    expect(orders.every(order => order.accessGroupIds.includes(stableCompanyGoUuid("fleet:stanton")))).toBe(true);
    expect(orders.map(order => order.name)).toEqual(expect.arrayContaining([expect.stringMatching(/GasGo/), expect.stringMatching(/SWD/)]));
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

  it("reuses an existing run's Fleet assets when canonical fixture names are absent", () => {
    const truck = "00000000-0000-4000-8000-000000000004";
    const trailer = "00000000-0000-4000-8000-000000000002";
    const existingState = {
      runs: [
        { vehicleAssetId: truck, trailerAssetId: trailer },
        { vehicleAssetId: truck, trailerAssetId: trailer },
        { vehicleAssetId: "00000000-0000-4000-8000-000000000003", trailerAssetId: "00000000-0000-4000-8000-000000000001" },
      ],
    };

    expect(selectCompanyGoAssetRoles([
      { id: "00000000-0000-4000-8000-000000000003", name: "Unit 101", category: "truck" },
      { id: truck, name: "Unit 102", category: "truck" },
      { id: "00000000-0000-4000-8000-000000000001", name: "Trailer T-11", category: "trailer" },
      { id: trailer, name: "Trailer T-12", category: "trailer" },
    ], existingState)).toEqual({ vehicleAssetId: truck, trailerAssetId: trailer });
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
    ])).toThrow(/ambiguous duplicate vehicle\/truck preferred natural key/i);
  });

  it("rejects distinct same-priority assets unless one preferred natural key resolves the role", () => {
    const trailer = { id: "00000000-0000-4000-8000-000000000009", name: "FleetGo Trailer 1", category: "trailer" };
    const truck = { id: "00000000-0000-4000-8000-000000000008", name: "FleetGo Truck 1", category: "truck" };

    expect(() => selectCompanyGoAssetRoles([
      { id: "00000000-0000-4000-8000-000000000001", name: "Truck Alpha", category: "truck" },
      { id: "00000000-0000-4000-8000-000000000002", name: "Truck Bravo", category: "truck" },
      trailer,
    ])).toThrow(/ambiguous vehicle\/truck assets without a unique preferred natural key/i);

    expect(() => selectCompanyGoAssetRoles([
      truck,
      { id: "00000000-0000-4000-8000-000000000003", name: "Trailer Alpha", category: "trailer" },
      { id: "00000000-0000-4000-8000-000000000004", name: "Trailer Bravo", category: "trailer" },
    ])).toThrow(/ambiguous trailer\/rigging assets without a unique preferred natural key/i);

    expect(selectCompanyGoAssetRoles([
      truck,
      { id: "00000000-0000-4000-8000-000000000005", name: "Truck Alpha", category: "truck" },
      trailer,
      { id: "00000000-0000-4000-8000-000000000006", name: "Trailer Alpha", category: "trailer" },
    ])).toEqual({ vehicleAssetId: truck.id, trailerAssetId: trailer.id });
  });

  it("rejects duplicate preferred matches across accepted category variants", () => {
    expect(() => selectCompanyGoAssetRoles([
      { id: "00000000-0000-4000-8000-000000000001", name: "FleetGo Truck 1", category: "truck" },
      { id: "00000000-0000-4000-8000-000000000002", name: "fleetgo truck 1", category: "vehicle" },
      { id: "00000000-0000-4000-8000-000000000003", name: "FleetGo Trailer 1", category: "trailer" },
    ])).toThrow(/ambiguous duplicate vehicle\/truck preferred natural key/i);

    expect(() => selectCompanyGoAssetRoles([
      { id: "00000000-0000-4000-8000-000000000004", name: "FleetGo Truck 1", category: "truck" },
      { id: "00000000-0000-4000-8000-000000000005", name: "FleetGo Trailer 1", category: "trailer" },
      { id: "00000000-0000-4000-8000-000000000006", name: "fleetgo trailer 1", category: "rigging" },
    ])).toThrow(/ambiguous duplicate trailer\/rigging preferred natural key/i);
  });
});
