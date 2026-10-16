import { expect, it } from "vitest";
import * as contracts from "./index";
import type { ZodType } from "zod/v4";

it("requires verification provenance and rejects raw document payloads", () => {
  const schema = (contracts as unknown as Record<string, ZodType>)["FleetComplianceEvidenceSchema"];
  expect(schema).toBeDefined();
  const value = { id: "22222222-2222-4222-8222-222222222222", revision: 1, subject: { kind: "driver", id: 42 }, requirementId: "cdl", requirementVersion: 1, status: "verified", validFrom: "2026-01-01T00:00:00Z", validUntil: "2027-01-01T00:00:00Z", verifiedAt: null, verifiedByUserId: null, source: "Uploaded", privateDocumentRef: null, restrictions: {} };
  expect(schema.safeParse(value).success).toBe(false);
  expect(schema.safeParse({ ...value, verifiedAt: "2026-01-01T00:00:00Z", verifiedByUserId: 7, laboratoryResult: "private" }).success).toBe(false);
});
