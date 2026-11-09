import { randomBytes } from "node:crypto";
import type { PoolClient } from "pg";
import { pool } from "@workspace/db";
import type {
  GateStaffingAlert,
  GateStaffingAlertsResponse,
} from "@workspace/gate-booth";
import type { SessionPayload } from "../lib/session";
import {
  NOTIFICATION_COMPANY_HOLDS,
  pausedNotificationUserIds,
} from "../lib/notification-company-hold";
import { logger } from "../lib/logger";
import {
  ChangeOverError,
  changeOverTransaction,
  requireChangeOverAccess,
  requireGateStationManagementAccess,
} from "./gate-change-over";
import type { GateCoverageNotice } from "./gate-coverage-monitor";

export type {
  GateStaffingAlert,
  GateStaffingAlertsResponse,
} from "@workspace/gate-booth";
export type GateStaffingAcknowledgmentChannel = "web" | "ios" | "push" | "sms";
type QueryClient = Pick<PoolClient, "query">;
type StaffingStateChange = {
  userId: number;
  notificationId: number;
  state: "acknowledged" | "resolved";
  changedAt: string;
};
type Scope = {
  session: SessionPayload;
  type: "vendor" | "partner" | null;
  id: number | null;
  admin: boolean;
  name: string;
};
type AlertRow = Record<string, any> & {
  id: string;
  shift_id: string;
  station_id: string;
  site_id: number;
  owner_org_type: string;
  owner_org_id: number;
};
const TEN_MINUTES = 10 * 60_000;
const staffingTypes = new Set([
  "gate_watch_radar",
  "gate_coverage_uncovered",
  "gate_coverage_understaffed",
  "gate_coverage_unconfirmed",
]);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fail = (status: number, code: string, message: string): never => {
  throw new ChangeOverError(status, `staffing_alert.${code}`, message);
};
const companyPaused = (type: string, id: number) =>
  type === "vendor" &&
  NOTIFICATION_COMPANY_HOLDS.some((hold) => hold.vendorId === id);
const iso = (value: Date | string | null | undefined) =>
  value == null ? null : new Date(value).toISOString();

async function mappedStateChanges(
  client: QueryClient,
  alertId: string,
  state: StaffingStateChange["state"],
  changedAt: string,
): Promise<StaffingStateChange[]> {
  const rows = (
    await client.query(
      `SELECT mapping.user_id AS "userId",mapping.notification_id AS "notificationId"
    FROM gate_staffing_alert_notifications mapping JOIN notifications n ON n.id=mapping.notification_id AND n.user_id=mapping.user_id
    WHERE mapping.alert_id=$1 ORDER BY mapping.notification_id`,
      [alertId],
    )
  ).rows;
  return rows.map((row) => ({ ...row, state, changedAt }));
}

/** Called only after commit; realtime outages never invalidate saved responsibility or custody. */
async function publishStateChanges(
  changes: StaffingStateChange[],
): Promise<void> {
  if (!changes.length) return;
  try {
    const { publishNotificationStateChanged } =
      await import("../lib/notification-events");
    for (const change of changes) {
      try {
        await publishNotificationStateChanged(change);
      } catch {
        logger.warn(
          { notificationId: change.notificationId },
          "Committed staffing state event could not be published",
        );
      }
    }
  } catch {
    logger.warn("Committed staffing state events are unavailable");
  }
}

// Joins also invalidate stale links after a shift changes company, site, or Gate.
const historicalAlertSelect = `SELECT a.*,s.title,s.starts_at,s.ends_at,s.timezone,coalesce(s.required_staff_count,1) AS current_required_count,
  site.name AS site_name,g.name AS gate_name,
  (s.owner_org_type=a.owner_org_type AND s.owner_org_id=a.owner_org_id
    AND s.gate_station_id=a.station_id AND g.site_id=a.site_id) AS context_current
  FROM gate_staffing_alerts a
  JOIN work_hub_shifts s ON s.id=a.shift_id
  JOIN gate_stations g ON g.id=a.station_id
  JOIN site_locations site ON site.id=a.site_id`;
