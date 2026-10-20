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
import {
  FleetRunSchema,
  FleetRoutePlanSchema,
  fleetRouteOperationalStops,
  type FleetDestination,
} from "@workspace/api-zod";
import { createFleetService } from "./fleet-ops";
import { databaseFleetRepository } from "./fleet-repository";

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
      driverUserId: null,
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
    driverUserId: (index: number) => staff[index + 1].id,
  };
}

describe("canonical Detail persistence", () => {
  it("stores reusable transport orders independently of Details, tickets and reservations with scoped versioned readback", async()=>{
    const f=await fixture();
    const module=await import("./fleet-run-orders").catch(()=>null);expect(module,"Saved Run transport-order service").not.toBeNull();
    const companyService=createFleetService({transaction:(_companyId,_userId,work)=>f.transaction(f.actor,work)});
    const yard=await companyService.saveDestination(f.actor,{operationId:randomUUID(),expectedVersion:1,destination:{name:"Company base before customer setup",kind:"yard",address:"Manual base road",latitude:null,longitude:null,active:true}});
    expect(yard).toMatchObject({destination:{ownerType:"vendor",ownerId:f.vendor.id}});
    const {FleetDestinationSchema,FleetCommercialSettingsSchema}=await import("@workspace/api-zod");
    const places=[0,1,2].map(index=>FleetDestinationSchema.parse({id:randomUUID(),revision:1,name:`Order location ${index}`,kind:index===0?"pickup":"delivery",address:`${index} Manual street`,latitude:null,longitude:null,ownerType:"vendor",ownerId:f.vendor.id}));
    await f.pool.query("UPDATE vendors SET fleet_commercial_settings=$2::jsonb WHERE id=$1",[f.vendor.id,JSON.stringify(FleetCommercialSettingsSchema.parse({destinations:places}))]);
    const service=module!.createFleetRunOrderOperations(f.transaction,(state,actor)=>state.grants.find(g=>g.userId===actor.userId)??null);
    const body={operationId:randomUUID(),expectedVersion:0,order:{id:randomUUID(),companyId:f.vendor.id,version:1,name:"Crude tank to collection",accessGroupIds:[f.groupId],origin:places[0],destination:places[1],base:null,returnPolicy:"delivery_only",instructions:"Unload crude at the collection point",timeZone:"America/Chicago",archivedAt:null}};
    const before=(await f.pool.query("SELECT fleet_resources FROM vendors WHERE id=$1",[f.vendor.id])).rows[0].fleet_resources;
    const saved=await service.saveFleetRunOrder(f.actor,body);
    expect((service as any).fleetRunOrderLocations).toBeTypeOf("function");
    const changedPlaces=places.map((place,index)=>index===0?{...place,revision:2,address:"Moved company entrance"}:place);
    await f.pool.query("UPDATE vendors SET fleet_commercial_settings=$2::jsonb WHERE id=$1",[f.vendor.id,JSON.stringify(FleetCommercialSettingsSchema.parse({destinations:changedPlaces}))]);
    const locationReview=await (service as any).fleetRunOrderLocations(f.actor,saved.id);
    expect(locationReview).toMatchObject({orderId:saved.id,orderVersion:1,locations:expect.arrayContaining([expect.objectContaining({id:places[0].id,revision:2})]),unavailableLocationIds:[]});
    expect((await service.fleetRunOrder(f.actor,saved.id)).origin.revision).toBe(1);
    await f.pool.query("UPDATE vendors SET fleet_commercial_settings=$2::jsonb WHERE id=$1",[f.vendor.id,JSON.stringify(FleetCommercialSettingsSchema.parse({destinations:places}))]);
    expect(saved).toEqual(body.order);
    expect(await service.saveFleetRunOrder(f.actor,body)).toEqual(saved);
    expect((await service.readFleetRunOrders(f.actor,{})).orders).toEqual([saved]);
    await expect(service.saveFleetRunOrder(f.actor,{...body,order:{...body.order,name:"Changed same operation"}})).rejects.toMatchObject({code:"fleet.operation_conflict"});
    await expect(service.saveFleetRunOrder(f.actor,{...body,operationId:randomUUID(),expectedVersion:1,order:{...saved,version:2,destination:{...places[1],address:"Forged address"}}})).rejects.toMatchObject({code:"fleet.destination_revision_conflict"});
    const updated=await service.saveFleetRunOrder(f.actor,{...body,operationId:randomUUID(),expectedVersion:1,order:{...saved,version:2,name:"Second revision"}});
    expect(updated.version).toBe(2);
    expect((await service.fleetRunOrderReceipt(f.actor,body.operationId)).order).toEqual(saved);
    expect((await service.fleetRunOrderHistory(f.actor,saved.id,{})).records.map(row=>row.order.version)).toEqual([2,1]);
    await expect(service.saveFleetRunOrder(f.actor,{...body,operationId:randomUUID()})).rejects.toMatchObject({code:"fleet.version_conflict"});
    expect((await service.readFleetRunOrders({...f.actor,userId:f.staff[1].id},{})).orders).toEqual([updated]);
    await expect(service.saveFleetRunOrder({...f.actor,userId:f.staff[1].id},{...body,operationId:randomUUID()})).rejects.toMatchObject({code:"fleet.dispatch_required"});
    await f.pool.query("UPDATE vendors SET fleet_commercial_settings=$2::jsonb WHERE id=$1",[f.vendor.id,JSON.stringify(FleetCommercialSettingsSchema.parse({destinations:places.map(place=>({...place,active:false}))}))]);
    const archived=await service.saveFleetRunOrder(f.actor,{...body,operationId:randomUUID(),expectedVersion:2,order:{...updated,version:3,archivedAt:new Date().toISOString()}});
    expect((await service.readFleetRunOrders(f.actor,{})).orders).toEqual([]);
    expect(await service.fleetRunOrder(f.actor,archived.id)).toEqual(archived);
    expect((await f.pool.query("SELECT fleet_resources FROM vendors WHERE id=$1",[f.vendor.id])).rows[0].fleet_resources).toEqual(before);
    await f.pool.query("UPDATE vendors SET fleet_ops_state=jsonb_set(fleet_ops_state,'{grants}','[]'::jsonb) WHERE id=$1",[f.vendor.id]);
    await expect(service.fleetRunOrderReceipt(f.actor,body.operationId)).rejects.toMatchObject({code:"fleet.dispatch_required"});
  });
  it("binds canonical runs to all components, preserves revisions, and releases only after the chosen return without waiting for office", async () => {
    const f = await fixture(),
      tag = randomUUID();
    const partner = (
      await f.pool.query(
        "INSERT INTO partners(name,contact_name,contact_email) VALUES($1,'Synthetic',$2) RETURNING id",
        [`Detail customer ${tag}`, `${tag}@example.invalid`],
      )
    ).rows[0];
    const site = (
      await f.pool.query(
        "INSERT INTO site_locations(partner_id,name,address,latitude,longitude,site_code,afe) VALUES($1,'Synthetic pad','Synthetic',35,-97,$2,'A1') RETURNING id",
        [partner.id, tag],
      )
    ).rows[0];
    const work = (
      await f.pool.query(
        "INSERT INTO work_types(name,category) VALUES($1,'haul') RETURNING id",
        [`Detail haul ${tag}`],
      )
    ).rows[0];
    await f.pool.query(
      "INSERT INTO vendor_work_types(vendor_id,work_type_id,unit,unit_price) VALUES($1,$2,'per_job','1.00')",
      [f.vendor.id, work.id],
    );
    await f.pool.query(
      "INSERT INTO site_work_assignments(vendor_id,site_location_id,work_type_id,afe) VALUES($1,$2,$3,'A1')",
      [f.vendor.id, site.id, work.id],
    );
    await f.pool.query(
      "INSERT INTO partner_vendor_relationships(partner_id,vendor_id,status) VALUES($1,$2,'approved')",
      [partner.id, f.vendor.id],
    );
    await f.pool.query(
      "INSERT INTO partner_vendor_work_type_approvals(partner_id,vendor_id,work_type_id) VALUES($1,$2,$3)",
      [partner.id, f.vendor.id, work.id],
    );
    const state = FleetStateSchema.parse(
      (
        await f.pool.query("SELECT fleet_ops_state FROM vendors WHERE id=$1", [
          f.vendor.id,
        ])
      ).rows[0].fleet_ops_state,
    );
    state.fleets[0].siteIds = [site.id];
    // Drivers belong to the company's pool; only dispatch/customer authority is site scoped.
    for (const grant of state.grants) grant.siteIds = grant.roles.includes("fleet_manager") ? [site.id] : [];
    await f.pool.query(
      "UPDATE vendors SET fleet_ops_state=$2::jsonb WHERE id=$1",
      [f.vendor.id, JSON.stringify(state)],
    );
    const actors: FleetActor[] = [];
    for (const user of f.staff) {
      const membership = (
        await f.pool.query(
          "SELECT id,role FROM user_org_memberships WHERE user_id=$1 AND vendor_id=$2",
          [user.id, f.vendor.id],
        )
      ).rows[0];
      actors.push({
        ...f.actor,
        userId: user.id,
        activeMembershipId: membership.id,
        membershipRole: membership.role,
        sv: user.sessionVersion,
      });
    }
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
    const service = createFleetService(databaseFleetRepository);
    const places: FleetDestination[] = [];
    for (const [index, kind] of (
      ["pickup", "delivery", "yard"] as const
    ).entries()) {
      const saved = await service.saveDestination(actors[0], {
        operationId: randomUUID(),
        expectedVersion: index + 1,
        destination: {
          name: `Synthetic physical ${kind}`,
          kind,
          address: `Manual ${kind} road`,
          latitude: null,
          longitude: null,
          active: true,
          timeZone: "America/Chicago",
        },
      });
      if (!("destination" in saved))
        throw new Error("Canonical location receipt required");
      places.push(saved.destination);
    }
    const physicalPlan = FleetRoutePlanSchema.parse({
      origin: { type: "canonical", location: places[0] },
      stops: [
        {
          id: randomUUID(),
          sequence: 0,
          kind: "delivery",
          cycleId: null,
          location: { type: "canonical", location: places[1] },
        },
        {
          id: randomUUID(),
          sequence: 1,
          kind: "return",
          cycleId: null,
          location: { type: "canonical", location: places[2] },
        },
      ],
      base: { type: "canonical", location: places[2] },
      returnPolicy: "return_required",
      plannedWindow: null,
    });
    const input = (index: number) => ({
      operationId: randomUUID(),
      fleetId: f.groupId,
      title: "Synthetic round trip",
      driverUserId: f.driverUserId(index),
      vehicleAssetId: details[index].vehicleAssetId,
      trailerAssetId: f.assets[2 + index].id,
      detailSelection: {
        version: 2,
        detailId: details[index].id,
        detailVersion: 1,
        timeZone: "America/Chicago",
        returnPolicy: "return_required",
      },
      billing: {
        mode: "new_ticket",
        workTypeId: work.id,
        afeNumber: "A1",
        workDate: "2026-10-16",
      },
      routePlan: physicalPlan,
      stops: fleetRouteOperationalStops(physicalPlan, site.id, randomUUID()),
    });
    let run = await service.create(actors[0], input(0));
    await expect.soft(service.fleetInventoryDetail(actors[1],f.assets[0].id)).resolves.toMatchObject({asset:{id:f.assets[0].id}});
    await expect.soft(service.fleetInventoryDetail(actors[1],f.assets[4].id)).resolves.toMatchObject({asset:{id:f.assets[4].id},runs:expect.arrayContaining([expect.objectContaining({id:run.id})])});
    expect(run.routePlan?.origin).toMatchObject({
      type: "canonical",
      location: { id: places[0].id, latitude: null },
    });
    expect(run.stops.map((stop) => stop.siteId)).toEqual([
      site.id,
      site.id,
      site.id,
    ]);
    const forged = structuredClone(physicalPlan);
    if (forged.origin.type !== "canonical") throw new Error("fixture");
    forged.origin.location.address = "Forged alternate pickup";
    await expect(
      service.editDraft(actors[0], run.id, {
        operationId: randomUUID(),
        expectedVersion: run.version,
        routePlan: forged,
        stops: fleetRouteOperationalStops(forged, site.id, run.stops[0].id),
      }),
    ).rejects.toMatchObject({ code: "fleet.destination_revision_conflict" });
    const deliveryOnly=FleetRoutePlanSchema.parse({...physicalPlan,base:null,returnPolicy:"delivery_only",stops:physicalPlan.stops.filter(stop=>stop.kind!=="return")});
    run=await service.editDraft(actors[0],run.id,{operationId:randomUUID(),expectedVersion:run.version,routePlan:deliveryOnly,stops:fleetRouteOperationalStops(deliveryOnly,site.id,run.stops[0].id)});
    expect.soft(run.resourceAssignment?.returnPolicy).toBe("delivery_only");
    run=await service.editDraft(actors[0],run.id,{operationId:randomUUID(),expectedVersion:run.version,routePlan:physicalPlan,stops:fleetRouteOperationalStops(physicalPlan,site.id,run.stops[0].id)});
    expect(run.resourceAssignment?.reservation.assetIds).toEqual([
      f.assets[0].id,
      f.assets[2].id,
      f.assets[4].id,
    ]);
    await expect(service.create(actors[0], input(1))).rejects.toMatchObject({
      code: "fleet.reservation_conflict",
    });
    expect(
      (
        await f.pool.query(
          "SELECT count(*)::int AS count FROM tickets WHERE vendor_id=$1",
          [f.vendor.id],
        )
      ).rows[0].count,
    ).toBe(1);
    await f.service.saveFleetDetail(f.actor, {
      operationId: randomUUID(),
      expectedVersion: 1,
      detail: { ...details[0], version: 2, name: "Changed future default" },
    });
    const act = async (action: string, extra: Record<string, unknown> = {}) => {
      run = await service.action(
        ["dispatch", "review"].includes(action) ? actors[0] : actors[1],
        run.id,
        {
          operationId: randomUUID(),
          expectedVersion: run.version,
          action,
          ...extra,
        },
      );
    };
    await act("dispatch");
    await act("acknowledge");
    expect(run.resourceAssignment?.snapshot.detail.version).toBe(1);
    await expect(
      act("inspect", {
        inspectionOutcome: "passed",
        notes: "Incomplete component coverage",
      }),
    ).rejects.toMatchObject({ code: "fleet.inspection_components_required" });
    await act("inspect", {
      inspectionOutcome: "passed",
      notes: "Actually inspected every component",
      inspectedAssetIds: [f.assets[0].id, f.assets[2].id, f.assets[4].id],
    });
    await act("record_meter", {
      reading: 100,
      unit: "miles",
      notes: "Actual meter",
    });
    const hold = (
      await f.pool.query(
        "INSERT INTO asset_holds(asset_id,reason,placed_by_user_id) VALUES($1,'Synthetic actual dolly hold',$2) RETURNING id",
        [f.assets[4].id, actors[0].userId],
      )
    ).rows[0];
    await expect(act("start")).rejects.toMatchObject({
      code: "fleet.equipment_on_hold",
    });
    await f.pool.query(
      "UPDATE asset_holds SET released_at=NOW(),released_by_user_id=$2 WHERE id=$1",
      [hold.id, actors[0].userId],
    );
    await act("start");
    expect(run.resourceAssignment?.reservation.state).toBe("active");
    await act("pause", { reason: "Driver reported a truck issue" });
    const replacementInput = f.detailInput(1, packages[1].id);
    replacementInput.detail.name = "Separate replacement Detail";
    const replacementDetail = await f.service.saveFleetDetail(
      f.actor,
      replacementInput,
    );
    const proposal = {
      operationId: randomUUID(),
      expectedVersion: run.version,
      vehicleAssetId: f.assets[1].id,
      trailerAssetId: f.assets[3].id,
      reason: "Recorded replacement resources",
      detailSelection: {
        ...input(0).detailSelection,
        detailId: replacementDetail.id,
        detailVersion: 1,
      },
    };
    await f.pool.query(
      "UPDATE assets SET status='checked_out',current_holder_user_id=$2 WHERE id=ANY($1::uuid[])",
      [[f.assets[1].id, f.assets[3].id], actors[1].userId],
    );
    await expect(
      service.proposeReplacement(actors[0], run.id, proposal),
    ).rejects.toMatchObject({ code: "fleet.equipment_custody_conflict" });
    await f.pool.query(
      "UPDATE assets SET status='checked_out',current_holder_user_id=$2 WHERE id=$1",
      [f.assets[4].id, actors[1].userId],
    );
    const replacementHold = (
      await f.pool.query(
        "INSERT INTO asset_holds(asset_id,reason,placed_by_user_id) VALUES($1,'Actual component hold',$2) RETURNING id",
        [f.assets[4].id, actors[0].userId],
      )
    ).rows[0];
    await expect(
      service.proposeReplacement(actors[0], run.id, proposal),
    ).rejects.toMatchObject({ code: "fleet.equipment_on_hold" });
    await f.pool.query(
      "UPDATE asset_holds SET released_at=NOW(),released_by_user_id=$2 WHERE id=$1",
      [replacementHold.id, actors[0].userId],
    );
    const replacement = await service.proposeReplacement(
      actors[0],
      run.id,
      proposal,
    );
    const acceptance = {
      operationId: randomUUID(),
      expectedVersion: replacement.version,
      runExpectedVersion: run.version,
      action: "accept",
      notes: "Driver accepted the recorded physical replacement",
    };
    await expect(
      service.replacementAction(actors[0], run.id, replacement.id, acceptance),
    ).rejects.toMatchObject({ code: "fleet.action_forbidden" });
    await service.replacementAction(
      actors[1],
      run.id,
      replacement.id,
      acceptance,
    );
    await expect.soft(service.fleetInventoryDetail(actors[0],f.assets[0].id)).resolves.toMatchObject({runs:expect.arrayContaining([expect.objectContaining({id:run.id})])});
    run = await service.detail(actors[1], run.id);
    expect(run.resourceAssignment?.snapshot.detail.id).toBe(
      replacementDetail.id,
    );
    expect(run.resourceAssignment?.reservation.state).toBe("active");
    expect(
      (
        run.events[0].details?.resourceAssignment as {
          snapshot: { detail: { id: string } };
        }
      ).snapshot.detail.id,
    ).toBe(details[0].id);
    await expect(act("resume")).rejects.toMatchObject({
      code: "fleet.action_forbidden",
    });
    await act("inspect", {
      inspectionOutcome: "passed",
      notes: "Driver inspected replacement components",
      inspectedAssetIds: [f.assets[1].id, f.assets[3].id, f.assets[4].id],
    });
    await act("record_meter", {
      reading: 500,
      unit: "miles",
      notes: "Actual replacement vehicle meter",
    });
    await act("resume");
    const loadId = randomUUID();
    await act("arrive_stop", { stopId: run.stops[0].id });
    await act("record_load", {
      loadId,
      commodity: "Water",
      quantity: 1,
      unit: "bbl",
      manifestReference: "Synthetic pickup",
    });
    await act("depart_stop", { stopId: run.stops[0].id });
    await act("arrive_stop", { stopId: run.stops[1].id });
    await act("record_delivery", {
      loadId,
      deliveryReference: "Synthetic delivered",
    });
    await act("depart_stop", { stopId: run.stops[1].id });
    await act("record_meter", {
      reading: 510,
      unit: "miles",
      notes: "Actual intermediate meter",
    });
    await expect(act("submit_closeout")).rejects.toMatchObject({
      code: "fleet.action_forbidden",
    });
    expect(run.resourceAssignment?.reservation.state).toBe("active");
    await act("arrive_stop", { stopId: run.stops[2].id });
    await act("depart_stop", { stopId: run.stops[2].id });
    await act("submit_closeout");
    expect(run.status).toBe("submitted_for_review");
    expect(run.resourceAssignment?.reservation.state).toBe("released");
    await expect(service.create(actors[0], input(1))).rejects.toMatchObject({
      code: "fleet.equipment_custody_conflict",
    });
    // The test records an explicit, separate Inventory return. Closing a Fleet run never does this implicitly.
    await f.pool.query(
      "UPDATE assets SET status='available',current_holder_user_id=NULL WHERE id=ANY($1::uuid[])",
      [[f.assets[1].id, f.assets[3].id, f.assets[4].id]],
    );
    let next = await service.create(actors[0], input(1));
    expect(next.resourceAssignment?.reservation.state).toBe("reserved");
    await act("review", {
      decision: "return",
      reason: "Please clarify the receipt notes",
    });
    expect(run.allowedActions).toEqual([]); // Office cannot perform the driver's correction.
    run = await service.detail(actors[1], run.id);
    expect(run.allowedActions).toEqual(["submit_closeout"]);
    await act("submit_closeout", {
      notes: "Driver clarified recorded receipt; no new physical trip",
    });
    expect(run.resourceAssignment?.reservation.state).toBe("released");
    const original = structuredClone(next.resourceAssignment);
    const reassignment = {
      operationId: randomUUID(),
      expectedVersion: next.version,
      action: "reassign",
      driverUserId: f.driverUserId(0),
      vehicleAssetId: details[0].vehicleAssetId,
      trailerAssetId: f.assets[2].id,
      detailSelection: { ...input(0).detailSelection, detailVersion: 2 },
    };
    await expect(
      service.action(actors[0], next.id, {
        ...reassignment,
        detailSelection: {
          ...reassignment.detailSelection,
          detailId: randomUUID(),
        },
      }),
    ).rejects.toMatchObject({ code: "fleet.detail_not_found" });
    expect(
      (await service.detail(actors[0], next.id)).resourceAssignment,
    ).toEqual(original);
    next = await service.action(actors[0], next.id, reassignment);
    expect(next.resourceAssignment?.snapshot.detail).toMatchObject({
      id: details[0].id,
      version: 2,
    });
    expect(next.resourceAssignment?.reservation.id).not.toBe(
      original?.reservation.id,
    );
    const start = new Date(Date.now() + 86400000),
      end = new Date(start.getTime() + 3600000);
    next = await service.editDraft(actors[0], next.id, {
      operationId: randomUUID(),
      expectedVersion: next.version,
      schedule: {
        plannedStartAt: start.toISOString(),
        plannedEndAt: end.toISOString(),
        timezone: "America/Chicago",
      },
    });
    expect(next.resourceAssignment?.reservation).toMatchObject({
      startAt: start.toISOString(),
      plannedEndAt: end.toISOString(),
    });
    expect.soft(next.routePlan?.plannedWindow).toEqual({startAt:start.toISOString(),endAt:end.toISOString(),timeZone:"America/Chicago"});
    next = await service.action(actors[0], next.id, {
      operationId: randomUUID(),
      expectedVersion: next.version,
      action: "cancel",
      reason: "Office cancelled planned work",
    });
    expect(next.resourceAssignment?.reservation.state).toBe("cancelled");
    expect(
      (
        await f.pool.query(
          "SELECT current_holder_user_id,status FROM assets WHERE id=ANY($1::uuid[])",
          [f.assets.map((row) => row.id)],
        )
      ).rows.every(
        (row) =>
          row.current_holder_user_id === null && row.status === "available",
      ),
    ).toBe(true);
    const {fleetRunOrderRoute}=await import("@workspace/api-zod");
    const order=await service.saveFleetRunOrder(actors[0],{operationId:randomUUID(),expectedVersion:0,order:{id:randomUUID(),companyId:f.vendor.id,version:1,name:"Saved tank to terminal Run",accessGroupIds:[f.groupId],origin:places[0],destination:places[1],base:places[2],returnPolicy:"return_required",instructions:"Repeat transport order",timeZone:"America/Chicago",archivedAt:null}});
    const route=fleetRunOrderRoute(order,randomUUID);
    const selected={...input(0),operationId:randomUUID(),detailSelection:{...input(0).detailSelection,detailVersion:2},runOrderSelection:{id:order.id,version:order.version},routePlan:route,stops:fleetRouteOperationalStops(route,site.id,randomUUID())};
    const firstActivity=await service.create(actors[0],selected);
    expect(firstActivity.runOrder).toEqual(order);
    expect(firstActivity.linkedTicketId).not.toBeNull();
    const replayedActivity=await service.create(actors[0],selected);
    expect(replayedActivity).toMatchObject({id:firstActivity.id,linkedTicketId:firstActivity.linkedTicketId,version:firstActivity.version,runOrder:order,resourceAssignment:firstActivity.resourceAssignment,events:firstActivity.events});
    await expect(service.create(actors[0],{...selected,operationId:randomUUID(),runOrderSelection:{id:order.id,version:99}})).rejects.toMatchObject({code:"fleet.run_order_revision_conflict"});
    await expect(service.editDraft(actors[0],firstActivity.id,{operationId:randomUUID(),expectedVersion:firstActivity.version,routePlan:deliveryOnly,stops:fleetRouteOperationalStops(deliveryOnly,site.id,firstActivity.stops[0].id)})).rejects.toMatchObject({code:"fleet.run_order_route_mismatch"});
    await service.action(actors[0],firstActivity.id,{operationId:randomUUID(),expectedVersion:firstActivity.version,action:"cancel",reason:"Synthetic first activity"});
    const secondActivity=await service.create(actors[0],{...selected,operationId:randomUUID(),billing:{mode:"existing_ticket",ticketId:firstActivity.linkedTicketId!,afeNumber:"A1",workDate:"2026-10-16"}});
    expect(secondActivity.id).not.toBe(firstActivity.id);
    expect(secondActivity.runOrder).toEqual(order);
    expect(secondActivity.linkedTicketId).toBe(firstActivity.linkedTicketId);
    const {FleetCommercialSettingsSchema}=await import("@workspace/api-zod");
    const partnerPlaces=places.slice(0,2).map(place=>({...place,id:randomUUID(),ownerType:"partner" as const,ownerId:partner.id}));
    await f.pool.query("UPDATE partners SET fleet_commercial_settings=$2::jsonb WHERE id=$1",[partner.id,JSON.stringify(FleetCommercialSettingsSchema.parse({destinations:partnerPlaces}))]);
    const partnerOrder=await service.saveFleetRunOrder(actors[0],{operationId:randomUUID(),expectedVersion:0,order:{...order,id:randomUUID(),origin:partnerPlaces[0],destination:partnerPlaces[1],base:null,returnPolicy:"delivery_only"}});
    const partnerChanges=[{...partnerPlaces[0],revision:2,address:"Partner moved entrance"},{...partnerPlaces[1],revision:2,permittedCompanyIds:[f.vendor.id+999]}];
    await f.pool.query("UPDATE partners SET fleet_commercial_settings=$2::jsonb WHERE id=$1",[partner.id,JSON.stringify(FleetCommercialSettingsSchema.parse({destinations:partnerChanges}))]);
    expect(await service.fleetRunOrderLocations(actors[0],partnerOrder.id)).toMatchObject({orderId:partnerOrder.id,orderVersion:1,locations:[expect.objectContaining({id:partnerPlaces[0].id,revision:2})],unavailableLocationIds:[partnerPlaces[1].id]});
    const currentState=FleetStateSchema.parse((await f.pool.query("SELECT fleet_ops_state FROM vendors WHERE id=$1",[f.vendor.id])).rows[0].fleet_ops_state);
    currentState.grants.find(grant=>grant.userId===actors[1].userId)!.roles=["driver","fleet_manager"];
    await f.pool.query("UPDATE vendors SET fleet_ops_state=$2::jsonb WHERE id=$1",[f.vendor.id,JSON.stringify(currentState)]);
    // Own assigned activity access does not grant a manager/driver access to
    // the customer's transport-order directory or permission to create one.
    await expect(service.fleetRunOrder(actors[1],partnerOrder.id)).rejects.toMatchObject({code:"fleet.run_order_not_found"});
    await expect(service.fleetRunOrderLocations(actors[1],partnerOrder.id)).rejects.toMatchObject({code:"fleet.run_order_not_found"});
    await expect(service.saveFleetRunOrder(actors[1],{operationId:randomUUID(),expectedVersion:0,order:{...partnerOrder,id:randomUUID()}})).rejects.toMatchObject({code:"fleet.run_order_not_found"});
  });
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
    const snapshot = await f.service.fleetDetailSnapshot(f.actor, detail.id, f.driverUserId(0));
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
      details.map((detail, index) =>
        f.service.fleetDetailSnapshot(f.actor, detail.id, f.driverUserId(index)),
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
  it("uses canonical UUID casing for resource reads and operation receipts", async () => {
    const f = await fixture(),
      input = f.packageInput(0);
    const rig = await f.service.saveFleetRigPackage(f.actor, input);
    expect(
      await f.service.fleetRigPackage(f.actor, rig.id.toUpperCase()),
    ).toMatchObject({ id: rig.id });
    expect(
      await f.service.fleetResourceReceipt(
        f.actor,
        input.operationId.toUpperCase(),
      ),
    ).toMatchObject({ operationId: input.operationId });
    const detail = await f.service.saveFleetDetail(
      f.actor,
      f.detailInput(0, rig.id),
    );
    expect(
      (await f.service.fleetDetailSnapshot(f.actor, detail.id.toUpperCase(), f.driverUserId(0)))
        .detail.id,
    ).toBe(detail.id);
  });
  it.each(["same_company", "other_company"])(
    "refuses a Detail reservation against an active legacy run in %s",
    async (where) => {
      const f = await fixture(),
        rig = await f.service.saveFleetRigPackage(f.actor, f.packageInput(0));
      const detail = await f.service.saveFleetDetail(
        f.actor,
        f.detailInput(0, rig.id),
      );
      const driverUserId = f.driverUserId(0);
      const snapshot = await f.service.fleetDetailSnapshot(f.actor, detail.id, driverUserId);
      let companyId = f.actor.companyId;
      if (where === "other_company")
        companyId = (
          await f.pool.query(
            "INSERT INTO vendors(name,contact_name,contact_email) VALUES($1,'Synthetic',$2) RETURNING id",
            [`Other ${randomUUID()}`, `${randomUUID()}@example.invalid`],
          )
        ).rows[0].id;
      const legacy = FleetRunSchema.parse({
        id: randomUUID(),
        companyId,
        fleetId: randomUUID(),
        title: "Private active legacy work",
        driverUserId,
        vehicleAssetId:
          where === "same_company" ? detail.vehicleAssetId : randomUUID(),
        trailerAssetId: null,
        siteIds: [9],
        status: "in_progress",
        phase: null,
        version: 1,
        stops: [{ id: randomUUID(), siteId: 9, kind: "pickup", sequence: 0 }],
        loads: [],
        records: [],
        inspections: [],
        currentStopId: null,
        visitedStopIds: [],
        events: [],
        linkedTicketId: null,
        allowedActions: [],
      });
      if (where === "other_company")
        await f.pool.query(
          "UPDATE vendors SET fleet_ops_state=$2::jsonb WHERE id=$1",
          [
            companyId,
            JSON.stringify({
              ...emptyFleetState(),
              enabled: true,
              runs: [legacy],
            }),
          ],
        );
      await expect(
        f.transaction(
          { ...f.actor, schedulingDriverUserIds: [driverUserId] },
          (state, client) => {
            if (where === "same_company") state.runs.push(legacy);
            return f.module.reserveFleetDetail({ state, client }, f.actor, {
              runId: randomUUID(),
              detailSnapshot: snapshot,
              startAt: "2026-10-16T12:00:00Z",
              plannedEndAt: null,
              timeZone: "America/Chicago",
            });
          },
        ),
      ).rejects.toMatchObject({ code: "fleet.reservation_conflict" });
    },
  );
  it("refuses a supplied snapshot that changes components without changing the saved revision", async () => {
    const f = await fixture(),
      rig = await f.service.saveFleetRigPackage(f.actor, f.packageInput(0));
    const detail = await f.service.saveFleetDetail(
      f.actor,
      f.detailInput(0, rig.id),
    );
    const driverUserId = f.driverUserId(0);
    const snapshot = await f.service.fleetDetailSnapshot(f.actor, detail.id, driverUserId);
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
        { ...f.actor, schedulingDriverUserIds: [driverUserId] },
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
    const driverUserId = f.driverUserId(0);
    const snapshot = await f.service.fleetDetailSnapshot(f.actor, detail.id, driverUserId);
    await f.pool.query("UPDATE users SET suspended_at=NOW() WHERE id=$1", [
      driverUserId,
    ]);
    await expect(
      f.transaction(
        { ...f.actor, schedulingDriverUserIds: [driverUserId] },
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

it("binds disabled-by-default service templates to existing offered catalog identities with exact audited retries",async()=>{
 const f=await fixture(),{db,workTypesTable,vendorWorkTypesTable}=await import("@workspace/db"),{createFleetServiceTemplateOperations,readFleetServiceTemplate}=await import("./fleet-service-template"),{buildFleetServiceTemplate}=await import("@workspace/api-zod");
 const [offered]=await db.insert(workTypesTable).values({name:`Synthetic template ${randomUUID()}`,category:"hauling"}).returning();await db.insert(vendorWorkTypesTable).values({vendorId:f.vendor.id,workTypeId:offered.id,unit:"per_job",unitPrice:"12.34",currency:"USD"});
 const service=createFleetServiceTemplateOperations(f.transaction,(state,actor)=>state.grants.find(row=>row.userId===actor.userId)??null),template={...buildFleetServiceTemplate({family:"crude_condensate",serviceId:offered.id,serviceName:offered.name}),revision:1},input={operationId:randomUUID(),expectedRevision:0,template};
 expect(await service.saveServiceTemplate(f.actor,input)).toEqual(template);expect(await service.saveServiceTemplate(f.actor,input)).toEqual(template);expect(await service.serviceTemplates(f.actor)).toMatchObject({canManage:true,services:[{serviceId:offered.id,template:{enabled:false,revision:1}}]});
 await expect(service.saveServiceTemplate({...f.actor,userId:f.staff[1].id},{...input,operationId:randomUUID()})).rejects.toMatchObject({status:403});await expect(service.saveServiceTemplate(f.actor,{...input,operationId:randomUUID(),template:{...template,serviceId:offered.id+999999}})).rejects.toMatchObject({code:"fleet.service_not_offered"});await expect(service.saveServiceTemplate(f.actor,{...input,template:{...template,name:"Changed retry"}})).rejects.toMatchObject({code:"fleet.operation_conflict"});
 const next={...template,revision:2,enabled:true,commodities:["Explicit reported material"],capabilities:["Reviewed capability"]};await service.saveServiceTemplate(f.actor,{operationId:randomUUID(),expectedRevision:1,template:next});
 const client=await f.pool.connect();try{expect(await readFleetServiceTemplate(client,f.vendor.id,offered.id,1)).toEqual(template);expect((await client.query("SELECT unit_price::text FROM vendor_work_types WHERE vendor_id=$1 AND work_type_id=$2",[f.vendor.id,offered.id])).rows[0].unit_price).toBe("12.34");expect((await client.query("SELECT count(*)::int AS n FROM tickets WHERE vendor_id=$1",[f.vendor.id])).rows[0].n).toBe(0);}finally{client.release();}
});
