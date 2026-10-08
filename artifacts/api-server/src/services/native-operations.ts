import {
  requireLiveTicketAssignment,
  LiveTicketAssignmentError,
} from "./live-ticket-assignment";
import { NativeDiagnosticSchema } from "./native-support";
import { z } from "zod/v4";
import {
  getObjectStore,
  renewObjectUploadDescriptor,
} from "../lib/objectStore";
import { randomUUID, createHash } from "node:crypto";
import { pool } from "@workspace/db";
import type { PoolClient } from "pg";
import type { SessionPayload } from "../lib/session";
import {
  NativePolicySchema,
  NativeRequestInputSchema,
  NativeResponseInputSchema,
  initialNativeState,
  effectiveDuty,
  nativeDutyContactAvailable,
  requestExpiry,
  locationEligibility,
  responseDisposition,
  validateFreshLocation,
  NativeOperationError,
  type NativeState,
  type NativeRequest,
  type NativePolicy,
} from "./native-operations-policy";
import { fanOutPersistedWorkHubEvent } from "../work-hub/events";
import { ownedTicketPhoto } from "./ticket-photo-association";

type Owner = { type: "vendor" | "partner"; id: number };
const owner = (s: SessionPayload): Owner => {
  if (s.vendorId) return { type: "vendor", id: s.vendorId };
  if (s.partnerId) return { type: "partner", id: s.partnerId };
  throw new NativeOperationError("native.organization_required", 403);
};
async function current(client: PoolClient, s: SessionPayload) {
  if (!s.userId) throw new NativeOperationError("auth.unauthenticated", 401);
  const user = await client.query(
    "SELECT session_version,suspended_at,must_change_password FROM users WHERE id=$1 FOR SHARE",
    [s.userId],
  );
  if (
    !user.rows.length ||
    user.rows[0].suspended_at ||
    user.rows[0].must_change_password ||
    !s.sv ||
    user.rows[0].session_version !== s.sv
  )
    throw new NativeOperationError("native.current_session_required", 403);
  const o = owner(s);
  const rows = await client.query(
    "SELECT role FROM user_org_memberships WHERE user_id=$1 AND org_type=$2 AND (vendor_id=$3 OR partner_id=$3) FOR SHARE",
    [s.userId, o.type, o.id],
  );
  if (!rows.rows.length)
    throw new NativeOperationError("native.membership_required", 403);
  return { owner: o, admin: rows.rows.some((r) => r.role === "admin") };
}
async function policy(client: PoolClient, o: Owner): Promise<NativePolicy> {
  const r = await client.query(
    `SELECT native_operations_policy FROM ${o.type === "vendor" ? "vendors" : "partners"} WHERE id=$1 FOR SHARE`,
    [o.id],
  );
  if (!r.rows.length)
    throw new NativeOperationError("native.organization_not_found", 404);
  return NativePolicySchema.parse(r.rows[0].native_operations_policy ?? {});
}
export async function getNativeCompanyPolicy(s: SessionPayload) {
  const c = await pool.connect();
  try {
    const a = await current(c, s);
    return await policy(c, a.owner);
  } finally {
    c.release();
  }
}
async function state(
  client: PoolClient,
  userId: number,
  vendorId: number,
): Promise<NativeState> {
  const r = await client.query(
    "SELECT native_operations FROM work_hub_device_preferences WHERE user_id=$1 AND owner_org_type='vendor' AND owner_org_id=$2",
    [userId, vendorId],
  );
  const value: NativeState = {
    ...initialNativeState(),
    ...(r.rows[0]?.native_operations ?? {}),
  };
  if (
    value.duty.active &&
    value.duty.mode === "ticket" &&
    value.duty.ticketId
  ) {
    const ticket = await client.query(
      "SELECT status,lifecycle_state FROM tickets t WHERE id=$1 AND vendor_id=$2 AND (t.field_employee_id IN(SELECT id FROM vendor_people WHERE user_id=$3 AND vendor_id=$2 AND is_active=true AND deleted_at IS NULL) OR t.foreman_user_id=$3 OR t.acting_foreman_user_id=$3 OR EXISTS(SELECT 1 FROM ticket_crew tc JOIN vendor_people vp ON vp.id=tc.employee_id WHERE tc.ticket_id=t.id AND vp.user_id=$3 AND tc.removed_at IS NULL AND vp.is_active=true AND vp.deleted_at IS NULL))",
      [value.duty.ticketId, vendorId, userId],
    );
    if (
      !ticket.rows.length ||
      ticket.rows[0].status !== "in_progress" ||
      ticket.rows[0].lifecycle_state !== "on_site"
    )
      value.duty = { ...value.duty, active: false };
  }
  if (value.duty.active && value.duty.mode === "scheduled") {
    const shift = await client.query(
      "SELECT sh.ends_at FROM work_hub_shifts sh JOIN work_hub_shift_assignments a ON a.shift_id=sh.id WHERE sh.id=$1 AND a.user_id=$2 AND sh.owner_org_type='vendor' AND sh.owner_org_id=$3 AND a.status IN('assigned','accepted') AND sh.starts_at<=now() AND sh.ends_at>now() AND sh.milestone_status<>'cancelled'",
      [value.duty.shiftId, userId, vendorId],
    );
    if (!shift.rows.length) value.duty = { ...value.duty, active: false };
    else value.duty.endsAt = new Date(shift.rows[0].ends_at).toISOString();
  }
  value.consent = { automaticArrival: false, ...value.consent };
  return value;
}
async function saveState(
  c: PoolClient,
  userId: number,
  vendorId: number,
  value: NativeState,
) {
  await c.query(
    "INSERT INTO work_hub_device_preferences(user_id,owner_org_type,owner_org_id,native_operations) VALUES($1,'vendor',$2,$3::jsonb) ON CONFLICT(user_id,owner_org_type,owner_org_id) DO UPDATE SET native_operations=EXCLUDED.native_operations,updated_at=now()",
    [userId, vendorId, JSON.stringify(value)],
  );
}
const outbox = new WeakMap<
  PoolClient,
  { events: any[]; notices: any[]; wakes?: NativeRequest[] }