const alertSelect = `SELECT a.*,s.title,s.starts_at,s.ends_at,s.timezone,coalesce(s.required_staff_count,1) AS current_required_count,
  site.name AS site_name,g.name AS gate_name
  FROM gate_staffing_alerts a
  JOIN work_hub_shifts s ON s.id=a.shift_id AND s.owner_org_type=a.owner_org_type
    AND s.owner_org_id=a.owner_org_id AND s.gate_station_id=a.station_id
  JOIN gate_stations g ON g.id=a.station_id AND g.site_id=a.site_id
  JOIN site_locations site ON site.id=a.site_id`;
const coverageIsPaused = `EXISTS(SELECT 1 FROM gate_coverage_status coverage_status
  WHERE coverage_status.station_id=a.station_id AND (coverage_status.mode IN ('closed','paused_indefinitely')
    OR (coverage_status.mode='paused_until' AND coverage_status.paused_until>now())))`;

/** Signed claims select a context; the current saved account and membership grant authority. */
async function currentScope(
  client: QueryClient,
  session: SessionPayload,
  lock = false,
): Promise<Scope> {
  if (!session.userId) return fail(401, "sign_in_required", "Sign in required");
  const user = (
    await client.query(
      `SELECT id,role,display_name,session_version,suspended_at,active_membership_id FROM users WHERE id=$1${lock ? " FOR SHARE" : ""}`,
      [session.userId],
    )
  ).rows[0];
  if (!user || user.suspended_at || user.session_version !== session.sv)
    return fail(401, "session_changed", "Sign in again to continue");
  if (
    session.role === "admin" &&
    user.role === "admin" &&
    user.active_membership_id == null &&
    session.activeMembershipId == null
  )
    return {
      session,
      type: null,
      id: null,
      admin: false,
      name: user.display_name,
    };
  if (
    !session.activeMembershipId ||
    user.active_membership_id !== session.activeMembershipId
  )
    return fail(
      401,
      "company_changed",
      "Return to your current company and retry",
    );
  const member = (
    await client.query(
      `SELECT id,org_type,vendor_id,partner_id,role,vendor_people_id FROM user_org_memberships WHERE id=$1 AND user_id=$2${lock ? " FOR SHARE" : ""}`,
      [session.activeMembershipId, session.userId],
    )
  ).rows[0];
  const type = member?.org_type;
  const id = type === "vendor" ? member?.vendor_id : member?.partner_id;
  const portalRole =
    member?.role === "field_employee" ? "field_employee" : type;
  if (
    !["vendor", "partner"].includes(type) ||
    !id ||
    session.role !== portalRole ||
    (type === "vendor"
      ? session.vendorId !== id || session.partnerId != null
      : session.partnerId !== id || session.vendorId != null)
  )
    return fail(
      403,
      "membership_required",
      "Current company membership required",
    );
  return {
    session: {
      ...session,
      membershipRole: member.role,
      vendorPeopleId: member.vendor_people_id,
    },
    type,
    id,
    admin: member.role === "admin",
    name: user.display_name,
  };
}

async function recipientScope(
  client: QueryClient,
  userId: number,
): Promise<Scope | null> {
  const row = (
    await client.query(
      `SELECT u.id,u.role AS user_role,u.session_version,m.id AS membership_id,
    m.org_type,m.vendor_id,m.partner_id,m.role,m.vendor_people_id,p.vendor_role
    FROM users u LEFT JOIN user_org_memberships m ON m.id=u.active_membership_id AND m.user_id=u.id
    LEFT JOIN vendor_people p ON p.id=m.vendor_people_id AND p.user_id=u.id AND p.vendor_id=m.vendor_id AND p.is_active=true AND p.deleted_at IS NULL
    WHERE u.id=$1 AND u.suspended_at IS NULL`,
      [userId],
    )
  ).rows[0];
  if (!row) return null;
  const session: SessionPayload = {
    userId,
    sv: row.session_version,
    role: row.membership_id
      ? row.role === "field_employee"
        ? "field_employee"
        : row.org_type
      : row.user_role,
    activeMembershipId: row.membership_id ?? null,
    vendorId: row.vendor_id ?? null,
    partnerId: row.partner_id ?? null,
    membershipRole: row.role,
    vendorPeopleId: row.vendor_people_id,
    vendorRole: row.vendor_role,
  };
  // Managed workers must retain their current site grants, even when no employee record exists.
  if (
    row.org_type === "vendor" &&
    row.role === "field_employee" &&
    !row.vendor_people_id
  ) {
    const grants = (
      await client.query(
        `SELECT g.site_id AS "siteId",g.role FROM managed_subcontractor_role_grants g
      JOIN managed_subcontractor_worker_sponsorships w ON w.id=g.sponsorship_id
      WHERE w.worker_user_id=$1 AND w.sponsor_vendor_id=$2 AND w.status='active' AND w.ended_at IS NULL
        AND g.status='active' AND g.ended_at IS NULL AND g.site_id IS NOT NULL AND g.role IN ('gatekeeper','gate_supervisor')`,
        [userId, row.vendor_id],
      )
    ).rows;
    session.managedSubcontractor = { siteGrants: grants };
  }
  try {
    return await currentScope(client, session);
  } catch (error) {
    if (error instanceof ChangeOverError) return null;
    throw error;
  }
}

