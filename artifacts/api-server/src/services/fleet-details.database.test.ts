import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { assertFreshLocalTestDatabaseEnvironment } from "../../../../scripts/fresh-test-database.mjs";
import {
  emptyFleetState,
  FleetStateSchema,
  type FleetState,
} from "./fleet-repository";
import type { FleetActor } from "./fleet-ops";
import type { PoolClient } from "pg";
import {FleetRunSchema} from "@workspace/api-zod";

async function fixture() {
  assertFreshLocalTestDatabaseEnvironment(process.env);
  const module = await import("./fleet-details").catch(() => null);
  expect(module, "Fleet Details service").not.toBeNull();
  const {
    db,
    pool,
    vendorsTable,
    usersTable,
    userOrgMembershipsTable,
    vendorPeopleTable,
    assetsTable,
  } = await import("@workspace/db");
  const tag = randomUUID(),
    groupId = randomUUID();
  const [vendor] = await db
    .insert(vendorsTable)
    .values({
      name: `Detail fixture ${tag}`,
      contactName: "Synthetic",
      contactEmail: `${tag}@example.invalid`,
    })
    .returning();
  const staff: Array<typeof usersTable.$inferSelect> = [];
  for (const name of ["Office", "Bob Villa", "Casey"]) {
    const [user] = await db
      .insert(usersTable)
      .values({
        username: `${name.replaceAll(" ", ".")}-${tag}@example.invalid`,
        passwordHash: "not-a-login",
        role: "vendor",
        displayName: name,
      })
      .returning();
    await db.insert(userOrgMembershipsTable).values({
      userId: user.id,
      orgType: "vendor",
      vendorId: vendor.id,
      role: "member",
    });
    await db.insert(vendorPeopleTable).values({
      userId: user.id,
      vendorId: vendor.id,
      firstName: name,
      email: user.username,
    });
    staff.push(user);
  }
  const assets: Array<typeof assetsTable.$inferSelect> = [];
  for (const category of ["truck", "truck", "trailer", "trailer", "dolly"]) {
    const [asset] = await db
      .insert(assetsTable)
      .values({
        name: `${category} ${assets.length}`,
        category,
        legalOwnerName: "Synthetic",
        responsibleOrgType: "vendor",
        responsibleOrgId: vendor.id,
      })
      .returning();
    await pool.query(
      "INSERT INTO asset_attachment_links(asset_id,attachment_type,attachment_id,linked_by_user_id) VALUES($1,'fleet_inventory',$2,$3)",
      [asset.id, String(vendor.id), staff[0].id],
    );
    assets.push(asset);
  }
  const state: FleetState = {
    ...emptyFleetState(),
    enabled: true,
    fleets: [
      {
        id: groupId,
        name: "Existing permissions",
        equipmentAssetIds: assets.map((row) => row.id),
        siteIds: [],
        requiredCertifications: [],
      },
    ],
    grants: staff.map((user, index) => ({
      userId: user.id,
      fleetIds: [groupId],
      siteIds: [],
      roles: index ? ["driver"] : ["fleet_manager"],
      safetyRelease: false,
      financeRead: false,
    })),
  };
  await pool.query("UPDATE vendors SET fleet_ops_state=$2::jsonb WHERE id=$1", [
    vendor.id,
    JSON.stringify(state),
  ]);
  const transaction = async <T>(
    actor: FleetActor,
    work: (state: FleetState, client: PoolClient) => Promise<T>,
  ) => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const userIds = [
        ...new Set([actor.userId, ...(actor.schedulingDriverUserIds ?? [])]),
      ].sort((a, b) => a - b);
      await client.query(
        "SELECT id FROM users WHERE id=ANY($1::int[]) ORDER BY id FOR UPDATE",
        [userIds],
      );
      const current = await client.query(
        "SELECT fleet_ops_state FROM vendors WHERE id=$1 FOR UPDATE",
        [actor.companyId],
      );
      const result = await work(
        FleetStateSchema.parse(current.rows[0].fleet_ops_state),
        client,
      );
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  };
  const service = module!.createFleetDetailsOperations(
    transaction,
    (s, a) => s.grants.find((row) => row.userId === a.userId) ?? null,
  );
  const actor = {
    userId: staff[0].id,
    companyId: vendor.id,
    role: "vendor",
    membershipRole: "member",
  };
  const window = {
    effectiveFrom: "2026-01-01T00:00:00Z",
    effectiveUntil: null,
    archivedAt: null,
  };
  const packageInput = (index: number) => ({
    operationId: randomUUID(),
    expectedVersion: 0,
    package: {
      id: randomUUID(),
      companyId: vendor.id,
      version: 1,
      name: `Tank rig ${index}`,
      components: [
        { assetId: assets[2 + index].id, role: "trailer", sequence: 0 },
        { assetId: assets[4].id, role: "dolly", sequence: 1 },
      ],
      ...window,
    },
  });
  const detailInput = (index: number, packageId: string) => ({
    operationId: randomUUID(),
    expectedVersion: 0,
    detail: {
      id: randomUUID(),
      companyId: vendor.id,
      version: 1,
      name: `Detail ${index}`,
      vehicleAssetId: assets[index].id,
      rigPackageId: packageId,
      rigPackageVersion: 1,
      driverUserId: staff[index + 1].id,
      accessGroupIds: [groupId],
      ...window,
    },
  });
  return {
    module: module!,
    pool,
    actor,
    vendor,
    assets,
    staff,
    groupId,
    service,
    transaction,
    packageInput,
    detailInput,
  };
}

