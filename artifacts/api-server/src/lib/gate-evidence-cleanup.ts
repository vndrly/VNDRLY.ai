import { db, siteVisitsTable } from "@workspace/db";
import { inArray, isNotNull, or } from "drizzle-orm";
import { logger } from "./logger";
import { ObjectStorageService } from "./objectStorage";
import {purgeExpiredGateIdentityImages} from "../services/gate-identity";

const DEFAULT_INTERVAL_MS = 6 * 60 * 60 * 1000;
const DEFAULT_RETENTION_MS = 24 * 60 * 60 * 1000;
let intervalHandle: NodeJS.Timeout | null = null;

export async function cleanupUnattachedGateEvidence(now = new Date()): Promise<number> {
  await purgeExpiredGateIdentityImages(now);
  const storage = new ObjectStorageService();
  const visitEvidence = await db
    .select({ plate: siteVisitsTable.platePhotoUrl, vehicle: siteVisitsTable.vehiclePhotoUrl })
    .from(siteVisitsTable)
    .where(or(isNotNull(siteVisitsTable.platePhotoUrl), isNotNull(siteVisitsTable.vehiclePhotoUrl)));
  const referencedPaths = new Set<string>();
  for (const row of visitEvidence) {
    if (row.plate) referencedPaths.add(row.plate);
    if (row.vehicle) referencedPaths.add(row.vehicle);
  }
  for (const path of referencedPaths) {
    if (!/^\/objects\/uploads\/[0-9a-f-]{36}$/i.test(path)) continue;
    const acl = await storage.getStoredObjectAcl(path).catch(() => null);
    if (!acl?.owner) continue;
    if (acl.visibility !== "private" || acl.purpose !== "gate-evidence") {
      await storage.trySetObjectEntityAclPolicy(path, {
        owner: acl.owner,
        visibility: "private",
        purpose: "gate-evidence",
      });
    }
  }
  const cutoff = new Date(now.getTime() - DEFAULT_RETENTION_MS);
  const olderUploads = await storage.listUploadsOlderThan(cutoff);
  const candidates: string[] = [];
  for (const path of olderUploads) {
    const acl = await storage.getStoredObjectAcl(path).catch(() => null);
    if (acl?.purpose === "gate-evidence") candidates.push(path);
  }
  if (!candidates.length) return 0;
  const referenced = new Set<string>();
  for (let start = 0; start < candidates.length; start += 500) {
    const batch = candidates.slice(start, start + 500);
    const rows = await db
      .select({ plate: siteVisitsTable.platePhotoUrl, vehicle: siteVisitsTable.vehiclePhotoUrl })
      .from(siteVisitsTable)
      .where(or(inArray(siteVisitsTable.platePhotoUrl, batch), inArray(siteVisitsTable.vehiclePhotoUrl, batch)));
    for (const row of rows) {
      if (row.plate) referenced.add(row.plate);
      if (row.vehicle) referenced.add(row.vehicle);
    }
  }
  let removed = 0;
  for (const path of candidates) {
    if (referenced.has(path)) continue;
    await storage.deleteStoredObject(path);
    removed += 1;
  }
  return removed;
}

export function startGateEvidenceCleanupWorker(intervalMs = DEFAULT_INTERVAL_MS): void {
  if (intervalHandle) return;
  const run = () => void cleanupUnattachedGateEvidence()
    .then((removed) => { if (removed) logger.info({ removed }, "Removed unattached gate evidence"); })
    .catch((err) => logger.error({ err }, "Gate evidence cleanup failed"));
  intervalHandle = setInterval(run, intervalMs);
  intervalHandle.unref?.();
  run();
}

export function stopGateEvidenceCleanupWorker(): void {
  if (intervalHandle) clearInterval(intervalHandle);
  intervalHandle = null;
}
