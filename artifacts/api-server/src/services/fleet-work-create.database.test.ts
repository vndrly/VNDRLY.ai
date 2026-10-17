import { randomUUID } from "node:crypto";
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

async function cancelWork(
  f: Awaited<ReturnType<typeof fixture>>,
  run: FleetRun,
) {
  if (!run.resourceAssignment || !run.billingV2)
    throw Error("Expected actual Detail and billing binding");
  const operationId = randomUUID(),
    capturedAt = new Date().toISOString();
  return f.work.apply(
    f.actor,
    FleetWorkCommandSchema.parse({
      version: 2,
      operationId,
      scope: f.command.scope,
      capturedAt,
      timeZone: "America/Chicago",
      dependencies: [],
      kind: "activity.action",
      payload: {
        activity: {
          type: "canonical",
          kind: "activity",
          id: run.id,
          version: run.version,
        },
        ticket: {
          type: "canonical",
          kind: "ticket",
          id: run.billingV2.ticketId,
          version: run.billingV2.ticketRevisionAtBinding,
        },
        baseAssignment: run.resourceAssignment.snapshot,
        action: {
          operationId,
          expectedVersion: run.version,
          action: "cancel",
          reason: "Synthetic office cancellation",
          capturedAt,
          source: "user_report",
        },
      },
    }),
  );
}

it("requires an original-scope receipt transaction for v2 actions while retaining actual office cancellation", async () => {
  const f = await fixture(),
    created = await f.work.apply(f.actor, f.command);
  if (created.status !== "applied") throw Error("Expected actual creation");
  const service = createFleetService(databaseFleetRepository),
    run = await service.detail(
      { ...f.actor },
      String(
        created.canonicalReferences.find((r) => r.kind === "activity")!.id,
      ),
    );
  await expect(
    service.action({ ...f.actor }, run.id, {
      operationId: randomUUID(),
      expectedVersion: run.version,
      action: "cancel",
      reason: "Legacy bypass attempt",
    }),
  ).rejects.toMatchObject({ code: "fleet.work_command_required", status: 409 });
  expect((await service.detail({ ...f.actor }, run.id)).status).toBe("draft");
  expect((await cancelWork(f, run)).status).toBe("applied");
  expect((await service.detail({ ...f.actor }, run.id)).status).toBe(
    "cancelled",
  );
});

it("shows Inventory for a pool driver's current retained assignment without personal site grants", async () => {
  const f = await fixture({ rig: true }), created = await f.work.apply(f.actor, f.command);
  if (created.status !== "applied") throw Error("Expected actual creation");
  const id = String(created.canonicalReferences.find(ref => ref.kind === "activity")!.id);
  const service = createFleetService(databaseFleetRepository);
  const driver = {
    ...f.actor, userId: f.driver.id, role: "field_employee", membershipRole: "field_employee",
    activeMembershipId: f.driverMembership.id, sv: f.driver.sessionVersion,
    vendorPeopleId: f.driverPerson.id,
  };
  const inventory = await service.fleetInventory({ ...driver });
  expect(inventory.canManage).toBe(false);
  expect(inventory.assets.map(asset => asset.id).sort()).toEqual([f.truck.id, ...f.rigAssets.map(asset => asset.id)].sort());
  expect(await service.fleetInventoryDetail({ ...driver }, f.truck.id)).toMatchObject({
    canManage: false, asset: { id: f.truck.id }, runs: [{ id }],
  });
  for (const asset of f.rigAssets) expect(await service.fleetInventoryDetail({ ...driver }, asset.id)).toMatchObject({
    canManage: false, asset: { id: asset.id }, runs: [{ id }],
  });
  const [unassigned] = await db.insert(assetsTable).values({
    name: "Synthetic unrelated company truck", category: "truck", legalOwnerName: "Synthetic",
    responsibleOrgType: "vendor", responsibleOrgId: f.vendor,
  }).returning();
  await pool.query("INSERT INTO asset_attachment_links(asset_id,attachment_type,attachment_id,linked_by_user_id) VALUES($1,'fleet_inventory',$2,$3)",
    [unassigned.id, String(f.vendor), f.manager.userId]);
  await expect(service.fleetInventoryDetail({ ...driver }, unassigned.id)).rejects.toMatchObject({ status: 404 });
  const state = (await pool.query("SELECT fleet_ops_state FROM vendors WHERE id=$1", [f.vendor])).rows[0].fleet_ops_state;
  expect(state.grants.find((grant: { userId: number }) => grant.userId === f.driver.id).siteIds).toEqual([]);
  expect(state.runs).toEqual([]);
  const snapshots = await pool.query("SELECT count(*)::int AS n FROM assistant_action_audit WHERE vendor_id=$1 AND target_type='fleet-run' AND target_id=$2", [f.vendor, id]);
  expect(snapshots.rows[0].n).toBe(1);
  const run = await service.detail({ ...f.actor }, id);
  expect((await cancelWork(f, run)).status).toBe("applied");
  expect((await service.fleetInventory({ ...driver })).assets).toEqual([]);
  await expect(service.fleetInventoryDetail({ ...driver }, f.truck.id)).rejects.toMatchObject({ status: 404 });
});

it("does not resurrect historical Inventory assignment when the latest driver or current grant changes", async () => {
  const f = await fixture(), created = await f.work.apply(f.actor, f.command);
  if (created.status !== "applied") throw Error("Expected actual creation");
  const id = String(created.canonicalReferences.find(ref => ref.kind === "activity")!.id);
  const service = createFleetService(databaseFleetRepository);
  const driver = {
    ...f.actor, userId: f.driver.id, role: "field_employee", membershipRole: "field_employee",
    activeMembershipId: f.driverMembership.id, sv: f.driver.sessionVersion,
    vendorPeopleId: f.driverPerson.id,
  };
  expect((await service.fleetInventory(driver)).assets.map(asset => asset.id)).toEqual([f.truck.id]);
  // Retained-history fixture: the current head no longer names this driver.
  // No driver action, acknowledgement, inspection or physical start is claimed.
  const original = await service.detail({ ...f.actor }, id);
  const reassigned = structuredClone(original);
  reassigned.version += 1;
  reassigned.driverUserId = f.actor.userId;
  reassigned.resourceAssignment!.snapshot.detail.driverUserId = f.actor.userId;
  reassigned.resourceAssignment!.reservation.driverUserId = f.actor.userId;
  FleetRunSchema.parse(reassigned);
  await pool.query("INSERT INTO assistant_action_audit(user_id,vendor_id,client_surface,input_mode,provider,tool_name,action_type,target_type,target_id,tool_output,result_status) VALUES($1,$2,'fleet','typed','canonical','synthetic_assignment_fixture','fleet-run-snapshot','fleet-run',$3,$4::jsonb,'completed')",
    [f.actor.userId, f.vendor, id, JSON.stringify(reassigned)]);
  expect((await service.fleetInventory(driver)).assets).toEqual([]);
  await expect(service.fleetInventoryDetail(driver, f.truck.id)).rejects.toMatchObject({ status: 404 });
  const state = (await pool.query("SELECT fleet_ops_state FROM vendors WHERE id=$1", [f.vendor])).rows[0].fleet_ops_state;
  state.grants.find((grant: { userId: number }) => grant.userId === f.driver.id).roles = [];
  await pool.query("UPDATE vendors SET fleet_ops_state=$2::jsonb WHERE id=$1", [f.vendor, JSON.stringify(state)]);
  await expect(service.fleetInventory(driver)).rejects.toMatchObject({ status: 403 });
});

