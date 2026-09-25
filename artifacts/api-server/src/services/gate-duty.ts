import type { PoolClient } from "pg";
import { pool } from "@workspace/db";
import type { SessionPayload } from "../lib/session";
import {
  ChangeOverError,
  changeOverTransaction,
  requireChangeOverAccess,
} from "./gate-change-over";

type GateSource = "web" | "ios" | "askv";
type Queryable = Pick<PoolClient, "query">;

export type StartWorkSessionInput = {
  workHubShiftId: string;
  stationId?: string;
  source: GateSource;
  idempotencyKey: string;
  at?: Date;
  locationSharingActive?: boolean;
  startLatitude?: number;
  startLongitude?: number;
};

export type AssumeGateDutyInput = {
  stationId: string;
  workHubShiftId?: string;
  workSessionId?: string;
  source: GateSource;
  idempotencyKey: string;
  at?: Date;
};

export type EndGateDutyInput = {
  dutySessionId: string;
  reason: string;
  handoffCompleted: boolean;
  at?: Date;
};

const fail = (status: number, code: string, message: string): never => {
  throw new ChangeOverError(status, `change_over.${code}`, message);
};

function requireUser(session: SessionPayload): number {
  if (!session.userId) fail(401, "sign_in_required", "Sign in required");
  return session.userId!;
}

const workRow = (row: Record<string, unknown>) => ({
  id: row.id as string,
  userId: row.user_id as number,
  workHubShiftId: (row.work_hub_shift_id as string | null) ?? null,
  ownerOrgType: row.owner_org_type as string,
  ownerOrgId: row.owner_org_id as number,
  startPolicy: row.start_policy as "on_site" | "paid_travel",
  travelStatus: row.travel_status as string,
  etaAt: (row.eta_at as Date | null) ?? null,
  etaSource: (row.eta_source as string | null) ?? null,
  locationSharingActive: row.location_sharing_active as boolean,
  trackingStatus: row.tracking_status as string,
  trackingExceptionReason:
    (row.tracking_exception_reason as string | null) ?? null,
  startedAt: row.started_at as Date,
  arrivedAt: (row.arrived_at as Date | null) ?? null,
  endedAt: (row.ended_at as Date | null) ?? null,
  source: row.source as GateSource,
  idempotencyKey: row.idempotency_key as string,
});

const dutyRow = (row: Record<string, unknown>) => ({
  id: row.id as string,
  stationId: row.station_id as string,
  userId: row.user_id as number,
  workHubShiftId: (row.work_hub_shift_id as string | null) ?? null,
  workSessionId: (row.work_session_id as string | null) ?? null,
  startedAt: row.started_at as Date,
  endedAt: (row.ended_at as Date | null) ?? null,
  endedByUserId: (row.ended_by_user_id as number | null) ?? null,
  endReason: (row.end_reason as string | null) ?? null,
  source: row.source as GateSource,
  idempotencyKey: row.idempotency_key as string,
});

async function stationWithAccess(
  client: Queryable,
  session: SessionPayload,
  stationId: string,
  requireActive = false,
) {
  const station = (
    await client.query(
      `SELECT id,site_id,name,active FROM gate_stations WHERE id=$1${requireActive ? " FOR SHARE" : ""}`,
      [stationId],
    )
  ).rows[0];
  if (!station) fail(404, "not_found", "Gate not found");
  const access = await requireChangeOverAccess(client, session, station.site_id);
  if (requireActive && station.active === false)
    fail(409, "station_inactive", "This gate is inactive");
  return { station, access };
}

async function shiftForWorker(
  client: Queryable,
  session: SessionPayload,
  workHubShiftId: string,
  stationId?: string,
) {
  const userId = requireUser(session);
  const shift = (
    await client.query(
      `SELECT s.*
       FROM work_hub_shifts s
       JOIN work_hub_shift_assignments a ON a.shift_id=s.id
       WHERE s.id=$1 AND a.user_id=$2 AND a.status IN ('assigned','accepted')
       FOR UPDATE OF s`,
      [workHubShiftId, userId],
    )
  ).rows[0];
  if (!shift)
    fail(
      403,
      "assignment_required",
      "The selected Work Hub shift is not assigned to you",
    );
  if (!shift.gate_station_id || !shift.site_location_id)
    fail(409, "gate_shift_required", "This is not a scheduled Gate shift");
  if (stationId && shift.gate_station_id !== stationId)
    fail(409, "station_mismatch", "The shift belongs to a different gate");
  await stationWithAccess(client, session, shift.gate_station_id, true);
  return shift;
}

