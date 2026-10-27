import { assertRequiredWorkClear } from "../work-hub/required-work-guard";
import {recordGateWorkday, endGateWorkdayForRecovery} from "./gate-workday";
import {WorkdayError} from "./workday";
import { GateTaskError, mutateGateTaskInTransaction } from "./gate-task-hopper";
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
  for (let attempt = 0; ; attempt++) {
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
      if(error instanceof GateTaskError)throw new ChangeOverError(error.status,"gate_task.rejected",error.message);
      if(error instanceof WorkdayError)throw new ChangeOverError(error.status,error.code,"Your shift clock could not be updated. Check your current company and retry; no Gate handoff was committed.");
      // PostgreSQL aborts a deadlock victim's entire transaction. Re-evaluate
      // authorization and the handoff revision after rollback; retain every
      // lock. Provider work stays outside this callback. Never replay an
      // uncertain commit, failed rollback, or a non-deadlock application error.
      if (
        attempt >= 2 ||
        !error || typeof error !== "object" ||
        !("code" in error) || error.code !== "40P01"
      ) throw error;
    } finally {
      client.release();
    }
    await new Promise((resolve) => setTimeout(resolve, 25 * (attempt + 1)));
  }
}

/** Re-evaluate database authorization even for valid signed sessions. */
export async function requireChangeOverAccess(
  client: Queryable,
  session: SessionPayload,
  siteId: number,
  options: { allowInactiveSite?: boolean } = {},
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
      "SELECT id, name, partner_id FROM site_locations WHERE id=$1 AND ($2::boolean OR is_active IS DISTINCT FROM false) AND hidden IS DISTINCT FROM true",
      [siteId, options.allowInactiveSite === true],
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
    "SELECT id FROM site_work_assignments WHERE vendor_id=$1 AND site_location_id=$2 AND is_gate_contractor=true LIMIT 1",
    [session.vendorId, siteId],
  );
  if (!assigned.rowCount)
    return fail(403, "forbidden", "Your company is not designated as a Gate contractor at this site");
  const membership = await client.query(
    "SELECT id, vendor_people_id, role FROM user_org_memberships WHERE user_id=$1 AND vendor_id=$2 AND org_type='vendor' AND ($3::int IS NULL OR id=$3)",
    [session.userId, session.vendorId, session.activeMembershipId ?? null],
  );
  if (!membership.rowCount)
    return fail(403, "forbidden", "Current company membership required");
  if (
    session.role === "vendor" &&
    session.membershipRole === "admin" &&
    membership.rows.some((row) => row.role === "admin")
  ) {
    return { supervisor: true, site, user };
  }
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
    const personId = membership.rows[0]?.vendor_people_id;
    if (personId) {
      const normalized = await client.query(
        `SELECT r.role FROM vendor_person_operational_roles r
        JOIN vendor_person_site_access a ON a.vendor_people_id=r.vendor_people_id
        WHERE r.vendor_people_id=$1 AND r.is_active=true
        AND r.role IN ('gatekeeper','gate_supervisor')
        AND a.site_location_id=$2 AND a.is_active=true`,
        [personId, siteId],
      );
      if (normalized.rowCount) {
        return {
          supervisor: normalized.rows.some((row) => row.role === "gate_supervisor"),
          site,
          user,
        };
      }
    }
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

/** Names and gate assignments only, limited to the caller's authorized sites/company. */
export async function listActiveGateWatches(session: SessionPayload) {
  const sites = await listChangeOverSites(session);
  const rows = (await pool.query(`SELECT d.station_id AS "stationId",g.name AS "gateName",g.site_id AS "siteId",s.name AS "siteName",
    d.user_id AS "userId",coalesce(u.display_name,u.username) AS name,min(d.started_at) AS "startedAt",w.id AS "watchId"
    FROM (SELECT station_id,user_id,started_at FROM gate_duty_sessions WHERE ended_at IS NULL
      UNION ALL SELECT station_id,operator_id,started_at FROM gate_shifts WHERE ended_at IS NULL) d
    JOIN gate_stations g ON g.id=d.station_id JOIN site_locations s ON s.id=g.site_id JOIN users u ON u.id=d.user_id
    LEFT JOIN gate_shifts w ON w.station_id=d.station_id AND w.operator_id=d.user_id AND w.ended_at IS NULL
    WHERE g.active=true AND g.site_id=ANY($1::int[]) AND ($2::int IS NULL OR EXISTS(
      SELECT 1 FROM user_org_memberships m WHERE m.user_id=d.user_id AND m.vendor_id=$2 AND m.org_type='vendor'))
    GROUP BY d.station_id,g.name,g.site_id,s.name,d.user_id,u.display_name,u.username,w.id ORDER BY s.name,g.name,name`,[sites.map(s=>s.id),session.vendorId??null])).rows;
  const managed=new Set<string>();
  for(const row of rows) {
    try { await requireGateWatchAdmin(pool,session,row.stationId);managed.add(row.stationId); }
    catch(error) { if(!(error instanceof ChangeOverError) || error.status!==403)throw error; }
  }
  return { watches: rows.map(row=>({...row,canManage:managed.has(row.stationId)&&Boolean(row.watchId)})) };
}

async function requireGateWatchAdmin(client: Queryable, session:SessionPayload, stationId:string) {
  const access=await stationAccess(client,session,stationId);
  if(session.realm==="demo"||session.publicDemo)return fail(403,"read_only","Demo access is read only");
  const membership=session.role==="admin"?true:Boolean((await client.query(
    "SELECT id FROM user_org_memberships WHERE id=$1 AND user_id=$2 AND role='admin' AND org_type=$3 AND CASE WHEN org_type='vendor' THEN vendor_id ELSE partner_id END=$4",
    [session.activeMembershipId,session.userId,session.vendorId?"vendor":"partner",session.vendorId??session.partnerId])).rowCount);
  if(!access.supervisor||!membership)return fail(403,"admin_required","Administrator access required");
  return access;
}

async function availableWatchStanders(client:Queryable,session:SessionPayload,stationId:string) {
  const candidates=await recoveryOperators(client,session,stationId);
  if(!candidates.length)return [];
  const eligible=new Set((await client.query(`SELECT DISTINCT p.user_id FROM vendor_people p
    WHERE p.user_id=ANY($1::int[]) AND p.is_active=true AND p.deleted_at IS NULL
    AND ($2::int IS NULL OR p.vendor_id=$2)
    AND (p.vendor_role IN ('gatekeeper','gate_supervisor') OR EXISTS(SELECT 1 FROM vendor_person_operational_roles r WHERE r.vendor_people_id=p.id AND r.is_active=true AND r.role IN ('gatekeeper','gate_supervisor')))
    AND NOT EXISTS(SELECT 1 FROM gate_duty_sessions d WHERE d.user_id=p.user_id AND d.ended_at IS NULL)`,[candidates.map(p=>p.userId),session.vendorId??null])).rows.map(row=>row.user_id));
  return candidates.filter(p=>eligible.has(p.userId)&&p.userId!==session.userId);
}
export async function listAvailableGateWatchStanders(session:SessionPayload,stationId:string) {
  await requireGateWatchAdmin(pool,session,stationId);
  return {operators:(await availableWatchStanders(pool,session,stationId)).map(({session:_session,...person})=>person)};
}