>();
async function event(
  c: PoolClient,
  userId: number,
  vendorId: number,
  payload: Record<string, unknown>,
  type = "native.operation",
) {
  const row = await c.query(
    "INSERT INTO work_hub_user_events(user_id,owner_org_type,owner_org_id,event_type,payload,retention_until) VALUES($1,'vendor',$2,$3,$4::jsonb,now()+$5::interval) RETURNING sequence,created_at",
    [
      userId,
      vendorId,
      type,
      JSON.stringify(payload),
      type === "native.diagnostic" ? "90 days" : "365 days",
    ],
  );
  if (row.rows[0])
    outbox.get(c)?.events.push({
      sequence: Number(row.rows[0].sequence),
      userId,
      owner: { type: "vendor", id: vendorId },
      eventType: type,
      payload,
      createdAt: row.rows[0].created_at,
    });
}
async function lock(c: PoolClient, userId: number, vendorId: number) {
  await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
    `native:${vendorId}:${userId}`,
  ]);
}
async function requests(
  c: PoolClient,
  vendorId: number,
  worker?: number,
): Promise<NativeRequest[]> {
  const r = await c.query(
    "SELECT DISTINCT ON(payload->'request'->>'id') payload->'request' AS request FROM work_hub_user_events WHERE owner_org_type='vendor' AND owner_org_id=$1 AND event_type='native.operation' AND payload ? 'request' AND ($2::int IS NULL OR user_id=$2) ORDER BY payload->'request'->>'id',sequence DESC",
    [vendorId, worker ?? null],
  );
  return r.rows.map((r) => r.request);
}
async function workerMember(c: PoolClient, userId: number, vendorId: number) {
  const r = await c.query(
    "SELECT m.id FROM user_org_memberships m JOIN users u ON u.id=m.user_id WHERE m.user_id=$1 AND m.vendor_id=$2 AND u.suspended_at IS NULL",
    [userId, vendorId],
  );
  if (!r.rows.length)
    throw new NativeOperationError("native.worker_not_found", 404);
}
async function scope(
  c: PoolClient,
  s: SessionPayload,
  r: Pick<NativeRequest, "vendorId" | "workerUserId" | "ticketId" | "siteId">,
  creation = false,
) {
  const a = await current(c, s);
  const p = await policy(c, { type: "vendor", id: r.vendorId });
  await workerMember(c, r.workerUserId, r.vendorId);
  if (!p.enabled || (await policy(c, a.owner)).enabled === false)
    throw new NativeOperationError("native.company_opted_out", 403);
  const own =
    s.userId === r.workerUserId &&
    a.owner.type === "vendor" &&
    a.owner.id === r.vendorId;
  const supervisor =
    a.owner.type === "vendor" && a.owner.id === r.vendorId && a.admin;
  const grant =
    a.admin &&
    p.grants.some(
      (g) =>
        g.requesterUserId === s.userId &&
        g.workerUserId === r.workerUserId &&
        (!g.siteId || g.siteId === r.siteId) &&
        (!g.ticketId || g.ticketId === r.ticketId),
    );
  const dutyContact =
    !creation &&
    a.owner.type === "vendor" &&
    a.owner.id === r.vendorId &&
    [
      p.escalation.assignedContactUserId,
      p.escalation.backupContactUserId,
    ].includes(s.userId!);
  if (!(own && !creation) && !supervisor && !grant && !dutyContact)
    throw new NativeOperationError("native.no_access", 403);
  if (r.ticketId) {
    const t = await c.query(
      "SELECT t.id,t.site_location_id FROM tickets t WHERE t.id=$1 AND t.vendor_id=$2 AND (t.field_employee_id IN(SELECT id FROM vendor_people WHERE user_id=$3 AND vendor_id=$2 AND is_active=true AND deleted_at IS NULL) OR t.foreman_user_id=$3 OR t.acting_foreman_user_id=$3 OR EXISTS(SELECT 1 FROM ticket_crew tc JOIN vendor_people vp ON vp.id=tc.employee_id WHERE tc.ticket_id=t.id AND vp.user_id=$3 AND tc.removed_at IS NULL))",
      [r.ticketId, r.vendorId, r.workerUserId],
    );
    if (!t.rows.length || (r.siteId && t.rows[0].site_location_id !== r.siteId))
      throw new NativeOperationError("native.ticket_worker_scope", 403);
  }
  if (r.siteId && !r.ticketId) {
    const assigned = await c.query(
      "SELECT t.id FROM tickets t WHERE t.site_location_id=$1 AND t.vendor_id=$2 AND t.status NOT IN('cancelled','denied','funds_dispersed','approved') AND (t.field_employee_id IN(SELECT id FROM vendor_people WHERE user_id=$3 AND vendor_id=$2 AND is_active=true AND deleted_at IS NULL) OR t.foreman_user_id=$3 OR t.acting_foreman_user_id=$3 OR EXISTS(SELECT 1 FROM ticket_crew tc JOIN vendor_people vp ON vp.id=tc.employee_id WHERE tc.ticket_id=t.id AND vp.user_id=$3 AND vp.is_active=true AND tc.removed_at IS NULL))",
      [r.siteId, r.vendorId, r.workerUserId],
    );
    if (!assigned.rows.length)
      throw new NativeOperationError("native.worker_site_scope", 403);
  }
  if (a.owner.type === "partner") {
    if (!r.siteId) throw new NativeOperationError("native.site_required", 403);
    const site = await c.query(
      "SELECT id FROM site_locations WHERE id=$1 AND partner_id=$2",
      [r.siteId, a.owner.id],
    );
    if (!site.rows.length)
      throw new NativeOperationError("native.site_no_access", 403);
  }
  return { a, p };
}
async function notice(
  c: PoolClient,
  userId: number,
  title: string,
  body: string,
  key: string,
  r?: NativeRequest,
) {
  const needsAck = Boolean(
    r &&
    r.kind === "photo" &&
    ((userId === r.workerUserId && key.endsWith(":requested")) ||
      key.includes(":escalation:")),
  );
  const p = r ? await policy(c, { type: "vendor", id: r.vendorId }) : null;
  const targetDuty =
    r && userId === r.workerUserId ? await state(c, userId, r.vendorId) : null;
  const quiet = targetDuty
    ? !effectiveDuty(targetDuty.duty, Date.now()) &&
      !targetDuty.onCallWindows?.some(
        (w) =>
          Date.parse(w.startsAt) <= Date.now() &&
          Date.parse(w.endsAt) > Date.now(),
      )
    : false;
  const rows = await c.query(
    "INSERT INTO notifications(user_id,type,category,title,body,link,dedupe_key,acknowledgement_required,acknowledgement_due_at,escalation_policy) VALUES($1,'native_operation','system',$2,$3,$4,$5,$6,$7,'native_duty_contacts') ON CONFLICT(user_id,dedupe_key) DO NOTHING RETURNING id",
    [
      userId,
      title,
      body,
      r ? `/work-hub?nativeRequestId=${r.id}` : "/work-hub",
      key,
      needsAck,
      needsAck
        ? new Date(Date.now() + (p?.escalation.intervalMinutes ?? 15) * 60_000)
        : null,
    ],
  );
  if (rows.rows[0])
    outbox.get(c)?.notices.push({
      userId,
      title,
      body,
      notificationId: rows.rows[0].id,
      request: r,
      quiet,
    });
}
async function requesterCurrent(c: PoolClient, r: NativeRequest) {
  const u = await c.query("SELECT session_version FROM users WHERE id=$1", [
    r.requesterUserId,
  ]);
  if (!u.rows.length)
    throw new NativeOperationError("native.requester_revoked", 403);
  const s: SessionPayload = {
    userId: r.requesterUserId,
    sv: u.rows[0].session_version,
    role: r.requesterOrgType,
    ...(r.requesterOrgType === "vendor"
      ? { vendorId: r.requesterOrgId }
      : { partnerId: r.requesterOrgId }),
  };
  await scope(c, s, r, true);
}
async function transaction<T>(
  s: SessionPayload,
  fn: (c: PoolClient) => Promise<T>,
): Promise<T> {
  const c = await pool.connect();
  try {
    outbox.set(c, { events: [], notices: [] });
    await c.query("BEGIN");
    await current(c, s);
    const value = await fn(c);
    await c.query("COMMIT");
    for (const e of outbox.get(c)?.events ?? []) fanOutPersistedWorkHubEvent(e);
    for (const wake of outbox.get(c)?.wakes ?? []) {
      try {
        const { sendNativeLocationWake } =
          await import("./native-location-wake");
        await sendNativeLocationWake(wake);
      } catch {
        /* Persisted pending request is authoritative; no delivery assertion. */
      }
    }
    for (const n of outbox.get(c)?.notices ?? []) {
      try {
        const { fanOutPushToUser } = await import("../routes/notifications");
        await fanOutPushToUser(n.userId, {
          type: "native_operation",
          title: n.title,
          body: n.body,
          notificationId: n.notificationId,
          quiet: n.quiet,
          link: n.request
            ? `/work-hub?nativeRequestId=${n.request.id}`
            : "/work-hub",
          pushData: {
            nativeRequestId: n.request?.id,
            ticketId: n.request?.ticketId,
          },
        });
      } catch {
        /* Saved inbox and result remain authoritative; no delivery assertion. */
      }
    }
    return value;
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    outbox.delete(c);
    c.release();
  }
}
async function find(c: PoolClient, id: string): Promise<NativeRequest> {
  const r = await c.query(
    "SELECT payload->'request' AS request FROM work_hub_user_events WHERE event_type='native.operation' AND payload->'request'->>'id'=$1 ORDER BY sequence DESC LIMIT 1",
    [id],
  );
  if (!r.rows.length)
    throw new NativeOperationError("native.request_not_found", 404);
  return r.rows[0].request;
}
async function refresh(c: PoolClient, r: NativeRequest, persist = true) {
  if (
    [
      "pending",
      "opened",
      "awaiting-worker",
      "delivered",
      "upload-in-progress",
    ].includes(r.state) &&
    Date.parse(r.expiresAt) <= Date.now()
  ) {
    r = {
      ...r,
      state: r.kind === "location" ? "unavailable" : "expired",
      result: {
        reason: r.kind === "location" ? "execution_timeout" : "request_expired",
        late: false,
      },
    };
    if (persist) {
      await event(c, r.workerUserId, r.vendorId, { request: r });
      if (r.kind === "photo") {
        try {
          await requesterCurrent(c, r);
          await notice(
            c,
            r.requesterUserId,
            "Photo request expired",
            "The photo request expired unanswered.",
            `native:${r.id}:expired`,
            r,
          );
        } catch (e) {
          if (!(e instanceof NativeOperationError)) throw e;
        }
      }
    }
  }
  return r;
}
async function grantCandidates(c: PoolClient, vendorId: number) {
  return (
    await c.query(
      'SELECT DISTINCT u.id AS "userId",u.display_name AS "displayName",m.org_type AS "orgType",COALESCE(m.vendor_id,m.partner_id) AS "orgId",sl.id AS "siteId" FROM user_org_memberships m JOIN users u ON u.id=m.user_id LEFT JOIN site_locations sl ON sl.partner_id=m.partner_id AND EXISTS(SELECT 1 FROM tickets t WHERE t.vendor_id=$1 AND t.site_location_id=sl.id) WHERE u.suspended_at IS NULL AND m.role=\'admin\' AND (m.vendor_id=$1 OR sl.id IS NOT NULL)',
      [vendorId],
    )
  ).rows;
}
async function validateGrants(
  c: PoolClient,
  vendorId: number,
  grants: NativePolicy["grants"],
) {
  const candidates = await grantCandidates(c, vendorId);
  for (const g of grants) {
    await workerMember(c, g.workerUserId, vendorId);
    const eligible = candidates.some(
      (p: any) =>
        p.userId === g.requesterUserId &&
        (p.orgType === "vendor" || (g.siteId && p.siteId === g.siteId)),
    );
    if (!eligible)
      throw new NativeOperationError("native.supervisor_grant_scope", 403);
    if (g.ticketId) {
      const t = await c.query(
        "SELECT t.id,t.site_location_id FROM tickets t WHERE t.id=$1 AND t.vendor_id=$2 AND (t.field_employee_id IN(SELECT id FROM vendor_people WHERE user_id=$3 AND vendor_id=$2 AND is_active=true AND deleted_at IS NULL) OR t.foreman_user_id=$3 OR t.acting_foreman_user_id=$3 OR EXISTS(SELECT 1 FROM ticket_crew tc JOIN vendor_people vp ON vp.id=tc.employee_id WHERE tc.ticket_id=t.id AND vp.user_id=$3 AND tc.removed_at IS NULL))",
        [g.ticketId, vendorId, g.workerUserId],
      );
      if (
        !t.rows.length ||
        (g.siteId && t.rows[0].site_location_id !== g.siteId)
      )
        throw new NativeOperationError("native.supervisor_grant_scope", 403);
    }
  }
}
async function projections(
  c: PoolClient,
  s: SessionPayload,
  a: { owner: Owner; admin: boolean },
) {
  const tickets = await c.query(
    'SELECT DISTINCT t.id,t.id AS "ticketNumber",t.vendor_id AS "vendorId",t.site_location_id AS "siteLocationId",t.status,t.lifecycle_state AS "lifecycleState",t.updated_at AS "lastUpdate",sl.name AS "siteName" FROM tickets t JOIN site_locations sl ON sl.id=t.site_location_id WHERE (t.vendor_id=$1 AND $2::boolean) OR (t.vendor_id=$1 AND (t.field_employee_id IN(SELECT id FROM vendor_people WHERE user_id=$3 AND is_active=true AND deleted_at IS NULL) OR t.foreman_user_id=$3 OR t.acting_foreman_user_id=$3 OR EXISTS(SELECT 1 FROM ticket_crew tc JOIN vendor_people vp ON vp.id=tc.employee_id WHERE tc.ticket_id=t.id AND vp.user_id=$3 AND vp.vendor_id=$1 AND vp.is_active=true AND vp.deleted_at IS NULL AND tc.removed_at IS NULL))) ORDER BY t.updated_at DESC LIMIT 100',
    [a.owner.type === "vendor" ? a.owner.id : null, a.admin, s.userId],
  );
  const gate = await c.query(
    'SELECT g.id,g.started_at AS "startedAt",g.eta_at AS "etaAt",g.travel_status AS status FROM gate_work_sessions g WHERE g.user_id=$1 AND g.owner_org_type=$2 AND g.owner_org_id=$3 AND g.ended_at IS NULL',
    [s.userId, a.owner.type, a.owner.id],
  );
  const fleet =
    a.owner.type === "vendor"
      ? await c.query("SELECT fleet_ops_state FROM vendors WHERE id=$1", [
          a.owner.id,
        ])
      : { rows: [] };
  const fleetState = fleet.rows[0]?.fleet_ops_state;
  const fleetGrant = fleetState?.grants?.find(
    (g: any) => g.userId === s.userId,
  );
  const runs = (
    fleetState?.enabled && fleetGrant?.roles?.length ? fleetState.runs : []
  ).filter(
    (r: any) =>
      fleetGrant.fleetIds?.includes(r.fleetId) &&
      r.siteIds?.every((id: number) => fleetGrant.siteIds?.includes(id)) &&
      r.driverUserId === s.userId &&
      !["completed", "cancelled"].includes(r.status),
  );
  const tasks = [
    ...tickets.rows
      .filter(
        (t: any) =>
          !["cancelled", "denied", "funds_dispersed", "approved"].includes(
            t.status,
          ),
      )
      .map((t: any) => ({
        kind: "ticket",
        id: String(t.id),
        identifier: String(t.id),
        site: t.siteName,
        status: t.status,
        lastUpdate: t.lastUpdate,
      })),
    ...gate.rows.map((g: any) => ({
      kind: "gate",
      id: g.id,
      identifier: g.id,
      status: g.status,
      startedAt: g.startedAt,
      eta: g.etaAt,
    })),
    ...runs.map((r: any) => ({
      kind: "fleet",
      id: String(r.id),
      identifier: String(r.id),
      status: r.status,
      lastUpdate: r.updatedAt ?? null,
    })),
  ];
  const shifts = await c.query(
    `SELECT sh.id,sh.title,sh.starts_at AS "startsAt",sh.ends_at AS "endsAt",sh.site_location_id AS "siteLocationId" FROM work_hub_shifts sh JOIN work_hub_shift_assignments a ON a.shift_id=sh.id WHERE a.user_id=$1 AND sh.owner_org_type=$2 AND sh.owner_org_id=$3 AND a.status IN('assigned','accepted') AND sh.ends_at>now() AND sh.milestone_status<>'cancelled' ORDER BY sh.starts_at LIMIT 100`,
    [s.userId, a.owner.type, a.owner.id],
  );
  return {
    shifts: shifts.rows,
    tickets: tickets.rows,
    sites: [
      ...new Map(
        tickets.rows.map((t: any) => [
          t.siteLocationId,
          { id: t.siteLocationId, name: t.siteName },
        ]),
      ).values(),
    ],
    tasks,
  };
}
async function status(c: PoolClient, s: SessionPayload) {
  const a = await current(c, s),
    p = await policy(c, a.owner);
  const vendorId = a.owner.type === "vendor" ? a.owner.id : null;
  const own = vendorId
    ? await state(c, s.userId!, vendorId)
    : initialNativeState();
  own.duty = { ...own.duty, active: effectiveDuty(own.duty, Date.now()) };
  const devices = await c.query(
    'SELECT id,friendly_name AS "friendlyName",device_class AS "deviceClass",revoked_at AS "revokedAt" FROM work_hub_devices WHERE user_id=$1 AND owner_org_type=$2 AND owner_org_id=$3 AND revoked_at IS NULL',
    [s.userId, a.owner.type, a.owner.id],
  );
  const candidates = await c.query(
    "SELECT DISTINCT ON(payload->'request'->>'id') payload->'request' AS request FROM work_hub_user_events WHERE event_type='native.operation' AND payload ? 'request' AND ((owner_org_type='vendor' AND owner_org_id=$1) OR (payload->'request'->>'requesterUserId')::int=$2 OR EXISTS(SELECT 1 FROM vendors v,jsonb_array_elements(COALESCE(v.native_operations_policy->'grants','[]'::jsonb)) g WHERE v.id=owner_org_id AND (g->>'requesterUserId')::int=$2)) ORDER BY payload->'request'->>'id',sequence DESC",
    [vendorId, s.userId],
  );
  const all: NativeRequest[] = candidates.rows.map((r) => r.request);
  const visible = [];
  for (const r of all) {
    try {
      await scope(c, s, r);
      visible.push(await refresh(c, r, false));
    } catch (e) {
      if (!(e instanceof NativeOperationError)) throw e;
    }
  }
  const projection = await projections(c, s, a);
  const workers =
    vendorId && a.admin
      ? await c.query(
          'SELECT u.id AS "userId",u.display_name AS "displayName",m.vendor_id AS "vendorId" FROM user_org_memberships m JOIN users u ON u.id=m.user_id WHERE m.vendor_id=$1 AND u.suspended_at IS NULL',
          [vendorId],
        )
      : await c.query(
          "SELECT DISTINCT u.id AS \"userId\",u.display_name AS \"displayName\",v.id AS \"vendorId\" FROM vendors v,jsonb_array_elements(COALESCE(v.native_operations_policy->'grants','[]'::jsonb)) g JOIN users u ON u.id=(g->>'workerUserId')::int JOIN user_org_memberships m ON m.user_id=u.id WHERE (g->>'requesterUserId')::int=$1 AND m.vendor_id=v.id AND u.suspended_at IS NULL",
          [s.userId],
        );
  const supportCandidates = a.admin
    ? (
        await c.query(
          'SELECT id AS "userId",display_name AS "displayName" FROM users WHERE role=\'admin\' AND suspended_at IS NULL ORDER BY id LIMIT 100',
        )
      ).rows
    : [];
  const eligibleSupervisors =
    vendorId && a.admin ? await grantCandidates(c, vendorId) : [];
  return {
    ...projection,
    grantCandidates: eligibleSupervisors,
    contactCandidates: workers.rows,
    supportCandidates,
    policy: p,
    ...own,
    userId: s.userId,
    vendorId,
    company: a.owner,
    canManagePolicy: a.admin,
    devices: devices.rows,
    workers: workers.rows,
    canRequest: workers.rows.length > 0,
    canWorkerOperate: a.owner.type === "vendor",
    requests: visible,
  };
}
export const NativePhotoUploadInputSchema = z
  .object({
    deviceId: z.uuid(),
    bindingVersion: z.number().int().nonnegative(),
    contentType: z.enum(["image/jpeg", "image/png", "image/webp"]),
    byteSize: z
      .number()
      .int()
      .positive()
      .max(25 * 1024 * 1024),
    checksumSha256: z.string().regex(/^[0-9a-f]{64}$/),
  })
  .strict();