async function insertDuty(
  client: Queryable,
  session: SessionPayload,
  input: AssumeGateDutyInput,
) {
  const userId = requireUser(session);
  const retry = (
    await client.query(
      "SELECT * FROM gate_duty_sessions WHERE idempotency_key=$1",
      [input.idempotencyKey],
    )
  ).rows[0];
  if (retry) {
    if (retry.user_id !== userId)
      fail(409, "idempotency_conflict", "That operation key is already used");
    return dutyRow(retry);
  }
  await client.query("SELECT id FROM gate_stations WHERE id=$1 FOR UPDATE", [
    input.stationId,
  ]);
  await stationWithAccess(client, session, input.stationId, true);
  let shift = null;
  if (input.workHubShiftId) {
    shift = await shiftForWorker(
      client,
      session,
      input.workHubShiftId,
      input.stationId,
    );
  }
  if (input.workSessionId) {
    const work = (
      await client.query(
        "SELECT * FROM gate_work_sessions WHERE id=$1 AND user_id=$2 AND ended_at IS NULL FOR UPDATE",
        [input.workSessionId, userId],
      )
    ).rows[0];
    if (!work) fail(409, "work_session_required", "Active work session required");
    if (
      input.workHubShiftId &&
      work.work_hub_shift_id !== input.workHubShiftId
    )
      fail(409, "shift_mismatch", "Work and duty shifts do not match");
  }
  const active = (
    await client.query(
      "SELECT * FROM gate_duty_sessions WHERE station_id=$1 AND user_id=$2 AND ended_at IS NULL",
      [input.stationId, userId],
    )
  ).rows[0];
  if (active) return dutyRow(active);
  const legacyShift = (
    await client.query(
      "SELECT id FROM gate_shifts WHERE station_id=$1 AND ended_at IS NULL FOR UPDATE",
      [input.stationId],
    )
  ).rows[0];
  if (!legacyShift) {
    await client.query(
      "INSERT INTO gate_shifts(station_id,operator_id,started_at) VALUES($1,$2,$3)",
      [input.stationId, userId, input.at ?? new Date()],
    );
  }
  const result = (
    await client.query(
      `INSERT INTO gate_duty_sessions(
        station_id,user_id,work_hub_shift_id,work_session_id,started_at,source,idempotency_key
      ) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [
        input.stationId,
        userId,
        input.workHubShiftId ?? null,
        input.workSessionId ?? null,
        input.at ?? new Date(),
        input.source,
        input.idempotencyKey,
      ],
    )
  ).rows[0];
  return dutyRow(result);
}

export async function assumeGateDuty(
  session: SessionPayload,
  input: AssumeGateDutyInput,
) {
  return changeOverTransaction((client) => insertDuty(client, session, input));
}

export async function startWorkSession(
  session: SessionPayload,
  input: StartWorkSessionInput,
) {
  return changeOverTransaction(async (client) => {
    const userId = requireUser(session);
    const retry = (
      await client.query(
        "SELECT * FROM gate_work_sessions WHERE idempotency_key=$1",
        [input.idempotencyKey],
      )
    ).rows[0];
    if (retry) {
      if (retry.user_id !== userId)
        fail(409, "idempotency_conflict", "That operation key is already used");
      const duty = (
        await client.query(
          "SELECT * FROM gate_duty_sessions WHERE work_session_id=$1 AND ended_at IS NULL",
          [retry.id],
        )
      ).rows[0];
      return {
        workSession: workRow(retry),
        dutySession: duty ? dutyRow(duty) : null,
      };
    }
    const shift = await shiftForWorker(
      client,
      session,
      input.workHubShiftId,
      input.stationId,
    );
    const stationId = input.stationId ?? shift.gate_station_id;
    const policy = shift.work_start_policy as "on_site" | "paid_travel";
    if (!policy || !["on_site", "paid_travel"].includes(policy))
      fail(409, "work_policy_required", "Work start policy is not configured");
    const locationSharing = Boolean(input.locationSharingActive);
    const result = (
      await client.query(
        `INSERT INTO gate_work_sessions(
          user_id,work_hub_shift_id,owner_org_type,owner_org_id,start_policy,
          travel_status,location_sharing_active,tracking_status,started_at,
          start_latitude,start_longitude,source,idempotency_key
        ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
        [
          userId,
          input.workHubShiftId,
          shift.owner_org_type,
          shift.owner_org_id,
          policy,
          policy === "paid_travel" ? "en_route" : "arrived",
          locationSharing,
          policy === "paid_travel"
            ? locationSharing
              ? "active"
              : "exception"
            : "not_required",
          input.at ?? new Date(),
          input.startLatitude ?? null,
          input.startLongitude ?? null,
          input.source,
          input.idempotencyKey,
        ],
      )
    ).rows[0];
    const workSession = workRow(result);
    const dutySession =
      policy === "on_site"
        ? await insertDuty(client, session, {
            stationId,
            workHubShiftId: input.workHubShiftId,
            workSessionId: workSession.id,
            source: input.source,
            idempotencyKey: input.idempotencyKey,
            at: input.at,
          })
        : null;
    return { workSession, dutySession };
  });
}