async function canView(
  client: QueryClient,
  scope: Scope,
  row: AlertRow,
): Promise<boolean> {
  if (row.context_current === false) return false;
  if (
    scope.type &&
    (scope.type !== row.owner_org_type || scope.id !== Number(row.owner_org_id))
  )
    return false;
  try {
    try {
      await requireChangeOverAccess(client, scope.session, Number(row.site_id));
    } catch (error) {
      if (!(error instanceof ChangeOverError) || error.status !== 403)
        throw error;
      await requireGateStationManagementAccess(
        client,
        scope.session,
        Number(row.site_id),
      );
    }
    return true;
  } catch (error) {
    if (error instanceof ChangeOverError && [401, 403].includes(error.status))
      return false;
    throw error;
  }
}

function dto(
  row: AlertRow,
  options: { scope?: Scope | null; paused?: boolean } = {},
): GateStaffingAlert {
  const timezone = row.timezone || "UTC";
  const local = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(row.starts_at));
  const date = ["year", "month", "day"]
    .map((part) => local.find((value) => value.type === part)!.value)
    .join("-");
  const params = new URLSearchParams({
    siteId: String(row.site_id),
    stationId: row.station_id,
    shiftId: row.shift_id,
    date,
  });
  const paused = Boolean(
    options.paused ||
    row.notifications_paused ||
    companyPaused(row.owner_org_type, Number(row.owner_org_id)),
  );
  return {
    id: row.id,
    code: row.code,
    status: row.status,
    severity: row.severity,
    kind: row.kind,
    siteId: Number(row.site_id),
    stationId: row.station_id,
    shiftId: row.shift_id,
    siteName: row.site_name,
    gateName: row.gate_name,
    title: row.title,
    startsAt: iso(row.starts_at)!,
    endsAt: iso(row.ends_at)!,
    timezone,
    requiredCount: Number(row.required_count),
    actualCount: Number(row.actual_count),
    acknowledgedAt: iso(row.acknowledged_at),
    acknowledgedBy: row.acknowledged_by_user_id
      ? {
          userId: Number(row.acknowledged_by_user_id),
          name: row.acknowledged_by_name ?? "Administrator",
        }
      : null,
    resolvedAt: iso(row.resolved_at),
    createdAt: iso(row.created_at)!,
    escalatedAt: iso(row.escalated_at),
    href: `/work-hub/calendar?${params}`,
    canAcknowledge: Boolean(
      options.scope?.admin &&
      options.scope.type === row.owner_org_type &&
      options.scope.id === Number(row.owner_org_id) &&
      !options.scope.session.publicDemo &&
      options.scope.session.realm !== "demo" &&
      row.status === "open",
    ),
    notificationsPaused: paused,
  };
}

