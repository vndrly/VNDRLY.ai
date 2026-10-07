import type { PoolClient } from "pg";
import type { FleetRun } from "@workspace/api-zod";
import type { FleetState } from "./fleet-repository";
import { ACTIVE_APPROVAL_STATUSES } from "@workspace/db";
import { notifyUsers } from "../routes/notifications";
const eventNames: Record<string, string> = {
  dispatch: "dispatched",
  reassign: "assignment changed",
  cancel: "cancelled",
  acknowledge: "acknowledged",
  start: "started",
  submit_closeout: "submitted for review",
  review: "reviewed",
};
export type FleetRunNotice = {
  userIds: number[];
  runId: string;
  companyId: number;
  operationId: string;
  action: string;
  title: string;
};
export async function fleetRunNotificationRecipients(
  state: FleetState,
  client: PoolClient,
  run: FleetRun,
  action: string,
  operationId: string,
  actorUserId: number,
): Promise<FleetRunNotice | undefined> {
  if (!eventNames[action] || !state.enabled) return;
  const siteResult = await client.query(
    "SELECT s.id FROM site_locations s JOIN partner_vendor_relationships r ON r.partner_id=s.partner_id WHERE r.vendor_id=$1 AND s.id=ANY($2::int[]) AND r.status=ANY($3::text[]) AND COALESCE(s.hidden,false)=false",
    [run.companyId, run.siteIds, [...ACTIVE_APPROVAL_STATUSES]],
  );
  if (!run.siteIds.every((id) => siteResult.rows.some((row) => row.id === id)))
    return;
  const candidates = state.grants
    .filter(
      (grant) =>
        grant.fleetIds.includes(run.fleetId) &&
        run.siteIds.every((id) => grant.siteIds.includes(id)) &&
        grant.roles.length &&
        (grant.roles.includes("fleet_manager") ||
          grant.roles.includes("dispatcher") ||
          (grant.roles.includes("driver") &&
            run.driverUserId === grant.userId)),
    )
    .map((grant) => grant.userId)
    .filter((id) => id !== actorUserId);
  if (!candidates.length) return;
  const people = await client.query(
    "SELECT DISTINCT m.user_id FROM user_org_memberships m JOIN users u ON u.id=m.user_id WHERE m.org_type='vendor' AND m.vendor_id=$1 AND m.user_id=ANY($2::int[]) AND u.suspended_at IS NULL AND (m.role IN ('admin','member') OR (m.role='field_employee' AND EXISTS(SELECT 1 FROM vendor_people p WHERE p.vendor_id=m.vendor_id AND p.user_id=m.user_id AND p.is_active=true AND p.deleted_at IS NULL)))",
    [run.companyId, candidates],
  );
  const userIds = people.rows
    .map((row) => Number(row.user_id))
    .filter((id) => candidates.includes(id));
  return userIds.length
    ? {
        userIds,
        runId: run.id,
        companyId: run.companyId,
        operationId,
        action,
        title: `Fleet run ${eventNames[action]}`,
      }
    : undefined;
}
/** Called only after the canonical transaction commits. Existing preferences, SSE/push and dedupe remain authoritative. */
export async function emitFleetRunNotification(notice: FleetRunNotice) {
  try {
    return await notifyUsers(notice.userIds, {
      type: "fleet_run_event",
      category: "crew",
      title: notice.title,
      body: "Open the saved run to review its current assignment and recorded status.",
      link: `/fleet/runs/${notice.runId}`,
      dedupeKey: `fleet:${notice.companyId}:${notice.operationId}`,
      pushData: {
        runId: notice.runId,
        companyId: notice.companyId,
        source: "fleet_run_event",
      },
    });
  } catch {
    return 0;
  } // Delivery failure cannot roll back or misrepresent an already committed run event.
}