it("reads retained phone observations through an explicit scoped map page instead of an empty legacy feed", async () => {
  const f = await fixture(), created = await f.work.apply(f.actor, f.command);
  if (created.status !== "applied") throw Error("Expected actual creation");
  const id = String(created.canonicalReferences.find(ref => ref.kind === "activity")!.id);
  const service = createFleetService(databaseFleetRepository), run = await service.detail({ ...f.actor }, id);
  const deviceId = `synthetic-map-${randomUUID()}`, recordedAt = new Date().toISOString();
  await pool.query("INSERT INTO location_consents(user_id,device_id) VALUES($1,$2)", [f.driver.id, deviceId]);
  // Explicit synthetic phone report fixture, not a claimed device/GPS acceptance.
  const observation = { runId: id, vehicleAssetId: f.truck.id, driverUserId: f.driver.id,
    latitude: 35, longitude: -97, accuracyMeters: 20, recordedAt, receivedAt: recordedAt,
    source: "driver_phone", freshness: "recent", physicalProofVerified: false };
  const saved = { operationId: randomUUID(), fingerprint: "synthetic-map-fixture", deviceId,
    assignment: JSON.stringify([id, f.vendor, f.driver.id, f.truck.id, null]), observation };
  await pool.query("INSERT INTO assistant_action_audit(user_id,vendor_id,client_surface,input_mode,provider,tool_name,action_type,target_type,target_id,tool_output,result_status) VALUES($1,$2,'fleet','device','canonical','synthetic_map_fixture','device-report','fleet-location',$3,$4::jsonb,'completed')",
    [f.driver.id, f.vendor, id, JSON.stringify(saved)]);
  await expect(service.locationObservations({ ...f.actor })).rejects.toMatchObject({ status: 409, code: "fleet.location_paging_required" });
  const readPage = () => service.locationObservationPage({ ...f.actor }, { limit: 1 });
  expect(await readPage()).toMatchObject({ observations: [{ runId: id, source: "driver_phone", freshness: "stale", physicalProofVerified: false }], page: { limit: 1, nextCursor: null } });
  const driver = { ...f.actor, userId: f.driver.id, role: "field_employee", membershipRole: "field_employee",
    activeMembershipId: f.driverMembership.id, sv: f.driver.sessionVersion, vendorPeopleId: f.driverPerson.id };
  expect(await service.locationObservationPage(driver, { limit: 1 })).toMatchObject({ observations: [{ runId: id, freshness: "stale" }] });
  expect(await service.locationObservationPage({ ...f.actor, readOnly: true }, { limit: 1 })).toMatchObject({ observations: [{ runId: id }] });
  await expect(service.locationObservationPage({ ...f.actor }, { limit: 51 })).rejects.toBeTruthy();
  await expect(service.locationObservationPage({ ...f.actor }, { cursor: "not-a-cursor" })).rejects.toBeTruthy();
  await pool.query("UPDATE location_consents SET revoked_at=now() WHERE user_id=$1 AND device_id=$2", [f.driver.id, deviceId]);
  expect((await readPage()).observations).toEqual([]);
  expect(run.status).toBe("draft");
});

it("edits a retained draft only through its exact original-scope receipt and open billing ticket", async () => {
  const f = await fixture(), created = await f.work.apply(f.actor, f.command);
  if (created.status !== "applied" || f.command.kind !== "activity.create") throw Error("Expected actual creation");
  const activity = created.canonicalReferences.find(ref => ref.kind === "activity")!,
    ticket = created.canonicalReferences.find(ref => ref.kind === "ticket")!;
  const service = createFleetService(databaseFleetRepository), id = String(activity.id);
  const original = await service.detail({ ...f.actor }, id);
  await expect(service.editDraft({ ...f.actor }, id, { operationId: randomUUID(), expectedVersion: original.version, title: "Legacy bypass" })).rejects.toMatchObject({ code: "fleet.work_command_required", status: 409 });
  const operationId = randomUUID();
  const command = FleetWorkCommandSchema.parse({ ...f.command, kind: "activity.edit", operationId, payload: {
    activity, ticket, baseAssignment: original.resourceAssignment!.snapshot,
    edit: { operationId, expectedVersion: original.version, title: "Actual office draft correction" },
  } });
  expect((await f.work.apply(f.actor, command)).status).toBe("applied");
  let saved = await service.detail({ ...f.actor }, id);
  expect(saved).toMatchObject({ title: "Actual office draft correction", status: "draft", version: original.version + 1 });
  expect(saved.billingV2).toEqual(original.billingV2);
  expect(saved.events.at(-1)).toMatchObject({ operationId, type: "draft_edited", source: "user_report",
    details: { originalCapture: { capturedAt: command.capturedAt, timeZone: command.timeZone } } });
  expect((await f.work.apply(f.actor, command)).status).toBe("duplicate");
  const localId = randomUUID();
  const localEdit = FleetWorkCommandSchema.parse({ ...command, operationId: localId,
    dependencies: [operationId], payload: { ...command.payload,
      activity: { type: "local", kind: "activity", id: f.command.payload.activityId },
      edit: { operationId: localId, expectedVersion: saved.version, title: "Second queued draft correction" } } });
  expect((await f.work.apply(f.actor, localEdit)).status).toBe("applied");
  saved = await service.detail({ ...f.actor }, id);
  expect(saved).toMatchObject({ version: original.version + 2, title: "Second queued draft correction", status: "draft" });
  expect(saved.billingV2).toEqual(original.billingV2);
  expect((await f.work.apply(f.actor, command)).status).toBe("duplicate");
  expect((await service.detail({ ...f.actor }, id)).version).toBe(saved.version);
  const mapping = (await pool.query("SELECT tool_output FROM assistant_action_audit WHERE vendor_id=$1 AND target_type='fleet-work-mapping' AND target_id=$2 ORDER BY id DESC LIMIT 1",
    [f.vendor, `${command.scope.provisioningId}:activity:${f.command.payload.activityId}`])).rows[0].tool_output;
  expect(mapping.mapping.canonical).toMatchObject({ id, version: original.version });
  const staleId = randomUUID();
  const stale = FleetWorkCommandSchema.parse({ ...command, operationId: staleId, payload: { ...command.payload, edit: { operationId: staleId, expectedVersion: original.version, title: "Stale correction" } } });
  expect(await f.work.apply(f.actor, stale)).toMatchObject({ status: "needs_reconciliation", reason: "stale_revision" });
  const changedId = randomUUID();
  const changedAssignment = FleetWorkCommandSchema.parse({ ...command, operationId: changedId, payload: { ...command.payload,
    activity: { ...activity, version: saved.version },
    baseAssignment: { ...original.resourceAssignment!.snapshot, detail: { ...original.resourceAssignment!.snapshot.detail, id: randomUUID() } },
    edit: { operationId: changedId, expectedVersion: saved.version, title: "Changed Detail correction" } } });
  expect(await f.work.apply(f.actor, changedAssignment)).toMatchObject({ status: "needs_reconciliation", reason: "changed_assignment" });
  const siteChangeId = randomUUID();
  const siteChange = FleetWorkCommandSchema.parse({ ...command, operationId: siteChangeId, payload: { ...command.payload,
    activity: { ...activity, version: saved.version }, edit: { operationId: siteChangeId, expectedVersion: saved.version,
      stops: saved.stops.map((stop, index) => index === 0 ? { ...stop, kind: "delivery" } : stop) } } });
  expect((await f.work.apply(f.actor, siteChange)).status).toBe("needs_reconciliation");
  expect((await service.detail({ ...f.actor }, id)).stops).toEqual(saved.stops);
  await pool.query("UPDATE tickets SET status='submitted' WHERE id=$1 AND vendor_id=$2", [ticket.id, f.vendor]);
  const closedId = randomUUID();
  const closed = FleetWorkCommandSchema.parse({ ...command, operationId: closedId, payload: { ...command.payload,
    activity: { ...activity, version: saved.version }, edit: { operationId: closedId, expectedVersion: saved.version, title: "Closed parent correction" } } });
  expect(await f.work.apply(f.actor, closed)).toMatchObject({ status: "needs_reconciliation", reason: "closed_ticket" });
  expect((await service.detail({ ...f.actor }, id)).title).toBe(saved.title);
  expect((await pool.query("SELECT id FROM ticket_line_items WHERE ticket_id=$1", [ticket.id])).rows).toEqual([]);
});