export async function listGateStaffingAlerts(
  session: SessionPayload,
): Promise<GateStaffingAlertsResponse> {
  const scope = await currentScope(pool, session);
  const paused =
    (await pausedNotificationUserIds([session.userId!])).has(session.userId!) ||
    Boolean(scope.type && companyPaused(scope.type, scope.id!));
  const rows = (
    await pool.query(
      `${alertSelect} WHERE a.resolved_at IS NULL AND s.ends_at>now() AND s.milestone_status<>'cancelled' AND NOT ${coverageIsPaused}
    AND ($1::text IS NULL OR (a.owner_org_type=$1 AND a.owner_org_id=$2)) ORDER BY a.created_at,a.id`,
      [scope.type, scope.id],
    )
  ).rows as AlertRow[];
  const alerts: GateStaffingAlert[] = [];
  for (const row of rows)
    if (await canView(pool, scope, row))
      alerts.push(dto(row, { scope, paused }));
  return { alerts, notificationsPaused: paused };
}

/** Must run inside the same transaction as acknowledgment or coverage resolution. */
export async function cancelStaffingAlertDeliveries(
  client: QueryClient,
  alertId: string,
): Promise<void> {
  await client.query(
    `UPDATE notifications n SET urgent_delivery_pending=false,urgent_delivery_lease=NULL,urgent_delivery_leased_until=NULL,
    next_delivery_attempt_at=NULL,acknowledgement_due_at=NULL,
    delivery_status=CASE WHEN n.delivery_status IN ('pending','retrying','retryable') THEN 'cancelled' ELSE n.delivery_status END,
    acknowledged_at=COALESCE(n.acknowledged_at,a.acknowledged_at),acknowledged_by_user_id=COALESCE(n.acknowledged_by_user_id,a.acknowledged_by_user_id)
    FROM gate_staffing_alert_notifications mapping JOIN gate_staffing_alerts a ON a.id=mapping.alert_id
    WHERE mapping.alert_id=$1 AND n.id=mapping.notification_id`,
    [alertId],
  );
  await client.query(
    `UPDATE notification_channel_deliveries d SET status='cancelled',next_attempt_at=NULL,last_error_code='staffing_incident_stopped',updated_at=now()
    FROM gate_staffing_alert_notifications mapping WHERE mapping.alert_id=$1 AND d.notification_id=mapping.notification_id AND d.status='retryable'`,
    [alertId],
  );
}

export async function acknowledgeGateStaffingAlert(
  session: SessionPayload,
  id: string,
  channel: GateStaffingAcknowledgmentChannel,
  beforeAcknowledge?: (client: QueryClient) => Promise<void>,
): Promise<GateStaffingAlert> {
  if (!uuid.test(id)) return fail(404, "not_found", "Staffing alert not found");
  if (!["web", "ios", "push", "sms"].includes(channel))
    return fail(
      400,
      "invalid_channel",
      "Choose a supported acknowledgment channel",
    );
  const changes: StaffingStateChange[] = [];
  const alert = await changeOverTransaction(async (client) => {
    changes.length = 0;
    const scope = await currentScope(client, session, true);
    if (session.publicDemo || session.realm === "demo")
      return fail(403, "read_only", "Demo access is read only");
    await beforeAcknowledge?.(client);
    let row = (
      await client.query(`${alertSelect} WHERE a.id=$1 FOR UPDATE OF a`, [id])
    ).rows[0] as AlertRow | undefined;
    if (!row) return fail(404, "not_found", "Staffing alert not found");
    if (
      !scope.admin ||
      scope.type !== row.owner_org_type ||
      scope.id !== Number(row.owner_org_id) ||
      !(await canView(client, scope, row))
    )
      return fail(
        403,
        "admin_required",
        "A current administrator of the owning company must acknowledge this alert",
      );
    const firstAcknowledgment = row.status === "open";
    if (firstAcknowledgment) {
      await client.query(
        `UPDATE gate_staffing_alerts SET status='acknowledged',acknowledged_at=now(),acknowledged_by_user_id=$2,
        acknowledged_by_name=$3,acknowledged_channel=$4,updated_at=now() WHERE id=$1 AND status='open'`,
        [id, session.userId, scope.name, channel],
      );
      row = (await client.query(`${alertSelect} WHERE a.id=$1`, [id]))
        .rows[0] as AlertRow;
    }
    await cancelStaffingAlertDeliveries(client, id);
    const paused = (
      await pausedNotificationUserIds([session.userId!], client)
    ).has(session.userId!);
    if (firstAcknowledgment)
      changes.push(
        ...(await mappedStateChanges(
          client,
          id,
          "acknowledged",
          iso(row.acknowledged_at)!,
        )),
      );
    return dto(row, { scope, paused });
  });
  await publishStateChanges(changes);
  return alert;
}

