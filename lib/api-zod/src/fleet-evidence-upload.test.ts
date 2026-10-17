import { expect, it } from "vitest";
import {
  FleetEvidenceUploadSessionSchema,
  FleetEvidenceUploadStatusSchema,
  FLEET_EVIDENCE_PART_BYTES,
} from "./fleet-evidence-upload";
const id = (n: number) =>
    `55555555-5555-4555-8555-${String(n).padStart(12, "0")}`,
  at = "2026-10-16T18:00:00Z";
function session() {
  return {
    version: 2,
    id: id(1),
    operationId: id(2),
    scope: {
      owner: { type: "vendor", id: 7 },
      userId: 2,
      membershipId: 8,
      sessionVersion: 3,
      deviceId: id(3),
      provisioningId: id(4),
    },
    fingerprint: "a".repeat(64),
    localEvidenceId: id(5),
    canonicalEvidenceId: id(6),
    capturedAt: at,
    timeZone: "America/Chicago",
    createdAt: at,
    byteSize: 5,
    sha256: "b".repeat(64),
    contentType: "image/jpeg",
    partCount: 1,
    partSize: FLEET_EVIDENCE_PART_BYTES,
    binding: {
      kind: "compliance",
      recordId: id(7),
      subject: { kind: "driver", id: 2 },
      expectedRecordVersion: 0,
    },
    completion: null,
  };
}
it("keeps bounded file metadata distinct from raw bytes and physical or identity verification", () => {
  const original = session();
  expect(FleetEvidenceUploadSessionSchema.safeParse(original).success).toBe(
    true,
  );
  expect(
    FleetEvidenceUploadSessionSchema.safeParse({
      ...original,
      bodyBase64: "PRIVATE",
    }).success,
  ).toBe(false);
  expect(
    FleetEvidenceUploadSessionSchema.safeParse({
      ...original,
      byteSize: 10 * 1024 * 1024,
      partCount: 40,
    }).success,
  ).toBe(true);
  expect(
    FleetEvidenceUploadSessionSchema.safeParse({
      ...original,
      byteSize: 10 * 1024 * 1024 + 1,
      partCount: 41,
    }).success,
  ).toBe(false);
  expect(
    FleetEvidenceUploadSessionSchema.safeParse({ ...original, partCount: 2 })
      .success,
  ).toBe(false);
});
it("refuses contradictory completion and duplicate or impossible acknowledged parts", () => {
  const saved = session(),
    part = {
      partNumber: 0,
      sha256: "c".repeat(64),
      byteSize: 5,
      recordedAt: at,
    };
  expect(
    FleetEvidenceUploadStatusSchema.safeParse({
      session: saved,
      parts: [part],
      completion: null,
    }).success,
  ).toBe(true);
  expect(
    FleetEvidenceUploadStatusSchema.safeParse({
      session: saved,
      parts: [part, part],
      completion: null,
    }).success,
  ).toBe(false);
  expect(
    FleetEvidenceUploadStatusSchema.safeParse({
      session: saved,
      parts: [{ ...part, partNumber: 1 }],
      completion: null,
    }).success,
  ).toBe(false);
  expect(
    FleetEvidenceUploadStatusSchema.safeParse({
      session: saved,
      parts: [{ ...part, byteSize: 4 }],
      completion: null,
    }).success,
  ).toBe(false);
  const completion = {
    status: "complete",
    sessionId: saved.id,
    operationId: saved.operationId,
    evidenceId: saved.canonicalEvidenceId,
    byteSize: 5,
    sha256: saved.sha256,
    contentType: saved.contentType,
    objectPath: `/objects/fleet-compliance-private/7/${id(7)}/documents/${saved.sha256}`,
    fileUrl: null,
    completedAt: at,
    physicalProofVerified: false,
    signatureIdentityVerified: false,
  };
  expect(
    FleetEvidenceUploadStatusSchema.safeParse({
      session: saved,
      parts: [part],
      completion,
    }).success,
  ).toBe(false);
  expect(
    FleetEvidenceUploadStatusSchema.safeParse({
      session: { ...saved, completion },
      parts: [part],
      completion,
    }).success,
  ).toBe(true);
  expect(
    FleetEvidenceUploadSessionSchema.safeParse({
      ...saved,
      completion: { ...completion, physicalProofVerified: true },
    }).success,
  ).toBe(false);
});
