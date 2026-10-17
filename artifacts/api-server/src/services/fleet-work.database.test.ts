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
import type { ObjectStore, StoredObject } from "../lib/objectStore";
import { createHash } from "node:crypto";
import type { FleetActor } from "./fleet-ops";
import {
  FleetWorkCommandSchema,
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