it("retains and pages a v2 activity beyond the legacy 200-event window without dropping original reports", async () => {
  const f = await fixture(), created = await f.work.apply(f.actor, f.command);
  if (created.status !== "applied") throw Error("Expected actual creation");
  const activity = created.canonicalReferences.find(ref => ref.kind === "activity")!,
    ticket = created.canonicalReferences.find(ref => ref.kind === "ticket")!;
  const service = createFleetService(databaseFleetRepository), id = String(activity.id);
  const original = await service.detail({ ...f.actor }, id);
  const retained = FleetRunSchema.parse({ ...original, eventHistory: undefined, version: 200,
    events: [original.events[0], ...Array.from({ length: 199 }, (_, index) => ({
      id: randomUUID(), operationId: randomUUID(), type: "draft_edited", actorUserId: f.actor.userId,
      recordedAt: original.events[0].recordedAt, source: "user_report",
      details: { notes: `Retained synthetic report ${index + 1}` },
    }))],
  });
  // Retained-head migration fixture; no physical action/device acceptance is claimed.
  await pool.query("INSERT INTO assistant_action_audit(user_id,vendor_id,client_surface,input_mode,provider,tool_name,action_type,target_type,target_id,tool_output,result_status) VALUES($1,$2,'fleet','typed','canonical','synthetic_history_fixture','fleet-run-snapshot','fleet-run',$3,$4::jsonb,'completed')",
    [f.actor.userId, f.vendor, id, JSON.stringify(retained)]);
  const operationId = randomUUID();
  const command = FleetWorkCommandSchema.parse({ ...f.command, operationId, kind: "activity.edit", payload: {
    activity: { ...activity, version: retained.version }, ticket, baseAssignment: retained.resourceAssignment!.snapshot,
    edit: { operationId, expectedVersion: retained.version, title: "Continued recorded work" },
  } });
  expect((await f.work.apply(f.actor, command)).status).toBe("applied");
  const current = await service.detail({ ...f.actor }, id);
  expect(current.events.length).toBeLessThanOrEqual(200);
  expect(current.eventHistory).toMatchObject({ version: 2, totalEvents: 201, complete: false });
  expect(current.events[0].id).toBe(retained.events[0].id);
  const reports: typeof retained.events = [];
  let cursor: string | null = null;
  do {
    const page = await service.eventHistory({ ...f.actor }, id, { limit: 50, ...(cursor ? { cursor } : {}) });
    reports.push(...page.events);
    cursor = page.nextCursor;
  } while (cursor);
  expect(reports).toHaveLength(201);
  expect(reports.slice(0, 200)).toEqual(retained.events);
  expect(reports.at(-1)).toMatchObject({ operationId, type: "draft_edited" });
  expect((await f.work.apply(f.actor, command)).status).toBe("duplicate");
  const state = (await pool.query("SELECT fleet_ops_state FROM vendors WHERE id=$1", [f.vendor])).rows[0].fleet_ops_state;
  expect(state.operations).toEqual([]);
  expect(state.runs).toEqual([]);
});

it("reads retained trip facts and scoped subject choices without relying on the legacy active view", async () => {
  const f = await fixture(),
    created = await f.work.apply(f.actor, f.command);
  if (created.status !== "applied") throw Error("Expected actual creation");
  const id = String(
    created.canonicalReferences.find((ref) => ref.kind === "activity")!.id,
  );
  const service = createFleetService(databaseFleetRepository);
  const outcomes = await Promise.allSettled([
    service.readFleetComplianceFacts({ ...f.actor }, { kind: "trip", id }),
    service.readFleetComplianceSubjects(
      { ...f.actor },
      { kind: "trip", limit: 1, search: "Synthetic crude" },
    ),
  ]);
  expect(outcomes[0]).toMatchObject({ status: "fulfilled", value: null });
  expect(outcomes[1]).toMatchObject({
    status: "fulfilled",
    value: {
      entries: [
        {
          subject: { kind: "trip", id },
          label: "Synthetic crude transport",
          canSubmit: true,
        },
      ],
      nextCursor: null,
    },
  });
  expect(
    await service.readFleetComplianceSubjects(
      { ...f.actor, readOnly: true },
      { kind: "trip", limit: 1 },
    ),
  ).toMatchObject({ entries: [{ subject: { id }, canSubmit: false }] });
  await expect(
    service.readFleetComplianceFacts(
      { ...f.actor },
      { kind: "trip", id: randomUUID() },
    ),
  ).rejects.toMatchObject({ status: 404 });
  const driver = {
    ...f.actor,
    userId: f.driver.id,
    role: "field_employee",
    membershipRole: "field_employee",
    activeMembershipId: f.driverMembership.id,
    sv: f.driver.sessionVersion,
    vendorPeopleId: f.driverPerson.id,
  };
  await expect(
    service.readFleetComplianceFacts(driver, { kind: "trip", id }),
  ).rejects.toMatchObject({ status: 403 });
});