type AdminWatchInput={stationId:string;expectedShiftId:string;operationId:string;action:"assume"|"assign";targetMembershipId?:number};
async function adminWatchReceipt(client:Queryable,session:SessionPayload,stationId:string,operationId:string) {
  const row=(await client.query("SELECT result_json FROM work_hub_client_operations WHERE user_id=$1 AND command_kind='gate.watch.admin' AND operation_id=$2",[session.userId,operationId])).rows[0];
  if(row&&row.result_json.stationId!==stationId)return fail(409,"operation_conflict","Operation belongs to a different gate");
  if(row&&(row.result_json.actorVendorId!==(session.vendorId??null)||row.result_json.actorPartnerId!==(session.partnerId??null)))return fail(409,"operation_conflict","Return to the original company to recover this assignment");
  return row?.result_json??null;
}
export async function getAdminGateWatchOperation(session:SessionPayload,stationId:string,operationId:string) {
  await requireGateWatchAdmin(pool,session,stationId);
  return {receipt:await adminWatchReceipt(pool,session,stationId,operationId)};
}

/** Immediate admin custody transfer; the assignment is not the recipient's attendance or paid-clock report. */
export async function administerGateWatch(session:SessionPayload,input:AdminWatchInput) {
  const receipt=await changeOverTransaction(async c=>{
    const access=await requireGateWatchAdmin(c,session,input.stationId);
    await lockStation(c,input.stationId);
    const prior=await adminWatchReceipt(c,session,input.stationId,input.operationId);
    if(prior) {
      if(prior.expectedShiftId!==input.expectedShiftId||prior.action!==input.action||prior.targetMembershipId!==(input.targetMembershipId??null))return fail(409,"operation_conflict","Operation already used for a different assignment");
      return prior;
    }
    const shift=await activeShift(c,input.stationId);
    if(!shift||shift.id!==input.expectedShiftId)return fail(409,"shift_changed","Watch changed; refresh before assigning");
    if(access.station.active===false)return fail(409,"station_inactive","This gate is inactive");
    const candidate=input.action==="assign"?(await availableWatchStanders(c,session,input.stationId)).find(p=>p.membershipId===input.targetMembershipId):null;
    if(input.action==="assign"&&!candidate)return fail(409,"operator_unavailable","This watch stander is no longer available");
    const incoming=candidate?.session??session,incomingName=candidate?.name??access.user.display_name??"Administrator";
    if(incoming.userId===shift.operator_id)return fail(409,"operator_on_watch","You already hold this watch");
    // Serialize assignments to the same worker across gates, then recheck availability.
    await c.query("SELECT id FROM users WHERE id=ANY($1::int[]) ORDER BY id FOR UPDATE",[[incoming.userId,shift.operator_id]]);
    if((await c.query("SELECT id FROM gate_shifts WHERE operator_id=$1 AND ended_at IS NULL UNION ALL SELECT id FROM gate_duty_sessions WHERE user_id=$1 AND ended_at IS NULL LIMIT 1",[incoming.userId])).rowCount)return fail(409,"operator_on_watch","Choose someone who is not currently on watch");
    await requireChangeOverAccess(c,incoming,access.station.site_id);
    if(input.action==="assume"&&session.userId&&(session.vendorId||session.partnerId))await assertRequiredWorkClear(c,session.userId,session.partnerId?{type:"partner",id:session.partnerId}:{type:"vendor",id:session.vendorId!});
    const facts=await snapshot(c,access.station.site_id,input.stationId,shift.started_at),now=new Date();
    const oldNotes=shift.preparation_id?(await c.query("SELECT notes FROM gate_preparations WHERE id=$1",[shift.preparation_id])).rows[0]?.notes??"":"";
    await c.query("INSERT INTO gate_preparations(id,shift_id,prepared_by,snapshot,notes,summary) VALUES($1,$2,$3,$4,$5,$6)",[input.operationId,shift.id,session.userId,JSON.stringify(facts),oldNotes,JSON.stringify({source:"structured_facts",facts:facts.facts,administrativeTransfer:{actorId:session.userId,action:input.action,assignedUserId:incoming.userId,assigneeAcknowledged:input.action==="assume",physicalAttendanceVerified:false}})]);
    const scheduled=(await c.query(`SELECT s.id,s.title,s.ends_at FROM work_hub_shifts s WHERE s.gate_station_id=$1 AND s.owner_org_type='vendor' AND s.owner_org_id=$2 AND s.starts_at<=$3 AND s.ends_at>$3 AND s.milestone_status<>'cancelled' ORDER BY s.starts_at DESC LIMIT 1 FOR UPDATE`,[input.stationId,incoming.vendorId??null,now])).rows[0];
    if(scheduled) {
      await c.query("UPDATE work_hub_shift_assignments SET status='cancelled' WHERE shift_id=$1 AND user_id=$2 AND status IN ('assigned','accepted','claimed')",[scheduled.id,shift.operator_id]);
      await c.query("INSERT INTO work_hub_shift_assignments(shift_id,user_id,assigned_by_id,status) VALUES($1,$2,$3,'assigned') ON CONFLICT(shift_id,user_id) DO UPDATE SET status='assigned',assigned_by_id=excluded.assigned_by_id",[scheduled.id,incoming.userId,session.userId]);
      await c.query("UPDATE work_hub_shifts SET version=version+1,updated_at=$2 WHERE id=$1",[scheduled.id,now]);
    }
    await c.query("UPDATE gate_shifts SET ended_at=$2,preparation_id=$3 WHERE id=$1 AND ended_at IS NULL",[shift.id,now,input.operationId]);
    await c.query("UPDATE gate_duty_sessions SET ended_at=$3,ended_by_user_id=$2,end_reason='Administrative watch transfer; paid shift unchanged' WHERE station_id=$1 AND user_id=$4 AND ended_at IS NULL",[input.stationId,session.userId,now,shift.operator_id]);
    const next=(await c.query("INSERT INTO gate_shifts(station_id,operator_id,started_at) VALUES($1,$2,$3) RETURNING id",[input.stationId,incoming.userId,now])).rows[0];
    await c.query("INSERT INTO gate_duty_sessions(station_id,user_id,work_hub_shift_id,source_legacy_shift_id,started_at,source,idempotency_key,post_coverage) VALUES($1,$2,$3,$4,$5,'web',$6,$7::jsonb)",[input.stationId,incoming.userId,scheduled?.id??null,next.id,now,input.operationId,JSON.stringify({...(incoming.vendorId?{vendorId:incoming.vendorId}:{partnerId:incoming.partnerId}),assignedBy:session.userId,assigneeAcknowledged:input.action==="assume",physicalAttendanceVerified:false})]);
    await c.query("INSERT INTO gate_handovers(id,preparation_id,incoming_shift_id,incoming_user_id,outgoing_name,incoming_name,acknowledged_at) VALUES($1,$1,$2,$3,$4,$5,$6)",[input.operationId,next.id,incoming.userId,shift.operator_name??"Gatekeeper",incomingName,now]);
    await c.query("INSERT INTO gate_shift_actions(station_id,actor_id,item_id,kind,text) VALUES($1,$2,$3,'admin_assignment',$4)",[input.stationId,session.userId,next.id,`Watch ${input.action==="assume"?"assumed":"assigned"} by administrator to ${incomingName}; paid shifts and sign-ins unchanged.`]);
    let notification=null;
    if(input.action==="assign") {
      const title=`Watch assigned — ${access.site.name} · ${access.station.name}`;
      const body=`${access.user.display_name??"An administrator"} assigned you the current watch at ${access.site.name}, ${access.station.name}.${scheduled?` Scheduled through ${new Date(scheduled.ends_at).toLocaleString("en-US",{timeZone:"America/Chicago"})} (America/Chicago).`:""} Open Gate Dashboard to review the handoff.`;
      const link=`/gate/change-over?siteId=${access.station.site_id}&stationId=${input.stationId}`;
      notification=(await c.query("INSERT INTO notifications(user_id,type,category,title,body,link,dedupe_key,urgent_delivery_pending) VALUES($1,'gate_watch_assigned','system',$2,$3,$4,$5,true) RETURNING id,user_id AS \"userId\",type,title,body,link,created_at AS \"createdAt\"",[incoming.userId,title,body,link,`gate-watch-assigned:${input.operationId}`])).rows[0];
    }
    const result={operationId:input.operationId,actorVendorId:session.vendorId??null,actorPartnerId:session.partnerId??null,stationId:input.stationId,expectedShiftId:input.expectedShiftId,action:input.action,targetMembershipId:input.targetMembershipId??null,watchId:next.id,workerUserId:incoming.userId,workerName:incomingName,shiftId:scheduled?.id??null,notification,assignedAt:now.toISOString()};
    await c.query("INSERT INTO work_hub_client_operations(user_id,command_kind,operation_id,owner_org_type,owner_org_id,result_json,applied_at) VALUES($1,'gate.watch.admin',$2,$3,$4,$5::jsonb,$6)",[session.userId,input.operationId,session.vendorId?"vendor":"partner",session.vendorId??access.site.partner_id,JSON.stringify(result),now]);
    return result;
  });
  if(receipt.notification) {
    // The durable marker is committed first; the existing alert worker recovers provider failures.
    try {
      const {publishNotificationCreated}=await import("../lib/notification-events");
      const n=receipt.notification;
      publishNotificationCreated({userId:n.userId,notificationId:n.id,notifType:n.type,category:"system",title:n.title,body:n.body,link:n.link,audible:false,createdAt:new Date(n.createdAt).toISOString()});
      const {processPendingGateAlert}=await import("./gate-alert-repository");await processPendingGateAlert(n);
    }catch { /* Delivery stays pending in the existing retry worker. */ }
  }
  return receipt;
}

