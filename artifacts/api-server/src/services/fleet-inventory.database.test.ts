import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { assertFreshLocalTestDatabaseEnvironment } from "../../../../scripts/fresh-test-database.mjs";
import { createFleetInventoryOperations } from "./fleet-inventory";
import { emptyFleetState, FleetStateSchema } from "./fleet-repository";
describe.runIf(process.env.VNDRLY_TEST_DB_MODE === "fresh-local")("Fleet Inventory canonical persistence", () => {
  it("commits a shared asset and fleet inclusion together, replays once, and rolls back a duplicate identifier", async () => {
    assertFreshLocalTestDatabaseEnvironment(process.env);
    const { db, pool, vendorsTable, usersTable, userOrgMembershipsTable } = await import("@workspace/db");
    const tag = randomUUID(), fleetId = randomUUID();
    const [vendor] = await db.insert(vendorsTable).values({ name: "Fleet Inventory " + tag, contactName: "Synthetic", contactEmail: tag + "@example.invalid" }).returning();
    const [user] = await db.insert(usersTable).values({ username: tag + "@example.invalid", passwordHash: "not-a-login", role: "vendor", displayName: "Synthetic Fleet Inventory Admin" }).returning();
    const [member] = await db.insert(userOrgMembershipsTable).values({ userId: user.id, orgType: "vendor", vendorId: vendor.id, role: "admin" }).returning();
    await pool.query("UPDATE vendors SET fleet_ops_state=$2::jsonb WHERE id=$1", [vendor.id, JSON.stringify({ ...emptyFleetState(), enabled: true, fleets: [{ id: fleetId, name: "Hauling", siteIds: [], equipmentAssetIds: [], requiredCertifications: [] }] })]);
    const service = createFleetInventoryOperations(async (a, work) => {
      const c = await pool.connect();
      try {
        await c.query("BEGIN");
        const result = await c.query("SELECT fleet_ops_state FROM vendors WHERE id=$1 FOR UPDATE", [a.companyId]);
        const state = FleetStateSchema.parse(result.rows[0].fleet_ops_state);
        const value = await work(state, c);
        await c.query("UPDATE vendors SET fleet_ops_state=$2::jsonb WHERE id=$1", [a.companyId, JSON.stringify(state)]);
        await c.query("COMMIT"); return value;
      } catch (error) { await c.query("ROLLBACK"); throw error; } finally { c.release(); }
    }, () => ({ fleetIds: [fleetId], roles: ["fleet_manager"] }), () => false);
    const actor = { userId: user.id, companyId: vendor.id, role: "vendor", membershipRole: "admin", activeMembershipId: member.id, sv: user.sessionVersion };
    const input = { operationId: randomUUID(), category: "truck", name: "Unit 77", legalOwner: "Synthetic Fleet", identifier: { kind: "asset_tag", value: tag } };
    const saved = await service.createFleetAsset(actor, input);
    expect(await service.createFleetAsset(actor, input)).toEqual(saved);
    await pool.query("INSERT INTO asset_aliases(asset_id,kind,jurisdiction,normalized_value,display_value) VALUES($1,'unit_number','','UNIT77','Unit 77')", [saved.assetId]);
    const detail = await service.fleetInventoryDetail(actor, saved.assetId);
    expect(detail.asset).toMatchObject({ name: "Unit 77", fleetIds: [], version: 1 });
    expect(detail.asset.aliases).toContainEqual({ kind: "unit_number", value: "Unit 77" });
    expect(detail.history[0].type).toBe("registered");
    await expect(service.createFleetAsset(actor, { ...input, operationId: randomUUID(), name: "Duplicate" })).rejects.toMatchObject({ code: "fleet.identifier_in_use" });
    expect((await pool.query("SELECT count(*)::int count FROM assets WHERE responsible_org_type='vendor' AND responsible_org_id=$1", [vendor.id])).rows[0].count).toBe(1);
    expect((await service.fleetInventory(actor)).assets.map(a => a.id)).toEqual([saved.assetId]);
    await service.editFleetAsset(actor, saved.assetId, { operationId: randomUUID(), expectedVersion: 1, name: "Unit 77 updated", manufacturer: "Synthetic", model: "Support" });
    expect((await pool.query("SELECT name,manufacturer,version FROM assets WHERE id=$1", [saved.assetId])).rows[0]).toEqual({ name: "Unit 77 updated", manufacturer: "Synthetic", version: 2 });
    const edited = await service.fleetInventoryDetail(actor, saved.assetId);
    expect(edited.history.some(e => e.type === "details_updated")).toBe(true);
    const [other] = await pool.query("INSERT INTO assets(name,category,legal_owner_name,responsible_org_type,responsible_org_id) VALUES('Other trailer','trailer','Synthetic','vendor',$1) RETURNING id", [vendor.id]).then(r => r.rows);
    await service.enrollFleetAsset(actor, other.id, { operationId: randomUUID(), expectedVersion: 1 });
    expect((await service.fleetInventory(actor)).assets).toHaveLength(2);
  });
});