export const nativeOperationsService = {
  shiftResponse: (s: SessionPayload, shiftId: string, raw: unknown) =>
    transaction(s, async (c) => {
      const input = z
        .object({
          operationId: z.uuid(),
          response: z.enum(["accepted", "declined"]),
          reason: z.string().trim().min(1).max(500).optional(),
        })
        .strict()
        .parse(raw);
      if (input.response === "declined" && !input.reason)
        throw new NativeOperationError("native.decline_reason_required", 400);
      const a = await current(c, s),
        p = await policy(c, a.owner);
      if (!p.enabled)
        throw new NativeOperationError("native.company_opted_out", 403);
      await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
        "native-shift-response:" + input.operationId,
      ]);
      const shift = await c.query(
        "SELECT sh.* FROM work_hub_shifts sh WHERE sh.id=$1 AND sh.owner_org_type=$2 AND sh.owner_org_id=$3 FOR UPDATE",
        [shiftId, a.owner.type, a.owner.id],
      );
      if (!shift.rows.length)
        throw new NativeOperationError("native.shift_no_access", 403);
      const assignment = await c.query(
        "SELECT id,status FROM work_hub_shift_assignments WHERE shift_id=$1 AND user_id=$2 FOR UPDATE",
        [shiftId, s.userId],
      );
      if (!assignment.rows.length)
        throw new NativeOperationError("native.shift_no_access", 403);
      const fingerprint = createHash("sha256")
        .update(
          JSON.stringify([
            s.userId,
            a.owner,
            shiftId,
            input.response,
            input.reason ?? null,
          ]),
        )
        .digest("hex");
      const old = await c.query(
        "SELECT user_id,tool_input,tool_output FROM assistant_action_audit WHERE target_type='native-shift-response' AND target_id=$1 ORDER BY id LIMIT 1",
        [input.operationId],
      );
      if (old.rows.length) {
        if (
          old.rows[0].user_id !== s.userId ||
          old.rows[0].tool_input.fingerprint !== fingerprint
        )
          throw new NativeOperationError("native.idempotency_conflict");
        return old.rows[0].tool_output;
      }
      if (
        !["assigned", "accepted"].includes(assignment.rows[0].status) ||
        shift.rows[0].milestone_status === "cancelled" ||
        Date.parse(shift.rows[0].ends_at) <= Date.now()
      )
        throw new NativeOperationError("native.shift_not_respondable");
      if (shift.rows[0].gate_station_id) {
        const station = await c.query(
          "SELECT site_location_id FROM gate_stations WHERE id=$1",
          [shift.rows[0].gate_station_id],
        );
        if (!station.rows.length)
          throw new NativeOperationError("native.shift_no_access", 403);
        const { authorizeOfflineGateObservation } =
          await import("./gate-offline-observation");
        await authorizeOfflineGateObservation(
          c,
          s,
          station.rows[0].site_location_id,
        );
      }
      const result = {
        operationId: input.operationId,
        shiftId,
        assignmentId: assignment.rows[0].id,
        status: input.response,
        reason: input.reason ?? null,
        respondedAt: new Date().toISOString(),
      };
      await c.query(
        "UPDATE work_hub_shift_assignments SET status=$2 WHERE id=$1",
        [result.assignmentId, result.status],
      );
      await c.query(
        "INSERT INTO assistant_action_audit(user_id,actor_role,client_surface,input_mode,provider,tool_name,action_type,target_type,target_id,tool_input,tool_output,result_status) VALUES($1,$2,'api','device_entry','vndrly','respond_own_shift','mutation','native-shift-response',$3,$4::jsonb,$5::jsonb,'success')",
        [
          s.userId,
          s.role,
          input.operationId,
          JSON.stringify({ fingerprint }),
          JSON.stringify(result),
        ],
      );
      await c.query(
        "INSERT INTO work_hub_user_events(user_id,owner_org_type,owner_org_id,event_type,payload,retention_until) VALUES($1,$2,$3,'native.operation',$4::jsonb,now()+interval '365 days')",
        [
          s.userId,
          a.owner.type,
          a.owner.id,
          JSON.stringify({ action: "shift.responded", ...result }),
        ],
      );
      return result;
    }),
  onCall: (s: SessionPayload, raw: unknown) =>
    transaction(s, async (c) => {
      const input = z
        .object({
          windows: z
            .array(
              z
                .object({
                  startsAt: z.iso.datetime(),
                  endsAt: z.iso.datetime(),
                  consent: z.literal(true),
                })
                .strict(),
            )
            .max(30),
        })
        .strict()
        .parse(raw);
      const a = await current(c, s);
      if (a.owner.type !== "vendor")
        throw new NativeOperationError("native.worker_company_required", 403);
      for (const w of input.windows)
        if (
          Date.parse(w.endsAt) <= Date.parse(w.startsAt) ||
          Date.parse(w.endsAt) - Date.parse(w.startsAt) > 7 * 86400000
        )
          throw new NativeOperationError("native.on_call_window_invalid", 400);
      await lock(c, s.userId!, a.owner.id);
      const st = await state(c, s.userId!, a.owner.id);
      st.onCallWindows = input.windows;
      await saveState(c, s.userId!, a.owner.id, st);
      await event(c, s.userId!, a.owner.id, {
        action: "on_call.saved",
        windows: input.windows,
      });
      return status(c, s);
    }),
  acknowledge: (s: SessionPayload, id: string) =>
    transaction(s, async (c) => {
      const r = await find(c, id);
      await lock(c, r.workerUserId, r.vendorId);
      await scope(c, s, r);
      const n = await c.query(
        "UPDATE notifications SET acknowledged_at=COALESCE(acknowledged_at,now()),acknowledged_by_user_id=$1 WHERE user_id=$1 AND (dedupe_key=$2 OR dedupe_key LIKE $3) RETURNING id,acknowledged_at",
        [s.userId, `native:${r.id}:requested`, `native:${r.id}:escalation:%`],
      );
      if (!n.rows.length)
        throw new NativeOperationError("native.notification_not_found", 404);
      await event(c, r.workerUserId, r.vendorId, {
        action: "request.acknowledged",
        requestId: r.id,
        notificationId: n.rows[0].id,
      });
      return {
        requestId: r.id,
        notificationId: n.rows[0].id,
        acknowledgedAt: n.rows[0].acknowledged_at,
      };
    }),

  diagnostics: (s: SessionPayload, raw: unknown) =>
    transaction(s, async (c) => {
      const input = NativeDiagnosticSchema.parse(raw),
        a = await current(c, s);
      const d = await c.query(
        "SELECT id FROM work_hub_devices WHERE id=$1 AND user_id=$2 AND owner_org_type=$3 AND owner_org_id=$4 AND revoked_at IS NULL FOR SHARE",
        [input.deviceId, s.userId, a.owner.type, a.owner.id],
      );
      if (!d.rows.length)
        throw new NativeOperationError("native.device_no_access", 403);
      await c.query(
        "INSERT INTO work_hub_user_events(user_id,owner_org_type,owner_org_id,event_type,payload,retention_until) VALUES($1,$2,$3,'native.diagnostic',$4::jsonb,now()+interval '90 days')",
        [s.userId, a.owner.type, a.owner.id, JSON.stringify(input)],
      );
      return { saved: true, retentionDays: 90 };
    }),

  photoUpload: (s: SessionPayload, id: string, raw: unknown) =>
    transaction(s, async (c) => {
      const input = NativePhotoUploadInputSchema.parse(raw);
      let r = await find(c, id);
      await lock(c, r.workerUserId, r.vendorId);
      r = await find(c, id);
      await scope(c, s, r);
      await requesterCurrent(c, r);
      if (
        s.userId !== r.workerUserId ||
        s.vendorId !== r.vendorId ||
        r.kind !== "photo"
      )
        throw new NativeOperationError("native.worker_photo_required", 403);
      if (["saved", "declined", "unavailable", "cancelled"].includes(r.state))
        throw new NativeOperationError("native.upload_request_finished");
      const st = await state(c, r.workerUserId, r.vendorId);
      const device = await c.query(
        "SELECT id FROM work_hub_devices WHERE id=$1 AND user_id=$2 AND owner_org_type='vendor' AND owner_org_id=$3 AND revoked_at IS NULL FOR SHARE",
        [input.deviceId, s.userId, r.vendorId],
      );
      if (!device.rows.length)
        throw new NativeOperationError("native.device_revoked", 403);
      responseDisposition(
        r,
        st,
        input.deviceId,
        input.bindingVersion,
        Date.now(),
        r.upload ? "saved" : "upload-in-progress",
      );
      if (r.upload) {
        if (
          r.upload.byteSize !== input.byteSize ||
          r.upload.contentType !== input.contentType ||
          r.upload.checksumSha256 !== input.checksumSha256
        )
          throw new NativeOperationError("native.upload_content_conflict");
        return {
          ...renewObjectUploadDescriptor(r.upload.objectPath),
          requestId: r.id,
          operationId: r.id,
        };
      }
      if (!["opened", "awaiting-worker"].includes(r.state))
        throw new NativeOperationError("native.open_photo_first");
      const descriptor = getObjectStore().getUploadDescriptor();
      r.upload = {
        objectPath: descriptor.objectPath,
        checksumSha256: input.checksumSha256,
        byteSize: input.byteSize,
        contentType: input.contentType,
      };
      r.uploadStartedAt = new Date().toISOString();
      r.deviceId = input.deviceId;
      r.bindingVersion = input.bindingVersion;
      r.state = "upload-in-progress";
      await event(c, r.workerUserId, r.vendorId, { request: r });
      return { ...descriptor, requestId: r.id, operationId: r.id };
    }),

  task: (
    s: SessionPayload,
    input: { kind: "ticket" | "gate" | "fleet"; id: string },
  ) =>
    transaction(s, async (c) => {
      const a = await current(c, s);
      if (a.owner.type !== "vendor")
        throw new NativeOperationError("native.worker_company_required", 403);
      await lock(c, s.userId!, a.owner.id);
      const authorized = await projections(c, s, { ...a, admin: false });
      if (
        !authorized.tasks.some(
          (t: any) => t.kind === input.kind && t.id === input.id,
        )
      )
        throw new NativeOperationError("native.task_no_access", 403);
      const st = await state(c, s.userId!, a.owner.id);
      await saveState(c, s.userId!, a.owner.id, {
        ...st,
        selectedTask: input,
      } as NativeState);
      await event(c, s.userId!, a.owner.id, {
        action: "task.selected",
        task: input,
      });
      return status(c, s);
    }),
  status: (s: SessionPayload) => transaction(s, (c) => status(c, s)),
  policy: (s: SessionPayload, input?: unknown) =>
    transaction(s, async (c) => {
      const a = await current(c, s);
      if (!input) return policy(c, a.owner);
      if (!a.admin)
        throw new NativeOperationError("native.admin_required", 403);
      const p = NativePolicySchema.parse(input);
      if (a.owner.type === "partner" && p.grants.length)
        throw new NativeOperationError(
          "native.worker_company_grants_only",
          403,
        );
      if (a.owner.type === "vendor") {
        await validateGrants(c, a.owner.id, p.grants);
        for (const grant of p.supportGrants) {
          if (
            Date.parse(grant.expiresAt) <= Date.now() ||
            Date.parse(grant.expiresAt) > Date.now() + 24 * 3600_000
          )
            throw new NativeOperationError(
              "native.support_grant_expiry_invalid",
              400,
            );
          const u = await c.query(
            "SELECT id FROM users WHERE id=$1 AND role='admin' AND suspended_at IS NULL",
            [grant.userId],
          );
          if (!u.rows.length)
            throw new NativeOperationError("native.support_actor_invalid", 403);
          for (const workerId of grant.workerUserIds)
            await workerMember(c, workerId, a.owner.id);
        }
        for (const contact of [
          p.escalation.assignedContactUserId,
          p.escalation.backupContactUserId,
        ])
          if (contact) await workerMember(c, contact, a.owner.id);
      }
      await c.query(
        `UPDATE ${a.owner.type === "vendor" ? "vendors" : "partners"} SET native_operations_policy=$2::jsonb WHERE id=$1`,
        [a.owner.id, JSON.stringify(p)],
      );
      await c.query(
        "INSERT INTO work_hub_user_events(user_id,owner_org_type,owner_org_id,event_type,payload,retention_until) VALUES($1,$2,$3,'native.operation',$4::jsonb,now()+interval '365 days')",
        [
          s.userId,
          a.owner.type,
          a.owner.id,
          JSON.stringify({ action: "policy.updated", policy: p }),
        ],
      );
      return p;
    }),
  consent: (
    s: SessionPayload,
    input: boolean | { locationSharing: boolean; automaticArrival?: boolean },
  ) =>
    transaction(s, async (c) => {
      const o = owner(s);
      if (o.type !== "vendor")
        throw new NativeOperationError("native.worker_company_required", 403);
      await lock(c, s.userId!, o.id);
      const value = await state(c, s.userId!, o.id);
      const locationSharing =
        typeof input === "boolean" ? input : input.locationSharing;
      value.consent = {
        ...value.consent,
        locationSharing,
        ...(typeof input === "object" && input.automaticArrival !== undefined
          ? { automaticArrival: input.automaticArrival }
          : {}),
      };
      await saveState(c, s.userId!, o.id, value);
      await event(c, s.userId!, o.id, {
        action: "consent.updated",
        ...value.consent,
      });
      return status(c, s);
    }),
  device: (s: SessionPayload, deviceId: string) =>
    transaction(s, async (c) => {
      const o = owner(s);
      if (o.type !== "vendor")
        throw new NativeOperationError("native.worker_company_required", 403);
      await lock(c, s.userId!, o.id);
      const d = await c.query(
        "SELECT id FROM work_hub_devices WHERE id=$1 AND user_id=$2 AND owner_org_type='vendor' AND owner_org_id=$3 AND revoked_at IS NULL AND device_class IN('phone','ios','iphone','mobile')",
        [deviceId, s.userId, o.id],
      );
      if (!d.rows.length)
        throw new NativeOperationError("native.work_phone_required", 403);
      const value = await state(c, s.userId!, o.id);
      if (value.designatedDeviceId !== deviceId) {
        value.designatedDeviceId = deviceId;
        value.bindingVersion++;
        await saveState(c, s.userId!, o.id, value);
        for (const r of await requests(c, o.id, s.userId)) {
          if (
            ["pending", "delivered", "opened", "awaiting-worker"].includes(
              r.state,
            ) &&
            Date.parse(r.expiresAt) > Date.now()
          )
            await event(c, r.workerUserId, r.vendorId, {
              request: { ...r, deviceId, bindingVersion: value.bindingVersion },
            });
        }
        await event(c, s.userId!, o.id, {
          action: "device.designated",
          deviceId,
          bindingVersion: value.bindingVersion,
        });
      }
      return status(c, s);
    }),
  duty: (
    s: SessionPayload,
    input: {
      action: "start" | "end";
      mode: "manual" | "ticket" | "scheduled";
      ticketId?: number;
      shiftId?: string;
    },
  ) =>
    transaction(s, async (c) => {
      const o = owner(s);
      if (o.type !== "vendor")
        throw new NativeOperationError("native.worker_company_required", 403);
      await lock(c, s.userId!, o.id);
      const value = await state(c, s.userId!, o.id);
      const p = await policy(c, o);
      if (input.action === "start") {
        if (!p.enabled || !p.dutyModes.includes(input.mode))
          throw new NativeOperationError("native.duty_disabled", 403);
        const activeShift = await c.query(
          "SELECT sh.ends_at FROM work_hub_shifts sh JOIN work_hub_shift_assignments a ON a.shift_id=sh.id WHERE a.user_id=$1 AND sh.owner_org_type='vendor' AND sh.owner_org_id=$2 AND a.status IN('assigned','accepted') AND sh.starts_at<=now() AND sh.ends_at>now() AND sh.milestone_status<>'cancelled' ORDER BY sh.ends_at LIMIT 1",
          [s.userId, o.id],
        );
        let endsAt: string | null =
          activeShift.rows[0]?.ends_at.toISOString() ?? null;
        if (input.mode === "ticket") {
          if (!input.ticketId)
            throw new NativeOperationError("native.ticket_required", 400);
          await scope(c, s, {
            workerUserId: s.userId!,
            vendorId: o.id,
            ticketId: input.ticketId,
            siteId: null,
          });
          const running = await c.query(
            "SELECT id FROM tickets WHERE id=$1 AND status='in_progress' AND lifecycle_state='on_site'",
            [input.ticketId],
          );
          if (!running.rows.length)
            throw new NativeOperationError("native.ticket_not_on_duty", 409);
        }
        if (input.mode === "scheduled") {
          const shift = await c.query(
            "SELECT sh.ends_at FROM work_hub_shifts sh JOIN work_hub_shift_assignments a ON a.shift_id=sh.id WHERE sh.id=$1 AND a.user_id=$2 AND sh.owner_org_type='vendor' AND sh.owner_org_id=$3 AND a.status IN('assigned','accepted') AND sh.starts_at<=now() AND sh.ends_at>now() AND sh.milestone_status<>'cancelled'",
            [input.shiftId ?? null, s.userId, o.id],
          );
          if (!shift.rows.length)
            throw new NativeOperationError("native.active_shift_required", 403);
          endsAt = shift.rows[0].ends_at.toISOString();
        }
        value.duty = {
          active: true,
          mode: input.mode,
          startedAt: new Date().toISOString(),
          endsAt,
          ticketId: input.ticketId ?? null,
          shiftId: input.shiftId ?? null,
          overrideEndedAt: null,
        };
      } else {
        value.duty = {
          ...value.duty,
          active: false,
          overrideEndedAt: new Date().toISOString(),
        };
        for (const r of await requests(c, o.id, s.userId)) {
          if (
            ["pending", "delivered", "opened", "upload-in-progress"].includes(
              r.state,
            )
          ) {
            await event(c, s.userId!, o.id, {
              request: {
                ...r,
                expiresAt: new Date().toISOString(),
                state: r.kind === "location" ? "unavailable" : "expired",
                result: { reason: "worker_ended_duty", late: false },
              },
            });
            await notice(
              c,
              r.requesterUserId,
              "Worker ended duty",
              "The worker ended duty before fulfilling the request.",
              `native:${r.id}:duty-ended`,
              r,
            );
          }
        }
      }
      await saveState(c, s.userId!, o.id, value);
      if (input.action === "end") {
        const supervisors = await c.query(
          "SELECT user_id FROM user_org_memberships WHERE vendor_id=$1 AND role='admin'",
          [o.id],
        );
        for (const sup of supervisors.rows)
          if (sup.user_id !== s.userId)
            await notice(
              c,
              sup.user_id,
              "Worker ended duty",
              "The worker ended duty; location responses stopped.",
              `native:duty-end:${s.userId}:${value.duty.overrideEndedAt}`,
            );
      }
      await event(c, s.userId!, o.id, {
        action:
          input.action === "end" ? "duty.worker_override" : "duty.started",
        duty: value.duty,
      });
      return status(c, s);
    }),
  list: (s: SessionPayload) =>
    transaction(s, async (c) => ({ requests: (await status(c, s)).requests })),
  read: (s: SessionPayload, id: string) =>
    transaction(s, async (c) => {
      const r = await find(c, id);
      await lock(c, r.workerUserId, r.vendorId);
      await scope(c, s, r);
      return refresh(c, await find(c, id));
    }),
  request: (
    s: SessionPayload,
    input: {
      workerUserId: number;
      vendorId: number;
      kind: "location" | "photo";
      siteId?: number;
      ticketId?: number;
      purpose: string;
      idempotencyKey: string;
      allowLibrary?: boolean;
    },
  ) =>
    transaction(s, async (c) => {
      input = NativeRequestInputSchema.parse(input);
      await lock(c, input.workerUserId, input.vendorId);
      const { a, p } = await scope(
        c,
        s,
        {
          ...input,
          siteId: input.siteId ?? null,
          ticketId: input.ticketId ?? null,
        },
        true,
      );
      if (!p[input.kind === "location" ? "locationRequests" : "photoRequests"])
        throw new NativeOperationError("native.capability_disabled", 403);
      if (input.kind === "photo" && !input.ticketId)
        throw new NativeOperationError("native.ticket_required", 400);
      const prior = await requests(c, input.vendorId, input.workerUserId);
      const duplicate = prior.find(
        (r) =>
          r.requesterUserId === s.userId &&
          r.idempotencyKey === input.idempotencyKey,
      );
      if (duplicate) {
        if (
          duplicate.kind !== input.kind ||
          duplicate.ticketId !== (input.ticketId ?? null) ||
          duplicate.siteId !== (input.siteId ?? null) ||
          duplicate.purpose !== input.purpose ||
          duplicate.allowLibrary !== Boolean(input.allowLibrary)
        )
          throw new NativeOperationError("native.idempotency_conflict");
        return refresh(c, duplicate);
      }
      const now = Date.now();
      if (input.kind === "location") {
        const recent = prior
          .filter(
            (r) =>
              r.kind === "location" && now - Date.parse(r.createdAt) < 300_000,
          )
          .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0];
        if (recent) {
          let authorized: NativeRequest | null = null;
          try {
            await scope(c, s, recent);
            authorized = await refresh(c, recent);
          } catch (error) {
            if (!(error instanceof NativeOperationError)) throw error;
          }
          if (!authorized)
            throw new NativeOperationError("native.location_throttled", 429);
          return {
            ...authorized,
            throttled: true,
            retryAfter: new Date(
              Date.parse(recent.createdAt) + 300_000,
            ).toISOString(),
          };
        }
      }
      const st = await state(c, input.workerUserId, input.vendorId);
      const online = st.designatedDeviceId
        ? await c.query(
            "SELECT 1 FROM work_hub_devices d WHERE d.id=$1 AND d.user_id=$2 AND d.owner_org_type='vendor' AND d.owner_org_id=$3 AND d.revoked_at IS NULL AND (EXISTS(SELECT 1 FROM work_hub_device_connections dc WHERE dc.device_id=d.id AND dc.seen_at>now()-interval '90 seconds') OR EXISTS(SELECT 1 FROM field_push_tokens p WHERE p.user_id=$2 AND p.native_device_id=d.id AND p.retirement_pending=false))",
            [st.designatedDeviceId, input.workerUserId, input.vendorId],
          )
        : { rows: [] };
      const reason =
        input.kind === "location"
          ? locationEligibility(st, !!online.rows.length, now)
          : null;
      const r: NativeRequest = {
        id: randomUUID(),
        ...input,
        requesterUserId: s.userId!,
        requesterOrgType: a.owner.type,
        requesterOrgId: a.owner.id,
        siteId: input.siteId ?? null,
        ticketId: input.ticketId ?? null,
        createdAt: new Date(now).toISOString(),
        expiresAt: requestExpiry(
          input.kind,
          now,
          st.duty.endsAt && Date.parse(st.duty.endsAt) > now
            ? st.duty.endsAt
            : null,
        ),
        deviceId: st.designatedDeviceId,
        bindingVersion: st.bindingVersion,
        state: reason ? "unavailable" : "pending",
        allowLibrary: Boolean(input.allowLibrary),
        result: reason
          ? { reason, lastKnown: st.lastLocation ?? null, late: false }
          : null,
      };
      await event(c, r.workerUserId, r.vendorId, { request: r });
      if (r.kind === "location" && r.state === "pending" && r.deviceId) {
        const queued = outbox.get(c);
        if (queued) (queued.wakes ??= []).push(r);
      }
      if (r.kind === "photo" && !reason)
        await notice(
          c,
          r.workerUserId,
          "Photo requested",
          r.purpose,
          `native:${r.id}:requested`,
          r,
        );
      return r;
    }),
  respond: (
    s: SessionPayload,
    id: string,
    input: {
      deviceId: string;
      bindingVersion: number;
      state: string;
      location?: {
        latitude: number;
        longitude: number;
        accuracy: number;
        capturedAt: string;
      };
      noteId?: number;
      operationId?: string;
      objectPath?: string;
      photoSource?: "camera" | "library";
      photoCapturedAt?: string;
      declineReason?: string;
      note?: string;
    },
  ) =>
    transaction(s, async (c) => {
      input = NativeResponseInputSchema.parse(input);
      let r = await find(c, id);
      await lock(c, r.workerUserId, r.vendorId);
      r = await find(c, id);
      await scope(c, s, r);
      await requesterCurrent(c, r);
      if (s.userId !== r.workerUserId || s.vendorId !== r.vendorId)
        throw new NativeOperationError("native.worker_required", 403);
      const st = await state(c, r.workerUserId, r.vendorId);
      const d = await c.query(
        "SELECT id FROM work_hub_devices WHERE id=$1 AND user_id=$2 AND owner_org_type='vendor' AND owner_org_id=$3 AND revoked_at IS NULL FOR SHARE",
        [input.deviceId, s.userId, r.vendorId],
      );
      if (!d.rows.length)
        throw new NativeOperationError("native.device_revoked", 403);
      const disposition = responseDisposition(
        r,
        st,
        input.deviceId,
        input.bindingVersion,
        Date.now(),
        input.state,
      );
      if (disposition === "replay") return r;
      if (r.kind === "location") {
        const eligible = locationEligibility(st, true, Date.now());
        if (eligible) throw new NativeOperationError("native." + eligible, 403);
        if (!["saved", "unavailable"].includes(input.state))
          throw new NativeOperationError(
            "native.location_response_invalid",
            400,
          );
        if (input.state === "saved") {
          if (!input.location)
            throw new NativeOperationError("native.location_required", 400);
          validateFreshLocation(input.location, r, Date.now());
          st.lastLocation = input.location;
          await saveState(c, r.workerUserId, r.vendorId, st);
          r.result = { location: input.location, late: false };
        } else
          r.result = {
            reason: input.note ?? "phone_unavailable",
            lastKnown: st.lastLocation ?? null,
            late: false,
          };
      } else {
        if (
          !["opened", "upload-in-progress", "saved", "declined"].includes(
            input.state,
          )
        )
          throw new NativeOperationError("native.photo_response_invalid", 400);
        if (input.state === "upload-in-progress") {
          if (!["opened", "awaiting-worker"].includes(r.state))
            throw new NativeOperationError("native.open_photo_first");
          r.uploadStartedAt = new Date().toISOString();
          r.deviceId = input.deviceId;
          r.bindingVersion = input.bindingVersion;
        }
        if (input.state === "declined") {
          if (
            !input.declineReason ||
            (input.declineReason === "other" && !input.note)
          )
            throw new NativeOperationError(
              "native.decline_reason_required",
              400,
            );
          r.result = {
            reason: input.declineReason,
            note: input.note ?? null,
            late: false,
          };
        }
        if (input.state === "saved") {
          if (
            !r.uploadStartedAt ||
            !input.noteId ||
            !input.operationId ||
            !input.objectPath ||
            !input.photoSource
          )
            throw new NativeOperationError(
              "native.canonical_photo_required",
              400,
            );
          if (input.photoSource === "library" && !r.allowLibrary)
            throw new NativeOperationError("native.new_photo_required", 403);
          const receipt = await c.query(
            "SELECT tool_output FROM assistant_action_audit WHERE user_id=$1 AND target_type='ticket-photo-association' AND target_id=$2 AND result_status='success'",
            [s.userId, input.operationId],
          );
          const photo = receipt.rows[0]?.tool_output;
          if (
            !photo ||
            photo.ticketId !== r.ticketId ||
            photo.noteId !== input.noteId ||
            photo.objectPath !== input.objectPath
          )
            throw new NativeOperationError(
              "native.photo_association_not_found",
              404,
            );
          const note = await c.query(
            "SELECT id FROM ticket_note_logs WHERE id=$1 AND ticket_id=$2 AND created_by_id=$3 AND content=$4 AND deleted_at IS NULL",
            [input.noteId, r.ticketId, s.userId, "[photo] " + input.objectPath],
          );
          if (!note.rows.length)
            throw new NativeOperationError(
              "native.photo_association_not_found",
              404,
            );
          const metadata = await ownedTicketPhoto(s.userId!, input.objectPath);
          if (
            r.upload &&
            (input.objectPath !== r.upload.objectPath ||
              input.operationId !== r.id ||
              metadata.sha256 !== r.upload.checksumSha256 ||
              metadata.size !== r.upload.byteSize ||
              metadata.contentType !== r.upload.contentType)
          )
            throw new NativeOperationError("native.upload_content_conflict");
          if (
            photo.sha256 !== metadata.sha256 ||
            photo.size !== metadata.size ||
            photo.contentType !== metadata.contentType
          )
            throw new NativeOperationError("native.photo_content_changed", 409);
          await scope(c, s, r);
          await requesterCurrent(c, r);
          r.result = {
            photo: {
              ...photo,
              photoSource: input.photoSource,
              photoCapturedAt: input.photoCapturedAt ?? null,
              physicalCaptureVerified: false,
            },
            late: disposition === "late",
          };
        }
      }
      r.state = input.state;
      await event(c, r.workerUserId, r.vendorId, { request: r });
      if (["saved", "declined", "unavailable"].includes(r.state))
        await notice(
          c,
          r.requesterUserId,
          r.state === "saved"
            ? "Requested evidence saved"
            : r.state === "declined"
              ? "Photo request declined"
              : "Location unavailable",
          r.state === "declined"
            ? String(input.declineReason)
            : "Open the canonical request result",
          `native:${r.id}:${r.state}`,
          r,
        );
      return r;
    }),
};