export async function getGateRoster(
  session: SessionPayload,
  stationId: string,
) {
  await stationWithAccess(pool, session, stationId);
  const rows = (
    await pool.query(
      `SELECT d.*,coalesce(u.display_name,u.username) AS user_name
       FROM gate_duty_sessions d
       JOIN users u ON u.id=d.user_id
       WHERE d.station_id=$1 AND d.ended_at IS NULL
       ORDER BY d.started_at,d.id`,
      [stationId],
    )
  ).rows;
  return rows.map((row) => ({ ...dutyRow(row), userName: row.user_name }));
}

export async function endGateDuty(
  session: SessionPayload,
  input: EndGateDutyInput,
) {
  return changeOverTransaction(async (client) => {
    const userId = requireUser(session);
    const duty = (
      await client.query(
        "SELECT * FROM gate_duty_sessions WHERE id=$1 FOR UPDATE",
        [input.dutySessionId],
      )
    ).rows[0];
    if (!duty) fail(404, "duty_not_found", "Active Gate duty was not found");
    const { access } = await stationWithAccess(
      client,
      session,
      duty.station_id,
    );
    if (duty.ended_at) return dutyRow(duty);
    if (duty.user_id !== userId && !access.supervisor)
      fail(403, "owner_required", "Only this worker or a supervisor may end duty");
    const remaining = Number(
      (
        await client.query(
          "SELECT count(*)::int AS count FROM gate_duty_sessions WHERE station_id=$1 AND ended_at IS NULL AND id<>$2",
          [duty.station_id, duty.id],
        )
      ).rows[0].count,
    );
    if (remaining === 0 && !input.handoffCompleted)
      fail(
        409,
        "handoff_required",
        "Complete the Gate handoff before leaving the station unattended",
      );
    const replacement =
      remaining > 0
        ? (
            await client.query(
              `SELECT user_id FROM gate_duty_sessions
               WHERE station_id=$1 AND ended_at IS NULL AND id<>$2
               ORDER BY started_at,id LIMIT 1`,
              [duty.station_id, duty.id],
            )
          ).rows[0]
        : null;
    const ended = (
      await client.query(
        `UPDATE gate_duty_sessions
         SET ended_at=$2,ended_by_user_id=$3,end_reason=$4
         WHERE id=$1 RETURNING *`,
        [duty.id, input.at ?? new Date(), userId, input.reason.trim()],
      )
    ).rows[0];
    if (replacement) {
      await client.query(
        `UPDATE gate_shifts SET operator_id=$2
         WHERE station_id=$1 AND ended_at IS NULL AND operator_id=$3`,
        [duty.station_id, replacement.user_id, duty.user_id],
      );
    } else {
      await client.query(
        `UPDATE gate_shifts SET ended_at=$2
         WHERE station_id=$1 AND ended_at IS NULL`,
        [duty.station_id, input.at ?? new Date()],
      );
    }
    return dutyRow(ended);
  });
}

export async function endWorkSession(
  session: SessionPayload,
  input: { workSessionId: string; reason?: string; at?: Date },
) {
  return changeOverTransaction(async (client) => {
    const userId = requireUser(session);
    const work = (
      await client.query(
        "SELECT * FROM gate_work_sessions WHERE id=$1 FOR UPDATE",
        [input.workSessionId],
      )
    ).rows[0];
    if (!work) fail(404, "work_session_not_found", "Work session was not found");
    if (work.user_id !== userId)
      fail(403, "owner_required", "Only the worker may end this work session");
    if (work.ended_at) return workRow(work);
    const activeDuty = await client.query(
      "SELECT id FROM gate_duty_sessions WHERE work_session_id=$1 AND ended_at IS NULL LIMIT 1",
      [work.id],
    );
    if (activeDuty.rowCount)
      fail(409, "duty_active", "End Gate duty before ending the work session");
    return workRow(
      (
        await client.query(
          "UPDATE gate_work_sessions SET ended_at=$2,location_sharing_active=false,travel_status='ended' WHERE id=$1 RETURNING *",
          [work.id, input.at ?? new Date()],
        )
      ).rows[0],
    );
  });
}