export async function staffingAlertForNotification(
  notificationId: number,
  userId?: number,
): Promise<GateStaffingAlert | null> {
  const row = (
    await pool.query(
      `${historicalAlertSelect} JOIN gate_staffing_alert_notifications mapping ON mapping.alert_id=a.id
    JOIN notifications n ON n.id=mapping.notification_id AND n.user_id=mapping.user_id
    WHERE mapping.notification_id=$1 AND ($2::int IS NULL OR n.user_id=$2)`,
      [notificationId, userId ?? null],
    )
  ).rows[0] as AlertRow | undefined;
  if (!row) return null;
  const scope = userId ? await recipientScope(pool, userId) : null;
  // Ownership lookup is still available to acknowledgment routes so a revoked
  // recipient gets a denied shared operation, never legacy per-recipient success.
  return dto(row, {
    scope: scope && (await canView(pool, scope, row)) ? scope : null,
    paused: userId
      ? (await pausedNotificationUserIds([userId])).has(userId)
      : false,
  });
}

export async function staffingNotificationMayDeliver(
  notificationId: number,
  options: { strictHoldLookup?: boolean } = {},
): Promise<boolean> {
  const record = (
    await pool.query(
      `SELECT n.type,n.user_id,mapping.alert_id FROM notifications n
    LEFT JOIN gate_staffing_alert_notifications mapping ON mapping.notification_id=n.id AND mapping.user_id=n.user_id WHERE n.id=$1`,
      [notificationId],
    )
  ).rows[0];
  if (!record) return false;
  if (!record.alert_id) return !staffingTypes.has(record.type);
  const row = (
    await pool.query(
      `${alertSelect} WHERE a.id=$1 AND a.status='open' AND a.resolved_at IS NULL AND NOT ${coverageIsPaused}
    AND s.ends_at>now() AND s.milestone_status<>'cancelled'`,
      [record.alert_id],
    )
  ).rows[0] as AlertRow | undefined;
  if (
    !row ||
    row.notifications_paused ||
    companyPaused(row.owner_org_type, Number(row.owner_org_id)) ||
    (
      await pausedNotificationUserIds([Number(record.user_id)], undefined, {
        throwOnLookupError: options.strictHoldLookup,
      })
    ).has(Number(record.user_id))
  )
    return false;
  const scope = await recipientScope(pool, Number(record.user_id));
  return Boolean(
    scope &&
    scope.type === row.owner_org_type &&
    scope.id === Number(row.owner_org_id) &&
    (await canView(pool, scope, row)),
  );
}

async function savedCoverage(
  client: QueryClient,
  shiftId: string,
): Promise<number> {
  const row = (
    await client.query(
      `SELECT count(DISTINCT d.user_id)::int AS actual_count FROM work_hub_shifts s
    JOIN gate_duty_sessions d ON d.station_id=s.gate_station_id AND d.ended_at IS NULL AND d.started_at<=now()
      AND d.post_coverage->>'assigneeAcknowledged' IS DISTINCT FROM 'false'
    WHERE s.id=$1 AND (d.started_at>=s.starts_at OR EXISTS(SELECT 1 FROM work_hub_shift_assignments assignment
      WHERE assignment.shift_id=s.id AND assignment.user_id=d.user_id AND assignment.status IN ('assigned','accepted','claimed')))`,
      [shiftId],
    )
  ).rows[0];
  return Number(row?.actual_count ?? 0);
}

async function resolve(
  client: QueryClient,
  row: AlertRow,
  actualCount: number,
): Promise<StaffingStateChange[]> {
  const saved = await client.query(
    "UPDATE gate_staffing_alerts SET status='resolved',resolved_at=now(),resolution_reason='coverage_restored',actual_count=$2,updated_at=now() WHERE id=$1 AND resolved_at IS NULL RETURNING resolved_at",
    [row.id, actualCount],
  );
  await cancelStaffingAlertDeliveries(client, row.id);
  return saved.rows[0]
    ? mappedStateChanges(
        client,
        row.id,
        "resolved",
        iso(saved.rows[0].resolved_at)!,
      )
    : [];
}