it("creates and pages 501 actual active v2 activities without filling the legacy company aggregate", async () => {
  const f = await fixture();
  if (f.command.kind !== "activity.create") throw Error("Expected creation");
  let ticket: FleetWorkReference | undefined;
  const ids = new Set<string>();
  const baseTime = Date.parse("2026-11-01T12:00:00Z");
  for (let index = 0; index < 501; index++) {
    const command = structuredClone(f.command);
    command.operationId = randomUUID();
    command.payload.activityId = randomUUID();
    command.payload.title = `Synthetic capacity activity ${index + 1}`;
    command.payload.billing.workDate = "2026-11-01";
    if (ticket)
      command.payload.billing = {
        ...command.payload.billing,
        choice: "existing_ticket",
        ticket,
      };
    command.payload.route.plannedWindow = {
      startAt: new Date(baseTime + index * 60000).toISOString(),
      endAt: new Date(baseTime + (index + 1) * 60000).toISOString(),
      timeZone: "America/Chicago",
    };
    const receipt = await f.work.apply(f.actor, command);
    expect(receipt.status, `Canonical activity ${index + 1}`).toBe("applied");
    if (receipt.status !== "applied")
      throw Error("Expected actual canonical receipt");
    ids.add(
      String(
        receipt.canonicalReferences.find((ref) => ref.kind === "activity")!.id,
      ),
    );
    ticket ??= receipt.canonicalReferences.find(
      (ref) => ref.kind === "ticket",
    )!;
  }
  expect(ids.size).toBe(501);
  expect(
    (
      await pool.query("SELECT fleet_ops_state FROM vendors WHERE id=$1", [
        f.vendor,
      ])
    ).rows[0].fleet_ops_state.runs,
  ).toHaveLength(0);
  expect(
    (
      await pool.query(
        "SELECT COUNT(DISTINCT target_id)::int AS count FROM assistant_action_audit WHERE vendor_id=$1 AND target_type='fleet-run'",
        [f.vendor],
      )
    ).rows[0].count,
  ).toBe(501);
  expect(
    (await pool.query("SELECT id FROM tickets WHERE vendor_id=$1", [f.vendor]))
      .rows,
  ).toHaveLength(1);
  expect(
    (
      await pool.query("SELECT id FROM ticket_line_items WHERE ticket_id=$1", [
        ticket!.id,
      ])
    ).rows,
  ).toHaveLength(0);
  const service = createFleetService(databaseFleetRepository),
    read = new Set<string>();
  let cursor: string | null = null;
  do {
    const page = await service.overview({
      ...f.actor,
      runPage: { limit: 50, ...(cursor ? { cursor } : {}) },
    });
    expect(page.runs.length).toBeLessThanOrEqual(50);
    for (const run of page.runs) read.add(run.id);
    cursor = page.page?.nextCursor ?? null;
  } while (cursor);
  expect(read).toEqual(ids);
  const subjects = new Set<string>();
  let after: string | null = null;
  do {
    const page = await service.readFleetComplianceSubjects(
      { ...f.actor },
      {
        kind: "trip",
        limit: 100,
        ...(after ? { after } : {}),
      },
    );
    expect(page.entries.length).toBeLessThanOrEqual(100);
    for (const entry of page.entries) subjects.add(String(entry.subject.id));
    after = page.nextCursor;
  } while (after);
  expect(subjects).toEqual(ids);
  const mapCursors = new Set<string>();
  let mapCursor: string | null = null, mapPages = 0;
  do {
    const page = await service.locationObservationPage({ ...f.actor }, { limit: 50, ...(mapCursor ? { cursor: mapCursor } : {}) });
    // There were no physical phone reports for these synthetic scheduled runs.
    expect(page.observations).toEqual([]);
    expect(page.page.limit).toBe(50);
    mapPages += 1;
    mapCursor = page.page.nextCursor;
    if (mapCursor) {
      expect(mapCursors.has(mapCursor)).toBe(false);
      mapCursors.add(mapCursor);
    }
  } while (mapCursor);
  expect(mapPages).toBe(11);
  expect(
    (
      await pool.query(
        "SELECT COUNT(*)::int AS count FROM assistant_action_audit WHERE vendor_id=$1 AND target_type='fleet-run'",
        [f.vendor],
      )
    ).rows[0].count,
  ).toBe(501);
}, 120000);

it("checks each mixed-service activity's own approval rather than the shared ticket's first service", async () => {
  const f = await fixture(),
    first = await f.work.apply(f.actor, f.command);
  if (first.status !== "applied" || f.command.kind !== "activity.create")
    throw Error("Expected actual activity");
  const service = createFleetService(databaseFleetRepository);
  const activity = first.canonicalReferences.find(
      (r) => r.kind === "activity",
    )!,
    ticket = first.canonicalReferences.find((r) => r.kind === "ticket")!;
  expect(
    (
      await cancelWork(
        f,
        await service.detail({ ...f.actor }, String(activity.id)),
      )
    ).status,
  ).toBe("applied");
  const secondService = (
    await pool.query(
      "INSERT INTO work_types(name,category) VALUES($1,'Synthetic') RETURNING id",
      [`Second service ${randomUUID()}`],
    )
  ).rows[0].id;
  await pool.query(
    "INSERT INTO vendor_work_types(vendor_id,work_type_id,unit_price,precise_unit_price,unit,currency) VALUES($1,$2,'12','12','per_barrel','USD')",
    [f.vendor, secondService],
  );
  await pool.query(
    "INSERT INTO site_work_assignments(vendor_id,work_type_id,site_location_id,afe) VALUES($1,$2,$3,'AFE1')",
    [f.vendor, secondService, f.site],
  );
  await pool.query(
    "INSERT INTO partner_vendor_work_type_approvals(partner_id,vendor_id,work_type_id,approved_unit_price,precise_unit_price,approved_unit,approved_currency,approved_by_user_id,approved_at) VALUES($1,$2,$3,'12','12','per_barrel','USD',$4,'2026-10-01T00:00:00Z')",
    [f.partner, f.vendor, secondService, f.user],
  );
  const next = structuredClone(f.command);
  next.operationId = randomUUID();
  next.payload.activityId = randomUUID();
  next.payload.billing = {
    ...next.payload.billing,
    choice: "existing_ticket",
    ticket,
    serviceId: secondService,
  };
  next.payload.pricingIntent = {
    mode: "unpriced",
    reason: "offline_reference_missing",
    serviceId: secondService,
    approvalRef: null,
  };
  const receipt = await f.work.apply(f.actor, next);
  if (receipt.status !== "applied")
    throw Error(`Expected shared activity: ${JSON.stringify(receipt)}`);
  const run = await service.detail(
    { ...f.actor },
    String(receipt.canonicalReferences.find((r) => r.kind === "activity")!.id),
  );
  expect(run.billingV2?.serviceId).toBe(secondService);
  expect(
    (
      await pool.query("SELECT work_type_id FROM tickets WHERE id=$1", [
        ticket.id,
      ])
    ).rows[0].work_type_id,
  ).toBe(f.service);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SAVEPOINT source_revocation");
    // Exact synthetic approval rows in this fresh retained loopback database.
    await client.query(
      "DELETE FROM partner_vendor_work_type_approvals WHERE vendor_id=$1 AND partner_id=$2 AND work_type_id=$3",
      [f.vendor, f.partner, f.service],
    );
    expect(await requireFleetRunCommercialAuthority(client, run)).toMatchObject(
      { allowed: true },
    );
    await client.query("ROLLBACK TO SAVEPOINT source_revocation");
    await client.query(
      "DELETE FROM partner_vendor_work_type_approvals WHERE vendor_id=$1 AND partner_id=$2 AND work_type_id=$3",
      [f.vendor, f.partner, secondService],
    );
    await expect(
      requireFleetRunCommercialAuthority(client, run),
    ).rejects.toMatchObject({
      status: 403,
      code: "fleet.site_service_forbidden",
    });
  } finally {
    await client.query("ROLLBACK");
    client.release();
  }
});

