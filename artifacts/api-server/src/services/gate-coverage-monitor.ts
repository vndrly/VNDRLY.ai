import { pool } from "@workspace/db";
import { createAttendanceException } from "./gate-attendance";
import type { SessionPayload } from "../lib/session";
import { ChangeOverError, changeOverTransaction, requireChangeOverAccess } from "./gate-change-over";

export type GateCoverageMode =
  | "active"
  | "paused_until"
  | "paused_indefinitely"
  | "closed";

export type GateCoverageCandidate = {
  shiftId: string;
  stationId: string;
  stationName: string;
  title: string;
  startsAt: Date;
  endsAt: Date;
  requiredCount: number;
  actualCount: number;
  activeUserIds?: number[];
  assignedUserIds: number[];
  recipientUserIds: number[];
  coverageMode: GateCoverageMode;
  pausedUntil?: Date | null;
};

export type GateCoverageRecord = {
  shiftId: string;
  state: string;
  lastReminderAt: Date | null;
  requiredCount: number;
  actualCount: number;
};

export type GateCoverageNotice = {
  kind: "uncovered" | "understaffed" | "restored";
  candidate: GateCoverageCandidate;
  recipientUserIds: number[];
  at: Date;
};

export interface GateCoverageDependencies {
  loadCandidates(at: Date): Promise<GateCoverageCandidate[]>;
  getRecord(shiftId: string): Promise<GateCoverageRecord | null>;
  saveRecord(record: GateCoverageRecord & { stationId: string; at: Date }): Promise<void>;
  createAttendanceException(shiftId: string, userId: number, detectedAt: Date): Promise<unknown>;
  deliver(notice: GateCoverageNotice): Promise<void>;
}

const TEN_MINUTES = 10 * 60_000;

const fail = (status: number, code: string, message: string): never => {
  throw new ChangeOverError(status, `change_over.${code}`, message);
};

export async function setGateCoverageStatus(
  session: SessionPayload,
  input: {
    stationId: string;
    mode: GateCoverageMode;
    pausedUntil?: Date | null;
    reason?: string | null;
  },
) {
  if (!session.userId) fail(401, "sign_in_required", "Sign in required");
  const reason = input.reason?.trim() || null;
  if (input.mode !== "active" && !reason)
    fail(400, "reason_required", "Explain why Gate coverage is changing");
  if (
    input.mode === "paused_until" &&
    (!input.pausedUntil || input.pausedUntil <= new Date())
  )
    fail(400, "pause_end_required", "Choose a future date to resume coverage");
  return changeOverTransaction(async (client) => {
    const station = (
      await client.query("SELECT site_id FROM gate_stations WHERE id=$1 FOR UPDATE", [
        input.stationId,
      ])
    ).rows[0];
    if (!station) fail(404, "not_found", "Gate not found");
    let supervisor = false;
    try {
      supervisor = (
        await requireChangeOverAccess(client, session, Number(station.site_id))
      ).supervisor;
    } catch (error) {
      if (!(error instanceof ChangeOverError) || error.status === 401) throw error;
    }
    if (!supervisor) {
      const admin = await client.query(
        `SELECT id FROM user_org_memberships
         WHERE user_id=$1 AND org_type='vendor' AND vendor_id=$2 AND role='admin'
         AND ($3::int IS NULL OR id=$3)`,
        [session.userId, session.vendorId ?? -1, session.activeMembershipId ?? null],
      );
      if (!admin.rowCount)
        fail(403, "supervisor_required", "Supervisor or administrator access required");
    }
    const row = (
      await client.query(
        `INSERT INTO gate_coverage_status(station_id,mode,paused_until,reason,changed_by_user_id)
         VALUES($1,$2,$3,$4,$5)
         ON CONFLICT(station_id) DO UPDATE SET mode=excluded.mode,
           paused_until=excluded.paused_until,reason=excluded.reason,
           changed_by_user_id=excluded.changed_by_user_id,changed_at=now(),updated_at=now()
         RETURNING *`,
        [
          input.stationId,
          input.mode,
          input.mode === "paused_until" ? input.pausedUntil : null,
          reason,
          session.userId,
        ],
      )
    ).rows[0];
    return {
      stationId: row.station_id,
      mode: row.mode as GateCoverageMode,
      pausedUntil: row.paused_until as Date | null,
      reason: row.reason as string | null,
      changedAt: row.changed_at as Date,
    };
  });
}

function paused(candidate: GateCoverageCandidate, at: Date) {
  if (candidate.coverageMode === "closed" || candidate.coverageMode === "paused_indefinitely") return true;
  return candidate.coverageMode === "paused_until" && Boolean(candidate.pausedUntil && candidate.pausedUntil > at);
}