/** Voluntary release ends watch custody/duty only. It never changes authentication or the paid workday. */
export async function releaseGateWatch(session: SessionPayload, input: {stationId:string; expectedShiftId:string; notes:string}) {
  return changeOverTransaction(async c => {
    const access=await stationAccess(c,session,input.stationId);
    if(session.realm==="demo"||session.publicDemo)return fail(403,"read_only","Demo access is read only");
    await lockStation(c,input.stationId);
    const shift=(await c.query("SELECT * FROM gate_shifts WHERE id=$1 AND station_id=$2 FOR UPDATE",[input.expectedShiftId,input.stationId])).rows[0];
    if(!shift || shift.operator_id!==session.userId)return fail(403,"owner_required","Only the current watch owner may hand off this watch");
    // The expected watch is the idempotent boundary: a retry cannot end a later watch.
    if(shift.ended_at)return {watchId:shift.id,endedAt:shift.ended_at,preparationId:shift.preparation_id};
    const facts=await snapshot(c,access.station.site_id,input.stationId,shift.started_at);
    const prep=(await c.query("INSERT INTO gate_preparations(shift_id,prepared_by,snapshot,notes,summary) VALUES($1,$2,$3,$4,$5) RETURNING id",
      [shift.id,session.userId,JSON.stringify(facts),input.notes,JSON.stringify({source:"structured_facts",facts:facts.facts,watchReleased:true})])).rows[0];
    const now=new Date();
    await c.query("UPDATE gate_shifts SET ended_at=$2,preparation_id=$3 WHERE id=$1",[shift.id,now,prep.id]);
    await c.query("UPDATE gate_duty_sessions SET ended_at=$3,ended_by_user_id=$2,end_reason='Watch handed off; paid shift remains active' WHERE station_id=$1 AND user_id=$2 AND ended_at IS NULL",[input.stationId,session.userId,now]);
    await c.query("INSERT INTO gate_shift_actions(station_id,actor_id,item_id,kind,text) VALUES($1,$2,$3,'watch_release',$4)",[input.stationId,session.userId,shift.id,"Watch released; handoff saved. Paid shift and signed-in session unchanged."]);
    return {watchId:shift.id,endedAt:now,preparationId:prep.id};
  });
}

async function releasedWatch(client: Queryable, stationId:string) {
  return (await client.query(`SELECT s.*,coalesce(u.display_name,u.username) AS operator_name FROM gate_shifts s JOIN users u ON u.id=s.operator_id
    JOIN gate_preparations p ON p.id=s.preparation_id WHERE s.station_id=$1 AND s.ended_at IS NOT NULL
    AND p.summary->>'watchReleased'='true' AND NOT EXISTS(SELECT 1 FROM gate_handovers h JOIN gate_preparations hp ON hp.id=h.preparation_id WHERE h.preparation_id=p.id OR hp.summary->>'originalPreparationId'=p.id::text)
    ORDER BY s.ended_at DESC LIMIT 1`,[stationId])).rows[0]??null;
}
/** Keep the shared site revision while hiding another vendor's task content.
 * Persisted handoff JSON is never rewritten by a viewer's projection. */
