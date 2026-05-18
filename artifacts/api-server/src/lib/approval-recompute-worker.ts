// Task #1156 — periodic re-derivation of partner-vendor approval
// status. Catches lapses that aren't tied to an explicit mutation:
//
//   - A COI/WC/GL/auto-liability expiration date silently rolls into
//     "today is past it" because nobody touched the vendor row.
//   - A vendor with no qualified employees (everyone deleted /
//     deactivated) sat in "approved" for some time before the system
//     noticed.
//
// Cadence: every 6 hours, mirroring the certification-reminder worker.
// Best-effort throughout; one failed pair logs a warning and the run
// continues.

import { eq } from "drizzle-orm";
import { db, partnerVendorRelationshipsTable } from "@workspace/db";
import { logger } from "./logger";
import { recomputeApproval } from "./approval-derivation";

const DEFAULT_INTERVAL_MS = 6 * 60 * 60 * 1000;

let intervalHandle: NodeJS.Timeout | null = null;
let firstTickHandle: NodeJS.Timeout | null = null;

export interface ApprovalRecomputeScanResult {
  scanned: number;
  flipped: number;
  failed: number;
}

/**
 * Re-derive every existing partner-vendor relationship row. Returns a
 * scan result for observability. Designed to be invoked from tests or
 * an admin trigger as well as the cron.
 */
export async function runApprovalRecomputeScan(): Promise<ApprovalRecomputeScanResult> {
  const result: ApprovalRecomputeScanResult = {
    scanned: 0,
    flipped: 0,
    failed: 0,
  };
  const rels = await db
    .select({
      partnerId: partnerVendorRelationshipsTable.partnerId,
      vendorId: partnerVendorRelationshipsTable.vendorId,
    })
    .from(partnerVendorRelationshipsTable);
  result.scanned = rels.length;
  for (const r of rels) {
    try {
      const res = await recomputeApproval(r.partnerId, r.vendorId, {
        triggerReason: "system_recompute",
      });
      if (res?.changed) result.flipped += 1;
    } catch (err) {
      result.failed += 1;
      logger.warn(
        { err, partnerId: r.partnerId, vendorId: r.vendorId },
        "Approval recompute (cron) failed",
      );
    }
  }
  return result;
}

export function startApprovalRecomputeWorker(
  intervalMs = DEFAULT_INTERVAL_MS,
): void {
  if (intervalHandle) return;
  // Defer first scan a bit so server boot doesn't block on a long
  // recompute pass.
  firstTickHandle = setTimeout(
    () => {
      firstTickHandle = null;
      void runOnce("startup");
    },
    2 * 60 * 1000,
  );
  intervalHandle = setInterval(() => {
    void runOnce("interval");
  }, intervalMs);
  logger.info({ intervalMs }, "Approval-recompute worker started");
}

export function stopApprovalRecomputeWorker(): void {
  if (firstTickHandle) {
    clearTimeout(firstTickHandle);
    firstTickHandle = null;
  }
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
  // Suppress unused-imports lint for `eq` when this file is split
  // further; today the helper is referenced via the dependency on
  // `partnerVendorRelationshipsTable` only.
  void eq;
}

async function runOnce(trigger: "startup" | "interval"): Promise<void> {
  const start = Date.now();
  try {
    const r = await runApprovalRecomputeScan();
    if (r.scanned > 0) {
      logger.info(
        {
          trigger,
          ms: Date.now() - start,
          ...r,
        },
        "Approval-recompute scan complete",
      );
    }
  } catch (err) {
    logger.error({ err, trigger }, "Approval-recompute scan crashed");
  }
}