/** Expiry is server work, independent of the requester's open screen. */
export async function runNativeOperationsMaintenance() {
  const candidates = await pool.query(
    "SELECT DISTINCT ON(payload->'request'->>'id') payload->'request' AS request FROM work_hub_user_events WHERE event_type='native.operation' AND payload ? 'request' ORDER BY payload->'request'->>'id',sequence DESC",
  );
  let expired = 0;
  for (const candidate of candidates.rows) {
    const original = candidate.request as NativeRequest;
    if (
      ![
        "pending",
        "delivered",
        "opened",
        "awaiting-worker",
        "upload-in-progress",
      ].includes(original.state) ||
      Date.parse(original.expiresAt) > Date.now()
    )
      continue;
    const c = await pool.connect();
    try {
      outbox.set(c, { events: [], notices: [] });
      await c.query("BEGIN");
      await lock(c, original.workerUserId, original.vendorId);
      const current = await find(c, original.id);
      const result = await refresh(c, current);
      await c.query("COMMIT");
      for (const e of outbox.get(c)?.events ?? [])
        fanOutPersistedWorkHubEvent(e);
      for (const n of outbox.get(c)?.notices ?? []) {
        try {
          const { fanOutPushToUser } = await import("../routes/notifications");
          await fanOutPushToUser(n.userId, {
            type: "native_operation",
            title: n.title,
            body: n.body,
            notificationId: n.notificationId,
            quiet: n.quiet,
            link: `/work-hub?nativeRequestId=${n.request.id}`,
            pushData: {
              nativeRequestId: n.request.id,
              ticketId: n.request.ticketId,
            },
          });
        } catch {
          /* Durable inbox survives push unavailability. */
        }
      }
      if (result.state !== current.state) expired++;
    } catch (e) {
      await c.query("ROLLBACK");
      throw e;
    } finally {
      outbox.delete(c);
      c.release();
    }
  }
  return { expired };
}
let maintenanceTimer: ReturnType<typeof setInterval> | null = null,
  maintenanceRunning = false;