describe("canonical Detail persistence", () => {
  it("does not let a scoped manager read, replay or overwrite another group's package", async () => {
    const f = await fixture(),
      input = f.packageInput(0);
    await f.service.saveFleetRigPackage(f.actor, input);
    const found = await f.pool.query(
      "SELECT fleet_ops_state FROM vendors WHERE id=$1",
      [f.vendor.id],
    );
    const state = FleetStateSchema.parse(found.rows[0].fleet_ops_state);
    state.fleets[0].equipmentAssetIds = [f.assets[3].id];
    state.fleets.push({
      ...state.fleets[0],
      id: randomUUID(),
      name: "Other authorized group",
      equipmentAssetIds: [f.assets[2].id, f.assets[4].id],
    });
    await f.pool.query(
      "UPDATE vendors SET fleet_ops_state=$2::jsonb WHERE id=$1",
      [f.vendor.id, JSON.stringify(state)],
    );
    expect(
      (await f.service.readFleetRigPackages(f.actor, {})).rigPackages,
    ).toEqual([]);
    await expect(
      f.service.saveFleetRigPackage(f.actor, input),
    ).rejects.toMatchObject({ code: "fleet.equipment_grant_required" });
    await expect(
      f.service.saveFleetRigPackage(f.actor, {
        ...input,
        operationId: randomUUID(),
        expectedVersion: 1,
        package: {
          ...input.package,
          version: 2,
          components: [
            { assetId: f.assets[3].id, role: "trailer", sequence: 0 },
          ],
        },
      }),
    ).rejects.toMatchObject({ code: "fleet.equipment_grant_required" });
  });
  it("replays one save, preserves Inventory custody, and keeps prior package revisions", async () => {
    const f = await fixture(),
      input = f.packageInput(0);
    const before = await f.pool.query(
      "SELECT id,current_holder_user_id,status FROM assets WHERE responsible_org_id=$1 ORDER BY id",
      [f.vendor.id],
    );
    const saved = await f.service.saveFleetRigPackage(f.actor, input);
    expect(await f.service.saveFleetRigPackage(f.actor, input)).toEqual(saved);
    const detail = await f.service.saveFleetDetail(
      f.actor,
      f.detailInput(0, saved.id),
    );
    const snapshot = await f.service.fleetDetailSnapshot(f.actor, detail.id);
    await f.service.saveFleetRigPackage(f.actor, {
      ...input,
      operationId: randomUUID(),
      expectedVersion: 1,
      package: {
        ...input.package,
        version: 2,
        name: "Changed for future work",
      },
    });
    expect(
      (
        await f.service.fleetResourceHistory(
          f.actor,
          "rig_package",
          saved.id,
          {},
        )
      ).records.map((row) => row.record.version),
    ).toEqual([2, 1]);
    expect(
      (await f.service.fleetResourceReceipt(f.actor, input.operationId)).result,
    ).toEqual(saved);
    expect(snapshot.rigPackage?.version).toBe(1);
    expect(snapshot.rigPackage?.name).toBe("Tank rig 0");
    expect(
      (
        await f.pool.query(
          "SELECT id,current_holder_user_id,status FROM assets WHERE responsible_org_id=$1 ORDER BY id",
          [f.vendor.id],
        )
      ).rows,
    ).toEqual(before.rows);
    await expect(
      f.service.saveFleetRigPackage(
        { ...f.actor, userId: f.staff[1].id },
        f.packageInput(1),
      ),
    ).rejects.toMatchObject({ code: "fleet.dispatch_required" });
  });
  it("reserves one shared component across two different trucks and drivers atomically", async () => {
    const f = await fixture();
    const packages = await Promise.all(
      [0, 1].map((index) =>
        f.service.saveFleetRigPackage(f.actor, f.packageInput(index)),
      ),
    );
    const details = await Promise.all(
      packages.map((rig, index) =>
        f.service.saveFleetDetail(f.actor, f.detailInput(index, rig.id)),
      ),
    );
    const snapshots = await Promise.all(
      details.map((detail) =>
        f.service.fleetDetailSnapshot(f.actor, detail.id),
      ),
    );
    const results = await Promise.allSettled(
      snapshots.map((snapshot) =>
        f.transaction(
          {
            ...f.actor,
            schedulingDriverUserIds: [snapshot.detail.driverUserId],
          },
          (state, client) =>
            f.module.reserveFleetDetail({ state, client }, f.actor, {
              runId: randomUUID(),
              detailSnapshot: snapshot,
              startAt: "2026-10-16T12:00:00Z",
              plannedEndAt: "2026-10-16T13:00:00Z",
              timeZone: "America/Chicago",
            }),
        ),
      ),
    );
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    const rejected = results.find((result) => result.status === "rejected");
    expect(
      rejected && rejected.status === "rejected" ? rejected.reason.code : null,
    ).toBe("fleet.reservation_conflict");
  });
  it("uses canonical UUID casing for resource reads and operation receipts",async()=>{
    const f=await fixture(),input=f.packageInput(0);
    const rig=await f.service.saveFleetRigPackage(f.actor,input);
    expect(await f.service.fleetRigPackage(f.actor,rig.id.toUpperCase())).toMatchObject({id:rig.id});
    expect(await f.service.fleetResourceReceipt(f.actor,input.operationId.toUpperCase())).toMatchObject({operationId:input.operationId});
    const detail=await f.service.saveFleetDetail(f.actor,f.detailInput(0,rig.id));
    expect((await f.service.fleetDetailSnapshot(f.actor,detail.id.toUpperCase())).detail.id).toBe(detail.id);
  });
  it.each(["same_company","other_company"])("refuses a Detail reservation against an active legacy run in %s",async(where)=>{
    const f=await fixture(),rig=await f.service.saveFleetRigPackage(f.actor,f.packageInput(0));
    const detail=await f.service.saveFleetDetail(f.actor,f.detailInput(0,rig.id));
    const snapshot=await f.service.fleetDetailSnapshot(f.actor,detail.id);
    let companyId=f.actor.companyId;
    if(where==="other_company")companyId=(await f.pool.query("INSERT INTO vendors(name,contact_name,contact_email) VALUES($1,'Synthetic',$2) RETURNING id",[`Other ${randomUUID()}`,`${randomUUID()}@example.invalid`])).rows[0].id;
    const legacy=FleetRunSchema.parse({id:randomUUID(),companyId,fleetId:randomUUID(),title:"Private active legacy work",
      driverUserId:detail.driverUserId,vehicleAssetId:where==="same_company"?detail.vehicleAssetId:randomUUID(),trailerAssetId:null,
      siteIds:[9],status:"in_progress",phase:null,version:1,stops:[{id:randomUUID(),siteId:9,kind:"pickup",sequence:0}],
      loads:[],records:[],inspections:[],currentStopId:null,visitedStopIds:[],events:[],linkedTicketId:null,allowedActions:[]});
    if(where==="other_company")await f.pool.query("UPDATE vendors SET fleet_ops_state=$2::jsonb WHERE id=$1",[companyId,JSON.stringify({...emptyFleetState(),enabled:true,runs:[legacy]})]);
    await expect(f.transaction({...f.actor,schedulingDriverUserIds:[detail.driverUserId]},(state,client)=>{
      if(where==="same_company")state.runs.push(legacy);
      return f.module.reserveFleetDetail({state,client},f.actor,{runId:randomUUID(),detailSnapshot:snapshot,
        startAt:"2026-10-16T12:00:00Z",plannedEndAt:null,timeZone:"America/Chicago"});
    })).rejects.toMatchObject({code:"fleet.reservation_conflict"});
  });
  it("refuses a supplied snapshot that changes components without changing the saved revision", async () => {
    const f = await fixture(),
      rig = await f.service.saveFleetRigPackage(f.actor, f.packageInput(0));
    const detail = await f.service.saveFleetDetail(
      f.actor,
      f.detailInput(0, rig.id),
    );
    const snapshot = await f.service.fleetDetailSnapshot(f.actor, detail.id);
    const forged = {
      ...snapshot,
      rigPackage: {
        ...snapshot.rigPackage!,
        components: snapshot.rigPackage!.components.map((row, index) =>
          index ? { ...row, assetId: f.assets[3].id } : row,
        ),
      },
      labels: {
        ...snapshot.labels,
        components: snapshot.labels.components.map((row, index) =>
          index ? { assetId: f.assets[3].id, label: "Other trailer" } : row,
        ),
      },
    };
    await expect(
      f.transaction(
        { ...f.actor, schedulingDriverUserIds: [detail.driverUserId] },
        (state, client) =>
          f.module.reserveFleetDetail({ state, client }, f.actor, {
            runId: randomUUID(),
            detailSnapshot: forged,
            startAt: "2026-10-16T12:00:00Z",
            plannedEndAt: "2026-10-16T13:00:00Z",
            timeZone: "America/Chicago",
          }),
      ),
    ).rejects.toMatchObject({ code: "fleet.detail_revision_conflict" });
  });
  it("rechecks a driver suspended after the Detail was saved", async () => {
    const f = await fixture(),
      rig = await f.service.saveFleetRigPackage(f.actor, f.packageInput(0));
    const detail = await f.service.saveFleetDetail(
      f.actor,
      f.detailInput(0, rig.id),
    );
    const snapshot = await f.service.fleetDetailSnapshot(f.actor, detail.id);
    await f.pool.query("UPDATE users SET suspended_at=NOW() WHERE id=$1", [
      detail.driverUserId,
    ]);
    await expect(
      f.transaction(
        { ...f.actor, schedulingDriverUserIds: [detail.driverUserId] },
        (state, client) =>
          f.module.reserveFleetDetail({ state, client }, f.actor, {
            runId: randomUUID(),
            detailSnapshot: snapshot,
            startAt: "2026-10-16T12:00:00Z",
            plannedEndAt: "2026-10-16T13:00:00Z",
            timeZone: "America/Chicago",
          }),
      ),
    ).rejects.toMatchObject({ code: "fleet.driver_unavailable" });
  });
});
