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

async function fixture() {
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
          equipmentAssetIds: [truck.id],
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
        rigPackageId: null,
        rigPackageVersion: null,
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
    command,
    repository,
    work: createFleetWorkService(repository),
    rollback: () => {
      failAfterCreate = true;
    },
  };
}

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
  await service.action({ ...f.actor }, String(activity.id), {
    operationId: randomUUID(),
    expectedVersion: activity.version,
    action: "cancel",
    reason: "Synthetic release for second service",
  });
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
  await service.action({ ...f.actor }, run.id, {
    operationId: randomUUID(),
    expectedVersion: run.version,
    action: "cancel",
    reason: "Synthetic release before next assignment",
  });
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
  await service.action({ ...f.actor }, secondRun.id, {
    operationId: randomUUID(),
    expectedVersion: secondRun.version,
    action: "cancel",
    reason: "Synthetic completion of test resource use",
  });
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