it("holds a v2 activity when the actual parent billing site changes instead of rebasing it", async () => {
  const f = await fixture(),
    created = await f.work.apply(f.actor, f.command);
  if (created.status !== "applied") throw Error("Expected actual activity");
  const run = await createFleetService(databaseFleetRepository).detail(
    { ...f.actor },
    String(created.canonicalReferences.find((r) => r.kind === "activity")!.id),
  );
  const otherSite = (
    await pool.query(
      "INSERT INTO site_locations(partner_id,name,address,latitude,longitude,site_code) VALUES($1,'Other billing pad','Synthetic',35,-97,$2) RETURNING id",
      [f.partner, randomUUID()],
    )
  ).rows[0].id;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "UPDATE tickets SET site_location_id=$2 WHERE id=$1 AND vendor_id=$3",
      [run.linkedTicketId, otherSite, f.vendor],
    );
    await expect(
      requireFleetRunCommercialAuthority(client, run),
    ).rejects.toMatchObject({
      status: 409,
      code: "fleet.billing_ticket_mismatch",
    });
  } finally {
    await client.query("ROLLBACK");
    client.release();
  }
});

it("atomically creates the real Detail reservation, approved ticket and mappings once after response loss", async () => {
  const f = await fixture();
  if (f.command.kind !== "activity.create") throw Error("Expected activity");
  f.command.capturedAt = f.command.payload.compliance.evaluatedAt =
    "2026-10-16T07:00:00-05:00";
  const original = structuredClone(f.command);
  const receipts = await Promise.all([
    f.work.apply(f.actor, f.command),
    f.work.apply(f.actor, f.command),
  ]);
  expect(receipts.map((r) => r.status).sort()).toEqual([
    "applied",
    "duplicate",
  ]);
  const receipt = receipts.find((r) => r.status === "applied")!;
  if (receipt.status !== "applied") throw Error("Expected actual receipt");
  const activity = receipt.mappings.find(
    (m) => m.local.kind === "activity",
  )!.canonical;
  const ticket = receipt.mappings.find(
    (m) => m.local.kind === "ticket",
  )!.canonical;
  const rows = await pool.query(
    "SELECT tool_output FROM assistant_action_audit WHERE vendor_id=$1 AND target_type='fleet-run' AND target_id=$2 ORDER BY id DESC LIMIT 1",
    [f.vendor, activity.id],
  );
  const run = FleetRunSchema.parse(rows.rows[0].tool_output);
  expect(run).toMatchObject({
    status: "draft",
    phase: null,
    linkedTicketId: ticket.id,
    driverUserId: f.driver.id,
    resourceAssignment: {
      snapshot: { detail: { vehicleAssetId: f.truck.id } },
    },
    billingV2: {
      pricing: { mode: "priced", rateCard: { unitRate: "0.0125" } },
      review: { status: "pending" },
    },
    runOrder: {
      id:
        original.kind === "activity.create"
          ? original.payload.runOrderReference!.id
          : "",
    },
  });
  expect(run.events.map((e) => e.type)).toEqual(["created"]);
  expect(run.events[0]).toMatchObject({
    capturedAt: new Date(original.capturedAt).toISOString(),
    source: "user_report",
    details: {
      originalCapture: {
        capturedAt: original.capturedAt,
        timeZone: original.timeZone,
        clockStatus: "reported_capture_time",
      },
    },
  });
  expect(Date.parse(run.events[0].recordedAt)).toBeGreaterThan(
    Date.parse(original.capturedAt),
  );
  expect(
    (await pool.query("SELECT id FROM tickets WHERE vendor_id=$1", [f.vendor]))
      .rows,
  ).toHaveLength(1);
  expect(
    (
      await pool.query("SELECT id FROM ticket_line_items WHERE ticket_id=$1", [
        ticket.id,
      ])
    ).rows,
  ).toHaveLength(0);
  expect(
    (
      await pool.query(
        "SELECT id FROM assistant_action_audit WHERE vendor_id=$1 AND target_type='fleet-reservation'",
        [f.vendor],
      )
    ).rows,
  ).toHaveLength(1);
  expect(
    (
      await pool.query(
        "SELECT id FROM assistant_action_audit WHERE vendor_id=$1 AND target_type IN ('workday','workday-event')",
        [f.vendor],
      )
    ).rows,
  ).toHaveLength(0);
  expect(f.command).toEqual(original);
  expect(
    (await f.work.read(f.actor, f.command.scope, f.command.operationId))
      ?.status,
  ).toBe("applied");
});

it("preserves a future device capture as a clock warning instead of replacing server time or starting work", async () => {
  const f = await fixture();
  f.command.capturedAt = new Date(Date.now() + 3600000).toISOString();
  const receipt = await f.work.apply(f.actor, f.command);
  if (receipt.status !== "applied") throw Error("Expected retained creation");
  const run = await createFleetService(databaseFleetRepository).detail(
    { ...f.actor },
    String(receipt.canonicalReferences.find((r) => r.kind === "activity")!.id),
  );
  expect(run.events[0]).toMatchObject({
    capturedAt: f.command.capturedAt,
    source: "user_report",
    details: {
      originalCapture: {
        timeZone: "America/Chicago",
        clockStatus: "ahead_of_server",
      },
    },
  });
  expect(Date.parse(run.events[0].recordedAt)).toBeLessThan(
    Date.parse(f.command.capturedAt),
  );
  expect(run.status).toBe("draft");
  expect(run.events.map((e) => e.type)).toEqual(["created"]);
});

