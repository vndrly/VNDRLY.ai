import { randomUUID } from "node:crypto";
import { expect, it, vi } from "vitest";
import { assertFreshLocalTestDatabaseEnvironment } from "../../../../scripts/fresh-test-database.mjs";
import {
  db,
  pool,
  vendorsTable,
  usersTable,
  userOrgMembershipsTable,
  workHubDevicesTable,
} from "@workspace/db";
import { emptyFleetState, FleetError } from "./fleet-repository";
import { createDatabaseFleetWorkRepository } from "./fleet-work-repository";
import { createFleetWorkService } from "./fleet-work";
import { executeFleetWorkCommand } from "./fleet-work-canonical";
import { workdayService } from "./workday";
import { createDatabaseFleetEvidenceUploadRepository } from "./fleet-evidence-upload-repository";
import { createFleetEvidenceUploadService } from "./fleet-evidence-upload";
import { createFleetEvidenceCanonicalHandlers } from "./fleet-evidence-upload-canonical";
import type { ObjectStore, StoredObject } from "../lib/objectStore";
import { createHash } from "node:crypto";
import type { FleetActor } from "./fleet-ops";
import {
  FleetWorkCommandSchema,
  FleetRunSchema,
  FleetDetailSnapshotSchema,
  type FleetWorkScope,
} from "@workspace/api-zod";
async function fixture(canonical = false) {
  assertFreshLocalTestDatabaseEnvironment(process.env);
  const tag = randomUUID();
  const [vendor] = await db
    .insert(vendorsTable)
    .values({
      name: `Work intake ${tag}`,
      contactName: "Synthetic",
      contactEmail: `${tag}@example.invalid`,
    })
    .returning();
  const [user] = await db
    .insert(usersTable)
    .values({
      username: `work-${tag}@example.invalid`,
      passwordHash: "not-a-login",
      displayName: "Synthetic worker",
      role: "vendor",
    })
    .returning();
  const [member] = await db
    .insert(userOrgMembershipsTable)
    .values({
      userId: user.id,
      orgType: "vendor",
      vendorId: vendor.id,
      role: "admin",
    })
    .returning();
  const [device] = await db
    .insert(workHubDevicesTable)
    .values({
      userId: user.id,
      ownerOrgType: "vendor",
      ownerOrgId: vendor.id,
      friendlyName: "Synthetic work device",
      deviceClass: "desktop",
      capabilities: {},
    })
    .returning();
  await pool.query("UPDATE vendors SET fleet_ops_state=$2::jsonb WHERE id=$1", [
    vendor.id,
    JSON.stringify({ ...emptyFleetState(), enabled: true }),
  ]);
  const actor: FleetActor = {
    userId: user.id,
    companyId: vendor.id,
    sv: user.sessionVersion,
    activeMembershipId: member.id,
    role: "vendor",
    membershipRole: "admin",
  };
  const delivered = vi.fn(async () => {});
  let rejectAfterWrite = false,
    failReceipt = false;
  const repository = createDatabaseFleetWorkRepository({
    execute: async (context, command) => {
      if (canonical) {
        const result = await executeFleetWorkCommand(context, command);
        if (rejectAfterWrite) throw new FleetError("fleet.version_conflict");
        return result;
      }
      const { client } = context;
      await client.query(
        "INSERT INTO assistant_action_audit(user_id,vendor_id,client_surface,input_mode,provider,tool_name,action_type,target_type,target_id,tool_output,result_status) VALUES($1,$2,'fleet','typed','canonical','synthetic_work','synthetic-work','synthetic-work',$3,'{}'::jsonb,'completed')",
        [actor.userId, actor.companyId, command.operationId],
      );
      if (rejectAfterWrite) throw new FleetError("fleet.version_conflict");
      if (failReceipt) throw Error("Injected transport storage outage");
      return {
        mappings: [],
        canonicalReferences: [],
        afterCommit: [delivered],
      };
    },
  });
  const provision = await repository.provision(actor, {
      deviceId: device.id,
      appVersion: "test-v2",
    }),
    scope = provision.scope as FleetWorkScope;
  const command = (operationId = randomUUID()) =>
    FleetWorkCommandSchema.parse({
      version: 2,
      operationId,
      scope,
      capturedAt: new Date().toISOString(),
      timeZone: "America/Chicago",
      dependencies: [],
      kind: "activity.note",
      payload: {
        activity: {
          type: "canonical",
          kind: "activity",
          id: randomUUID(),
          version: 1,
        },
        ticket: { type: "canonical", kind: "ticket", id: 123, version: 1 },
        notes: "Synthetic original field note",
      },
    });
  return {
    actor,
    device,
    repository,
    service: createFleetWorkService(repository),
    scope,
    command,
    delivered,
    reject: () => {
      rejectAfterWrite = true;
    },
    outage: () => {
      failReceipt = true;
    },
  };
}
it("atomically stores one canonical effect and receipt across concurrent lost-response retry", async () => {
  const f = await fixture(),
    original = f.command();
  const results = await Promise.all([
    f.service.apply(f.actor, original),
    f.service.apply(f.actor, original),
  ]);
  expect(results.map((r) => r.status).sort()).toEqual(["applied", "duplicate"]);
  const rows = await pool.query(
    "SELECT target_type,tool_output FROM assistant_action_audit WHERE vendor_id=$1 AND target_id=$2 ORDER BY id",
    [f.actor.companyId, original.operationId],
  );
  expect(
    rows.rows.filter((r) => r.target_type === "synthetic-work"),
  ).toHaveLength(1);
  expect(
    rows.rows.filter((r) => r.target_type === "fleet-work-operation"),
  ).toHaveLength(1);
  expect(f.delivered).toHaveBeenCalledOnce();
  expect(
    await f.service.read(f.actor, f.scope, original.operationId),
  ).toMatchObject({ status: "applied" });
});
it("retains late work photos on their original ticket and Detail without replaying inspection or changing a replacement", async () => {
  const f = await fixture(),
    tag = randomUUID(),
    group = randomUUID();
  const partner = (
    await pool.query(
      "INSERT INTO partners(name,contact_name,contact_email) VALUES($1,'Synthetic',$2) RETURNING id",
      [tag, `${tag}@example.invalid`],
    )
  ).rows[0].id;
  const site = (
    await pool.query(
      "INSERT INTO site_locations(partner_id,name,address,latitude,longitude,site_code) VALUES($1,'Synthetic','Synthetic',35,-97,$2) RETURNING id",
      [partner, tag],
    )
  ).rows[0].id;
  const workType = (
    await pool.query(
      "INSERT INTO work_types(name,category) VALUES($1,'Synthetic') RETURNING id",
      [tag],
    )
  ).rows[0].id;
  const ticket = (
    await pool.query(
      "INSERT INTO tickets(vendor_id,site_location_id,work_type_id,status) VALUES($1,$2,$3,'submitted') RETURNING id",
      [f.actor.companyId, site, workType],
    )
  ).rows[0].id;
  const capturedAt = new Date(Date.now() - 3600000).toISOString();
  const assignment = FleetDetailSnapshotSchema.parse({
    detail: {
      id: randomUUID(),
      companyId: f.actor.companyId,
      version: 1,
      name: "Original Detail",
      vehicleAssetId: randomUUID(),
      rigPackageId: null,
      rigPackageVersion: null,
      driverUserId: f.actor.userId,
      accessGroupIds: [group],
      effectiveFrom: capturedAt,
      effectiveUntil: null,
      archivedAt: null,
    },
    rigPackage: null,
    labels: {
      truck: "Synthetic truck",
      driver: "Synthetic worker",
      rigPackage: null,
      components: [],
    },
    carrierOfRecordId: f.actor.companyId,
    snapshottedAt: capturedAt,
  });
  const id = randomUUID(),
    reservation = {
      version: 1,
      id: randomUUID(),
      runId: id,
      detailId: assignment.detail.id,
      detailVersion: 1,
      driverUserId: f.actor.userId,
      assetIds: [assignment.detail.vehicleAssetId],
      startAt: capturedAt,
      plannedEndAt: null,
      timeZone: "America/Chicago",
      state: "released",
      actualReleasedAt: new Date().toISOString(),
      releaseReason: "Closed",
    };
  const original = FleetRunSchema.parse({
    id,
    companyId: f.actor.companyId,
    fleetId: group,
    title: "Original activity",
    driverUserId: f.actor.userId,
    vehicleAssetId: assignment.detail.vehicleAssetId,
    trailerAssetId: null,
    siteIds: [site],
    status: "in_progress",
    phase: "travelling",
    version: 1,
    stops: [{ id: randomUUID(), siteId: site, kind: "pickup", sequence: 0 }],
    loads: [],
    inspections: [],
    currentStopId: null,
    visitedStopIds: [],
    events: [],
    linkedTicketId: ticket,
    allowedActions: [],
    resourceAssignment: {
      version: 2,
      snapshot: assignment,
      reservation,
      returnPolicy: "delivery_only",
    },
  });
  const replacementSnapshot = FleetDetailSnapshotSchema.parse({
    ...assignment,
    detail: { ...assignment.detail, version: 2, vehicleAssetId: randomUUID() },
  });
  const current = FleetRunSchema.parse({
    ...original,
    version: 2,
    status: "completed",
    vehicleAssetId: replacementSnapshot.detail.vehicleAssetId,
    resourceAssignment: {
      ...original.resourceAssignment,
      snapshot: replacementSnapshot,
      reservation: {
        ...reservation,
        detailVersion: 2,
        assetIds: [replacementSnapshot.detail.vehicleAssetId],
      },
    },
  });
  for (const run of [original, current])
    await pool.query(
      "INSERT INTO assistant_action_audit(user_id,vendor_id,client_surface,input_mode,provider,tool_name,action_type,target_type,target_id,tool_output,result_status) VALUES($1,$2,'fleet','typed','canonical','synthetic_run','snapshot','fleet-run',$3,$4::jsonb,'completed')",
      [f.actor.userId, f.actor.companyId, id, JSON.stringify(run)],
    );
  await pool.query("UPDATE vendors SET fleet_ops_state=$2::jsonb WHERE id=$1", [
    f.actor.companyId,
    JSON.stringify({
      ...emptyFleetState(),
      enabled: true,
      fleets: [
        {
          id: group,
          name: "Access",
          siteIds: [],
          equipmentAssetIds: [],
          requiredCertifications: [],
        },
      ],
      grants: [
        {
          userId: f.actor.userId,
          roles: ["driver"],
          fleetIds: [group],
          siteIds: [],
          safetyRelease: false,
          financeRead: false,
        },
      ],
    }),
  ]);
  const objects = new Map<string, StoredObject>(),
    bytes = Buffer.from([255, 216, 255, 1]),
    hash = createHash("sha256").update(bytes).digest("hex");
  const store = {
    getObject: async (path: string) => objects.get(path) ?? null,
    putObject: async (
      path: string,
      contentType: string,
      body: Buffer,
      acl: StoredObject["acl"],
    ) => {
      objects.set(path, {
        contentType,
        body: Buffer.from(body),
        size: body.length,
        acl,
      });
    },
  } as unknown as ObjectStore;
  const handlers = createFleetEvidenceCanonicalHandlers({ store: () => store });
  const upload = createFleetEvidenceUploadService(
    createDatabaseFleetEvidenceUploadRepository(f.repository, handlers),
    () => store,
  );
  const command = FleetWorkCommandSchema.parse({
    ...f.command(),
    capturedAt,
    kind: "evidence.stage",
    payload: {
      activity: { type: "canonical", kind: "activity", id, version: 1 },
      ticket: { type: "canonical", kind: "ticket", id: ticket, version: 1 },
      assignment,
      evidence: { type: "local", kind: "evidence", id: randomUUID() },
      kind: "photo",
      notes: "Original truck damage",
      byteSize: bytes.length,
      sha256: hash,
      contentType: "image/jpeg",
    },
  });
  const session = await upload.begin(f.actor, command);
  await upload.put(f.actor, {
    scope: f.scope,
    sessionId: session.id,
    partNumber: 0,
    sha256: hash,
    bytes,
  });
  const receipt = await upload.complete(f.actor, {
    scope: f.scope,
    sessionId: session.id,
    operationId: command.operationId,
  });
  expect(
    await upload.complete(f.actor, {
      scope: f.scope,
      sessionId: session.id,
      operationId: command.operationId,
    }),
  ).toEqual(receipt);
  const saved = (
    await pool.query(
      "SELECT tool_output FROM assistant_action_audit WHERE vendor_id=$1 AND target_type='fleet-evidence'",
      [f.actor.companyId],
    )
  ).rows;
  expect(saved).toHaveLength(1);
  expect(saved[0].tool_output).toMatchObject({
    record: {
      runId: id,
      runVersion: 1,
      capturedAt,
      physicalProofVerified: false,
      signatureIdentityVerified: false,
    },
    capture: {
      scope: f.scope,
      ticketId: ticket,
      assignment,
      capturedAt,
      timeZone: "America/Chicago",
    },
  });
  expect(
    (
      await pool.query(
        "SELECT tool_output FROM assistant_action_audit WHERE vendor_id=$1 AND target_type='fleet-run' ORDER BY id DESC LIMIT 1",
        [f.actor.companyId],
      )
    ).rows[0].tool_output,
  ).toEqual(current);
  expect(
    (await pool.query("SELECT status FROM tickets WHERE id=$1", [ticket]))
      .rows[0].status,
  ).toBe("submitted");
  const altered = JSON.parse(JSON.stringify(command));
  altered.operationId = randomUUID();
  altered.payload.assignment.detail.vehicleAssetId = randomUUID();
  await expect(upload.begin(f.actor, altered)).rejects.toMatchObject({
    code: "fleet.work_assignment_changed",
  });
  const wrongVersion = JSON.parse(JSON.stringify(command));
  wrongVersion.operationId = randomUUID();
  wrongVersion.payload.activity.version = 2;
  await expect(upload.begin(f.actor, wrongVersion)).rejects.toMatchObject({
    code: "fleet.work_assignment_changed",
  });
  // Retained itemized originals are not the legacy 100-photo view. New transfer
  // and paging must still work after that bounded view has been exceeded.
  await pool.query(
    "INSERT INTO assistant_action_audit(user_id,vendor_id,client_surface,input_mode,provider,tool_name,action_type,target_type,target_id,tool_output,result_status) SELECT $1,$2,'fleet','typed','canonical','synthetic_photo','association','fleet-evidence',synthetic_id::text,jsonb_set($3::jsonb,'{record,evidenceId}',to_jsonb(synthetic_id::text)),'completed' FROM (SELECT gen_random_uuid() AS synthetic_id FROM generate_series(1,101)) synthetic",
    [f.actor.userId, f.actor.companyId, JSON.stringify(saved[0].tool_output)],
  );
  const late = JSON.parse(JSON.stringify(command));
  late.operationId = randomUUID();
  late.payload.evidence.id = randomUUID();
  const laterSession = await upload.begin(f.actor, late);
  await upload.put(f.actor, {
    scope: f.scope,
    sessionId: laterSession.id,
    partNumber: 0,
    sha256: hash,
    bytes,
  });
  await upload.complete(f.actor, {
    scope: f.scope,
    sessionId: laterSession.id,
    operationId: late.operationId,
  });
  const readPage = (cursor: string | null = null) =>
    f.repository.readScope({ ...f.actor, readOnly: true }, f.scope, (context) =>
      handlers.readWorkEvidence(context, {
        scope: f.scope,
        activityId: id,
        cursor,
        limit: 40,
      }),
    );
  let page = await readPage(),
    seen = page.evidence.length,
    pages = 1;
  expect(page.evidence[0]).toMatchObject({
    capture: { assignment, ticketId: ticket },
  });
  while (page.nextCursor) {
    page = await readPage(page.nextCursor);
    seen += page.evidence.length;
    pages++;
  }
  expect(seen).toBe(103);
  expect(pages).toBe(3);
  await expect(
    f.repository.readScope(f.actor, f.scope, (context) =>
      handlers.readWorkEvidence(context, {
        scope: { ...f.scope, userId: f.actor.userId + 1 },
        activityId: id,
        cursor: null,
        limit: 40,
      }),
    ),
  ).rejects.toMatchObject({ code: "fleet.work_scope_changed" });
  await expect(readPage("not-a-real-cursor")).rejects.toMatchObject({
    code: "fleet.invalid_cursor",
  });
  const file = await f.repository.withScope(f.actor, f.scope, (context) =>
    handlers.readWorkEvidenceFile(
      context,
      f.scope,
      session.canonicalEvidenceId,
    ),
  );
  expect(file.object.body).toEqual(bytes);
  await expect(
    f.repository.withScope(
      { ...f.actor, readOnly: true },
      f.scope,
      async () => null,
    ),
  ).rejects.toMatchObject({ code: "fleet.read_only" });
  objects.set(receipt.objectPath, {
    ...objects.get(receipt.objectPath)!,
    acl: {
      owner: "different",
      visibility: "private",
      purpose: "fleet-evidence",
    },
  });
  await expect(
    f.repository.withScope(f.actor, f.scope, (context) =>
      handlers.readWorkEvidenceFile(
        context,
        f.scope,
        session.canonicalEvidenceId,
      ),
    ),
  ).rejects.toMatchObject({ code: "fleet.not_found" });
  await pool.query(
    "UPDATE vendors SET fleet_ops_state=jsonb_set(fleet_ops_state,'{grants}','[]'::jsonb) WHERE id=$1",
    [f.actor.companyId],
  );
  const revoked = JSON.parse(JSON.stringify(command));
  revoked.operationId = randomUUID();
  await expect(upload.begin(f.actor, revoked)).rejects.toMatchObject({
    code: "fleet.action_forbidden",
  });
  await expect(readPage()).rejects.toMatchObject({
    code: "fleet.action_forbidden",
  });
});
it("applies an existing location service inside the same original-scope receipt transaction and maps its local identity once", async () => {
  const f = await fixture(true),
    localId = randomUUID(),
    seed = f.command(),
    original = FleetWorkCommandSchema.parse({
      ...seed,
      kind: "location.save",
      payload: {
        operationId: seed.operationId,
        expectedVersion: 1,
        localReference: { type: "local", kind: "location", id: localId },
        destination: {
          name: "Synthetic origin",
          address: "Synthetic yard",
          latitude: 35,
          longitude: -97,
          active: true,
          kind: "yard",
        },
      },
    });
  const receipt = await f.service.apply(f.actor, original);
  expect(receipt.status).toBe("applied");
  if (receipt.status !== "applied")
    throw Error("Expected actual canonical location receipt");
  expect(receipt.mappings).toEqual([
    expect.objectContaining({
      local: { type: "local", kind: "location", id: localId },
      canonical: expect.objectContaining({
        type: "canonical",
        kind: "location",
        version: 1,
      }),
    }),
  ]);
  expect((await f.service.apply(f.actor, original)).status).toBe("duplicate");
  const settings = await pool.query(
    "SELECT fleet_commercial_settings FROM vendors WHERE id=$1",
    [f.actor.companyId],
  );
  expect(settings.rows[0].fleet_commercial_settings.destinations).toHaveLength(
    1,
  );
  expect(settings.rows[0].fleet_commercial_settings.destinations[0].id).toBe(
    receipt.mappings[0].canonical.id,
  );
});
it("rolls a failed business savepoint back while preserving only safe discrepancy metadata", async () => {
  const f = await fixture();
  f.reject();
  const original = f.command(),
    receipt = await f.service.apply(f.actor, original);
  expect(receipt.status).toBe("needs_reconciliation");
  const rows = await pool.query(
    "SELECT target_type,tool_output FROM assistant_action_audit WHERE vendor_id=$1",
    [f.actor.companyId],
  );
  expect(
    rows.rows.filter((r) => r.target_type === "synthetic-work"),
  ).toHaveLength(0);
  expect(
    rows.rows.filter((r) => r.target_type === "fleet-work-case"),
  ).toHaveLength(1);
  expect(JSON.stringify(rows.rows)).not.toContain(
    "Synthetic original field note",
  );
  expect(f.delivered).not.toHaveBeenCalled();
});
it("cannot execute or read under a revoked device or rotated session and never deletes the retained original receipt", async () => {
  const f = await fixture(),
    original = f.command();
  await f.service.apply(f.actor, original);
  await pool.query("UPDATE work_hub_devices SET revoked_at=now() WHERE id=$1", [
    f.device.id,
  ]);
  await expect(
    f.service.read(f.actor, f.scope, original.operationId),
  ).rejects.toMatchObject({ status: 403 });
  const rows = await pool.query(
    "SELECT id FROM assistant_action_audit WHERE vendor_id=$1 AND target_type='fleet-work-operation' AND target_id=$2",
    [f.actor.companyId, original.operationId],
  );
  expect(rows.rowCount).toBe(1);
  await pool.query(
    "UPDATE users SET session_version=session_version+1 WHERE id=$1",
    [f.actor.userId],
  );
  await expect(f.service.apply(f.actor, f.command())).rejects.toMatchObject({
    status: 403,
  });
});
it("does not turn an actual database/application outage into an accepted or permanently denied receipt", async () => {
  const f = await fixture();
  f.outage();
  const original = f.command();
  await expect(f.service.apply(f.actor, original)).rejects.toThrow(
    "Injected transport storage outage",
  );
  expect(
    await f.service.read(f.actor, f.scope, original.operationId),
  ).toBeNull();
  expect(
    (
      await pool.query(
        "SELECT id FROM assistant_action_audit WHERE vendor_id=$1 AND target_type='synthetic-work'",
        [f.actor.companyId],
      )
    ).rowCount,
  ).toBe(0);
  expect(f.delivered).not.toHaveBeenCalled();
});
it("records the same shared Work Hub workday and v2 receipt atomically without a second clock", async () => {
  const f = await fixture(true),
    seed = f.command(),
    shiftId = randomUUID(),
    { deviceId: _device, provisioningId: _provision, ...workerScope } = f.scope;
  const original = FleetWorkCommandSchema.parse({
    ...seed,
    kind: "workday.event",
    payload: {
      operationId: seed.operationId,
      shiftId,
      scope: workerScope,
      action: "start_shift",
      capturedAt: seed.capturedAt,
      timezone: seed.timeZone,
    },
  });
  expect(await f.service.apply(f.actor, original)).toMatchObject({
    status: "applied",
    canonicalReferences: [
      { type: "canonical", kind: "shift", id: shiftId, version: 1 },
    ],
  });
  const session = {
    userId: f.actor.userId,
    vendorId: f.actor.companyId,
    role: f.actor.role,
    sv: f.actor.sv,
    activeMembershipId: f.actor.activeMembershipId,
    membershipRole: f.actor.membershipRole,
  };
  expect(
    await workdayService.operation(session, original.operationId),
  ).toMatchObject({
    shiftId,
    event: { kind: "start_shift", capturedAt: seed.capturedAt },
  });
  expect((await f.service.apply(f.actor, original)).status).toBe("duplicate");
  const retained = await pool.query(
    "SELECT id FROM assistant_action_audit WHERE vendor_id=$1 AND target_type='workday-event' AND target_id=$2",
    [f.actor.companyId, original.operationId],
  );
  expect(retained.rowCount).toBe(1);
});
it("does not leave a workday start committed when the enclosing work command fails", async () => {
  const f = await fixture(true),
    seed = f.command(),
    { deviceId: _device, provisioningId: _provision, ...workerScope } = f.scope;
  const original = FleetWorkCommandSchema.parse({
    ...seed,
    kind: "workday.event",
    payload: {
      operationId: seed.operationId,
      shiftId: randomUUID(),
      scope: workerScope,
      action: "start_shift",
      capturedAt: seed.capturedAt,
      timezone: seed.timeZone,
    },
  });
  f.reject();
  expect((await f.service.apply(f.actor, original)).status).toBe(
    "needs_reconciliation",
  );
  expect(
    (
      await pool.query(
        "SELECT id FROM assistant_action_audit WHERE vendor_id=$1 AND target_type='workday-event' AND target_id=$2",
        [f.actor.companyId, original.operationId],
      )
    ).rowCount,
  ).toBe(0);
});
it("provides the same verified original transaction to byte metadata handlers without skipping provisioning checks", async () => {
  const f = await fixture(),
    callback = vi.fn(
      async ({ client }: { client: import("pg").PoolClient }) => {
        return (await client.query("SELECT 17::int AS value")).rows[0].value;
      },
    );
  expect(await f.repository.withScope(f.actor, f.scope, callback)).toBe(17);
  expect(callback).toHaveBeenCalledOnce();
  await expect(
    f.repository.withScope(
      f.actor,
      { ...f.scope, provisioningId: randomUUID() },
      callback,
    ),
  ).rejects.toMatchObject({ status: 403 });
  expect(callback).toHaveBeenCalledOnce();
});
it("persists resumable byte metadata and canonical association in the original database scope across service restart", async () => {
  const f = await fixture(),
    objects = new Map<string, StoredObject>(),
    body = Buffer.from([255, 216, 255, 1, 2]),
    hash = createHash("sha256").update(body).digest("hex"),
    seed = f.command();
  const store = {
    kind: "filesystem",
    getObject: async (path: string) => objects.get(path) ?? null,
    putObject: async (
      path: string,
      type: string,
      bytes: Buffer,
      acl: StoredObject["acl"],
    ) => {
      objects.set(path, {
        contentType: type,
        size: bytes.length,
        body: Buffer.from(bytes),
        acl,
      });
    },
  } as unknown as ObjectStore;
  const associate = vi.fn(
    async (
      { client }: { client: import("pg").PoolClient },
      saved: import("@workspace/api-zod").FleetEvidenceUploadSession,
      bytes: Buffer,
    ) => {
      if (saved.binding.kind !== "compliance")
        throw Error("Expected source document");
      const path = `/objects/fleet-compliance-private/${f.actor.companyId}/${saved.binding.recordId}/documents/${saved.sha256}`;
      await store.putObject(path, saved.contentType, bytes, {
        owner: `fleet-compliance:${f.actor.companyId}`,
        visibility: "private",
        purpose: "fleet-compliance-private",
      });
      await client.query(
        "INSERT INTO assistant_action_audit(user_id,vendor_id,client_surface,input_mode,provider,tool_name,action_type,target_type,target_id,tool_output,result_status) VALUES($1,$2,'fleet','typed','canonical','synthetic_evidence','association','synthetic-evidence-association',$3,'{}'::jsonb,'completed')",
        [f.actor.userId, f.actor.companyId, saved.id],
      );
      return {
        evidenceId: saved.canonicalEvidenceId,
        objectPath: path,
        fileUrl: null,
      };
    },
  );
  const repo = createDatabaseFleetEvidenceUploadRepository(f.repository, {
      authorize: async () => {},
      associate,
    }),
    service = createFleetEvidenceUploadService(repo, () => store);
  const command = FleetWorkCommandSchema.parse({
      ...seed,
      kind: "compliance.document.stage",
      payload: {
        recordId: randomUUID(),
        subject: { kind: "driver", id: f.actor.userId },
        expectedRecordVersion: 0,
        evidence: { type: "local", kind: "evidence", id: randomUUID() },
        byteSize: body.length,
        sha256: hash,
        contentType: "image/jpeg",
      },
    }),
    saved = await service.begin(f.actor, command);
  await service.put(f.actor, {
    scope: f.scope,
    sessionId: saved.id,
    partNumber: 0,
    sha256: hash,
    bytes: body,
  });
  const restarted = createFleetEvidenceUploadService(
    createDatabaseFleetEvidenceUploadRepository(f.repository, {
      authorize: async () => {},
      associate,
    }),
    () => store,
  );
  expect((await restarted.read(f.actor, f.scope, saved.id)).parts).toHaveLength(
    1,
  );
  const results = await Promise.all([
    service.complete(f.actor, {
      scope: f.scope,
      sessionId: saved.id,
      operationId: command.operationId,
    }),
    restarted.complete(f.actor, {
      scope: f.scope,
      sessionId: saved.id,
      operationId: command.operationId,
    }),
  ]);
  expect(results[0]).toEqual(results[1]);
  expect(associate).toHaveBeenCalledOnce();
  const rows = await pool.query(
    "SELECT target_type,tool_output FROM assistant_action_audit WHERE vendor_id=$1",
    [f.actor.companyId],
  );
  expect(
    rows.rows.filter(
      (row) => row.target_type === "synthetic-evidence-association",
    ),
  ).toHaveLength(1);
  expect(JSON.stringify(rows.rows)).not.toContain(body.toString("base64"));
});
it("completes a real private source document through its current authorization boundary without auto-creating or verifying a qualification", async () => {
  const f = await fixture(),
    objects = new Map<string, StoredObject>(),
    body = Buffer.from([255, 216, 255, 1, 2]),
    hash = createHash("sha256").update(body).digest("hex"),
    seed = f.command();
  const store = {
    kind: "filesystem",
    getObject: async (path: string) => objects.get(path) ?? null,
    getObjectAcl: async (path: string) => objects.get(path)?.acl ?? null,
    putObject: async (
      path: string,
      type: string,
      bytes: Buffer,
      acl: StoredObject["acl"],
    ) => {
      objects.set(path, {
        contentType: type,
        size: bytes.length,
        body: Buffer.from(bytes),
        acl,
      });
    },
  } as unknown as ObjectStore;
  const handlers = createFleetEvidenceCanonicalHandlers({
      store: () => store,
      secret: () => "synthetic-upload-hmac-not-a-credential",
    }),
    service = createFleetEvidenceUploadService(
      createDatabaseFleetEvidenceUploadRepository(f.repository, handlers),
      () => store,
    );
  const command = FleetWorkCommandSchema.parse({
      ...seed,
      kind: "compliance.document.stage",
      payload: {
        recordId: randomUUID(),
        subject: { kind: "driver", id: f.actor.userId },
        expectedRecordVersion: 0,
        evidence: { type: "local", kind: "evidence", id: randomUUID() },
        byteSize: body.length,
        sha256: hash,
        contentType: "image/jpeg",
      },
    }),
    saved = await service.begin(f.actor, command);
  const work = createFleetWorkService(
    createDatabaseFleetWorkRepository({ execute: executeFleetWorkCommand }),
  );
  expect(await work.apply(f.actor, command)).toMatchObject({
    status: "retry_later",
    reason: "invalid_dependency",
  });
  await service.put(f.actor, {
    scope: f.scope,
    sessionId: saved.id,
    partNumber: 0,
    sha256: hash,
    bytes: body,
  });
  const receipt = await service.complete(f.actor, {
    scope: f.scope,
    sessionId: saved.id,
    operationId: command.operationId,
  });
  expect(receipt).toMatchObject({
    status: "complete",
    physicalProofVerified: false,
    signatureIdentityVerified: false,
  });
  expect(
    await service.complete(f.actor, {
      scope: f.scope,
      sessionId: saved.id,
      operationId: command.operationId,
    }),
  ).toEqual(receipt);
  expect(
    (
      await pool.query(
        "SELECT id FROM assistant_action_audit WHERE vendor_id=$1 AND target_type='fleet-compliance-revision'",
        [f.actor.companyId],
      )
    ).rowCount,
  ).toBe(0);
  expect(await work.apply(f.actor, command)).toMatchObject({
    status: "applied",
    mappings: [
      {
        local: { type: "local", kind: "evidence", id: saved.localEvidenceId },
        canonical: {
          type: "canonical",
          kind: "evidence",
          id: saved.canonicalEvidenceId,
          version: 1,
        },
      },
    ],
  });
  expect((await work.apply(f.actor, command)).status).toBe("duplicate");
  const receivedId = randomUUID();
  if (command.kind !== "compliance.document.stage")
    throw Error("Expected source document stage");
  const sourceCommand = FleetWorkCommandSchema.parse({
    ...seed,
    operationId: receivedId,
    dependencies: [command.operationId],
    kind: "compliance.receive",
    payload: {
      documentReference: {
        type: "local",
        kind: "evidence",
        id: saved.localEvidenceId,
      },
      source: {
        operationId: receivedId,
        expectedVersion: 0,
        record: {
          evidence: {
            id: command.payload.recordId,
            revision: 1,
            subject: command.payload.subject,
            requirementId: "unmapped:driver_license",
            requirementVersion: 1,
            status: "document_received",
            validFrom: "2026-01-01T00:00:00Z",
            validUntil: "2027-01-01T00:00:00Z",
            verifiedAt: null,
            verifiedByUserId: null,
            source: "Synthetic received file",
            privateDocumentRef: null,
            restrictions: {},
          },
          attributes: {
            kind: "driver_license",
            issuingState: "OK",
            licenseNumber: "SYNTHETIC-PRIVATE-LICENSE",
            licenseClass: "A",
            endorsements: [],
            restrictions: [],
            licenseStatus: "active",
            sourceRecordId: null,
          },
          retentionClass: "qualification",
          retainUntil: null,
          legalHold: false,
        },
      },
    },
  });
  const sourceWork = createFleetWorkService(
    createDatabaseFleetWorkRepository({
      execute: (context, value) =>
        executeFleetWorkCommand(context, value, {
          compliance: {
            store: () => store,
            secret: () => "synthetic-upload-hmac-not-a-credential",
          },
        }),
    }),
  );
  if (sourceCommand.kind !== "compliance.receive")
    throw Error("Expected source receipt intent");
  const badId = randomUUID(),
    bad = {
      ...sourceCommand,
      operationId: badId,
      payload: {
        ...sourceCommand.payload,
        source: {
          ...sourceCommand.payload.source,
          operationId: badId,
          record: {
            ...sourceCommand.payload.source.record,
            evidence: {
              ...sourceCommand.payload.source.record.evidence,
              id: randomUUID(),
            },
          },
        },
      },
    };
  expect(await sourceWork.apply(f.actor, bad)).toMatchObject({
    status: "needs_reconciliation",
    reason: "invalid_command",
  });
  expect((await sourceWork.apply(f.actor, sourceCommand)).status).toBe(
    "applied",
  );
  expect((await sourceWork.apply(f.actor, sourceCommand)).status).toBe(
    "duplicate",
  );
  expect(
    sourceCommand.payload.source.record.evidence.privateDocumentRef,
  ).toBeNull();
  const privateRecords = [...objects.values()]
    .filter((object) => object.contentType === "application/json")
    .map((object) => JSON.parse(object.body.toString()));
  expect(privateRecords).toEqual([
    expect.objectContaining({
      evidence: expect.objectContaining({
        status: "document_received",
        privateDocumentRef: receipt.objectPath,
      }),
      attributes: expect.objectContaining({
        licenseNumber: "SYNTHETIC-PRIVATE-LICENSE",
      }),
    }),
  ]);
  const rows = await pool.query(
    "SELECT target_type,tool_output FROM assistant_action_audit WHERE vendor_id=$1",
    [f.actor.companyId],
  );
  expect(
    rows.rows.filter((row) => row.target_type === "fleet-compliance-document"),
  ).toHaveLength(1);
  expect(
    rows.rows.filter((row) => row.target_type === "fleet-compliance-revision"),
  ).toHaveLength(1);
  expect(JSON.stringify(rows.rows)).not.toContain(body.toString("base64"));
  expect(JSON.stringify(rows.rows)).not.toContain("SYNTHETIC-PRIVATE-LICENSE");
});
