import { createHash, randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import {
  db,
  pool,
  usersTable,
  userOrgMembershipsTable,
  vendorPeopleTable,
  assetsTable,
  workHubDevicesTable,
} from "@workspace/db";
import {
  FleetDestinationReceiptSchema,
  FleetRunSchema,
  FleetWorkCommandSchema,
  fleetRunOrderRoute,
  type FleetRun,
  type FleetWorkReference,
} from "@workspace/api-zod";
import { createFleetPricingFixture } from "../test-utils/fleet-pricing";
import { createFleetService } from "./fleet-ops";
import {
  databaseFleetRepository,
  emptyFleetState,
  FleetError,
} from "./fleet-repository";
import { createDatabaseFleetWorkRepository } from "./fleet-work-repository";
import { executeFleetWorkCommand } from "./fleet-work-canonical";
import { createFleetWorkService } from "./fleet-work";
import { requireFleetRunCommercialAuthority } from "./fleet-commercial-authority";
import {readFleetReconciliation,readFleetRecoveryOptions} from "./fleet-reconciliation";

async function fixture(options: { rig?: boolean } = {}) {
  const f = await createFleetPricingFixture(),
    group = randomUUID();
  const [driver] = await db
    .insert(usersTable)
    .values({
      username: `driver-${randomUUID()}@example.invalid`,
      passwordHash: "not-a-login",
      displayName: "Synthetic pool driver",
      role: "field_employee",
    })
    .returning();
  const [driverMembership] = await db
    .insert(userOrgMembershipsTable)
    .values({
      userId: driver.id,
      orgType: "vendor",
      vendorId: f.vendor,
      role: "field_employee",
    })
    .returning();
  const [driverPerson] = await db
    .insert(vendorPeopleTable)
    .values({
      userId: driver.id,
      vendorId: f.vendor,
      firstName: "Synthetic",
      email: driver.username,
    })
    .returning();
  const [truck] = await db
    .insert(assetsTable)
    .values({
      name: "Synthetic dispatch truck",
      category: "truck",
      legalOwnerName: "Synthetic",
      responsibleOrgType: "vendor",
      responsibleOrgId: f.vendor,
    })
    .returning();
  await pool.query(
    "INSERT INTO asset_attachment_links(asset_id,attachment_type,attachment_id,linked_by_user_id) VALUES($1,'fleet_inventory',$2,$3)",
    [truck.id, String(f.vendor), f.manager.userId],
  );
  const rigAssets = options.rig ? await db.insert(assetsTable).values(
    ["trailer", "dolly"].map(category => ({
      name: `Synthetic ${category}`, category, legalOwnerName: "Synthetic",
      responsibleOrgType: "vendor", responsibleOrgId: f.vendor,
    })),
  ).returning() : [];
  await pool.query("UPDATE vendors SET fleet_ops_state=$2::jsonb WHERE id=$1", [
    f.vendor,
    JSON.stringify({
      ...emptyFleetState(),
      enabled: true,
      fleets: [
        {
          id: group,
          name: "Dispatch access",
          siteIds: [f.site],
          equipmentAssetIds: [truck.id, ...rigAssets.map(asset => asset.id)],
          requiredCertifications: [],
        },
      ],
      grants: [
        {
          userId: f.manager.userId,
          fleetIds: [group],
          siteIds: [f.site],
          roles: ["fleet_manager"],
          safetyRelease: false,
          financeRead: true,
        },
        {
          userId: driver.id,
          fleetIds: [group],
          siteIds: [],
          roles: ["driver"],
          safetyRelease: false,
          financeRead: false,
        },
      ],
    }),
  ]);
  const service = createFleetService(databaseFleetRepository),
    actor = f.manager;
  const rig = rigAssets.length ? await service.saveFleetRigPackage({ ...actor }, {
    operationId: randomUUID(), expectedVersion: 0,
    package: {
      id: randomUUID(), companyId: f.vendor, version: 1, name: "Synthetic tow package",
      components: rigAssets.map((asset, sequence) => ({ assetId: asset.id, role: asset.category, sequence })),
      effectiveFrom: "2026-01-01T00:00:00Z", effectiveUntil: null, archivedAt: null,
    },
  }) : null;
  const detail = await service.saveFleetDetail(
    { ...actor },
    {
      operationId: randomUUID(),
      expectedVersion: 0,
      detail: {
        id: randomUUID(),
        companyId: f.vendor,
        version: 1,
        name: "Synthetic Detail",
        vehicleAssetId: truck.id,
        rigPackageId: rig?.id ?? null,
        rigPackageVersion: rig?.version ?? null,
        driverUserId: driver.id,
        accessGroupIds: [group],
        effectiveFrom: "2026-01-01T00:00:00Z",
        effectiveUntil: null,
        archivedAt: null,
      },
    },
  );
  const savePlace = (name: string, expectedVersion: number) =>
    service
      .saveDestination(
        { ...actor },
        {
          operationId: randomUUID(),
          expectedVersion,
          destination: {
            name,
            kind: "delivery",
            address: `${name}, synthetic yard`,
            latitude: null,
            longitude: null,
          },
        },
      )
      .then(FleetDestinationReceiptSchema.parse);
  const origin = await savePlace("Origin", 1),
    destination = await savePlace("Destination", origin.version);
  const order = await service.saveFleetRunOrder(
    { ...actor },
    {
      operationId: randomUUID(),
      expectedVersion: 0,
      order: {
        id: randomUUID(),
        companyId: f.vendor,
        version: 1,
        name: "Synthetic transport order",
        accessGroupIds: [group],
        origin: origin.destination,
        destination: destination.destination,
        base: null,
        returnPolicy: "delivery_only",
        instructions: "Synthetic",
        timeZone: "America/Chicago",
        archivedAt: null,
      },
    },
  );
  const snapshot = await service.fleetDetailSnapshot({ ...actor }, detail.id);
  const [device] = await db
    .insert(workHubDevicesTable)
    .values({
      userId: actor.userId,
      ownerOrgType: "vendor",
      ownerOrgId: f.vendor,
      friendlyName: "Synthetic dispatch device",
      deviceClass: "desktop",
      capabilities: {},
    })
    .returning();
  let failAfterCreate = false;
  const repository = createDatabaseFleetWorkRepository({
    execute: async (context, command) => {
      const result = await executeFleetWorkCommand(context, command);
      if (failAfterCreate) throw new FleetError("fleet.version_conflict");
      return result;
    },
  });
  const provisioning = await repository.provision(actor, {
    deviceId: device.id,
    appVersion: "test-v2",
  });
  const capturedAt = new Date().toISOString();
  const command = FleetWorkCommandSchema.parse({
    version: 2,
    operationId: randomUUID(),
    scope: provisioning.scope,
    capturedAt,
    timeZone: "America/Chicago",
    dependencies: [],
    kind: "activity.create",
    payload: {
      activityId: randomUUID(),
      title: "Synthetic crude transport",
      detailReference: {
        type: "canonical",
        kind: "detail",
        id: detail.id,
        version: detail.version,
      },
      detailSnapshot: snapshot,
      route: fleetRunOrderRoute(order, randomUUID),
      runOrderReference: {
        type: "canonical",
        kind: "run_order",
        id: order.id,
        version: order.version,
      },
      billing: {
        choice: "new_ticket",
        ticket: { type: "local", kind: "ticket", id: randomUUID() },
        partnerId: f.partner,
        billingSiteId: f.site,
        afeNumber: "AFE1",
        workDate: "2026-10-16",
        currency: "USD",
        serviceId: f.service,
        agreementReference: null,
      },
      pricingIntent: {
        mode: "unpriced",
        reason: "offline_reference_missing",
        serviceId: f.service,
        approvalRef: null,
      },
      capturePolicy: null,
      compliance: {
        mode: "warn_only",
        status: "red",
        evaluatedAt: capturedAt,
        warnings: [],
      },
    },
  });
  return {
    ...f,
    actor,
    driver,
    driverMembership,
    driverPerson,
    truck,
    rigAssets,
    command,
    repository,
    work: createFleetWorkService(repository),
    rollback: () => {
      failAfterCreate = true;
    },
  };
}


it("retains an offline new-ticket Detail day through restart, performs only own original reports, then office reviews and submits",async()=>{
 const mod=await import("@workspace/api-zod"),f=await fixture({rig:true}),actor={...f.actor,userId:f.driver.id,role:"field_employee",membershipRole:"field_employee",vendorPeopleId:f.driverPerson.id,sv:f.driver.sessionVersion,activeMembershipId:f.driverMembership.id},provision=await f.repository.assistantProvision(actor);
 const create=FleetWorkCommandSchema.parse({...f.command,scope:provision.scope,payload:{...f.command.payload,originStopId:randomUUID()}});if(create.kind!=="activity.create")throw Error("Expected creation");
 const rows=new Map<string,string>(),storage={transaction:async(work:any)=>work({get:async(k:string,id:string)=>rows.get(k+id)??null,set:async(k:string,id:string,value:string)=>{rows.set(k+id,value);},values:async(k:string)=>[...rows].filter(([key])=>key.startsWith(k)).map(([,value])=>value)})};const open=()=>mod.createDurableFleetWorkJournal({scope:provision.scope,storage,isCurrent:()=>true,digest:async value=>createHash("sha256").update(value).digest("hex")});let journal=open();await journal.append(create);journal=open();
 const run=mod.projectFleetLocalActivities((await journal.readState()).entries,actor.userId,[])[0],pickup=run.stops[0],delivery=run.stops[1],loadId=randomUUID();expect(run.localWork?.state).toBe("pending_server_acceptance");expect(run.resourceAssignment).toBeUndefined();
 const actions:any[]=[{action:"dispatch"},{action:"acknowledge"},{action:"inspect",inspectionOutcome:"passed",notes:"Synthetic reported inspection",inspectedAssetIds:[run.vehicleAssetId,...(create.payload.detailSnapshot.rigPackage?.components.map(c=>c.assetId)??[])]},{action:"record_meter",reading:100,unit:"miles",notes:"Synthetic opening odometer"},{action:"start"},{action:"arrive_stop",stopId:pickup.id},{action:"record_load",loadId,commodity:"Crude",quantity:42,unit:"barrel",manifestReference:"SYNTHETIC-MANIFEST"},{action:"depart_stop",stopId:pickup.id},{action:"arrive_stop",stopId:delivery.id},{action:"record_delivery",loadId,deliveryReference:"SYNTHETIC-DELIVERY"},{action:"depart_stop",stopId:delivery.id},{action:"record_meter",reading:120,unit:"miles",notes:"Synthetic ending odometer"},{action:"submit_closeout",notes:"Synthetic driver closeout"}];
 for(const fields of actions){const state=await journal.readState(),preview=mod.previewFleetWorkEntries(run,state.entries,actor.userId),input={...fields,expectedVersion:preview?.expectedVersion??1,operationId:randomUUID(),source:"user_report" as const,capturedAt:new Date().toISOString()},command=mod.buildFleetActionIntent(provision.scope,{...run,version:input.expectedVersion},input,()=>new Date(),"America/Chicago");command.dependencies=[state.entries.at(-1)!.command.operationId];await journal.append(command);journal=open();}
 const offline=await journal.readState();expect(mod.previewFleetWorkEntries(run,offline.entries,actor.userId)?.status).toBe("submitted_for_review");expect(offline.entries).toHaveLength(14);
 let first:any;for(const entry of offline.entries){const receipt=await f.work.apply(actor,entry.command);expect(receipt.status,JSON.stringify(receipt)).toBe("applied");if(!first)first=receipt;await journal.applyReceipt(provision.scope,receipt);}
 const activity=first.canonicalReferences.find((r:any)=>r.kind==="activity"),ticket=first.canonicalReferences.find((r:any)=>r.kind==="ticket"),service=createFleetService(databaseFleetRepository),saved=await service.detail({...f.actor},activity.id);expect(saved.status).toBe("submitted_for_review");expect(saved.inspections).toHaveLength(1);expect(saved.loads[0].deliveredAt).toBeTruthy();
 const quantityId=randomUUID(),quantityAt=new Date().toISOString(),reported=await f.work.apply(actor,{version:2,operationId:randomUUID(),scope:provision.scope,kind:"quantity.record",capturedAt:quantityAt,timeZone:"America/Chicago",dependencies:[],payload:{activity:{...activity,version:saved.version},ticket,evidence:{id:quantityId,cycleId:null,kind:"delivered",quantity:"42",unit:"barrel",source:"manual",evidenceReferences:["SYNTHETIC-DELIVERY"],capturedAt:quantityAt,recordedByUserId:actor.userId}}});expect(reported.status).toBe("applied");
 const office={version:2 as const,scope:f.command.scope,operationId:randomUUID(),capturedAt:new Date().toISOString(),timeZone:"America/Chicago",dependencies:[]},binding={activity:{...activity,version:saved.version},ticket};expect((await f.work.apply(f.actor,{...office,kind:"quantity.review",payload:{...binding,selections:[{evidenceId:quantityId,expectedReviewRevision:0,decision:"accept_as_billable",reason:"Synthetic office source review"}]}})).status).toBe("applied");
 const reviewed=await f.work.apply(f.actor,{...office,operationId:randomUUID(),kind:"charge.review",payload:{...binding,expectedVersion:saved.version,quantityReviews:[{evidenceId:quantityId,revision:1}],taxTreatment:"existing_ticket_rubric",intervals:[],additionalCharges:[]}});expect(reviewed.status,JSON.stringify(reviewed)).toBe("applied");
 const parent=(await pool.query("SELECT status,fleet_plan FROM tickets WHERE id=$1",[ticket.id])).rows[0];expect(parent.status).not.toBe("submitted");const finalized=await f.work.apply(f.actor,{...office,operationId:randomUUID(),kind:"ticket.finalize",payload:{ticket:{...ticket,version:parent.fleet_plan.revision},expectedVersion:parent.fleet_plan.revision,finalizeDayMinimums:false}});expect(finalized.status,JSON.stringify(finalized)).toBe("applied");expect((await pool.query("SELECT status FROM tickets WHERE id=$1",[ticket.id])).rows[0].status).toBe("submitted");
},60000);
