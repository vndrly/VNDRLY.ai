import { pool } from "@workspace/db";
import {
  FleetComplianceConfigurationSchema,
  type FleetComplianceIndexEntry,
} from "@workspace/api-zod";
import { notifyUsers } from "../routes/notifications";
/** Product reminder windows, not statutory grace periods or deletion dates. */
export function fleetComplianceReminderWindow(
  entry: FleetComplianceIndexEntry,
  at: Date,
): number | null {
  if (!entry.validUntil) return null;
  const days = Math.ceil(
    (Date.parse(entry.validUntil) - at.getTime()) / 86400000,
  );
  if (days < 0 || days > 60) return null;
  return [7, 14, 30, 60].find((value) => days <= value) ?? null;
}
export async function runFleetComplianceReminderScan(at = new Date()) {
  if (!Number.isFinite(at.getTime()))
    throw new Error("Valid reminder time required");
  let after = 0,
    scanned = 0,
    noticesCreated = 0;
  for (;;) {
    const rows = await pool.query(
      "SELECT id,fleet_compliance_configuration FROM vendors WHERE id>$1 AND fleet_compliance_configuration IS NOT NULL AND fleet_ops_state->>'enabled'='true' ORDER BY id LIMIT 100",
      [after],
    );
    if (!rows.rows.length) break;
    for (const vendor of rows.rows) {
      after = vendor.id;
      const config = FleetComplianceConfigurationSchema.safeParse(
        vendor.fleet_compliance_configuration,
      );
      if (!config.success) continue;
      for (const entry of config.data.entries) {
        scanned++;
        const window = fleetComplianceReminderWindow(entry, at);
        if (window === null) continue;
        const candidates = [
          ...new Set([
            ...config.data.reviewerUserIds,
            ...(entry.subject.kind === "driver" ? [entry.subject.id] : []),
          ]),
        ];
        if (!candidates.length) continue;
        const current = await pool.query(
          "SELECT DISTINCT m.user_id FROM user_org_memberships m JOIN users u ON u.id=m.user_id WHERE m.vendor_id=$1 AND m.org_type='vendor' AND m.user_id=ANY($2::int[]) AND u.suspended_at IS NULL AND (m.role IN ('admin','member') OR (m.role='field_employee' AND EXISTS(SELECT 1 FROM vendor_people p WHERE p.vendor_id=m.vendor_id AND p.user_id=m.user_id AND p.is_active=true AND p.deleted_at IS NULL)))",
          [vendor.id, candidates],
        );
        noticesCreated += await notifyUsers(
          current.rows.map((row) => Number(row.user_id)),
          {
            type: "fleet_compliance_due",
            category: "crew",
            title: "Fleet compliance renewal due",
            body: "A recorded requirement is nearing its expiry. Open Fleet compliance to review the current record.",
            link: "/fleet/compliance",
            dedupeKey: `fleet-compliance:${vendor.id}:${entry.id}:${entry.revision}:${window}`,
          },
        );
      }
    }
  }
  return { scanned, noticesCreated };
}
let timer: ReturnType<typeof setInterval> | undefined,
  startup: ReturnType<typeof setTimeout> | undefined,
  busy = false;
async function tick() {
  if (busy) return;
  busy = true;
  try {
    await runFleetComplianceReminderScan();
  } catch {
    /* Durable dedupe keys allow a later sweep to retry without blocking work. */
  } finally {
    busy = false;
  }
}
export function startFleetComplianceReminderWorker() {
  if (timer) return;
  startup = setTimeout(() => void tick(), 90000);
  startup.unref();
  timer = setInterval(() => void tick(), 6 * 60 * 60 * 1000);
  timer.unref();
}
export function stopFleetComplianceReminderWorker() {
  if (timer) clearInterval(timer);
  if (startup) clearTimeout(startup);
  timer = undefined;
  startup = undefined;
}