export function startNativeOperationsWorker() {
  if (maintenanceTimer) return;
  maintenanceTimer = setInterval(() => {
    if (maintenanceRunning) return;
    maintenanceRunning = true;
    void runNativeOperationsMaintenance()
      .then(() => runNativeOperationsEscalation())
      .catch((error) => {
        console.error(
          "Native operations maintenance failed",
          error instanceof NativeOperationError
            ? error.code
            : "native.maintenance_failed",
        );
      })
      .finally(() => {
        maintenanceRunning = false;
      });
  }, 15_000);
  maintenanceTimer.unref();
}
export function stopNativeOperationsWorker() {
  if (maintenanceTimer) clearInterval(maintenanceTimer);
  maintenanceTimer = null;
}

/** Separate request acknowledgment from push acceptance and eventual saved evidence. */
export async function runNativeOperationsEscalation() {
  const due = await pool.query(
    "SELECT id,dedupe_key FROM notifications WHERE type='native_operation' AND escalation_policy='native_duty_contacts' AND acknowledgement_required=true AND acknowledged_at IS NULL AND acknowledgement_due_at<=now() AND dedupe_key LIKE 'native:%:requested' AND (escalation_id IS NULL OR escalation_id LIKE 'native-assigned%') ORDER BY acknowledgement_due_at LIMIT 100",
  );
  let sent = 0;
  for (const candidate of due.rows) {
    const id = /^native:([0-9a-f-]{36}):requested$/.exec(
      candidate.dedupe_key,
    )?.[1];
    if (!id) continue;
    const c = await pool.connect();
    try {
      outbox.set(c, { events: [], notices: [] });
      await c.query("BEGIN");
      const r = await find(c, id);
      await lock(c, r.workerUserId, r.vendorId);
      const currentRequest = await find(c, id);
      const n = (
        await c.query(
          "SELECT id,acknowledged_at,escalation_id,escalated_at FROM notifications WHERE id=$1 FOR UPDATE",
          [candidate.id],
        )
      ).rows[0];
      if (
        !n ||
        n.acknowledged_at ||
        ![
          "pending",
          "delivered",
          "opened",
          "awaiting-worker",
          "upload-in-progress",
        ].includes(currentRequest.state) ||
        Date.parse(currentRequest.expiresAt) <= Date.now()
      ) {
        await c.query("COMMIT");
        continue;
      }
      const p = await policy(c, { type: "vendor", id: r.vendorId });
      if (!p.enabled) {
        await c.query("COMMIT");
        continue;
      }
      await requesterCurrent(c, r);
      const handled = await c.query(
        "SELECT id FROM notifications WHERE dedupe_key LIKE $1 AND acknowledged_at IS NOT NULL LIMIT 1",
        [`native:${id}:escalation:%`],
      );
      if (handled.rows.length) {
        await c.query(
          "UPDATE notifications SET escalation_id='native-handled' WHERE id=$1",
          [n.id],
        );
        await c.query("COMMIT");
        continue;
      }
      const backup = Boolean(n.escalation_id);
      if (
        backup &&
        n.escalated_at &&
        Date.now() - n.escalated_at.getTime() <
          p.escalation.intervalMinutes * 60_000
      ) {
        await c.query("COMMIT");
        continue;
      }
      const target = backup
        ? p.escalation.backupContactUserId
        : p.escalation.assignedContactUserId;
      if (!target) {
        await c.query("COMMIT");
        continue;
      }
      const u = (
        await c.query("SELECT session_version FROM users WHERE id=$1", [target])
      ).rows[0];
      let eligible = false;
      if (u) {
        const session: SessionPayload = {
          userId: target,
          vendorId: r.vendorId,
          role: "vendor",
          sv: u.session_version,
        };
        try {
          await scope(c, session, r, false);
          const st = await state(c, target, r.vendorId);
          eligible = nativeDutyContactAvailable(st, Date.now());
        } catch (e) {
          if (!(e instanceof NativeOperationError)) throw e;
        }
      }
      if (eligible) {
        await notice(
          c,
          target,
          backup
            ? "Unacknowledged request: backup contact"
            : "Unacknowledged request: duty contact",
          "The worker has not acknowledged this request.",
          `native:${id}:escalation:${backup ? "backup" : "assigned"}`,
          r,
        );
        sent++;
      }
      await c.query(
        "UPDATE notifications SET escalation_id=$2,escalated_at=now() WHERE id=$1",
        [
          n.id,
          backup
            ? "native-backup"
            : eligible
              ? "native-assigned"
              : "native-assigned-unavailable",
        ],
      );
      await event(c, r.workerUserId, r.vendorId, {
        action: "request.escalation",
        requestId: r.id,
        contactUserId: target,
        stage: backup ? "backup" : "assigned",
        outcome: eligible ? "inbox_saved" : "contact_off_duty_or_revoked",
      });
      await c.query("COMMIT");
      for (const e of outbox.get(c)?.events ?? [])
        fanOutPersistedWorkHubEvent(e);
      for (const notice of outbox.get(c)?.notices ?? []) {
        try {
          const { fanOutPushToUser } = await import("../routes/notifications");
          await fanOutPushToUser(notice.userId, {
            type: "native_operation",
            title: notice.title,
            body: notice.body,
            notificationId: notice.notificationId,
            link: `/work-hub?nativeRequestId=${id}`,
            pushData: { nativeRequestId: id, ticketId: r.ticketId },
          });
        } catch {
          /* A saved alert is not proof of device delivery. */
        }
      }
    } catch (e) {
      await c.query("ROLLBACK");
      if (!(e instanceof NativeOperationError)) throw e;
    } finally {
      outbox.delete(c);
      c.release();
    }
  }
  return { sent };
}