async function projectGateTaskItems(client: Queryable, value: any, vendorId?: number) {
  if (!value || !vendorId) return value;
  const ids = [...new Set<string>([...(value.openItems ?? []).map((item: ShiftItem) => item.id), ...(value.facts ?? []).filter((fact: ShiftFact) => fact.id.startsWith("item:")).map((fact: ShiftFact) => fact.id.slice(5))])].filter(id => /^[0-9a-f-]{36}$/i.test(id));
  if (!ids.length) return value;
  const foreign = new Set((await client.query("SELECT id FROM work_hub_tasks WHERE id=ANY($1::uuid[]) AND gate_hopper IS NOT NULL AND owner_org_id<>$2", [ids, vendorId])).rows.map(row => row.id));
  return { ...value, ...(value.openItems ? { openItems: value.openItems.filter((item: ShiftItem) => !foreign.has(item.id)) } : {}),
    ...(value.facts ? { facts: value.facts.filter((fact: ShiftFact) => !fact.id.startsWith("item:") || !foreign.has(fact.id.slice(5))) } : {}) };
}
async function projectGatePreparation(client: Queryable, preparation: any, vendorId?: number) {
  if (!preparation || !vendorId) return preparation;
  return { ...preparation, snapshot: await projectGateTaskItems(client, preparation.snapshot, vendorId), summary: await projectGateTaskItems(client, preparation.summary, vendorId) };
}
async function currentItems(
  client: Queryable,
  stationId: string,
  vendorId?: number,
): Promise<ShiftItem[]> {
  const rows = (
    await client.query(
      `SELECT DISTINCT ON (item_id) item_id AS id, text, kind,
    CASE WHEN kind='resolve' THEN 'resolved' ELSE 'open' END AS status FROM gate_shift_actions
    WHERE station_id=$1 AND kind IN ('open','resolve','reopen') ORDER BY item_id, created_at DESC, id DESC`,
      [stationId],
    )
  ).rows;
  const items = rows.map((r) => ({ id: r.id, text: r.text, status: r.status }));
  return (await projectGateTaskItems(client, { openItems: items }, vendorId)).openItems as ShiftItem[];
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
export type GateDiscoveryMode = "operational" | "history";
export async function listChangeOverSites(session: SessionPayload, mode: GateDiscoveryMode = "operational") {
  const sites = (
    await pool.query(
      `SELECT s.id, s.name, s.latitude, s.longitude FROM site_locations s WHERE s.is_active IS DISTINCT FROM false AND s.hidden IS DISTINCT FROM true
    AND ($1='admin' OR ($1='partner' AND s.partner_id=$2) OR EXISTS (SELECT 1 FROM site_work_assignments a WHERE a.site_location_id=s.id AND a.vendor_id=$3 AND a.is_gate_contractor=true))
    ORDER BY s.name LIMIT 2000`,
      [
        session.role,
        session.partnerId ?? null,
        session.vendorId ?? null,
      ],
    )
  ).rows;
  const allowed: { id: number; name: string; latitude: number | null; longitude: number | null; supervisor: boolean }[] = [];
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
  mode: GateDiscoveryMode = "operational",
) {
  await requireChangeOverAccess(pool, session, siteId);
  // History navigation uses the same current site authorization as notes/reports,
  // without requiring an active gate or a future scheduled shift.
  if (mode === "history") return (await pool.query(
    "SELECT id,name,site_id,latitude,longitude,active FROM gate_stations WHERE site_id=$1 ORDER BY created_at,id",
    [siteId],
  )).rows;
  return (
    await pool.query(
      `SELECT station.id, station.name, station.site_id, station.latitude, station.longitude, station.geofence_radius_m AS "geofenceRadiusM", station.active
       FROM gate_stations station
       WHERE station.site_id=$1
         AND (station.active=true
           OR EXISTS (SELECT 1 FROM gate_shifts finishing WHERE finishing.station_id=station.id AND finishing.operator_id=$2 AND finishing.ended_at IS NULL)
           OR EXISTS (SELECT 1 FROM gate_duty_sessions finishing WHERE finishing.station_id=station.id AND finishing.user_id=$2 AND finishing.ended_at IS NULL)
           OR EXISTS (SELECT 1 FROM gate_work_sessions finishing JOIN work_hub_shifts finishing_shift ON finishing_shift.id=finishing.work_hub_shift_id WHERE finishing_shift.gate_station_id=station.id AND finishing.user_id=$2 AND finishing.ended_at IS NULL))
       ORDER BY station.created_at, station.id`,
      [
        siteId,
        session.userId ?? null,
      ],
    )
  ).rows;
}
/** Gate creation is an office capability; it does not grant watch recovery. */
async function requireGateStationManagementAccess(client: Queryable, session: SessionPayload, siteId: number) {
  try {
    if ((await requireChangeOverAccess(client, session, siteId)).supervisor) return;
  } catch (error) {
    if (!(error instanceof ChangeOverError) || error.status !== 403) throw error;
  }
  if (!session.managedSubcontractor && session.vendorId && ["vendor", "field_employee"].includes(session.role ?? "")) {
    const office = await client.query(
      `SELECT 1 FROM users u
       JOIN user_org_memberships m ON m.user_id=u.id AND m.org_type='vendor' AND m.vendor_id=$2
       JOIN vendor_people p ON p.id=m.vendor_people_id AND p.user_id=u.id AND p.vendor_id=m.vendor_id
       JOIN site_work_assignments a ON a.vendor_id=m.vendor_id AND a.site_location_id=$3 AND a.is_gate_contractor=true
       JOIN site_locations s ON s.id=a.site_location_id
       WHERE u.id=$1 AND u.session_version=$4 AND u.suspended_at IS NULL
         AND ($5::int IS NULL OR m.id=$5)
         AND p.deleted_at IS NULL AND p.is_active=true AND p.vendor_role IN ('office','both')
         AND s.is_active IS DISTINCT FROM false AND s.hidden IS DISTINCT FROM true LIMIT 1`,
      [session.userId, session.vendorId, siteId, session.sv, session.activeMembershipId ?? null],
    );
    if (office.rowCount) return;
  }
  return fail(403, "supervisor_required", "Supervisor, office or admin access required");
}

export async function listGateStationManagementSites(session: SessionPayload) {
  const candidates = (await pool.query(
    `SELECT s.id,s.name FROM site_locations s
     WHERE s.is_active IS DISTINCT FROM false AND s.hidden IS DISTINCT FROM true
       AND ($1='admin' OR ($1='partner' AND s.partner_id=$2)
         OR EXISTS (SELECT 1 FROM site_work_assignments a WHERE a.site_location_id=s.id AND a.vendor_id=$3 AND a.is_gate_contractor=true))
     ORDER BY s.name LIMIT 2000`,
    [session.role, session.partnerId ?? null, session.vendorId ?? null],
  )).rows;
  const sites: { id: number; name: string }[] = [];
  for (const site of candidates) {
    try {
      await requireGateStationManagementAccess(pool, session, site.id);
      sites.push({ id: site.id, name: site.name });
    } catch (error) {
      if (!(error instanceof ChangeOverError) || error.status !== 403) throw error;
    }
  }
  return sites;
}

export async function addChangeOverStation(
  session: SessionPayload,
  siteId: number,
  name: string,
) {
  return changeOverTransaction(async (c) => {
    await requireGateStationManagementAccess(c, session, siteId);
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
    const released = !shift ? await releasedWatch(c,stationId) : null;
    const preparationId=shift?.preparation_id??released?.preparation_id;
    const preparation = preparationId
      ? (
          await c.query("SELECT * FROM gate_preparations WHERE id=$1", [
            preparationId,
          ])
        ).rows[0]
      : null;
    // Site activity and occupancy remain visible before anybody assumes a watch.
    const current = await snapshot(c, access.station.site_id, stationId,
      shift?.started_at ?? released?.started_at ?? new Date(Date.now() - 24 * 60 * 60_000));
    return {
      station: access.station,
      site: access.site,
      supervisor: access.supervisor,
      shift,
      releasedWatch: released,
      preparation: await projectGatePreparation(c, preparation, session.vendorId),
      snapshot: await projectGateTaskItems(c, current, session.vendorId),
      // Elapsed time alone does not invalidate saved notes. The incoming
      // operation still checks the exact current facts revision transactionally.
      stale: Boolean(preparation && !released && preparation.snapshot.revision !== current?.revision),
      items: await currentItems(c, stationId, session.vendorId),
      roster: await activeRoster(c, stationId),
    };
  });
}
export async function startGateShift(
  session: SessionPayload,
  stationId: string,
) {
  return changeOverTransaction(async (c) => {
    await lockStation(c, stationId);
    const access = await stationAccess(c, session, stationId);
    const shift = await activeShift(c, stationId);
    if (shift) {
      if (shift.operator_id === session.userId) {await recordGateWorkday(c,session,"start_shift",shift.id,new Date());return shift;}
      return fail(
        409,
        "occupied",
        "This gate has an active shift; use Change Over to accept it",
      );
    }
    if (access.station.active === false)
      return fail(409, "station_inactive", "This gate is inactive");
    if (session.userId && (session.vendorId || session.partnerId)) await assertRequiredWorkClear(c, session.userId, session.partnerId ? {type:"partner",id:session.partnerId} : {type:"vendor",id:session.vendorId!});
    const started = (
      await c.query(
        "INSERT INTO gate_shifts(station_id,operator_id) VALUES($1,$2) RETURNING *",
        [stationId, session.userId],
      )
    ).rows[0];
    await recordGateWorkday(c,session,"start_shift",started.id,new Date(started.started_at));
    return started;
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
type RecoveryOperator = { userId: number; membershipId: number; name: string; companyName: string; session: SessionPayload };
async function recoveryOperators(client: Queryable, session: SessionPayload, stationId: string): Promise<RecoveryOperator[]> {
  const access = await stationAccess(client, session, stationId);
  if (!access.supervisor) return fail(403, "supervisor_required", "Supervisor access required");
  const rows = (await client.query(
    `SELECT m.id AS membership_id,m.user_id,m.vendor_id,m.vendor_people_id,m.role,
      u.session_version,coalesce(u.display_name,u.username) AS name,v.name AS company_name
     FROM user_org_memberships m JOIN users u ON u.id=m.user_id JOIN vendors v ON v.id=m.vendor_id
     WHERE m.org_type='vendor' AND u.suspended_at IS NULL AND u.must_change_password IS DISTINCT FROM true
       AND ($2::int IS NULL OR m.vendor_id=$2)
       AND EXISTS(SELECT 1 FROM site_work_assignments a WHERE a.vendor_id=m.vendor_id AND a.site_location_id=$1 AND a.is_gate_contractor=true)
       AND (m.role='admin' OR EXISTS(SELECT 1 FROM vendor_people p WHERE p.id=m.vendor_people_id AND p.user_id=m.user_id AND p.vendor_id=m.vendor_id AND p.is_active=true AND p.deleted_at IS NULL))
     ORDER BY name,m.id`, [access.station.site_id, session.vendorId ?? null],
  )).rows;
  const occupied = new Set<number>(rows.length ? (await client.query(
    "SELECT DISTINCT operator_id FROM gate_shifts WHERE ended_at IS NULL AND operator_id=ANY($1::int[])",
    [rows.map(row => row.user_id)],
  )).rows.map(row => row.operator_id) : []);
  const eligible: RecoveryOperator[] = [];
  for (const row of rows) {
    if (occupied.has(row.user_id)) continue;
    const candidate: SessionPayload = { userId: row.user_id, vendorId: row.vendor_id, activeMembershipId: row.membership_id,
      membershipRole: row.role, role: row.role === "field_employee" ? "field_employee" : "vendor",
      vendorPeopleId: row.vendor_people_id, sv: row.session_version };
    try { await requireChangeOverAccess(client, candidate, access.station.site_id); }
    catch (error) { if (error instanceof ChangeOverError && error.status === 403) continue; throw error; }
    eligible.push({ userId: row.user_id, membershipId: row.membership_id, name: row.name, companyName: row.company_name, session: candidate });
  }
  return eligible;
}
export async function listGateRecoveryOperators(session: SessionPayload, stationId: string) {
  return { operators: (await recoveryOperators(pool, session, stationId)).map(({ session: _session, ...operator }) => operator) };
}
/** Emergency recovery is separate from normal handover and ordinary sign-out.
 * The supervisor acknowledges; an assigned employee is never recorded as having
 * personally reviewed notes, signed in, or started their paid shift. */
export async function recoverGateShift(
  session: SessionPayload, stationId: string, expectedShiftId: string, reason: string, targetMembershipId?: number,
) {
  return changeOverTransaction(async (c) => {
    await c.query("LOCK TABLE site_visits, ticket_check_ins, tickets, vendor_people, users, user_org_memberships, site_work_assignments, vendor_person_operational_roles, vendor_person_site_access, managed_subcontractor_worker_sponsorships, managed_subcontractor_role_grants IN SHARE ROW EXCLUSIVE MODE");
    const access = await stationAccess(c, session, stationId);
    if (!access.supervisor) return fail(403, "supervisor_required", "Supervisor access required");
    if (!reason.trim() || reason.trim().length > 2000) return fail(400, "reason_required", "Enter the reason or resolution");
    if (session.realm === "demo" || session.publicDemo) return fail(403, "read_only", "Demo access is read only");
    await lockStation(c, stationId);
    // Stable identity is the outgoing watch. A lost response cannot end another
    // shift, invalidate sessions twice, or silently assume a later watch.
    const prior = (await c.query(
      `SELECT s.*,p.summary FROM gate_handovers h JOIN gate_preparations p ON p.id=h.preparation_id
       JOIN gate_shifts s ON s.id=h.incoming_shift_id WHERE h.id=$1 AND s.station_id=$2`, [expectedShiftId, stationId],
    )).rows[0];
    if (prior) {
      const recovery = prior.summary?.recovery;
      if (!recovery || recovery.actorId !== session.userId || recovery.targetMembershipId !== (targetMembershipId ?? null) || recovery.reason !== reason.trim())
        return fail(409, "operation_conflict", "This watch has already been recovered with different details");
      const { summary: _summary, ...receipt } = prior;
      return receipt;
    }
    const shift = await activeShift(c, stationId);
    if (!shift || shift.id !== expectedShiftId || shift.operator_id === session.userId)
      return fail(409, "shift_changed", "Shift changed; refresh before accepting responsibility");
    if (access.station.active === false) return fail(409, "station_inactive", "This gate is inactive");
    let incoming = session, incomingName = access.user.display_name ?? "Supervisor";
    if (targetMembershipId !== undefined) {
      const target = (await recoveryOperators(c, session, stationId)).find(operator => operator.membershipId === targetMembershipId);
      if (!target || target.userId === shift.operator_id) return fail(403, "assignment_required", "Choose a currently authorized replacement operator for this Gate");
      incoming = target.session;
      incomingName = target.name;
    }
    if ((await c.query("SELECT id FROM gate_shifts WHERE operator_id=$1 AND ended_at IS NULL LIMIT 1", [incoming.userId])).rowCount)
      return fail(409, "operator_on_watch", "Choose an operator who is not currently assigned a watch");
    if (incoming.userId && (incoming.vendorId || incoming.partnerId)) await assertRequiredWorkClear(c, incoming.userId,
      incoming.partnerId ? { type: "partner", id: incoming.partnerId } : { type: "vendor", id: incoming.vendorId! });
    const incomingDuty = (await c.query("SELECT post_coverage FROM gate_duty_sessions WHERE station_id=$1 AND user_id=$2 AND ended_at IS NULL FOR UPDATE", [stationId, incoming.userId])).rows[0];
    if (incomingDuty?.post_coverage?.vendorId && incomingDuty.post_coverage.vendorId !== incoming.vendorId)
      return fail(409, "duty_employer_changed", "Return to the original employer before changing this watch");
    const facts = await snapshot(c, access.station.site_id, stationId, shift.started_at);
    const previous = shift.preparation_id ? (await c.query("SELECT notes FROM gate_preparations WHERE id=$1", [shift.preparation_id])).rows[0]?.notes : "";
    const now = new Date();
    const clockReceipt = await endGateWorkdayForRecovery(c, session, {
      stationId, siteId: access.station.site_id, operatorId: shift.operator_id, watchId: shift.id, reason: reason.trim(), at: now,
    });
    const notes = `Supervisor recovery: ${reason.trim()}${previous ? `\nPrevious outgoing notes: ${previous}` : ""}`;
    const prep = (await c.query(
      "INSERT INTO gate_preparations(shift_id,prepared_by,snapshot,notes,summary) VALUES($1,$2,$3,$4,$5) RETURNING id",
      [shift.id, session.userId, JSON.stringify(facts), notes, JSON.stringify({ source: "structured_facts", facts: facts.facts,
        recovery: { actorId: session.userId, targetMembershipId: targetMembershipId ?? null, assignedUserId: incoming.userId,
          reason: reason.trim(), acknowledgedBy: session.userId, assigneeAcknowledged: false, clockReceipt } })],
    )).rows[0];
    await c.query("UPDATE gate_shifts SET ended_at=$1,preparation_id=$2 WHERE id=$3", [now, prep.id, shift.id]);
    await c.query(`UPDATE gate_work_sessions w SET ended_at=$3,location_sharing_active=false,travel_status='ended'
      WHERE w.user_id=$2 AND w.ended_at IS NULL AND (
        EXISTS(SELECT 1 FROM gate_duty_sessions d WHERE d.work_session_id=w.id AND d.station_id=$1 AND d.user_id=$2 AND d.ended_at IS NULL)
        OR EXISTS(SELECT 1 FROM work_hub_shifts s WHERE s.id=w.work_hub_shift_id AND s.gate_station_id=$1))`, [stationId, shift.operator_id, now]);
    await c.query("UPDATE gate_duty_sessions SET ended_at=$3,ended_by_user_id=$4,end_reason=$5 WHERE station_id=$1 AND user_id=$2 AND ended_at IS NULL", [stationId, shift.operator_id, now, session.userId, reason.trim()]);
    const next = (await c.query("INSERT INTO gate_shifts(station_id,operator_id,started_at) VALUES($1,$2,$3) RETURNING *", [stationId, incoming.userId, now])).rows[0];
    await c.query(`INSERT INTO gate_duty_sessions(station_id,user_id,started_at,source,idempotency_key,post_coverage)
      SELECT $1,$2,$3,'web',$4,$5::jsonb WHERE NOT EXISTS(SELECT 1 FROM gate_duty_sessions WHERE station_id=$1 AND user_id=$2 AND ended_at IS NULL)`,
      [stationId, incoming.userId, now, expectedShiftId, JSON.stringify(incoming.vendorId ? { vendorId: incoming.vendorId } : incoming.partnerId ? { partnerId: incoming.partnerId } : {})]);
    await c.query("INSERT INTO gate_handovers(id,preparation_id,incoming_shift_id,incoming_user_id,outgoing_name,incoming_name,acknowledged_at) VALUES($1,$2,$3,$4,$5,$6,$7)",
      [expectedShiftId, prep.id, next.id, incoming.userId, shift.operator_name ?? "Gatekeeper", incomingName, now]);
    await c.query("INSERT INTO gate_shift_actions(station_id,actor_id,item_id,kind,text) VALUES($1,$2,$3,'recovery',$4)",
      [stationId, session.userId, shift.id, `${reason.trim()} — Watch assigned to ${incomingName}; outgoing watch and shift ended; outgoing account signed out.`]);
    await c.query("UPDATE users SET session_version=session_version+1 WHERE id=$1", [shift.operator_id]);
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
    const task = (await c.query("SELECT id,version,gate_hopper FROM work_hub_tasks WHERE id=$1", [itemId])).rows[0];
    if (kind === "open" && task) return fail(409, "item_exists", "Item already exists");
    if (kind === "open" || task?.gate_hopper?.stationId === stationId) {
      return (await mutateGateTaskInTransaction(c, session, { operationId: randomUUID(), action: kind === "open" ? "create" : kind === "resolve" ? "complete" : "reopen",
        taskId: itemId, expectedVersion: task?.version, vendorId: session.vendorId, stationId, text, note: text })).task;
    }
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
    if (incoming.userId && (incoming.vendorId || incoming.partnerId)) await assertRequiredWorkClear(c, incoming.userId, incoming.partnerId ? {type:"partner",id:incoming.partnerId} : {type:"vendor",id:incoming.vendorId!});
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
    // The incoming acknowledgement and delivered notes are the Gate-specific
    // extra step. Both workers use the same Work Hub duty clock as every portal.
    const outgoingDuties=(await c.query("SELECT id FROM gate_duty_sessions WHERE station_id=$1 AND user_id=$2 AND ended_at IS NULL",[input.stationId,outgoing.userId])).rows;
    await recordGateWorkday(c,outgoing,"end_shift",shift.id,now,"America/Chicago",outgoingDuties.map(row=>row.id));
    await recordGateWorkday(c,incoming,"start_shift",nextShift.id,now);
    await c.query("UPDATE gate_duty_sessions SET ended_at=$3,ended_by_user_id=$2,end_reason='Completed acknowledged handoff' WHERE station_id=$1 AND user_id=$2 AND ended_at IS NULL",[input.stationId,outgoing.userId,now]);
    await c.query("INSERT INTO gate_duty_sessions(id,station_id,user_id,started_at,source,idempotency_key,post_coverage) SELECT $6,$1,$2,$3,'web',$4,$5::jsonb WHERE NOT EXISTS(SELECT 1 FROM gate_duty_sessions WHERE station_id=$1 AND user_id=$2 AND ended_at IS NULL)",[input.stationId,incoming.userId,now,input.operationId,JSON.stringify(incoming.vendorId?{vendorId:incoming.vendorId}:{}),nextShift.id]);
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

async function watchReceipt(c: Pick<PoolClient, "query">, session: SessionPayload, stationId: string, operationId: string) {
  const handover = (await c.query(`SELECT h.*, s.station_id, p.summary->>'originalPreparationId' AS original_preparation_id
    FROM gate_handovers h JOIN gate_preparations p ON p.id=h.preparation_id
    JOIN gate_shifts s ON s.id=p.shift_id WHERE h.id=$1`, [operationId])).rows[0];
  if (handover) {
    if (handover.incoming_user_id !== session.userId || handover.station_id !== stationId)
      return fail(409, "operation_conflict", "Operation belongs to another watch");
    return handover;
  }
  const duty = (await c.query("SELECT * FROM gate_duty_sessions WHERE idempotency_key=$1", [operationId])).rows[0];
  if (duty && (duty.user_id !== session.userId || duty.station_id !== stationId))
    return fail(409, "operation_conflict", "Operation belongs to another watch");
  return duty ?? null;
}

export async function getGateWatchOperation(session: SessionPayload, stationId: string, operationId: string) {
  await stationAccess(pool, session, stationId);
  return { receipt: await watchReceipt(pool, session, stationId, operationId) };
}

/** A worker assumes a prepared watch from their own signed-in device.
 * Authentication, paid shifts, and watch custody are separate boundaries. */
export async function assumeGateWatch(session: SessionPayload, input: {
  stationId: string; operationId: string; source: "web" | "ios";
  preparationId?: string | null; reviewedRevision?: string; acknowledged?: boolean;
}) {
  return changeOverTransaction(async c => {
    await c.query("LOCK TABLE site_visits, ticket_check_ins, tickets, vendor_people, users, user_org_memberships, site_work_assignments, managed_subcontractor_worker_sponsorships, managed_subcontractor_role_grants IN SHARE ROW EXCLUSIVE MODE");
    const access = await stationAccess(c, session, input.stationId);
    await lockStation(c, input.stationId);
    if (access.station.active === false) return fail(409, "station_inactive", "This gate is inactive");
    // Check receipts before the current watch: a retry must not assume a later watch.
    const receipt = await watchReceipt(c, session, input.stationId, input.operationId);
    if (receipt) {
      if (receipt.incoming_user_id && (receipt.original_preparation_id ?? receipt.preparation_id) !== input.preparationId) return fail(409, "operation_conflict", "Operation already used");
      return receipt;
    }
    const own = (await c.query("SELECT * FROM gate_duty_sessions WHERE station_id=$1 AND user_id=$2 AND ended_at IS NULL", [input.stationId, session.userId])).rows[0];
    if (own?.post_coverage?.vendorId && own.post_coverage.vendorId !== session.vendorId)
      return fail(409, "duty_employer_changed", "Return to the original employer before changing this watch");
    const active = await activeShift(c, input.stationId);
    const released = !active ? await releasedWatch(c,input.stationId) : null;
    const shift=active??released;
    if (shift && (released || shift.operator_id !== session.userId)) {
      if (!input.acknowledged || !input.preparationId || input.preparationId !== shift.preparation_id) return fail(409, "acknowledgment_required", "The outgoing worker must prepare the handover. Review and acknowledge its notes before assuming this watch.");
      const prep = (await c.query("SELECT * FROM gate_preparations WHERE id=$1 AND shift_id=$2", [input.preparationId, shift.id])).rows[0];
      const live = await snapshot(c, access.station.site_id, input.stationId, shift.started_at);
      // Notes survive sign-out and elapsed time. Incoming review must still match
      // the live site revision, rather than silently acknowledge new activity.
      if (!prep || live.revision !== input.reviewedRevision) return fail(409, "stale", "Activity changed. Review the current watch and handover notes again.");
      if (session.userId && (session.vendorId || session.partnerId)) await assertRequiredWorkClear(c, session.userId, session.partnerId ? { type: "partner", id: session.partnerId } : { type: "vendor", id: session.vendorId! });
      const now = new Date();
      // Keep outgoing notes immutable and save exactly the live facts acknowledged.
      await c.query("INSERT INTO gate_preparations(id,shift_id,prepared_by,snapshot,notes,summary) VALUES($1,$2,$3,$4,$5,$6)",
        [input.operationId, shift.id, prep.prepared_by, live, prep.notes, { source: "structured_facts", facts: live.facts, originalPreparationId: prep.id, acknowledgedBy: session.userId }]);
      await c.query("UPDATE gate_shifts SET ended_at=$1 WHERE id=$2 AND ended_at IS NULL", [now, shift.id]);
      const next = (await c.query("INSERT INTO gate_shifts(station_id,operator_id,started_at) VALUES($1,$2,$3) RETURNING id", [input.stationId, session.userId, now])).rows[0];
      const handover = (await c.query(`INSERT INTO gate_handovers(id,preparation_id,incoming_shift_id,incoming_user_id,outgoing_name,incoming_name,acknowledged_at)
        VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`, [input.operationId, input.operationId, next.id, session.userId, shift.operator_name ?? "Gatekeeper", access.user.display_name ?? "Gatekeeper", now])).rows[0];
      await c.query("UPDATE gate_duty_sessions SET ended_at=$3,ended_by_user_id=$2,end_reason='Completed acknowledged watch handover' WHERE station_id=$1 AND user_id=$4 AND ended_at IS NULL", [input.stationId, session.userId, now, shift.operator_id]);
      await c.query(`INSERT INTO gate_duty_sessions(station_id,user_id,started_at,source,idempotency_key,post_coverage)
        SELECT $1,$2,$3,$4,$5,$6::jsonb WHERE NOT EXISTS (SELECT 1 FROM gate_duty_sessions WHERE station_id=$1 AND user_id=$2 AND ended_at IS NULL)`, [input.stationId, session.userId, now, input.source, input.operationId, JSON.stringify(session.vendorId ? { vendorId: session.vendorId } : {})]);
      return handover;
    }
    if (!shift) {
      if (input.preparationId) return fail(409, "stale", "The watch changed. Refresh before assuming it.");
      if (session.userId && (session.vendorId || session.partnerId)) await assertRequiredWorkClear(c, session.userId, session.partnerId ? { type: "partner", id: session.partnerId } : { type: "vendor", id: session.vendorId! });
      await c.query("INSERT INTO gate_shifts(station_id,operator_id,started_at) VALUES($1,$2,$3) RETURNING id", [input.stationId, session.userId, new Date()]);
    }
    if (own) return own;
    return (await c.query(`INSERT INTO gate_duty_sessions(station_id,user_id,started_at,source,idempotency_key,post_coverage)
      VALUES($1,$2,$3,$4,$5,$6::jsonb) RETURNING *`, [input.stationId, session.userId, new Date(), input.source, input.operationId, JSON.stringify(session.vendorId ? { vendorId: session.vendorId } : {})])).rows[0];
  });
}

export async function getShiftNotes(
  session: SessionPayload,
  input: { stationId: string; days?: number; before?: string; search?: string; limit?: number; handoffId?: string },
) {
  const access = await stationAccess(pool, session, input.stationId);
  const days = input.days ?? 7;
  if (!Number.isInteger(days) || days < 1 || days > 3650)
    return fail(400, "invalid_range", "Choose between 1 and 3650 days");
  const before = input.before ? new Date(input.before) : new Date();
  if (!Number.isFinite(before.getTime()))
    return fail(400, "invalid_cursor", "Invalid notes cursor");
  const limit = input.limit ?? 50;
  if (!Number.isInteger(limit) || limit < 1 || limit > 50)
    return fail(400, "invalid_range", "Choose between 1 and 50 notes");
  // The compact latest-notes list and exact-note links must reach older notes,
  // independently of the history page's selected date range.
  const from = input.handoffId || (input.limit !== undefined && input.days === undefined)
    ? new Date(0) : new Date(Date.now() - days * 86400000);
  const result = await pool.query(
    `SELECT h.*, p.snapshot, p.notes, p.summary, p.created_at AS filed_at,
      s.operator_id AS outgoing_user_id, s.started_at, s.ended_at, s.station_id,
      (SELECT min(a.created_at) FROM gate_shift_actions a WHERE a.station_id=s.station_id
       AND a.item_id=h.id AND a.actor_id=$5 AND a.kind='note_viewed') AS viewed_at
    FROM gate_handovers h JOIN gate_preparations p ON p.id=h.preparation_id JOIN gate_shifts s ON s.id=p.shift_id
    WHERE s.station_id=$1 AND h.acknowledged_at >= $2 AND h.acknowledged_at < $3
    AND ($6::uuid IS NULL OR h.id=$6)
    AND position(lower($4) in lower(p.notes || ' ' || p.snapshot::text || ' ' || h.outgoing_name || ' ' || h.incoming_name)) > 0
    ORDER BY ${input.limit !== undefined ? "p.created_at" : "h.acknowledged_at"} DESC, h.id DESC LIMIT $7`,
    [input.stationId, from, before, (input.search ?? "").slice(0, 200), session.userId, input.handoffId ?? null, limit + 1],
  );
  if (input.handoffId && !result.rows.length) return fail(404, "not_found", "Shift note not found at this gate");
  const rows = await Promise.all(result.rows.slice(0, limit).map(async row => ({ ...await projectGatePreparation(pool, row, session.vendorId), site_id: access.station.site_id })));
  const actions = input.limit !== undefined || input.handoffId ? [] : (
    await pool.query(
      "SELECT a.*, u.display_name AS actor_name FROM gate_shift_actions a JOIN users u ON u.id=a.actor_id WHERE station_id=$1 AND a.created_at >= $2 AND a.kind <> 'note_viewed' AND ($3::int IS NULL OR NOT EXISTS(SELECT 1 FROM work_hub_tasks t WHERE t.id=a.item_id AND t.gate_hopper IS NOT NULL AND t.owner_org_id<>$3)) ORDER BY a.created_at DESC LIMIT 100",
      [input.stationId, from, session.vendorId ?? null],
    )
  ).rows;
  return {
    rows,
    nextBefore:
      input.limit === undefined && result.rows.length > limit
        ? new Date(rows[limit - 1].acknowledged_at).toISOString()
        : null,
    actions,
    from: from.toISOString(),
    retention: "History is retained; this date range is a display filter.",
  };
}

/** Viewing notes is separate from acknowledging a handoff or assuming a watch. */
export async function markShiftNoteViewed(session: SessionPayload, stationId: string, handoffId: string) {
  return changeOverTransaction(async client => {
    await stationAccess(client, session, stationId);
    await lockStation(client, stationId);
    const note = await client.query(`SELECT h.id FROM gate_handovers h
      JOIN gate_preparations p ON p.id=h.preparation_id JOIN gate_shifts s ON s.id=p.shift_id
      WHERE h.id=$1 AND s.station_id=$2`, [handoffId, stationId]);
    if (!note.rowCount) return fail(404, "not_found", "Shift note not found at this gate");
    await client.query(`INSERT INTO gate_shift_actions(station_id,actor_id,item_id,kind,text)
      SELECT $1,$2,$3,'note_viewed','Shift note viewed'
      WHERE NOT EXISTS(SELECT 1 FROM gate_shift_actions WHERE station_id=$1 AND actor_id=$2 AND item_id=$3 AND kind='note_viewed')`,
      [stationId, session.userId, handoffId]);
    return { viewed: true };
  });
}
