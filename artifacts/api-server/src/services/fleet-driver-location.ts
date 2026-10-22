import { FleetDriverLocationSchema, FleetLocationObservationSchema } from "@workspace/api-zod";
import { pool } from "@workspace/db";
import type { FleetActor } from "./fleet-ops";
import { resolveFleetCapabilities } from "./fleet-mobile-permissions";
import { FleetError } from "./fleet-repository";

/** Returns one privacy-scoped driver-phone observation for the Driver page.
 * Managers may inspect company drivers; a driver may inspect only themselves. */
export async function readFleetDriverLocation(actor: FleetActor, driverUserId: number) {
  const capabilities = await resolveFleetCapabilities(actor, actor.companyId);
  const isSelf = actor.userId === driverUserId && capabilities.has("driver");
  const isManager = capabilities.has("admin") || capabilities.has("office") || capabilities.has("dispatch");
  if (!isSelf && !isManager) throw new FleetError("fleet.permission_denied", 403);

  const target = await pool.query(
    `SELECT 1 FROM user_org_memberships m JOIN users u ON u.id=m.user_id JOIN vendors v ON v.id=m.vendor_id
      WHERE m.user_id=$1 AND m.vendor_id=$2 AND m.org_type='vendor' AND u.suspended_at IS NULL
        AND COALESCE((v.fleet_ops_state->>'enabled')::boolean,false)
        AND EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(v.fleet_ops_state->'grants','[]'::jsonb)) grant
                     WHERE (grant->>'userId')::int=$1 AND grant->'roles' ? 'driver') LIMIT 1`,
    [driverUserId, actor.companyId],
  );
  if (!target.rows.length) throw new FleetError("fleet.not_found", 404);

  const shift = await pool.query(
    `SELECT tool_output->'summary'->>'state' AS state
       FROM (SELECT DISTINCT ON(target_id) target_id,tool_output,id
               FROM assistant_action_audit
              WHERE vendor_id=$1 AND partner_id IS NULL AND target_type='workday'
                AND tool_output->>'workerUserId'=$2
              ORDER BY target_id,id DESC) latest
      WHERE tool_output->'summary'->>'endedAt' IS NULL
      ORDER BY id DESC LIMIT 1`,
    [actor.companyId, String(driverUserId)],
  );
  const rawShift = shift.rows[0]?.state;
  const shiftState = rawShift === "on_shift" ? "on_shift" : rawShift === "on_break" ? "on_break" : "off_shift";

  const latest = await pool.query(
    `SELECT a.tool_output->'observation' AS observation
       FROM assistant_action_audit a
      WHERE a.vendor_id=$1 AND a.partner_id IS NULL AND a.target_type='fleet-location'
        AND a.tool_output->'observation'->>'driverUserId'=$2
        AND EXISTS (SELECT 1 FROM location_consents c
                     WHERE c.user_id=$2::int AND c.device_id=a.tool_output->>'deviceId'
                       AND c.revoked_at IS NULL)
      ORDER BY (a.tool_output->'observation'->>'recordedAt')::timestamptz DESC,a.id DESC
      LIMIT 1`,
    [actor.companyId, String(driverUserId)],
  );
  const location = latest.rows.length ? FleetLocationObservationSchema.parse(latest.rows[0].observation) : null;
  return FleetDriverLocationSchema.parse({
    driverUserId,
    onShift: shiftState === "on_shift",
    shiftState,
    location,
    generatedAt: new Date().toISOString(),
  });
}