/** Worker preference and current designated-device authority; domain route owns arrival transition. */
export async function requireLiveNativeTicketAssignment(
  c: PoolClient,
  s: SessionPayload,
  ticketId: number,
) {
  try {
    await requireLiveTicketAssignment(c, s, ticketId);
  } catch (error) {
    if (error instanceof LiveTicketAssignmentError)
      throw new NativeOperationError(error.code, error.status);
    throw error;
  }
}

/** Assignment, person activation and roster removal serialize with the domain write. */
export async function withLiveNativeTicketAssignment<T>(
  s: SessionPayload,
  ticketId: number,
  apply: (client: PoolClient) => Promise<T>,
): Promise<T> {
  return transaction(s, async (c) => {
    await current(c, s);
    await requireLiveNativeTicketAssignment(c, s, ticketId);
    return apply(c);
  });
}

export async function authorizeNativeAutomaticArrival<T = void>(
  s: SessionPayload,
  ticketId: number,
  raw: { deviceId: string; bindingVersion: number },
  apply?: (client: PoolClient) => Promise<T>,
): Promise<T | void> {
  const input = z
    .object({
      deviceId: z.uuid(),
      bindingVersion: z.number().int().nonnegative(),
    })
    .strict()
    .parse(raw);
  return transaction(s, async (c) => {
    const a = await current(c, s);
    if (a.owner.type !== "vendor")
      throw new NativeOperationError("native.worker_company_required", 403);
    await lock(c, s.userId!, a.owner.id);
    const p = await policy(c, a.owner),
      st = await state(c, s.userId!, a.owner.id);
    if (!p.enabled || !p.automaticArrival || !st.consent.automaticArrival)
      throw new NativeOperationError(
        "native.automatic_arrival_opt_in_required",
        403,
      );
    if (st.duty.overrideEndedAt && !effectiveDuty(st.duty, Date.now()))
      throw new NativeOperationError("native.duty_ended", 403);
    if (
      st.designatedDeviceId !== input.deviceId ||
      st.bindingVersion !== input.bindingVersion
    )
      throw new NativeOperationError("native.work_phone_changed", 403);
    const device = await c.query(
      "SELECT id FROM work_hub_devices WHERE id=$1 AND user_id=$2 AND owner_org_type='vendor' AND owner_org_id=$3 AND revoked_at IS NULL",
      [input.deviceId, s.userId, a.owner.id],
    );
    if (!device.rows.length)
      throw new NativeOperationError("native.work_phone_required", 403);
    await requireLiveNativeTicketAssignment(c, s, ticketId);
    return apply ? await apply(c) : undefined;
  });
}

