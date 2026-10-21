import { createHash, createHmac } from "node:crypto";
import { FleetComplianceRecordSchema, fleetComplianceSubjectKey, type FleetComplianceIndexEntry } from "@workspace/api-zod";
import type { ObjectStore, StoredObject } from "../src/lib/objectStore";

/** Deployment-only recovery of the one deterministic CompanyGo fixture.
 * Never relax the API's private-source reader or regenerate evidence. */
export async function repairCompanyGoComplianceSource(
  companyId: number, entry: FleetComplianceIndexEntry,
  store: Pick<ObjectStore, "getObject" | "putObject">,
  legacyRead: (path: string) => Promise<StoredObject | null>, secret: string,
): Promise<string> {
  if (!secret) throw new Error("SESSION_SECRET required for CompanyGo compliance storage");
  const bytes = Buffer.from(createHash("sha256").update("companygo:fleet-mobile:compliance:driver-license").digest().subarray(0, 16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const h = bytes.toString("hex");
  const fixtureId = `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  if (entry.id !== fixtureId || entry.requirementId !== "companygo-driver-license") throw new Error("Not the CompanyGo synthetic compliance fixture");
  const prefix = `/objects/fleet-compliance-private/${companyId}/${entry.id}/${entry.revision}/`;
  if (!entry.objectPath.startsWith(prefix) || !/^[a-f0-9]{64}$/.test(entry.objectPath.slice(prefix.length))) throw new Error("Invalid CompanyGo private source path");
  const object = await store.getObject(entry.objectPath) ?? await legacyRead(entry.objectPath);
  if (!object || object.acl?.purpose !== "fleet-compliance-private" || object.acl.visibility !== "private" || object.acl.owner !== `fleet-compliance:${companyId}`) throw new Error("CompanyGo private source unavailable");
  const record = FleetComplianceRecordSchema.parse(JSON.parse(object.body.toString("utf8")));
  if (record.evidence.id !== entry.id || record.evidence.revision !== entry.revision || fleetComplianceSubjectKey(record.evidence.subject) !== fleetComplianceSubjectKey(entry.subject) || record.evidence.requirementId !== "companygo-driver-license" || record.evidence.source !== "CompanyGo synthetic qualification record" || record.attributes.kind !== "driver_license" || record.attributes.licenseNumber !== "COMPANYGO-SYNTHETIC") throw new Error("CompanyGo private source identity changed");
  const body = Buffer.from(JSON.stringify(record));
  const pathFor = (key: string) => prefix + createHmac("sha256", key).update(body).digest("hex");
  const canonicalPath = pathFor(secret);
  if (entry.objectPath !== canonicalPath && entry.objectPath !== pathFor("dev-session-secret")) throw new Error("CompanyGo private source integrity changed");
  // Copy first; the caller changes the DB pointer transactionally only after
  // readback. Keep the original object and every evidence field unchanged.
  if (canonicalPath !== entry.objectPath || !await store.getObject(canonicalPath)) {
    await store.putObject(canonicalPath, "application/json", body, object.acl);
  }
  const saved = await store.getObject(canonicalPath);
  if (!saved || !saved.body.equals(body) || saved.acl?.owner !== object.acl.owner || saved.acl.visibility !== "private" || saved.acl.purpose !== "fleet-compliance-private") throw new Error("CompanyGo private source readback failed");
  return canonicalPath;
}