/** Intentional suspension ends the requirement; it does not claim physical coverage. */
export async function stopGateStaffingAlertsForCoveragePause(
  client: QueryClient,
  stationId: string,
): Promise<number> {
  const status = (
    await client.query(
      `SELECT mode FROM gate_coverage_status WHERE station_id=$1
    AND (mode IN ('closed','paused_indefinitely') OR (mode='paused_until' AND paused_until>now()))`,
      [stationId],
    )
  ).rows[0];
  if (!status) return 0;
  const stopped = (
    await client.query(
      `UPDATE gate_staffing_alerts SET status='resolved',resolved_at=now(),resolution_reason='coverage_paused',updated_at=now()
    WHERE station_id=$1 AND resolved_at IS NULL RETURNING id`,
      [stationId],
    )
  ).rows;
  for (const row of stopped)
    await cancelStaffingAlertDeliveries(client, row.id);
  return stopped.length;
}

/** A saved duty session is evidence; planned assignment and acknowledgment are not. */
export async function resolveCoveredGateStaffingAlerts(
  stationId: string,
): Promise<number> {
  if (!uuid.test(stationId)) return 0;
  const changes: StaffingStateChange[] = [];
  const result = await changeOverTransaction(async (client) => {
    changes.length = 0;
    await client.query("SELECT id FROM gate_stations WHERE id=$1 FOR UPDATE", [
      stationId,
    ]);
    const stopped = await stopGateStaffingAlertsForCoveragePause(
      client,
      stationId,
    );
    if (stopped) return stopped;
    const rows = (
      await client.query(
        `${alertSelect} WHERE a.station_id=$1 AND a.resolved_at IS NULL ORDER BY a.shift_id FOR UPDATE OF a`,
        [stationId],
      )
    ).rows as AlertRow[];
    let resolved = 0;
    for (const row of rows) {
      const actual = await savedCoverage(client, row.shift_id);
      if (actual >= Number(row.current_required_count)) {
        changes.push(...(await resolve(client, row, actual)));
        resolved++;
      }
    }
    return resolved;
  });
  await publishStateChanges(changes);
  return result;
}

