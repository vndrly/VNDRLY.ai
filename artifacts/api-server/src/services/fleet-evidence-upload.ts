import { createHash, randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod/v4";
import {
  FleetWorkCommandSchema,
  FleetWorkScopeSchema,
  FleetEvidenceUploadSessionSchema,
  FleetEvidenceUploadCompletionSchema,
  FleetEvidencePartReceiptSchema,
  FLEET_EVIDENCE_PART_BYTES,
  type FleetWorkCommand,
  type FleetWorkScope,
  type FleetEvidenceUploadSession,
  type FleetEvidencePartReceipt,
} from "@workspace/api-zod";
import type { FleetActor } from "./fleet-ops";
import { FleetError } from "./fleet-repository";
import { fleetWorkFingerprint } from "./fleet-work";
import { validateFleetEvidenceObject } from "./fleet-evidence";
import type { ObjectStore, StoredObject } from "../lib/objectStore";
export type {
  FleetEvidenceUploadSession,
  FleetEvidencePartReceipt,
} from "@workspace/api-zod";
type Stage = Extract<
  FleetWorkCommand,
  { kind: "evidence.stage" | "compliance.document.stage" }
>;
type Association = {
  evidenceId: string;
  objectPath: string;
  fileUrl: string | null;
};
export type FleetEvidenceUploadTransaction = {
  authorize(command: Stage): Promise<void>;
  readSession(
    key: { sessionId: string } | { operationId: string },
  ): Promise<FleetEvidenceUploadSession | null>;
  saveSession(session: FleetEvidenceUploadSession): Promise<void>;
  readPart(
    sessionId: string,
    partNumber: number,
  ): Promise<FleetEvidencePartReceipt | null>;
  savePart(sessionId: string, part: FleetEvidencePartReceipt): Promise<void>;
  associate(
    session: FleetEvidenceUploadSession,
    bytes: Buffer,
  ): Promise<Association>;
};
/** Must revalidate live identity, registered device/provisioning and original
 * membership, then serialize metadata and canonical association in one actual
 * transaction. Neither an object path nor a hash is authorization. */
export type FleetEvidenceUploadRepository = {
  transaction<T>(
    actor: FleetActor,
    scope: FleetWorkScope,
    work: (tx: FleetEvidenceUploadTransaction) => Promise<T>,
  ): Promise<T>;
};
const hash = (body: Buffer) => createHash("sha256").update(body).digest("hex");
const uuid = z.uuid(),
  sha = z.string().regex(/^[a-f0-9]{64}$/);
const partPath = (session: FleetEvidenceUploadSession, part: number) =>
  `/objects/fleet/${session.scope.owner.id}/work-uploads/${session.scope.provisioningId}/${session.id}/parts/${part}`;
const partOwner = (session: FleetEvidenceUploadSession) =>
  `fleet-work:${session.scope.owner.id}:${session.scope.userId}:${session.scope.provisioningId}`;
function requireActor(actor: FleetActor, scope: FleetWorkScope) {
  if (
    actor.readOnly ||
    scope.owner.type !== "vendor" ||
    scope.owner.id !== actor.companyId ||
    scope.userId !== actor.userId ||
    scope.membershipId !== actor.activeMembershipId ||
    scope.sessionVersion !== actor.sv
  )
    throw new FleetError("fleet.work_scope_changed", 403);
}
function expectedLength(session: FleetEvidenceUploadSession, index: number) {
  return index === session.partCount - 1
    ? session.byteSize - index * session.partSize
    : session.partSize;
}
function validPart(
  object: StoredObject | null,
  session: FleetEvidenceUploadSession,
  receipt: FleetEvidencePartReceipt,
) {
  return Boolean(
    object &&
    object.acl?.owner === partOwner(session) &&
    object.acl.visibility === "private" &&
    object.acl.purpose === "fleet-evidence" &&
    object.contentType === "application/octet-stream" &&
    object.size === receipt.byteSize &&
    object.body.length === receipt.byteSize &&
    hash(object.body) === receipt.sha256,
  );
}
/** Byte transfer is independent from physical actions and source verification.
 * Never evicts originals, invents a signature, or calls a photo proof of work. */
export function createFleetEvidenceUploadService(
  repository: FleetEvidenceUploadRepository,
  store: () => ObjectStore,
  now = () => new Date(),
) {
  const session = async (
    tx: FleetEvidenceUploadTransaction,
    scope: FleetWorkScope,
    id: string,
  ) => {
    const value = await tx.readSession({ sessionId: uuid.parse(id) });
    if (!value) throw new FleetError("fleet.evidence_session_not_found", 404);
    const saved = FleetEvidenceUploadSessionSchema.parse(value);
    if (!isDeepStrictEqual(saved.scope, scope))
      throw new FleetError("fleet.work_scope_changed", 403);
    return saved;
  };
  const begin = async (actor: FleetActor, raw: unknown) => {
    const command = FleetWorkCommandSchema.parse(raw);
    if (
      command.kind !== "evidence.stage" &&
      command.kind !== "compliance.document.stage"
    )
      throw new FleetError("fleet.invalid_request", 400);
    requireActor(actor, command.scope);
    if (command.payload.evidence.type !== "local")
      throw new FleetError("fleet.local_evidence_identity_required", 400);
    return repository.transaction(actor, command.scope, async (tx) => {
      const fingerprint = fleetWorkFingerprint(command),
        prior = await tx.readSession({ operationId: command.operationId });
      if (prior) {
        const saved = FleetEvidenceUploadSessionSchema.parse(prior);
        if (
          !isDeepStrictEqual(saved.scope, command.scope) ||
          saved.fingerprint !== fingerprint
        )
          throw new FleetError("fleet.operation_conflict");
        return saved;
      }
      await tx.authorize(command);
      const p = command.payload,
        binding: FleetEvidenceUploadSession["binding"] =
          command.kind === "evidence.stage"
            ? {
                kind: "work",
                activity: command.payload.activity,
                ticket: command.payload.ticket,
                assignment: command.payload.assignment,
                evidenceKind: command.payload.kind,
                notes: command.payload.notes,
              }
            : {
                kind: "compliance",
                recordId: command.payload.recordId,
                subject: command.payload.subject,
                expectedRecordVersion: command.payload.expectedRecordVersion,
              };
      const saved = FleetEvidenceUploadSessionSchema.parse({
        version: 2,
        id: randomUUID(),
        operationId: command.operationId,
        scope: command.scope,
        fingerprint,
        localEvidenceId: p.evidence.id,
        canonicalEvidenceId: randomUUID(),
        capturedAt: command.capturedAt,
        timeZone: command.timeZone,
        createdAt: now().toISOString(),
        byteSize: p.byteSize,
        sha256: p.sha256,
        contentType: p.contentType,
        partCount: Math.ceil(p.byteSize / FLEET_EVIDENCE_PART_BYTES),
        partSize: FLEET_EVIDENCE_PART_BYTES,
        binding,
        completion: null,
      });
      await tx.saveSession(saved);
      return saved;
    });
  };
  const read = async (actor: FleetActor, rawScope: unknown, id: string) => {
    const scope = FleetWorkScopeSchema.parse(rawScope);
    requireActor(actor, scope);
    return repository.transaction(actor, scope, async (tx) => {
      const saved = await session(tx, scope, id),
        parts = (
          await Promise.all(
            Array.from({ length: saved.partCount }, (_, index) =>
              tx.readPart(saved.id, index),
            ),
          )
        )
          .filter((part): part is FleetEvidencePartReceipt => part !== null)
          .map((part) => FleetEvidencePartReceiptSchema.parse(part));
      return { session: saved, parts, completion: saved.completion };
    });
  };
  const put = async (
    actor: FleetActor,
    input: {
      scope: FleetWorkScope;
      sessionId: string;
      partNumber: number;
      sha256: string;
      bytes: Buffer;
    },
  ) => {
    const scope = FleetWorkScopeSchema.parse(input.scope);
    requireActor(actor, scope);
    uuid.parse(input.sessionId);
    sha.parse(input.sha256);
    if (
      !Buffer.isBuffer(input.bytes) ||
      !Number.isSafeInteger(input.partNumber) ||
      input.partNumber < 0
    )
      throw new FleetError("fleet.invalid_request", 400);
    return repository.transaction(actor, scope, async (tx) => {
      const saved = await session(tx, scope, input.sessionId);
      if (
        input.partNumber >= saved.partCount ||
        input.bytes.length !== expectedLength(saved, input.partNumber) ||
        hash(input.bytes) !== input.sha256
      )
        throw new FleetError("fleet.invalid_evidence_part", 400);
      const prior = await tx.readPart(saved.id, input.partNumber);
      if (
        prior &&
        (prior.sha256 !== input.sha256 || prior.byteSize !== input.bytes.length)
      )
        throw new FleetError("fleet.evidence_part_conflict", 409);
      const receipt = FleetEvidencePartReceiptSchema.parse(
          prior ?? {
            partNumber: input.partNumber,
            sha256: input.sha256,
            byteSize: input.bytes.length,
            recordedAt: now().toISOString(),
          },
        ),
        path = partPath(saved, input.partNumber),
        existing = await store().getObject(path);
      if (
        existing &&
        (existing.acl?.owner !== partOwner(saved) ||
          existing.acl.visibility !== "private" ||
          existing.acl.purpose !== "fleet-evidence")
      )
        throw new FleetError("fleet.evidence_part_conflict", 409);
      if (!validPart(existing, saved, receipt)) {
        if (existing && !prior)
          throw new FleetError("fleet.evidence_part_conflict", 409);
        await store().putObject(path, "application/octet-stream", input.bytes, {
          owner: partOwner(saved),
          visibility: "private",
          purpose: "fleet-evidence",
        });
      }
      if (!validPart(await store().getObject(path), saved, receipt))
        throw new FleetError("fleet.evidence_storage_unavailable", 503);
      if (!prior) await tx.savePart(saved.id, receipt);
      return receipt;
    });
  };
  const complete = async (
    actor: FleetActor,
    input: { scope: FleetWorkScope; sessionId: string; operationId: string },
  ) => {
    const scope = FleetWorkScopeSchema.parse(input.scope);
    requireActor(actor, scope);
    uuid.parse(input.operationId);
    return repository.transaction(actor, scope, async (tx) => {
      const saved = await session(tx, scope, input.sessionId);
      if (input.operationId !== saved.operationId)
        throw new FleetError("fleet.operation_conflict");
      if (saved.completion) return saved.completion;
      const chunks: Buffer[] = [];
      for (let index = 0; index < saved.partCount; index++) {
        const receipt = await tx.readPart(saved.id, index);
        if (!receipt) throw new FleetError("fleet.evidence_parts_missing", 409);
        const part = FleetEvidencePartReceiptSchema.parse(receipt),
          object = await store().getObject(partPath(saved, index));
        if (
          part.partNumber !== index ||
          part.byteSize !== expectedLength(saved, index) ||
          !validPart(object, saved, part)
        )
          throw new FleetError("fleet.evidence_part_unavailable", 409);
        chunks.push(object!.body);
      }
      const bytes = Buffer.concat(chunks);
      if (bytes.length !== saved.byteSize || hash(bytes) !== saved.sha256)
        throw new FleetError("fleet.evidence_hash_mismatch", 400);
      validateFleetEvidenceObject({
        contentType: saved.contentType,
        size: bytes.length,
        body: bytes,
        acl: null,
      });
      const associated = await tx.associate(saved, bytes),
        privateSource = saved.binding.kind === "compliance",
        prefix = privateSource
          ? `/objects/fleet-compliance-private/${scope.owner.id}/`
          : `/objects/fleet/${scope.owner.id}/`,
        object = await store().getObject(associated.objectPath);
      if (
        associated.evidenceId !== saved.canonicalEvidenceId ||
        !associated.objectPath.startsWith(prefix) ||
        !object ||
        object.acl?.visibility !== "private" ||
        object.acl.owner !==
          (privateSource
            ? `fleet-compliance:${scope.owner.id}`
            : String(scope.userId)) ||
        object.acl.purpose !==
          (privateSource ? "fleet-compliance-private" : "fleet-evidence") ||
        object.contentType !== saved.contentType ||
        object.size !== saved.byteSize ||
        object.body.length !== saved.byteSize ||
        hash(object.body) !== saved.sha256
      )
        throw new FleetError("fleet.evidence_storage_unavailable", 503);
      const completion = FleetEvidenceUploadCompletionSchema.parse({
        status: "complete",
        sessionId: saved.id,
        operationId: saved.operationId,
        evidenceId: saved.canonicalEvidenceId,
        byteSize: saved.byteSize,
        sha256: saved.sha256,
        contentType: saved.contentType,
        objectPath: associated.objectPath,
        fileUrl: associated.fileUrl,
        completedAt: now().toISOString(),
        physicalProofVerified: false,
        signatureIdentityVerified: false,
      });
      await tx.saveSession({ ...saved, completion });
      return completion;
    });
  };
  return { begin, read, put, complete };
}