it("rolls back the new ticket, run and reservation together before recording a reconciliation case", async () => {
  const f = await fixture();
  f.rollback();
  expect((await f.work.apply(f.actor, f.command)).status).toBe(
    "needs_reconciliation",
  );
  expect(
    (await pool.query("SELECT id FROM tickets WHERE vendor_id=$1", [f.vendor]))
      .rows,
  ).toHaveLength(0);
  expect(
    (
      await pool.query(
        "SELECT id FROM assistant_action_audit WHERE vendor_id=$1 AND target_type IN ('fleet-run','fleet-reservation','fleet-work-mapping')",
        [f.vendor],
      )
    ).rows,
  ).toHaveLength(0);
});

it("keeps canonical labels, holds changed resources and joins an explicitly selected compatible ticket", async () => {
  const f = await fixture();
  if (f.command.kind !== "activity.create") throw Error("Expected create");
  const changed = structuredClone(f.command);
  changed.operationId = randomUUID();
  changed.payload.detailSnapshot.detail.driverUserId = f.actor.userId;
  expect(await f.work.apply(f.actor, changed)).toMatchObject({
    status: "needs_reconciliation",
    reason: "changed_assignment",
  });
  const cached = structuredClone(f.command);
  cached.payload.detailSnapshot.labels.driver = "Untrusted cached label";
  cached.payload.detailSnapshot.snapshottedAt = "2026-10-01T00:00:00Z";
  const first = await f.work.apply(f.actor, cached);
  if (first.status !== "applied")
    throw Error(`Expected actual create: ${JSON.stringify(first)}`);
  const activity = first.mappings.find(
    (m) => m.local.kind === "activity",
  )!.canonical;
  const ticket = first.mappings.find(
    (m) => m.local.kind === "ticket",
  )!.canonical;
  const service = createFleetService(databaseFleetRepository);
  const run = await service.detail({ ...f.actor }, String(activity.id));
  expect(run.resourceAssignment?.snapshot.labels.driver).toBe(
    "Synthetic pool driver",
  );
  expect((await cancelWork(f, run)).status).toBe("applied");
  await pool.query(
    "UPDATE partner_vendor_work_type_approvals SET precise_unit_price='12' WHERE vendor_id=$1",
    [f.vendor],
  );
  const next = structuredClone(f.command);
  next.operationId = randomUUID();
  next.payload.activityId = randomUUID();
  next.payload.billing = {
    ...next.payload.billing,
    choice: "existing_ticket",
    ticket,
  };
  const second = await f.work.apply(f.actor, next);
  expect(second.status).toBe("applied");
  if (second.status !== "applied") throw Error("Expected shared ticket");
  expect(second.mappings.map((m) => m.local.kind)).toEqual(["activity"]);
  const secondRun = await service.detail(
    { ...f.actor },
    String(second.canonicalReferences.find((r) => r.kind === "activity")!.id),
  );
  expect(secondRun).toMatchObject({
    linkedTicketId: ticket.id,
    billingV2: { pricing: { mode: "priced", rateCard: { unitRate: "12" } } },
  });
  expect(run.billingV2?.pricing).toMatchObject({
    mode: "priced",
    rateCard: { unitRate: "0.0125" },
  });
  expect(
    (await pool.query("SELECT id FROM tickets WHERE vendor_id=$1", [f.vendor]))
      .rows,
  ).toHaveLength(1);
  expect((await cancelWork(f, secondRun)).status).toBe("applied");
  await pool.query("UPDATE tickets SET status='submitted' WHERE id=$1", [
    ticket.id,
  ]);
  const closed = structuredClone(next);
  closed.operationId = randomUUID();
  closed.payload.activityId = randomUUID();
  expect(await f.work.apply(f.actor, closed)).toMatchObject({
    status: "needs_reconciliation",
    reason: "closed_ticket",
  });
  expect(
    (await pool.query("SELECT id FROM tickets WHERE vendor_id=$1", [f.vendor]))
      .rows,
  ).toHaveLength(1);
});

it("retains unresolved billing context for reconciliation instead of treating it as revoked authority", async () => {
  const f = await fixture();
  if (f.command.kind !== "activity.create") throw Error("Expected create");
  f.command.payload.billing.billingSiteId = null;
  expect(await f.work.apply(f.actor, f.command)).toMatchObject({
    status: "needs_reconciliation",
    reason: "unresolved_price",
  });
  expect(
    (await pool.query("SELECT id FROM tickets WHERE vendor_id=$1", [f.vendor]))
      .rows,
  ).toHaveLength(0);
});

