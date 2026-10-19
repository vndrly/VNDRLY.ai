import { createHash, randomUUID } from "node:crypto";
import { expect, it, vi } from "vitest";
import {
  FleetWorkCommandSchema,
  FleetWorkScopeSchema,
  type FleetWorkScope,
} from "@workspace/api-zod";
import {
  createFleetEvidenceUploadService,
  type FleetEvidenceUploadRepository,
  type FleetEvidenceUploadSession,
  type FleetEvidencePartReceipt,
} from "./fleet-evidence-upload";
import type { ObjectStore, StoredObject } from "../lib/objectStore";
import { FleetError } from "./fleet-repository";
const digest = (bytes: Buffer) =>
  createHash("sha256").update(bytes).digest("hex");
const scope = FleetWorkScopeSchema.parse({
  owner: { type: "vendor", id: 7 },
  userId: 2,
  membershipId: 8,
  sessionVersion: 3,
  deviceId: randomUUID(),
  provisioningId: randomUUID(),
});
const actor = {
  userId: 2,
  companyId: 7,
  sv: 3,
  activeMembershipId: 8,
  role: "vendor",
  membershipRole: "admin",
};
function stage(bytes: Buffer) {
  const operationId = randomUUID();
  return FleetWorkCommandSchema.parse({
    version: 2,
    operationId,
    scope,
    capturedAt: "2026-10-16T18:00:00Z",
    timeZone: "America/Chicago",
    dependencies: [],
    kind: "compliance.document.stage",
    payload: {
      recordId: randomUUID(),
      subject: { kind: "driver", id: 2 },
      expectedRecordVersion: 0,
      evidence: { type: "local", kind: "evidence", id: randomUUID() },
      byteSize: bytes.length,
      sha256: digest(bytes),
      contentType: "image/jpeg",
    },
  });
}
function fixture() {
  let sessions: FleetEvidenceUploadSession[] = [],
    parts: Array<{ sessionId: string; part: FleetEvidencePartReceipt }> = [],
    revoked = false,
    failCommit = false;
  const objects = new Map<string, StoredObject>(),
    writes = vi.fn(
      async (
        path: string,
        type: string,
        bytes: Buffer,
        acl: StoredObject["acl"],
      ) => {
        objects.set(path, {
          body: Buffer.from(bytes),
          size: bytes.length,
          contentType: type,
          acl,
        });
      },
    );
  const store = {
    kind: "filesystem",
    getObject: async (path: string) => objects.get(path) ?? null,
    putObject: writes,
  } as unknown as ObjectStore;
  const associate = vi.fn(
    async (session: FleetEvidenceUploadSession, bytes: Buffer) => {
      if (session.binding.kind !== "compliance")
        throw Error("Private source descriptor required");
      const path = `/objects/fleet-compliance-private/7/${session.binding.recordId}/documents/${session.sha256}`;
      await store.putObject(path, session.contentType, bytes, {
        owner: "fleet-compliance:7",
        visibility: "private",
        purpose: "fleet-compliance-private",
      });
      return {
        evidenceId: session.canonicalEvidenceId,
        objectPath: path,
        fileUrl: null,
      };
    },
  );
  const repository: FleetEvidenceUploadRepository = {
    async transaction(currentActor, originalScope, operation) {
      if (
        revoked ||
        currentActor.userId !== scope.userId ||
        JSON.stringify(originalScope) !== JSON.stringify(scope)
      )
        throw new FleetError("fleet.work_scope_changed", 403);
      const before = {
        sessions: structuredClone(sessions),
        parts: structuredClone(parts),
      };
      try {
        const result = await operation({
          authorize: async () => {},
          readSession: async (key) =>
            sessions.find((s) =>
              "sessionId" in key
                ? s.id === key.sessionId
                : s.operationId === key.operationId,
            ) ?? null,
          saveSession: async (value) => {
            sessions = [
              ...sessions.filter((s) => s.id !== value.id),
              structuredClone(value),
            ];
          },
          readPart: async (id, index) =>
            parts.find((r) => r.sessionId === id && r.part.partNumber === index)
              ?.part ?? null,
          savePart: async (id, part) => {
            parts = [
              ...parts.filter(
                (r) =>
                  r.sessionId !== id || r.part.partNumber !== part.partNumber,
              ),
              { sessionId: id, part: structuredClone(part) },
            ];
          },
          associate,
        });
        if (failCommit) throw Error("Injected metadata failure");
        return result;
      } catch (e) {
        ({ sessions, parts } = before);
        throw e;
      }
    },
  };
  return {
    service: createFleetEvidenceUploadService(repository, () => store),
    objects,
    writes,
    associate,
    get sessions() {
      return sessions;
    },
    revoke: () => {
      revoked = true;
    },
    failCommit: () => {
      failCommit = true;
    },
    restoreCommit: () => {
      failCommit = false;
    },
  };
}
const jpeg = (size = 256 * 1024 + 5) => {
  const body = Buffer.alloc(size, 1);
  Buffer.from([255, 216, 255]).copy(body);
  return body;
};
async function uploadPart(
  f: ReturnType<typeof fixture>,
  sessionId: string,
  index: number,
  bytes: Buffer,
  originalScope: FleetWorkScope = scope,
) {
  return f.service.put(actor, {
    scope: originalScope,
    sessionId,
    partNumber: index,
    sha256: digest(bytes),
    bytes,
  });
}
it("resumes exact acknowledged chunks and independently reads one canonical completion after a lost response", async () => {
  const f = fixture(),
    body = jpeg(),
    command = stage(body),
    session = await f.service.begin(actor, command);
  const first = await uploadPart(
    f,
    session.id,
    0,
    body.subarray(0, 256 * 1024),
  );
  expect((await f.service.read(actor, scope, session.id)).parts).toEqual([
    first,
  ]);
  await expect(
    f.service.complete(actor, {
      scope,
      sessionId: session.id,
      operationId: command.operationId,
    }),
  ).rejects.toMatchObject({ code: "fleet.evidence_parts_missing" });
  expect(f.associate).not.toHaveBeenCalled();
  await uploadPart(f, session.id, 0, body.subarray(0, 256 * 1024));
  await uploadPart(f, session.id, 1, body.subarray(256 * 1024));
  const receipt = await f.service.complete(actor, {
    scope,
    sessionId: session.id,
    operationId: command.operationId,
  });
  expect(receipt).toMatchObject({
    status: "complete",
    sha256: digest(body),
    byteSize: body.length,
    evidenceId: session.canonicalEvidenceId,
  });
  expect(
    await f.service.complete(actor, {
      scope,
      sessionId: session.id,
      operationId: command.operationId,
    }),
  ).toEqual(receipt);
  expect(f.associate).toHaveBeenCalledOnce();
  expect((await f.service.read(actor, scope, session.id)).completion).toEqual(
    receipt,
  );
});
it("refuses changed original descriptors, part bytes/ordinal/length and caller hashes without overwriting acknowledged bytes", async () => {
  const f = fixture(),
    body = jpeg(),
    command = stage(body),
    session = await f.service.begin(actor, command),
    part = body.subarray(0, 256 * 1024);
  await uploadPart(f, session.id, 0, part);
  await expect(
    uploadPart(f, session.id, 0, Buffer.alloc(part.length, 2)),
  ).rejects.toMatchObject({ status: 409 });
  await expect(
    uploadPart(f, session.id, 2, body.subarray(0, 5)),
  ).rejects.toMatchObject({ status: 400 });
  await expect(uploadPart(f, session.id, 1, part)).rejects.toMatchObject({
    status: 400,
  });
  await expect(
    f.service.put(actor, {
      scope,
      sessionId: session.id,
      partNumber: 1,
      sha256: "a".repeat(64),
      bytes: body.subarray(256 * 1024),
    }),
  ).rejects.toMatchObject({ status: 400 });
  await expect(
    f.service.begin(actor, {
      ...command,
      payload: { ...command.payload, sha256: "b".repeat(64) },
    }),
  ).rejects.toMatchObject({ code: "fleet.operation_conflict" });
  expect((await f.service.read(actor, scope, session.id)).parts).toHaveLength(
    1,
  );
});
it("recovers a part written before a metadata failure without replacing it with different bytes", async () => {
  const f = fixture(),
    body = jpeg(5),
    command = stage(body),
    session = await f.service.begin(actor, command);
  f.failCommit();
  await expect(uploadPart(f, session.id, 0, body)).rejects.toThrow(
    "Injected metadata failure",
  );
  expect(f.objects.size).toBe(1);
  expect(f.sessions).toHaveLength(1);
  expect(f.associate).not.toHaveBeenCalled();
  f.restoreCommit();
  await uploadPart(f, session.id, 0, body);
  expect(f.writes).toHaveBeenCalledOnce();
  expect(
    (
      await f.service.complete(actor, {
        scope,
        sessionId: session.id,
        operationId: command.operationId,
      })
    ).status,
  ).toBe("complete");
});
it("requires the exact still-authorized original account/device scope for every upload step", async () => {
  const f = fixture(),
    body = jpeg(5),
    command = stage(body),
    session = await f.service.begin(actor, command);
  await expect(
    uploadPart(f, session.id, 0, body, { ...scope, sessionVersion: 4 }),
  ).rejects.toMatchObject({ status: 403 });
  f.revoke();
  await expect(uploadPart(f, session.id, 0, body)).rejects.toMatchObject({
    status: 403,
  });
  await expect(f.service.read(actor, scope, session.id)).rejects.toMatchObject({
    status: 403,
  });
  expect(f.objects.size).toBe(0);
  expect(f.sessions).toHaveLength(1);
});
it("requires exact whole-file hash and supported signature without treating bytes as legal or physical verification", async () => {
  const f = fixture(),
    body = Buffer.alloc(5, 1),
    command = stage(body),
    session = await f.service.begin(actor, command);
  await uploadPart(f, session.id, 0, body);
  await expect(
    f.service.complete(actor, {
      scope,
      sessionId: session.id,
      operationId: command.operationId,
    }),
  ).rejects.toMatchObject({ status: 400 });
  expect(f.associate).not.toHaveBeenCalled();
  expect(f.sessions[0].completion).toBeNull();
});
it("does not trust valid individual part hashes as a substitute for the declared whole-file digest", async () => {
  const f = fixture(),
    body = jpeg(5),
    original = stage(body),
    command = {
      ...original,
      payload: { ...original.payload, sha256: "a".repeat(64) },
    },
    session = await f.service.begin(actor, command);
  await uploadPart(f, session.id, 0, body);
  await expect(
    f.service.complete(actor, {
      scope,
      sessionId: session.id,
      operationId: command.operationId,
    }),
  ).rejects.toMatchObject({ code: "fleet.evidence_hash_mismatch" });
  expect(f.associate).not.toHaveBeenCalled();
});