export async function recheckNativeLocationWake(input: {
  id: string;
  workerUserId: number;
  vendorId: number;
  deviceId: string | null;
  bindingVersion: number;
  expiresAt: string;
}): Promise<boolean> {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    const user = await c.query(
      "SELECT session_version FROM users WHERE id=$1",
      [input.workerUserId],
    );
    if (!user.rows.length) return false;
    const s: SessionPayload = {
      userId: input.workerUserId,
      vendorId: input.vendorId,
      role: "field_employee",
      sv: user.rows[0].session_version,
    };
    const a = await current(c, s),
      p = await policy(c, a.owner),
      r = await find(c, input.id);
    await scope(c, s, r);
    await requesterCurrent(c, r);
    if (
      !p.enabled ||
      !p.locationRequests ||
      r.kind !== "location" ||
      r.state !== "pending" ||
      r.workerUserId !== input.workerUserId ||
      r.vendorId !== input.vendorId ||
      r.deviceId !== input.deviceId ||
      r.bindingVersion !== input.bindingVersion ||
      Date.parse(r.expiresAt) <= Date.now()
    )
      return false;
    const st = await state(c, input.workerUserId, input.vendorId);
    if (
      locationEligibility(st, true, Date.now()) ||
      st.designatedDeviceId !== input.deviceId ||
      st.bindingVersion !== input.bindingVersion
    )
      return false;
    const device = await c.query(
      "SELECT id FROM work_hub_devices WHERE id=$1 AND user_id=$2 AND owner_org_type='vendor' AND owner_org_id=$3 AND revoked_at IS NULL",
      [input.deviceId, input.workerUserId, input.vendorId],
    );
    return Boolean(device.rows.length);
  } catch (error) {
    if (error instanceof NativeOperationError) return false;
    throw error;
  } finally {
    await c.query("ROLLBACK");
    c.release();
  }
}