it("reviews original quantity reports with actual office identity without changing the report or billing early", async () => {
  const f = await fixture(),
    created = await f.work.apply(f.actor, f.command);
  if (created.status !== "applied") throw Error("Expected create");
  const activity = created.canonicalReferences.find(
      (r) => r.kind === "activity",
    )!,
    ticket = created.canonicalReferences.find((r) => r.kind === "ticket")!;
  const driverActor = {
    ...f.actor,
    userId: f.driver.id,
    role: "field_employee",
    membershipRole: "field_employee",
    vendorPeopleId: f.driverPerson.id,
    sv: f.driver.sessionVersion,
    activeMembershipId: f.driverMembership.id,
  };
  const [device] = await db
    .insert(workHubDevicesTable)
    .values({
      userId: f.driver.id,
      ownerOrgType: "vendor",
      ownerOrgId: f.vendor,
      friendlyName: "Synthetic driver",
      deviceClass: "ios",
      capabilities: {},
    })
    .returning();
  const provision = await f.repository.provision(driverActor, {
    deviceId: device.id,
    appVersion: "test-v2",
  });
  const quantity = {
    id: randomUUID(),
    cycleId: null,
    kind: "delivered",
    quantity: "123.456789",
    unit: "barrel",
    source: "manual",
    evidenceReferences: [],
    capturedAt: new Date().toISOString(),
    recordedByUserId: f.driver.id,
  };
  const report = FleetWorkCommandSchema.parse({
    version: 2,
    operationId: randomUUID(),
    scope: provision.scope,
    kind: "quantity.record",
    capturedAt: quantity.capturedAt,
    timeZone: "America/Chicago",
    dependencies: [],
    payload: { activity, ticket, evidence: quantity },
  });
  expect((await f.work.apply(driverActor, report)).status).toBe("applied");
  const review = FleetWorkCommandSchema.parse({
    version: 2,
    operationId: randomUUID(),
    scope: f.command.scope,
    kind: "quantity.review",
    capturedAt: new Date().toISOString(),
    timeZone: "America/Chicago",
    dependencies: [],
    payload: {
      activity,
      ticket,
      selections: [
        {
          evidenceId: quantity.id,
          expectedReviewRevision: 0,
          decision: "accept_as_billable",
          reason: "Office checked delivery report",
        },
      ],
    },
  });
  expect((await f.work.apply(f.actor, review)).status).toBe("applied");
  expect((await f.work.apply(f.actor, review)).status).toBe("duplicate");
  const rows = await pool.query(
    "SELECT tool_output FROM assistant_action_audit WHERE vendor_id=$1 AND target_type='fleet-work-quantity-review' AND target_id=$2 ORDER BY id",
    [f.vendor, quantity.id],
  );
  expect(rows.rows).toHaveLength(1);
  expect(rows.rows[0].tool_output).toMatchObject({
    version: 2,
    revision: 1,
    activityId: activity.id,
    ticketId: ticket.id,
    decision: "accept_as_billable",
    reviewedByUserId: f.actor.userId,
    quantity: {
      kind: "billable",
      quantity: "123.456789",
      unit: "barrel",
      recordedByUserId: f.driver.id,
    },
    independentInstrumentVerification: false,
  });
  const original = (
    await pool.query(
      "SELECT tool_output FROM assistant_action_audit WHERE vendor_id=$1 AND target_type='fleet-work-quantity' AND target_id=$2",
      [f.vendor, quantity.id],
    )
  ).rows[0].tool_output;
  expect(original.evidence).toEqual(quantity);
  expect(original).toMatchObject({
    officeReviewRequired: true,
    quantitySourceVerified: false,
  });
  expect(
    (
      await pool.query("SELECT id FROM ticket_line_items WHERE ticket_id=$1", [
        ticket.id,
      ])
    ).rows,
  ).toHaveLength(0);
  const run = await createFleetService(databaseFleetRepository).detail(
    { ...f.actor },
    String(activity.id),
  );
  expect(run.events.map((e) => e.type)).toEqual(["created"]);
  const stale = { ...review, operationId: randomUUID() };
  expect(await f.work.apply(f.actor, stale)).toMatchObject({
    status: "needs_reconciliation",
    reason: "stale_revision",
  });
  expect(
    await f.work.apply(driverActor, {
      ...review,
      operationId: randomUUID(),
      scope: provision.scope,
    }),
  ).toMatchObject({ status: "denied", reason: "missing_authority" });
  const planned = structuredClone(report);
  planned.operationId = randomUUID();
  if (planned.kind !== "quantity.record")
    throw Error("Expected quantity report");
  planned.payload.evidence.id = randomUUID();
  planned.payload.evidence.kind = "planned";
  expect((await f.work.apply(driverActor, planned)).status).toBe("applied");
  const batch = structuredClone(review);
  if (batch.kind !== "quantity.review") throw Error("Expected review");
  batch.operationId = randomUUID();
  batch.payload.selections = [
    {
      evidenceId: quantity.id,
      expectedReviewRevision: 1,
      decision: "accept_as_billable",
      reason: "Recheck original",
    },
    {
      evidenceId: planned.payload.evidence.id,
      expectedReviewRevision: 0,
      decision: "accept_as_billable",
      reason: "Cannot turn planned quantity into performed work",
    },
  ];
  expect((await f.work.apply(f.actor, batch)).status).toBe(
    "needs_reconciliation",
  );
  expect(
    (
      await pool.query(
        "SELECT id FROM assistant_action_audit WHERE vendor_id=$1 AND target_type='fleet-work-quantity-review' AND target_id=$2",
        [f.vendor, quantity.id],
      )
    ).rows,
  ).toHaveLength(1);
  batch.operationId = randomUUID();
  batch.payload.selections = [
    {
      evidenceId: planned.payload.evidence.id,
      expectedReviewRevision: 0,
      decision: "reject",
      reason: "Only planned quantity; delivery evidence required",
    },
  ];
  expect((await f.work.apply(f.actor, batch)).status).toBe("applied");
  expect(
    (
      await pool.query(
        "SELECT tool_output FROM assistant_action_audit WHERE vendor_id=$1 AND target_type='fleet-work-quantity-review' AND target_id=$2",
        [f.vendor, planned.payload.evidence.id],
      )
    ).rows[0].tool_output,
  ).toMatchObject({ decision: "reject", quantity: null });
});

