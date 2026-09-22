import { pool } from "@workspace/db";
import type { SessionPayload } from "../lib/session";
import { ChangeOverError, changeOverTransaction, requireChangeOverAccess } from "./gate-change-over";
import { startWorkSession, type StartWorkSessionInput } from "./gate-duty";

type AttendanceDisposition = "no_show" | "excused" | "reassigned";

const fail = (status: number, code: string, message: string): never => {
  throw new ChangeOverError(status, `change_over.${code}`, message);
};

function userId(session: SessionPayload) {
  if (!session.userId) fail(401, "sign_in_required", "Sign in required");
  return session.userId!;
}

const workRow = (row: Record<string, unknown>) => ({
  id: row.id as string,
  userId: row.user_id as number,
  workHubShiftId: row.work_hub_shift_id as string,
  startPolicy: row.start_policy as string,
  travelStatus: row.travel_status as string,
  etaAt: (row.eta_at as Date | null) ?? null,
  etaSource: (row.eta_source as string | null) ?? null,
  locationSharingActive: row.location_sharing_active as boolean,
  trackingStatus: row.tracking_status as string,
  trackingExceptionReason: (row.tracking_exception_reason as string | null) ?? null,
  startedAt: row.started_at as Date,
  endedAt: (row.ended_at as Date | null) ?? null,
});

const attendanceRow = (row: Record<string, unknown>) => ({
  id: row.id as string,
  workHubShiftId: row.work_hub_shift_id as string,
  userId: row.user_id as number,
  state: row.state as string,
  disposition: (row.disposition as AttendanceDisposition | null) ?? null,
  reason: (row.reason as string | null) ?? null,
  resolvedByUserId: (row.resolved_by_user_id as number | null) ?? null,
  detectedAt: row.detected_at as Date,
  resolvedAt: (row.resolved_at as Date | null) ?? null,
});

export async function startPaidTravel(
  session: SessionPayload,
  input: StartWorkSessionInput,
) {
  const shift = (
    await pool.query(
      "SELECT work_start_policy FROM work_hub_shifts WHERE id=$1",
      [input.workHubShiftId],
    )
  ).rows[0];
  if (shift?.work_start_policy !== "paid_travel")
    fail(409, "paid_travel_not_enabled", "Paid travel is not enabled for this shift");
  return startWorkSession(session, input);
}

export async function setTravelEta(
  session: SessionPayload,
  workSessionId: string,
  input: { etaAt: Date; source: "gps" | "manual" },
) {
  return changeOverTransaction(async (client) => {
    const result = (
      await client.query(
        `UPDATE gate_work_sessions SET eta_at=$3,eta_source=$4,travel_status='en_route'
         WHERE id=$1 AND user_id=$2 AND ended_at IS NULL RETURNING *`,
        [workSessionId, userId(session), input.etaAt, input.source],
      )
    ).rows[0];
    if (!result) fail(404, "work_session_not_found", "Active work session was not found");
    return workRow(result);
  });
}

export async function recordTrackingException(
  session: SessionPayload,
  workSessionId: string,
  reason: string,
) {
  const trimmed = reason.trim();
  if (!trimmed) fail(400, "reason_required", "A tracking exception reason is required");
  return changeOverTransaction(async (client) => {
    const result = (
      await client.query(
        `UPDATE gate_work_sessions
         SET tracking_status='exception',tracking_exception_reason=$3,location_sharing_active=false
         WHERE id=$1 AND user_id=$2 AND ended_at IS NULL RETURNING *`,
        [workSessionId, userId(session), trimmed],
      )
    ).rows[0];
    if (!result) fail(404, "work_session_not_found", "Active work session was not found");
    return workRow(result);
  });
}

export async function createAttendanceException(
  workHubShiftId: string,
  workerUserId: number,
  detectedAt = new Date(),
) {
  const row = (
    await pool.query(
      `INSERT INTO gate_attendance_exceptions(work_hub_shift_id,user_id,detected_at)
       VALUES($1,$2,$3)
       ON CONFLICT(work_hub_shift_id,user_id) DO UPDATE SET updated_at=now()
       RETURNING *`,
      [workHubShiftId, workerUserId, detectedAt],
    )
  ).rows[0];
  return attendanceRow(row);
}

async function requireAttendanceResolver(
  session: SessionPayload,
  record: Record<string, unknown>,
) {
  const actorId = userId(session);
  const fresh = (
    await pool.query(
      "SELECT role,session_version,suspended_at FROM users WHERE id=$1",
      [actorId],
    )
  ).rows[0];
  if (!fresh || fresh.suspended_at || fresh.session_version !== session.sv)
    fail(401, "session_changed", "Sign in again to continue");
  if (session.role === "admin" && fresh.role === "admin") return;
  if (
    session.vendorId === record.owner_org_id &&
    record.owner_org_type === "vendor"
  ) {
    const membership = await pool.query(
      `SELECT id FROM user_org_memberships
       WHERE user_id=$1 AND vendor_id=$2 AND org_type='vendor'
       AND role='admin' AND ($3::int IS NULL OR id=$3)`,
      [actorId, session.vendorId, session.activeMembershipId ?? null],
    );
    if (membership.rowCount) return;
  }
  const access = await requireChangeOverAccess(
    pool,
    session,
    Number(record.site_location_id),
  );
  if (!access.supervisor)
    fail(403, "supervisor_required", "Supervisor or administrator access required");
}

export async function resolveAttendanceException(
  session: SessionPayload,
  attendanceExceptionId: string,
  input: { disposition: AttendanceDisposition; reason: string },
) {
  const reason = input.reason.trim();
  if (!reason) fail(400, "reason_required", "A resolution reason is required");
  return changeOverTransaction(async (client) => {
    const record = (
      await client.query(
        `SELECT e.*,s.owner_org_type,s.owner_org_id,s.site_location_id,s.gate_station_id
         FROM gate_attendance_exceptions e
         JOIN work_hub_shifts s ON s.id=e.work_hub_shift_id
         WHERE e.id=$1 FOR UPDATE OF e`,
        [attendanceExceptionId],
      )
    ).rows[0];
    if (!record) fail(404, "attendance_not_found", "Attendance exception was not found");
    await requireAttendanceResolver(session, record);
    if (record.state === "resolved") return attendanceRow(record);
    return attendanceRow(
      (
        await client.query(
          `UPDATE gate_attendance_exceptions
           SET state='resolved',disposition=$2,reason=$3,resolved_by_user_id=$4,
             resolved_at=now(),updated_at=now()
           WHERE id=$1 RETURNING *`,
          [attendanceExceptionId, input.disposition, reason, userId(session)],
        )
      ).rows[0],
    );
  });
}