export async function withNativeLocationCollection<T>(
  s: SessionPayload,
  deviceId: string | undefined,
  apply: (c: PoolClient) => Promise<T>,
): Promise<T> {
  return transaction(s, async (c) => {
    const a = await current(c, s);
    if (a.owner.type !== "vendor")
      throw new NativeOperationError("native.worker_company_required", 403);
    await lock(c, s.userId!, a.owner.id);
    const raw = await c.query(
      "SELECT native_operations FROM work_hub_device_preferences WHERE user_id=$1 AND owner_org_type='vendor' AND owner_org_id=$2",
      [s.userId, a.owner.id],
    );
    if (Object.keys(raw.rows[0]?.native_operations ?? {}).length) {
      const st = await state(c, s.userId!, a.owner.id),
        p = await policy(c, a.owner);
      if (st.duty.overrideEndedAt && !effectiveDuty(st.duty, Date.now()))
        throw new NativeOperationError("native.duty_ended", 403);
      if (
        !p.enabled ||
        !st.consent.locationSharing ||
        !effectiveDuty(st.duty, Date.now())
      )
        throw new NativeOperationError(
          "native.location_collection_disabled",
          403,
        );
      if (st.designatedDeviceId && deviceId !== st.designatedDeviceId)
        throw new NativeOperationError("native.work_phone_changed", 403);
      if (st.designatedDeviceId) {
        const d = await c.query(
          "SELECT id FROM work_hub_devices WHERE id=$1 AND user_id=$2 AND revoked_at IS NULL",
          [st.designatedDeviceId, s.userId],
        );
        if (!d.rows.length)
          throw new NativeOperationError("native.work_phone_required", 403);
      }
    }
    return apply(c);
  });
}