async function loadCandidates(at: Date): Promise<GateCoverageCandidate[]> {
  const shifts = (
    await pool.query(
      `SELECT s.id AS shift_id,s.gate_station_id AS station_id,g.name AS station_name,
        s.title,s.starts_at,s.ends_at,coalesce(s.required_staff_count,1)::int AS required_count,
        coalesce(c.mode,'active') AS coverage_mode,c.paused_until,s.owner_org_type,s.owner_org_id
       FROM work_hub_shifts s
       JOIN gate_stations g ON g.id=s.gate_station_id
       LEFT JOIN gate_coverage_status c ON c.station_id=s.gate_station_id
       WHERE s.gate_station_id IS NOT NULL AND s.starts_at <= $1 AND s.ends_at > $1
         AND s.milestone_status <> 'cancelled'`,
      [at],
    )
  ).rows;
  const candidates: GateCoverageCandidate[] = [];
  for (const shift of shifts) {
    const activeRows = (
        await pool.query(
          `SELECT user_id FROM gate_duty_sessions
           WHERE station_id=$1 AND started_at <= $2 AND ended_at IS NULL`,
          [shift.station_id, at],
        )
      ).rows;
    const activeUserIds = activeRows.map((row) => Number(row.user_id));
    const actualCount = activeUserIds.length;
    const assignedUserIds = (
      await pool.query(
        `SELECT user_id FROM work_hub_shift_assignments
         WHERE shift_id=$1 AND status IN ('assigned','accepted','claimed')`,
        [shift.shift_id],
      )
    ).rows.map((row) => Number(row.user_id));
    const leadership = (
      await pool.query(
        `SELECT DISTINCT u.id FROM users u
         LEFT JOIN user_org_memberships m ON m.user_id=u.id
         LEFT JOIN vendor_people p ON p.user_id=u.id AND p.deleted_at IS NULL AND p.is_active=true
         WHERE u.suspended_at IS NULL AND (
           ($1='vendor' AND m.org_type='vendor' AND m.vendor_id=$2 AND m.role='admin')
           OR ($1='partner' AND m.org_type='partner' AND m.partner_id=$2 AND m.role='admin')
           OR ($1='vendor' AND p.vendor_id=$2 AND p.vendor_role='gate_supervisor')
         )`,
        [shift.owner_org_type, shift.owner_org_id],
      )
    ).rows.map((row) => Number(row.id));
    candidates.push({
      shiftId: shift.shift_id,
      stationId: shift.station_id,
      stationName: shift.station_name,
      title: shift.title,
      startsAt: new Date(shift.starts_at),
      endsAt: new Date(shift.ends_at),
      requiredCount: Number(shift.required_count),
      actualCount,
      activeUserIds,
      assignedUserIds,
      recipientUserIds: [...new Set([...assignedUserIds, ...leadership])],
      coverageMode: shift.coverage_mode,
      pausedUntil: shift.paused_until ? new Date(shift.paused_until) : null,
    });
  }
  return candidates;
}

async function getRecord(shiftId: string): Promise<GateCoverageRecord | null> {
  const row = (
    await pool.query(
      `SELECT shift_id,state,last_reminder_at,required_count,actual_count
       FROM workforce_coverage_records WHERE shift_id=$1`,
      [shiftId],
    )
  ).rows[0];
  return row
    ? {
        shiftId: row.shift_id,
        state: row.state,
        lastReminderAt: row.last_reminder_at ? new Date(row.last_reminder_at) : null,
        requiredCount: Number(row.required_count),
        actualCount: Number(row.actual_count),
      }
    : null;
}

async function saveRecord(
  record: GateCoverageRecord & { stationId: string; at: Date },
) {
  await pool.query(
    `INSERT INTO workforce_coverage_records(
      shift_id,gate_station_id,vacancy_origin,required_count,assigned_count,
      actual_count,coverage_kind,state,last_reminder_at,resolved_at,updated_at
    ) VALUES($1,$2,'gate_schedule',$3,0,$4,'gate',$5,$6,$7,$8)
    ON CONFLICT(shift_id) DO UPDATE SET
      gate_station_id=excluded.gate_station_id,required_count=excluded.required_count,
      actual_count=excluded.actual_count,coverage_kind='gate',state=excluded.state,
      last_reminder_at=excluded.last_reminder_at,resolved_at=excluded.resolved_at,
      version=workforce_coverage_records.version+1,updated_at=excluded.updated_at`,
    [
      record.shiftId,
      record.stationId,
      record.requiredCount,
      record.actualCount,
      record.state,
      record.lastReminderAt,
      record.state === "resolved" ? record.at : null,
      record.at,
    ],
  );
}