it("office approves exact retained activity charges and explicitly finalizes the ticket once",async()=>{
 const f=await fixture(),created=await f.work.apply(f.actor,f.command);if(created.status!=="applied")throw Error("Expected create");
 const activity=created.canonicalReferences.find(r=>r.kind==="activity")!,ticket=created.canonicalReferences.find(r=>r.kind==="ticket")!;
 const service=createFleetService(databaseFleetRepository),original=await service.detail({...f.actor},String(activity.id));
 const driverActor={...f.actor,userId:f.driver.id,role:"field_employee",membershipRole:"field_employee",vendorPeopleId:f.driverPerson.id,sv:f.driver.sessionVersion,activeMembershipId:f.driverMembership.id};
 const [device]=await db.insert(workHubDevicesTable).values({userId:f.driver.id,ownerOrgType:"vendor",ownerOrgId:f.vendor,friendlyName:"Synthetic billing driver",deviceClass:"ios",capabilities:{}}).returning();
 const provision=await f.repository.provision(driverActor,{deviceId:device.id,appVersion:"test-v2"});
 const at=new Date().toISOString(),quantity={id:randomUUID(),cycleId:null,kind:"delivered",quantity:"123.456789",unit:"barrel",source:"manual",evidenceReferences:[],capturedAt:at,recordedByUserId:f.driver.id};
 expect((await f.work.apply(driverActor,{version:2,operationId:randomUUID(),scope:provision.scope,kind:"quantity.record",capturedAt:at,timeZone:"America/Chicago",dependencies:[],payload:{activity,ticket,evidence:quantity}})).status).toBe("applied");
 expect((await f.work.apply(f.actor,{...f.command,operationId:randomUUID(),kind:"quantity.review",payload:{activity,ticket,selections:[{evidenceId:quantity.id,expectedReviewRevision:0,decision:"accept_as_billable",reason:"Office reviewed original receipt"}]}})).status).toBe("applied");
 // Synthetic retained operational closeout fixture, not physical/device proof.
 const pickup=original.stops.find(s=>s.kind==="pickup")!,delivery=original.stops.find(s=>s.kind==="delivery")!;
 const closed=FleetRunSchema.parse({...original,version:2,status:"submitted_for_review",phase:null,currentStopId:null,visitedStopIds:original.stops.map(s=>s.id),
  inspections:[{driverUserId:f.driver.id,vehicleAssetId:original.vehicleAssetId,trailerAssetId:original.trailerAssetId,outcome:"passed",notes:"Synthetic recorded inspection",recordedByUserId:f.driver.id,recordedAt:at,source:"user_report",inspectedAssetIds:[original.vehicleAssetId]}],
  loads:[{id:randomUUID(),pickupStopId:pickup.id,deliveryStopId:delivery.id,commodity:"Crude",quantity:123.456789,unit:"barrel",manifestReference:"Synthetic",deliveryReference:"Synthetic",recordedByUserId:f.driver.id,recordedAt:at,deliveredAt:at,source:"user_report"}],
  records:[1,2].map((reading)=>({id:randomUUID(),vehicleAssetId:original.vehicleAssetId,kind:"meter",quantity:null,reading,unit:"miles",notes:"Synthetic meter",recordedByUserId:f.driver.id,recordedAt:at,capturedAt:null,source:"user_report"})),
 });
 await pool.query("INSERT INTO assistant_action_audit(user_id,vendor_id,client_surface,input_mode,provider,tool_name,action_type,target_type,target_id,tool_output,result_status) VALUES($1,$2,'fleet','typed','canonical','synthetic_closeout_fixture','snapshot','fleet-run',$3,$4::jsonb,'completed')",[f.actor.userId,f.vendor,closed.id,JSON.stringify(closed)]);
 const command={...f.command,operationId:randomUUID(),kind:"charge.review",payload:{activity:{...activity,version:2},ticket,expectedVersion:2,quantityReviews:[{evidenceId:quantity.id,revision:1}],taxTreatment:"existing_ticket_rubric",intervals:[],additionalCharges:[]}};
 const approved=await f.work.apply(f.actor,command);expect(approved.status).toBe("applied");
 const lines=(await pool.query("SELECT * FROM ticket_line_items WHERE ticket_id=$1",[ticket.id])).rows;expect(lines).toHaveLength(1);expect(lines[0].fleet_billing_metadata).toMatchObject({version:2,charge:{quantity:"123.456789",unitRate:"0.0125",exactAmount:"1.5432098625",currencyAmount:"1.54",reviewedByUserId:f.actor.userId}});
 expect((await f.work.apply(f.actor,command)).status).toBe("duplicate");expect((await pool.query("SELECT status FROM tickets WHERE id=$1",[ticket.id])).rows[0].status).not.toBe("submitted");
 let plan=(await pool.query("SELECT fleet_plan FROM tickets WHERE id=$1",[ticket.id])).rows[0].fleet_plan;
 const visible=await service.ticketPlan({...f.actor},Number(ticket.id));expect(visible).toMatchObject({billingVersion:2,charges:{runs:1,total:"1.54"},canFinalize:true,plan:{version:plan.revision}});
 const choices=await service.billingOptions({...f.actor},{siteId:f.site,fleetId:original.fleetId,afeNumber:"AFE1",workDate:"2026-10-16"});expect(choices.tickets).toEqual(expect.arrayContaining([expect.objectContaining({id:ticket.id,planVersion:plan.revision})]));
 const adjustment={...f.command,operationId:randomUUID(),kind:"charge.adjust",payload:{activity:{...activity,version:3},ticket:{...ticket,version:plan.revision},chargeId:lines[0].fleet_billing_metadata.charge.id,expectedRevision:1,delta:"-0.0049",reason:"Office credit after receipt review"}};
 expect((await f.work.apply(f.actor,{...adjustment,operationId:randomUUID(),payload:{...adjustment.payload,ticket:{...ticket,version:1}}})).status).toBe("needs_reconciliation");
 expect((await f.work.apply(f.actor,adjustment)).status).toBe("applied");expect((await f.work.apply(f.actor,adjustment)).status).toBe("duplicate");
 const adjusted=(await pool.query("SELECT fleet_billing_metadata FROM ticket_line_items WHERE ticket_id=$1",[ticket.id])).rows;expect(adjusted).toHaveLength(2);expect(adjusted.find(row=>row.fleet_billing_metadata.charge.kind==="adjustment")?.fleet_billing_metadata.charge).toMatchObject({exactAmount:"-0.0049",currencyAmount:"0",reviewedByUserId:f.actor.userId});
 plan=(await pool.query("SELECT fleet_plan FROM tickets WHERE id=$1",[ticket.id])).rows[0].fleet_plan;
 const finalize={...f.command,operationId:randomUUID(),kind:"ticket.finalize",payload:{ticket:{...ticket,version:plan.revision},expectedVersion:plan.revision}};
 expect((await f.work.apply(f.actor,finalize)).status).toBe("applied");expect((await f.work.apply(f.actor,finalize)).status).toBe("duplicate");expect((await pool.query("SELECT status,lifecycle_state FROM tickets WHERE id=$1",[ticket.id])).rows[0]).toMatchObject({status:"submitted",lifecycle_state:"off_site"});expect((await pool.query("SELECT id FROM ticket_line_items WHERE ticket_id=$1",[ticket.id])).rows).toHaveLength(2);
});

it("prepares current saved Detail and billing references without granting driver finance or pretending a driver started",async()=>{
 const f=await fixture(),{prepareFleetWorkCreation}=await import("./fleet-work-preparation");
 if(f.command.kind!=="activity.create")throw Error("Expected creation fixture");
 const body={detailId:f.command.payload.detailReference.id,billingSiteId:f.site,ticketId:null};
 const prepared=await f.repository.readScope(f.actor,f.command.scope,ctx=>prepareFleetWorkCreation(ctx,body));expect(prepared.snapshot.detail).toEqual(f.command.payload.detailSnapshot.detail);expect(prepared).toMatchObject({billingSiteId:f.site,partnerId:f.partner,ticket:null});
 await expect(f.repository.readScope(f.actor,f.command.scope,ctx=>prepareFleetWorkCreation(ctx,{...body,billingSiteId:f.site+100000}))).rejects.toMatchObject({status:403});
 const receipt=await f.work.apply(f.actor,f.command);if(receipt.status!=="applied")throw Error("Expected create");const activity=receipt.canonicalReferences.find(r=>r.kind==="activity")!,ticket=receipt.canonicalReferences.find(r=>r.kind==="ticket")!;
 const service=createFleetService(databaseFleetRepository),driverActor={...f.actor,userId:f.driver.id,role:"field_employee",membershipRole:"field_employee",vendorPeopleId:f.driverPerson.id,sv:f.driver.sessionVersion,activeMembershipId:f.driverMembership.id};
 const own=await service.detail(driverActor,String(activity.id));expect(own.billingV2).toBeUndefined();expect(own.ticketReference).toEqual({id:ticket.id,version:ticket.version});expect(own.status).toBe("draft");expect(own.events.some(event=>["acknowledge","inspect","start"].includes(event.type))).toBe(false);
});