export async function reconcileGateStaffingAlert(
  notice: GateCoverageNotice,
): Promise<GateStaffingAlert | null> {
  const changes: StaffingStateChange[] = [];
  const deliveries: Array<{
    id: number;
    userId: number;
    type: string;
    title: string;
    body: string;
    link: string;
    createdAt: Date;
  }> = [];
  const alert = await changeOverTransaction(async (client) => {
    changes.length = 0;
    deliveries.length = 0; // A deadlock retry never publishes a rolled-back insert.
    const station = (
      await client.query(
        "SELECT site_id,name FROM gate_stations WHERE id=$1 AND active=true FOR UPDATE",
        [notice.candidate.stationId],
      )
    ).rows[0];
    if (!station) return null;
    const coverage = (
      await client.query(
        "SELECT mode,paused_until FROM gate_coverage_status WHERE station_id=$1",
        [notice.candidate.stationId],
      )
    ).rows[0];
    const coveragePaused = Boolean(
      coverage &&
      (coverage.mode === "closed" ||
        coverage.mode === "paused_indefinitely" ||
        (coverage.mode === "paused_until" &&
          coverage.paused_until &&
          new Date(coverage.paused_until) > new Date())),
    );
    const shift = (
      await client.query(
        `SELECT s.*,site.name AS site_name FROM work_hub_shifts s JOIN site_locations site ON site.id=$3
      WHERE s.id=$1 AND s.gate_station_id=$2 AND s.owner_org_type IN ('vendor','partner')
      AND s.milestone_status<>'cancelled' AND site.is_active IS DISTINCT FROM false AND site.hidden IS DISTINCT FROM true FOR SHARE OF s`,
        [notice.candidate.shiftId, notice.candidate.stationId, station.site_id],
      )
    ).rows[0];
    if (!shift) return null;
    // A schedule edit can move this same shift to another Gate/site/company.
    // Lock the raw episode before joining its saved context: the old context
    // no longer joins the current schedule but still owns the active unique key.
    const previousContext = (
      await client.query(
        "SELECT * FROM gate_staffing_alerts WHERE shift_id=$1 AND resolved_at IS NULL FOR UPDATE",
        [shift.id],
      )
    ).rows[0] as AlertRow | undefined;
    if (
      previousContext &&
      (previousContext.station_id !== notice.candidate.stationId ||
        Number(previousContext.site_id) !== Number(station.site_id) ||
        previousContext.owner_org_type !== shift.owner_org_type ||
        Number(previousContext.owner_org_id) !== Number(shift.owner_org_id))
    ) {
      await client.query(
        "UPDATE gate_staffing_alerts SET status='resolved',resolved_at=now(),resolution_reason='context_changed',updated_at=now() WHERE id=$1 AND resolved_at IS NULL",
        [previousContext.id],
      );
      await cancelStaffingAlertDeliveries(client, previousContext.id);
    }
    if (coveragePaused) {
      await stopGateStaffingAlertsForCoveragePause(
        client,
        notice.candidate.stationId,
      );
      return null;
    }
    let row = (
      await client.query(
        `${alertSelect} WHERE a.shift_id=$1 AND a.resolved_at IS NULL FOR UPDATE OF a`,
        [shift.id],
      )
    ).rows[0] as AlertRow | undefined;
    const actual = await savedCoverage(client, shift.id),
      required = Math.max(1, Number(shift.required_staff_count ?? 1));
    if (actual >= required) {
      if (!row) return null;
      changes.push(...(await resolve(client, row, actual)));
      return dto({
        ...row,
        status: "resolved",
        resolved_at: new Date(),
        actual_count: actual,
      });
    }
    if (notice.kind === "restored") return row ? dto(row) : null;
    // A queued evaluation from before real restoration cannot reopen an old episode.
    if (
      !row &&
      (
        await client.query(
          `SELECT 1 FROM gate_staffing_alerts WHERE shift_id=$1 AND (resolved_at IS NULL OR resolved_at>$2)
            AND station_id=$3 AND site_id=$4 AND owner_org_type=$5 AND owner_org_id=$6 LIMIT 1`,
          [
            shift.id,
            notice.at,
            notice.candidate.stationId,
            station.site_id,
            shift.owner_org_type,
            shift.owner_org_id,
          ],
        )
      ).rowCount
    )
      return null;
    if (new Date(shift.ends_at) <= notice.at) return row ? dto(row) : null;
    const paused = companyPaused(
      shift.owner_org_type,
      Number(shift.owner_org_id),
    );
    const previousKind = row?.kind;
    const kind =
      new Date(shift.starts_at) > notice.at
        ? "watch_radar"
        : notice.kind === "watch_radar"
          ? actual === 0
            ? "uncovered"
            : "understaffed"
          : notice.kind;
    const severity = kind === "watch_radar" ? "warning" : "critical";
    if (!row) {
      const inserted = (
        await client.query(
          `INSERT INTO gate_staffing_alerts(code,owner_org_type,owner_org_id,site_id,station_id,shift_id,kind,severity,required_count,actual_count,notifications_paused,escalated_at,created_at,updated_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$13) RETURNING id`,
          [
            randomBytes(5).toString("hex").toUpperCase(),
            shift.owner_org_type,
            shift.owner_org_id,
            station.site_id,
            notice.candidate.stationId,
            shift.id,
            kind,
            severity,
            required,
            actual,
            paused,
            severity === "critical" ? notice.at : null,
            notice.at,
          ],
        )
      ).rows[0];
      row = (await client.query(`${alertSelect} WHERE a.id=$1`, [inserted.id]))
        .rows[0] as AlertRow;
    } else {
      await client.query(
        `UPDATE gate_staffing_alerts SET kind=$2,severity=$3,required_count=$4,actual_count=$5,
        notifications_paused=notifications_paused OR $6,escalated_at=COALESCE(escalated_at,$7),updated_at=now() WHERE id=$1`,
        [
          row.id,
          kind,
          severity,
          required,
          actual,
          paused,
          severity === "critical" ? notice.at : null,
        ],
      );
      row = (await client.query(`${alertSelect} WHERE a.id=$1`, [row.id]))
        .rows[0] as AlertRow;
    }
    if (row.status !== "open" || row.notifications_paused) {
      await cancelStaffingAlertDeliveries(client, row.id);
      return dto(row);
    }
    const reminderDue =
      !row.last_notified_at ||
      (previousKind === "watch_radar" && severity === "critical") ||
      (kind !== "watch_radar" &&
        notice.at.getTime() - new Date(row.last_notified_at).getTime() >=
          TEN_MINUTES);
    if (!reminderDue) return dto(row);
    const type =
      kind === "watch_radar" ? "gate_watch_radar" : `gate_coverage_${kind}`;
    const title =
      kind === "watch_radar"
        ? `${station.name} watch needs staffing`
        : `${station.name} is ${kind}`;
    const gap = required - actual;
    const body =
      kind === "watch_radar"
        ? `${shift.title} starts within 24 hours and needs an assigned watch.`
        : kind === "unconfirmed"
          ? `${shift.title}: relief has not assumed the watch. Confirm actual coverage or arrange backup.`
          : `${shift.title}: ${actual} of ${required} required gatekeepers on duty; ${gap} position${gap === 1 ? " remains" : "s remain"} open. A company administrator must acknowledge and arrange coverage.`;
    const link = dto(row).href;
    const recipients = [...new Set(notice.recipientUserIds)].filter(
      (id) => Number.isSafeInteger(id) && id > 0,
    );
    const heldUsers = await pausedNotificationUserIds(recipients, client);
    for (const userId of recipients) {
      if (heldUsers.has(userId)) continue;
      const scope = await recipientScope(client, userId);
      if (
        !scope ||
        scope.type !== row.owner_org_type ||
        scope.id !== Number(row.owner_org_id) ||
        !(await canView(client, scope, row))
      )
        continue;
      const inserted = (
        await client.query(
          `INSERT INTO notifications(user_id,type,category,dedupe_key,title,body,link,urgent_delivery_pending,acknowledgement_required)
        VALUES($1,$2,'crew',$3,$4,$5,$6,true,true) ON CONFLICT(user_id,dedupe_key) DO NOTHING
        RETURNING id,user_id AS "userId",type,title,body,link,created_at AS "createdAt"`,
          [
            userId,
            type,
            `gate-staffing:${row.id}:${kind}:${Math.floor(notice.at.getTime() / TEN_MINUTES)}`,
            title,
            body,
            link,
          ],
        )
      ).rows[0];
      if (inserted) {
        await client.query(
          "INSERT INTO gate_staffing_alert_notifications(notification_id,alert_id,user_id) VALUES($1,$2,$3)",
          [inserted.id, row.id, userId],
        );
        deliveries.push(inserted);
      }
    }
    await client.query(
      "UPDATE gate_staffing_alerts SET last_notified_at=$2 WHERE id=$1",
      [row.id, notice.at],
    );
    return dto(row);
  });
  await publishStateChanges(changes);
  // No provider or realtime event is visible until canonical notice + mapping commit.
  if (deliveries.length) {
    const { publishNotificationCreated } =
      await import("../lib/notification-events");
    const { processPendingGateAlert } = await import("./gate-alert-repository");
    for (const notice of deliveries) {
      try {
        if (!(await staffingNotificationMayDeliver(notice.id))) continue;
        publishNotificationCreated({
          userId: notice.userId,
          notificationId: notice.id,
          notifType: notice.type,
          category: "crew",
          title: notice.title,
          body: notice.body,
          link: notice.link,
          audible: false,
          createdAt: iso(notice.createdAt)!,
        });
        await processPendingGateAlert(notice);
      } catch {
        logger.warn(
          { notificationId: notice.id },
          "Staffing alert delivery remains pending for the existing retry worker",
        );
      }
    }
  }
  return alert;
}
