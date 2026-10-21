import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { FleetComplianceRecordSchema } from "@workspace/api-zod";
import { repairCompanyGoComplianceSource } from "../../scripts/companygo-compliance-repair";
import { stableCompanyGoUuid } from "../../scripts/seed-companygo-fleet-workflows";

const companyId = 17;
const record = FleetComplianceRecordSchema.parse({
  evidence: { id: stableCompanyGoUuid("compliance:driver-license"), revision: 1, subject: { kind: "driver", id: 9 }, requirementId: "companygo-driver-license", requirementVersion: 1, status: "reviewed", validFrom: "2025-10-20T16:00:00Z", validUntil: "2027-10-20T16:00:00Z", verifiedAt: "2026-10-20T16:00:00Z", verifiedByUserId: 8, source: "CompanyGo synthetic qualification record", privateDocumentRef: null, restrictions: {} },
  attributes: { kind: "driver_license", issuingState: "OK", licenseNumber: "COMPANYGO-SYNTHETIC", licenseClass: "A", endorsements: ["N"], restrictions: [], licenseStatus: "active", sourceRecordId: null },
  retentionClass: "qualification", retainUntil: null, legalHold: false,
});
const digest = (secret: string) => createHmac("sha256", secret).update(JSON.stringify(record)).digest("hex");
const objectPath = `/objects/fleet-compliance-private/${companyId}/${record.evidence.id}/1/${digest("dev-session-secret")}`;
const entry = { ...record.evidence, attributeKind: "driver_license", objectPath, updatedAt: "2026-10-20T16:00:00Z" };
const object = { body: Buffer.from(JSON.stringify(record)), acl: { owner: `fleet-compliance:${companyId}`, visibility: "private", purpose: "fleet-compliance-private" } };

describe("CompanyGo compliance private-source repair", () => {
  it("moves the exact legacy synthetic source into canonical storage and signing without changing evidence", async () => {
    const stored = new Map<string, any>();
    const store = { getObject: async (path: string) => stored.get(path) ?? null, putObject: async (path: string, type: string, body: Buffer, acl: unknown) => { stored.set(path, { body, acl }); } };
    const repaired = await repairCompanyGoComplianceSource(companyId, entry as any, store, async () => object as any, "production-test-secret");
    expect(repaired).toBe(`/objects/fleet-compliance-private/${companyId}/${record.evidence.id}/1/${digest("production-test-secret")}`);
    expect(JSON.parse(stored.get(repaired).body.toString())).toEqual(record);
    expect(stored.get(repaired).acl).toEqual(object.acl);
    expect(await repairCompanyGoComplianceSource(companyId, { ...entry, objectPath: repaired } as any, store, async () => { throw new Error("must not reload legacy source"); }, "production-test-secret")).toBe(repaired);
    expect(stored.size).toBe(1);
  });
  it("refuses tampered bytes, unrelated records, and missing production signing configuration", async () => {
    let writes = 0;
    const store = { getObject: async () => null, putObject: async () => { writes++; } };
    await expect(repairCompanyGoComplianceSource(companyId, entry as any, store, async () => ({ ...object, body: Buffer.from(JSON.stringify({ ...record, legalHold: true })) }) as any, "production-test-secret")).rejects.toThrow();
    await expect(repairCompanyGoComplianceSource(companyId, { ...entry, id: "11111111-1111-4111-8111-111111111111" } as any, store, async () => object as any, "production-test-secret")).rejects.toThrow();
    await expect(repairCompanyGoComplianceSource(companyId, entry as any, store, async () => object as any, "")).rejects.toThrow();
    expect(writes).toBe(0);
  });
});