async function deliver(notice: GateCoverageNotice) {
  if (!notice.recipientUserIds.length) return;
  const { notifyUsers } = await import("../routes/notifications");
  const gap = notice.candidate.requiredCount - notice.candidate.actualCount;
  const restored = notice.kind === "restored";
  await notifyUsers(notice.recipientUserIds, {
    type: restored ? "gate_coverage_restored" : `gate_coverage_${notice.kind}`,
    category: "crew",
    title: restored
      ? `${notice.candidate.stationName} coverage restored`
      : `${notice.candidate.stationName} is ${notice.kind}`,
    body: restored
      ? `${notice.candidate.actualCount} of ${notice.candidate.requiredCount} required gatekeepers are now on duty.`
      : `${gap} required Gate position${gap === 1 ? " is" : "s are"} still open. Assume the Gate or share your ETA now.`,
    link: "/work-hub/workforce-coverage",
    dedupeKey: `gate-coverage:${notice.candidate.shiftId}:${notice.kind}:${Math.floor(notice.at.getTime() / TEN_MINUTES)}`,
    forceImmediateDelivery: true,
  });
}

export const databaseGateCoverageDependencies: GateCoverageDependencies = {
  loadCandidates,
  getRecord,
  saveRecord,
  createAttendanceException,
  deliver,
};

export async function evaluateGateCoverage(
  at = new Date(),
  dependencies: GateCoverageDependencies = databaseGateCoverageDependencies,
) {
  const results: Array<{ shiftId: string; state: string }> = [];
  for (const candidate of await dependencies.loadCandidates(at)) {
    const prior = await dependencies.getRecord(candidate.shiftId);
    if (paused(candidate, at)) {
      await dependencies.saveRecord({
        shiftId: candidate.shiftId,
        stationId: candidate.stationId,
        state: "resolved",
        lastReminderAt: prior?.lastReminderAt ?? null,
        requiredCount: candidate.requiredCount,
        actualCount: candidate.actualCount,
        at,
      });
      results.push({ shiftId: candidate.shiftId, state: "paused" });
      continue;
    }
    const covered = candidate.actualCount >= candidate.requiredCount;
    if (covered) {
      const shouldRestore = Boolean(
        prior && ["uncovered", "understaffed", "escalated"].includes(prior.state),
      );
      if (shouldRestore) {
        await dependencies.deliver({
          kind: "restored",
          candidate,
          recipientUserIds: candidate.recipientUserIds,
          at,
        });
      }
      await dependencies.saveRecord({
        shiftId: candidate.shiftId,
        stationId: candidate.stationId,
        state: shouldRestore ? "resolved" : "covered",
        lastReminderAt: prior?.lastReminderAt ?? null,
        requiredCount: candidate.requiredCount,
        actualCount: candidate.actualCount,
        at,
      });
      results.push({ shiftId: candidate.shiftId, state: "covered" });
      continue;
    }
    if (at.getTime() < candidate.startsAt.getTime() + TEN_MINUTES) {
      results.push({ shiftId: candidate.shiftId, state: "grace" });
      continue;
    }
    const state = candidate.actualCount === 0 ? "uncovered" : "understaffed";
    const reminderDue =
      !prior?.lastReminderAt ||
      at.getTime() - prior.lastReminderAt.getTime() >= TEN_MINUTES;
    if (reminderDue) {
      const activeUsers = new Set(candidate.activeUserIds ?? []);
      for (const assignedUserId of candidate.assignedUserIds) {
        if (!activeUsers.has(assignedUserId))
          await dependencies.createAttendanceException(
            candidate.shiftId,
            assignedUserId,
            at,
          );
      }
      await dependencies.deliver({
        kind: state,
        candidate,
        recipientUserIds: candidate.recipientUserIds,
        at,
      });
    }
    await dependencies.saveRecord({
      shiftId: candidate.shiftId,
      stationId: candidate.stationId,
      state,
      lastReminderAt: reminderDue ? at : prior?.lastReminderAt ?? null,
      requiredCount: candidate.requiredCount,
      actualCount: candidate.actualCount,
      at,
    });
    results.push({ shiftId: candidate.shiftId, state });
  }
  return results;
}

let coverageTimer: ReturnType<typeof setInterval> | null = null;

export function startGateCoverageMonitor(intervalMs = 60_000) {
  if (coverageTimer) return;
  const run = () => {
    void evaluateGateCoverage().catch((error) =>
      console.error("Gate coverage evaluation failed", error),
    );
  };
  run();
  coverageTimer = setInterval(run, intervalMs);
  coverageTimer.unref?.();
}

export function stopGateCoverageMonitor() {
  if (!coverageTimer) return;
  clearInterval(coverageTimer);
  coverageTimer = null;
}
