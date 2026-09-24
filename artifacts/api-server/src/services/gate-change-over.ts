import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { pool } from "@workspace/db";
import type { SessionPayload } from "../lib/session";
import { notifyGateSiteEvent } from "./gate-notification-events";
import {
  assembleShiftSnapshot,
  type ShiftRecord,
  type ShiftItem,
  type ShiftSnapshot,
  type ShiftFact,
} from "./gate-change-over-snapshot";

export class ChangeOverError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
const fail = (status: number, code: string, text: string): never => {
  throw new ChangeOverError(status, `change_over.${code}`, text);
};
type Queryable = Pick<PoolClient, "query">;
export async function changeOverTransaction<T>(
  work: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL lock_timeout = '5s'");
    await client.query("SET LOCAL statement_timeout = '15s'");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

/** Re-evaluate database authorization even for valid signed sessions. */
export async function requireChangeOverAccess(
  client: Queryable,
  session: SessionPayload,
  siteId: number,
) {
  if (!session.userId || !Number.isSafeInteger(siteId) || siteId < 1)
    return fail(403, "forbidden", "Assigned gate access required");
  const user = (
    await client.query(
      "SELECT id, role, session_version, suspended_at, display_name FROM users WHERE id=$1",
      [session.userId],
    )
  ).rows[0];
  if (!user || user.suspended_at || user.session_version !== session.sv)
    return fail(401, "session_changed", "Sign in again to continue");
  const site = (
    await client.query(
      "SELECT id, name, partner_id FROM site_locations WHERE id=$1 AND is_active IS DISTINCT FROM false AND hidden IS DISTINCT FROM true",
      [siteId],
    )
  ).rows[0];
  if (!site) return fail(403, "forbidden", "Site unavailable");
  if (session.role === "admin" && user.role === "admin")
    return { supervisor: true, site, user };
  if (session.role === "partner" && session.partnerId === site.partner_id) {
    const membership = await client.query(
      "SELECT id FROM user_org_memberships WHERE user_id=$1 AND partner_id=$2 AND org_type='partner' AND ($3::int IS NULL OR id=$3) AND role IN ('admin','member')",
      [session.userId, session.partnerId, session.activeMembershipId ?? null],
    );
    if (membership.rowCount) return { supervisor: true, site, user };
  }
  if (
    !["vendor", "field_employee"].includes(session.role ?? "") ||
    !session.vendorId
  )
    return fail(403, "forbidden", "Assigned gate access required");
  const assigned = await client.query(
    "SELECT id FROM site_work_assignments WHERE vendor_id=$1 AND site_location_id=$2 LIMIT 1",
    [session.vendorId, siteId],
  );
  if (!assigned.rowCount)
    return fail(403, "forbidden", "You are not assigned to this site");
  const membership = await client.query(
    "SELECT id, vendor_people_id FROM user_org_memberships WHERE user_id=$1 AND vendor_id=$2 AND org_type='vendor' AND ($3::int IS NULL OR id=$3)",
    [session.userId, session.vendorId, session.activeMembershipId ?? null],
  );
  if (!membership.rowCount)
    return fail(403, "forbidden", "Current company membership required");
  if (session.managedSubcontractor) {
    const grants = await client.query(
      `SELECT g.role FROM managed_subcontractor_worker_sponsorships w
      JOIN managed_subcontractor_role_grants g ON g.sponsorship_id=w.id
      WHERE w.worker_user_id=$1 AND w.sponsor_vendor_id=$2 AND w.status='active'
      AND g.site_id=$3 AND g.status='active' AND g.role IN ('gatekeeper','gate_supervisor')`,
      [session.userId, session.vendorId, siteId],
    );
    if (grants.rowCount)
      return {
        supervisor: grants.rows.some((r) => r.role === "gate_supervisor"),
        site,
        user,
      };
  } else {
    const staff = await client.query(
      "SELECT vendor_role FROM vendor_people WHERE user_id=$1 AND vendor_id=$2 AND deleted_at IS NULL AND is_active=true AND vendor_role IN ('gatekeeper','gate_supervisor')",
      [session.userId, session.vendorId],
    );
    if (staff.rowCount)
      return {
        supervisor: staff.rows.some((r) => r.vendor_role === "gate_supervisor"),
        site,
        user,
      };
  }
  return fail(
    403,
    "forbidden",
    "Current gatekeeper or gate supervisor assignment required",
  );
}

async function stationAccess(
  client: Queryable,
  session: SessionPayload,
  stationId: string,
) {
  const station = (
    await client.query("SELECT * FROM gate_stations WHERE id=$1", [stationId])
  ).rows[0];
  if (!station) return fail(404, "not_found", "Gate not found");
  return {
    station,
    ...(await requireChangeOverAccess(client, session, station.site_id)),
  };
}
async function lockStation(client: PoolClient, stationId: string) {
  await client.query("SELECT id FROM gate_stations WHERE id=$1 FOR UPDATE", [
    stationId,
  ]);
}
async function activeShift(client: Queryable, stationId: string) {
  return (
    (
      await client.query(
        "SELECT s.*, u.display_name AS operator_name FROM gate_shifts s JOIN users u ON u.id=s.operator_id WHERE station_id=$1 AND ended_at IS NULL",
        [stationId],
      )
    ).rows[0] ?? null
  );
}
async function activeDutyMember(
  client: Queryable,
  stationId: string,
  userId: number | undefined,
) {
  if (!userId) return false;
  return Boolean(
    (
      await client.query(
        "SELECT 1 FROM gate_duty_sessions WHERE station_id=$1 AND user_id=$2 AND ended_at IS NULL LIMIT 1",
        [stationId, userId],
      )
    ).rowCount,
  );
}
async function activeRoster(client: Queryable, stationId: string) {
  return (
    await client.query(
      `SELECT d.id,d.station_id AS "stationId",d.user_id AS "userId",
        d.work_hub_shift_id AS "workHubShiftId",d.work_session_id AS "workSessionId",
        d.started_at AS "startedAt",coalesce(u.display_name,u.username) AS "userName"
       FROM gate_duty_sessions d JOIN users u ON u.id=d.user_id
       WHERE d.station_id=$1 AND d.ended_at IS NULL
       ORDER BY d.started_at,d.id`,
      [stationId],
    )
  ).rows;
}
async function currentItems(
  client: Queryable,
  stationId: string,
): Promise<ShiftItem[]> {
  const rows = (
    await client.query(
      `SELECT DISTINCT ON (item_id) item_id AS id, text, kind,
    CASE WHEN kind='resolve' THEN 'resolved' ELSE 'open' END AS status FROM gate_shift_actions
    WHERE station_id=$1 AND kind IN ('open','resolve','reopen') ORDER BY item_id, created_at DESC, id DESC`,
      [stationId],
    )
  ).rows;
  return rows.map((r) => ({ id: r.id, text: r.text, status: r.status }));
}
async function snapshot(
  client: Queryable,
  siteId: number,
  stationId: string,
  startedAt: Date | string,
): Promise<ShiftSnapshot> {
  // Consistent source rows, without leaking phone/email or unrelated account data.
  const result = await client.query(
    `SELECT 'visit:' || id AS id, 'visitor' AS kind,
    trim(first_name || ' ' || last_name) AS name, company,
    CASE WHEN vehicle_plate IS NULL THEN NULL ELSE coalesce(plate_state,'?') || ':' || vehicle_plate END AS plate,
    check_in_time AS "checkIn", check_out_time AS "checkOut", admission_status AS admission,
    expected_duration_minutes AS "expectedMinutes", reconciliation_state AS reconciliation,
    concat_ws(E'\\n', notes, check_out_notes, conflict_reason) AS notes
    FROM site_visits WHERE site_location_id=$1 AND (check_out_time IS NULL OR check_out_time >= $2 OR check_in_time >= $2)
    UNION ALL
    SELECT 'checkin:' || c.id, 'employee', trim(p.first_name || ' ' || p.last_name), v.name, NULL,
    c.check_in_at, c.check_out_at, NULL, NULL, NULL, NULL
    FROM ticket_check_ins c JOIN tickets t ON t.id=c.ticket_id
    JOIN vendor_people p ON p.id=c.employee_id AND p.vendor_id=t.vendor_id
    JOIN vendors v ON v.id=t.vendor_id WHERE t.site_location_id=$1
    AND (c.check_out_at IS NULL OR c.check_out_at >= $2 OR c.check_in_at >= $2)
    ORDER BY id LIMIT 25001`,
    [siteId, startedAt],
  );
  if (result.rows.length > 25000)
    return fail(
      413,
      "too_large",
      "Shift exceeds the safe snapshot limit; contact a supervisor",
    );
  const records: ShiftRecord[] = result.rows.map((r) => ({
    ...r,
    checkIn: new Date(r.checkIn).toISOString(),
    checkOut: r.checkOut ? new Date(r.checkOut).toISOString() : null,
  }));
  return assembleShiftSnapshot(
    records,
    await currentItems(client, stationId),
    new Date(startedAt).toISOString(),
  );
}
export async function listChangeOverSites(session: SessionPayload) {
  const sites = (
    await pool.query(
      `SELECT s.id, s.name FROM site_locations s WHERE s.is_active IS DISTINCT FROM false AND s.hidden IS DISTINCT FROM true
    AND ($1='admin' OR ($1='partner' AND s.partner_id=$2) OR EXISTS (SELECT 1 FROM site_work_assignments a WHERE a.site_location_id=s.id AND a.vendor_id=$3))
    AND (
      $1 IN ('admin','partner')
      OR EXISTS (
        SELECT 1 FROM gate_shifts active_shift
        JOIN gate_stations active_station ON active_station.id=active_shift.station_id
        WHERE active_shift.operator_id=$4 AND active_shift.ended_at IS NULL AND active_station.site_id=s.id
      )
      OR EXISTS (
        SELECT 1 FROM gate_duty_sessions duty
        JOIN gate_stations duty_station ON duty_station.id=duty.station_id
        WHERE duty.user_id=$4 AND duty.ended_at IS NULL AND duty_station.site_id=s.id
      )
      OR EXISTS (
        SELECT 1 FROM gate_work_sessions work_session
        JOIN work_hub_shifts work_shift ON work_shift.id=work_session.work_hub_shift_id
        LEFT JOIN gate_stations work_station ON work_station.id=work_shift.gate_station_id
        WHERE work_session.user_id=$4 AND work_session.ended_at IS NULL
          AND coalesce(work_shift.site_location_id,work_station.site_id)=s.id
      )
      OR EXISTS (
        SELECT 1 FROM work_hub_shift_assignments assignment
        JOIN work_hub_shifts scheduled_shift ON scheduled_shift.id=assignment.shift_id
        LEFT JOIN gate_stations scheduled_station ON scheduled_station.id=scheduled_shift.gate_station_id
        WHERE assignment.user_id=$4
          AND assignment.status NOT IN ('cancelled','declined')
          AND scheduled_shift.milestone_status <> 'cancelled'
          AND scheduled_shift.ends_at >= now()
          AND coalesce(scheduled_shift.site_location_id,scheduled_station.site_id)=s.id
      )
    )
    ORDER BY s.name LIMIT 2000`,
      [
        session.role,
        session.partnerId ?? null,
        session.vendorId ?? null,
        session.userId ?? null,
      ],
    )
  ).rows;
  const allowed: { id: number; name: string; supervisor: boolean }[] = [];
  for (const site of sites) {
    try {
      const access = await requireChangeOverAccess(pool, session, site.id);
      allowed.push({
        ...site,
        supervisor: access.supervisor,
      } as (typeof allowed)[number]);
    } catch (e) {
      if (!(e instanceof ChangeOverError) || e.status === 401) throw e;
    }
  }
  return allowed;
}
export async function listChangeOverStations(
  session: SessionPayload,
  siteId: number,
) {
  await requireChangeOverAccess(pool, session, siteId);
  return (
    await pool.query(
      `SELECT station.id, station.name, station.site_id
       FROM gate_stations station
       WHERE station.site_id=$1
         AND (
           $2 IN ('admin','partner')
           OR EXISTS (
             SELECT 1 FROM gate_shifts active_shift
             WHERE active_shift.station_id=station.id AND active_shift.operator_id=$3 AND active_shift.ended_at IS NULL
           )
           OR EXISTS (
             SELECT 1 FROM gate_duty_sessions duty
             WHERE duty.station_id=station.id AND duty.user_id=$3 AND duty.ended_at IS NULL
           )
           OR EXISTS (
             SELECT 1 FROM gate_work_sessions work_session
             JOIN work_hub_shifts work_shift ON work_shift.id=work_session.work_hub_shift_id
             WHERE work_shift.gate_station_id=station.id AND work_session.user_id=$3 AND work_session.ended_at IS NULL
           )
           OR EXISTS (
             SELECT 1 FROM work_hub_shift_assignments assignment
             JOIN work_hub_shifts scheduled_shift ON scheduled_shift.id=assignment.shift_id
             WHERE assignment.user_id=$3
               AND assignment.status NOT IN ('cancelled','declined')
               AND scheduled_shift.milestone_status <> 'cancelled'
               AND scheduled_shift.ends_at >= now()
               AND scheduled_shift.gate_station_id=station.id
           )
         )
       ORDER BY station.created_at, station.id`,
      [siteId, session.role, session.userId ?? null],
    )
  ).rows;
}
export async function addChangeOverStation(
  session: SessionPayload,
  siteId: number,
  name: string,
) {
  return changeOverTransaction(async (c) => {
    if (!(await requireChangeOverAccess(c, session, siteId)).supervisor)
      return fail(403, "supervisor_required", "Supervisor access required");
    return (
      await c.query(
        "INSERT INTO gate_stations(site_id,name) VALUES($1,$2) ON CONFLICT(site_id,name) DO UPDATE SET name=excluded.name RETURNING *",
        [siteId, name],
      )
    ).rows[0];
  });
}
export async function getChangeOverState(
  session: SessionPayload,
  stationId: string,
) {
  return changeOverTransaction(async (c) => {
    await c.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
    const access = await stationAccess(c, session, stationId);
    const shift = await activeShift(c, stationId);
    const preparation = shift?.preparation_id
      ? (
          await c.query("SELECT * FROM gate_preparations WHERE id=$1", [
            shift.preparation_id,
          ])
        ).rows[0]
      : null;
    const current = shift
      ? await snapshot(c, access.station.site_id, stationId, shift.started_at)
      : null;
    return {
      station: access.station,
      site: access.site,
      supervisor: access.supervisor,
      shift,
      preparation,
      snapshot: current,
      stale: Boolean(
        preparation &&
        (preparation.snapshot.revision !== current?.revision ||
          Date.now() - new Date(preparation.created_at).getTime() > 5 * 60000),
      ),
      items: await currentItems(c, stationId),
      roster: await activeRoster(c, stationId),
    };
  });
}
export async function startGateShift(
  session: SessionPayload,
  stationId: string,
) {
  return changeOverTransaction(async (c) => {
    await stationAccess(c, session, stationId);
    await lockStation(c, stationId);
    const shift = await activeShift(c, stationId);
    if (shift) {
      if (shift.operator_id === session.userId) return shift;
      return fail(
        409,
        "occupied",
        "This gate has an active shift; use Change Over to accept it",
      );
    }
    return (
      await c.query(
        "INSERT INTO gate_shifts(station_id,operator_id) VALUES($1,$2) RETURNING *",
        [stationId, session.userId],
      )
    ).rows[0];
  });
}
export async function prepareGateHandoff(
  session: SessionPayload,
  stationId: string,
  notes: string,
  summarize: (
    facts: ShiftFact[],
  ) => Promise<{ source: string; facts: ShiftFact[] }>,
) {
  const state = await getChangeOverState(session, stationId);
  if (
    !state.shift ||
    (state.shift.operator_id !== session.userId &&
      !(await activeDutyMember(pool, stationId, session.userId)))
  )
    return fail(
      403,
      "owner_required",
      "Only the current gatekeeper can prepare this shift",
    );
  // Never hold database locks while waiting for an external AI provider.
  const summary = await summarize(state.snapshot!.facts);
  return changeOverTransaction(async (c) => {
    await stationAccess(c, session, stationId);
    await lockStation(c, stationId);
    const shift = await activeShift(c, stationId);
    if (
      !shift ||
      shift.id !== state.shift.id ||
      (shift.operator_id !== session.userId &&
        !(await activeDutyMember(c, stationId, session.userId)))
    )
      return fail(409, "shift_changed", "Shift changed; refresh Change Over");
    const preparation = (
      await c.query(
        "INSERT INTO gate_preparations(shift_id,prepared_by,snapshot,notes,summary) VALUES($1,$2,$3,$4,$5) RETURNING *",
        [
          shift.id,
          session.userId,
          JSON.stringify(state.snapshot),
          notes,
          JSON.stringify(summary),
        ],
      )
    ).rows[0];
    await c.query("UPDATE gate_shifts SET preparation_id=$1 WHERE id=$2", [
      preparation.id,
      shift.id,
    ]);
    return preparation;
  });
}
export async function cancelGateHandoff(
  session: SessionPayload,
  stationId: string,
  reason: string,
) {
  return changeOverTransaction(async (c) => {
    const access = await stationAccess(c, session, stationId);
    await lockStation(c, stationId);
    const shift = await activeShift(c, stationId);
    if (!shift || (shift.operator_id !== session.userId && !access.supervisor))
      return fail(
        403,
        "owner_required",
        "Current gatekeeper or supervisor required",
      );
    if (shift.preparation_id) {
      await c.query(
        "INSERT INTO gate_shift_actions(station_id,actor_id,item_id,kind,text) VALUES($1,$2,$3,'cancel',$4)",
        [stationId, session.userId, shift.preparation_id, reason],
      );
      await c.query("UPDATE gate_shifts SET preparation_id=NULL WHERE id=$1", [
        shift.id,
      ]);
    }
    return { cancelled: true };
  });
}
/** A signed-in supervisor explicitly accepts responsibility for an abandoned shift. */
export async function recoverGateShift(
  session: SessionPayload,
  stationId: string,
  expectedShiftId: string,
  reason: string,
) {
  return changeOverTransaction(async (c) => {
    await c.query(
      "LOCK TABLE site_visits, ticket_check_ins, tickets, vendor_people, users, user_org_memberships, site_work_assignments, managed_subcontractor_worker_sponsorships, managed_subcontractor_role_grants IN SHARE ROW EXCLUSIVE MODE",
    );
    const access = await stationAccess(c, session, stationId);
    if (!access.supervisor)
      return fail(403, "supervisor_required", "Supervisor access required");
    await lockStation(c, stationId);
    const shift = await activeShift(c, stationId);
    if (
      !shift ||
      shift.id !== expectedShiftId ||
      shift.operator_id === session.userId
    )
      return fail(
        409,
        "shift_changed",
        "Shift changed; refresh before accepting responsibility",
      );
    const facts = await snapshot(
      c,
      access.station.site_id,
      stationId,
      shift.started_at,
    );
    const previous = shift.preparation_id
      ? (
          await c.query("SELECT notes FROM gate_preparations WHERE id=$1", [
            shift.preparation_id,
          ])
        ).rows[0]?.notes
      : "";
    const notes = `Supervisor recovery: ${reason}${previous ? `\nPrevious outgoing notes: ${previous}` : ""}`;
    const prep = (
      await c.query(
        "INSERT INTO gate_preparations(shift_id,prepared_by,snapshot,notes,summary) VALUES($1,$2,$3,$4,$5) RETURNING id",
        [
          shift.id,
          session.userId,
          JSON.stringify(facts),
          notes,
          JSON.stringify({ source: "structured_facts", facts: facts.facts }),
        ],
      )
    ).rows[0];
    const now = new Date();
    await c.query(
      "UPDATE gate_shifts SET ended_at=$1, preparation_id=$2 WHERE id=$3",
      [now, prep.id, shift.id],
    );
    const next = (
      await c.query(
        "INSERT INTO gate_shifts(station_id,operator_id,started_at) VALUES($1,$2,$3) RETURNING *",
        [stationId, session.userId, now],
      )
    ).rows[0];
    await c.query(
      "INSERT INTO gate_handovers(id,preparation_id,incoming_shift_id,incoming_user_id,outgoing_name,incoming_name,acknowledged_at) VALUES($1,$2,$3,$4,$5,$6,$7)",
      [
        randomUUID(),
        prep.id,
        next.id,
        session.userId,
        shift.operator_name ?? "Gatekeeper",
        access.user.display_name ?? "Supervisor",
        now,
      ],
    );
    await c.query(
      "INSERT INTO gate_shift_actions(station_id,actor_id,item_id,kind,text) VALUES($1,$2,$3,'recovery',$4)",
      [stationId, session.userId, shift.id, reason],
    );
    await c.query(
      "UPDATE users SET session_version=session_version+1 WHERE id=$1",
      [shift.operator_id],
    );
    return next;
  });
}

export async function actOnShiftItem(
  session: SessionPayload,
  stationId: string,
  itemId: string,
  kind: "open" | "resolve" | "reopen",
  text: string,
) {
  return changeOverTransaction(async (c) => {
    const access = await stationAccess(c, session, stationId);
    await lockStation(c, stationId);
    const shift = await activeShift(c, stationId);
    if (!access.supervisor && shift?.operator_id !== session.userId)
      return fail(
        403,
        "owner_required",
        "Current gatekeeper or supervisor required",
      );
    const existing = (await currentItems(c, stationId)).find(
      (i) => i.id === itemId,
    );
    if (kind === "open" && existing)
      return fail(409, "item_exists", "Item already exists");
    if (kind !== "open" && !existing)
      return fail(404, "item_missing", "Item not found");
    if (
      (kind === "resolve" && existing?.status === "resolved") ||
      (kind === "reopen" && existing?.status === "open")
    )
      return fail(409, "item_changed", "Item already changed; refresh");
    return (
      await c.query(
        "INSERT INTO gate_shift_actions(station_id,actor_id,item_id,kind,text) VALUES($1,$2,$3,$4,$5) RETURNING *",
        [
          stationId,
          session.userId,
          itemId,
          kind,
          kind === "open"
            ? text
            : `${existing!.text}\n${kind === "resolve" ? "Resolution" : "Reopened"}: ${text}`,
        ],
      )
    ).rows[0];
  });
}

export async function transferGateShift(
  outgoing: SessionPayload,
  incoming: SessionPayload,
  input: {
    stationId: string;
    preparationId: string;
    revision: string;
    operationId: string;
    acknowledged: boolean;
  },
) {
  if (!input.acknowledged || incoming.userId === outgoing.userId)
    return fail(
      400,
      "acknowledgment_required",
      "A different incoming gatekeeper must acknowledge this handoff",
    );
  let notificationSiteId: number | undefined;
  const result = await changeOverTransaction(async (c) => {
    // Brief SHARE locks cover every writer, including existing visit/checkout
    // paths. No network/provider work occurs inside this atomic boundary.
    await c.query(
      "LOCK TABLE site_visits, ticket_check_ins, tickets, vendor_people, users, user_org_memberships, site_work_assignments, managed_subcontractor_worker_sponsorships, managed_subcontractor_role_grants IN SHARE ROW EXCLUSIVE MODE",
    );
    const access = await stationAccess(c, outgoing, input.stationId);
    const next = await requireChangeOverAccess(
      c,
      incoming,
      access.station.site_id,
    );
    await lockStation(c, input.stationId);
    const previous = (
      await c.query("SELECT * FROM gate_handovers WHERE id=$1", [
        input.operationId,
      ])
    ).rows[0];
    if (previous) {
      if (
        previous.preparation_id !== input.preparationId ||
        previous.incoming_user_id !== incoming.userId
      )
        return fail(409, "operation_conflict", "Operation already used");
      return previous;
    }
    const shift = await activeShift(c, input.stationId);
    if (
      !shift ||
      shift.operator_id !== outgoing.userId ||
      shift.preparation_id !== input.preparationId
    )
      return fail(
        409,
        "shift_changed",
        "This handoff is no longer active; refresh Change Over",
      );
    const prep = (
      await c.query(
        "SELECT * FROM gate_preparations WHERE id=$1 AND shift_id=$2",
        [input.preparationId, shift.id],
      )
    ).rows[0];
    const current = await snapshot(
      c,
      access.station.site_id,
      input.stationId,
      shift.started_at,
    );
    if (
      !prep ||
      prep.snapshot.revision !== input.revision ||
      current.revision !== input.revision ||
      Date.now() - new Date(prep.created_at).getTime() > 5 * 60000
    )
      return fail(
        409,
        "stale",
        "Activity changed or snapshot expired. Refresh the handoff and review it again.",
      );
    const now = new Date();
    await c.query(
      "UPDATE gate_shifts SET ended_at=$1 WHERE id=$2 AND ended_at IS NULL",
      [now, shift.id],
    );
    const nextShift = (
      await c.query(
        "INSERT INTO gate_shifts(station_id,operator_id,started_at) VALUES($1,$2,$3) RETURNING id",
        [input.stationId, incoming.userId, now],
      )
    ).rows[0];
    const handover = (
      await c.query(
        `INSERT INTO gate_handovers(id,preparation_id,incoming_shift_id,incoming_user_id,outgoing_name,incoming_name,acknowledged_at)
      VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [
          input.operationId,
          prep.id,
          nextShift.id,
          incoming.userId,
          access.user.display_name ?? "Gatekeeper",
          next.user.display_name ?? "Gatekeeper",
          now,
        ],
      )
    ).rows[0];
    // Same revocation mechanism as Sign Out; rollback also restores this version.
    await c.query(
      "UPDATE users SET session_version=session_version+1 WHERE id=$1",
      [outgoing.userId],
    );
    notificationSiteId = access.station.site_id;
    return handover;
  });
  if (notificationSiteId !== undefined) await notifyGateSiteEvent(notificationSiteId, {
    type: "gate_handoff_ready", title: "Gate handoff completed",
    body: "The acknowledged shift handoff is ready to review.",
    link: `/shift-notes?stationId=${input.stationId}&handoffId=${result.id}`,
    dedupeKey: `gate-handoff:${result.id}:1`,
  });
  return result;
}

export async function getShiftNotes(
  session: SessionPayload,
  input: { stationId: string; days?: number; before?: string; search?: string },
) {
  await stationAccess(pool, session, input.stationId);
  const days = input.days ?? 7;
  if (!Number.isInteger(days) || days < 1 || days > 3650)
    return fail(400, "invalid_range", "Choose between 1 and 3650 days");
  const before = input.before ? new Date(input.before) : new Date();
  if (!Number.isFinite(before.getTime()))
    return fail(400, "invalid_cursor", "Invalid notes cursor");
  const from = new Date(Date.now() - days * 86400000);
  const result = await pool.query(
    `SELECT h.*, p.snapshot, p.notes, p.summary, s.started_at, s.ended_at, s.station_id
    FROM gate_handovers h JOIN gate_preparations p ON p.id=h.preparation_id JOIN gate_shifts s ON s.id=p.shift_id
    WHERE s.station_id=$1 AND h.acknowledged_at >= $2 AND h.acknowledged_at < $3
    AND position(lower($4) in lower(p.notes || ' ' || p.snapshot::text || ' ' || h.outgoing_name || ' ' || h.incoming_name)) > 0
    ORDER BY h.acknowledged_at DESC, h.id DESC LIMIT 51`,
    [input.stationId, from, before, (input.search ?? "").slice(0, 200)],
  );
  const rows = result.rows.slice(0, 50);
  const actions = (
    await pool.query(
      "SELECT a.*, u.display_name AS actor_name FROM gate_shift_actions a JOIN users u ON u.id=a.actor_id WHERE station_id=$1 AND a.created_at >= $2 ORDER BY a.created_at DESC LIMIT 100",
      [input.stationId, from],
    )
  ).rows;
  return {
    rows,
    nextBefore:
      result.rows.length > 50
        ? new Date(rows[49].acknowledged_at).toISOString()
        : null,
    actions,
    from: from.toISOString(),
    retention: "History is retained; this date range is a display filter.",
  };
}
