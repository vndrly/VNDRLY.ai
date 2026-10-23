import { pool } from "@workspace/db";
import type { PoolClient } from "pg";
import type { SessionPayload } from "../lib/session";
import { ChangeOverError, changeOverTransaction, requireChangeOverAccess } from "./gate-change-over";

const kind = "gate.watch.schedule.response";
const fail = (status:number, code:string, message:string):never => { throw new ChangeOverError(status, `change_over.${code}`, message); };
const scope = (session:SessionPayload) => session.vendorId ? { type:"vendor", id:session.vendorId } : session.partnerId ? { type:"partner", id:session.partnerId } : fail(403,"forbidden","Choose your company first");
const iso = (value:Date|string) => new Date(value).toISOString();

async function actor(client:Pick<PoolClient,"query">, session:SessionPayload) {
  const owner=scope(session);
  const result=await client.query(`SELECT u.display_name FROM users u JOIN user_org_memberships m ON m.user_id=u.id
    WHERE u.id=$1 AND u.session_version=$2 AND u.suspended_at IS NULL AND m.id=$3
    AND m.org_type=$4 AND CASE WHEN $4='vendor' THEN m.vendor_id ELSE m.partner_id END=$5`,
  [session.userId,session.sv,session.activeMembershipId,owner.type,owner.id]);
  if(!result.rows.length)fail(401,"session_changed","Sign in again to continue");
  return {...owner,name:result.rows[0].display_name??"Gatekeeper"};
}

const scheduleSql=`SELECT s.id,s.title,s.starts_at,s.ends_at,s.timezone,s.version,s.site_location_id,s.gate_station_id,
  a.id AS assignment_id,a.assigned_by_id,COALESCE(a.assigned_by_id,s.created_by_id) AS scheduler_id,
  u.display_name AS scheduler_name,vp.id AS scheduler_person_id,g.name AS gate_name,l.name AS site_name,
  r.request_type AS response_type,r.warning_snapshot AS response_detail
  FROM work_hub_shifts s JOIN work_hub_shift_assignments a ON a.shift_id=s.id AND a.user_id=$1
  JOIN gate_stations g ON g.id=s.gate_station_id AND g.active=true
  JOIN site_locations l ON l.id=s.site_location_id
  LEFT JOIN users u ON u.id=COALESCE(a.assigned_by_id,s.created_by_id) AND u.suspended_at IS NULL
  LEFT JOIN vendor_people vp ON vp.user_id=u.id AND vp.vendor_id=s.owner_org_id AND s.owner_org_type='vendor' AND vp.is_active=true AND vp.deleted_at IS NULL
  LEFT JOIN LATERAL (SELECT request_type,warning_snapshot FROM work_hub_shift_requests r WHERE r.shift_id=s.id
    AND r.requested_by_id=$1 AND r.request_type IN ('gate_confirm','gate_conflict') AND r.status IN ('approved','pending')
    AND r.warning_snapshot->0->>'assignmentId'=a.id::text AND r.warning_snapshot->0->>'shiftVersion'=s.version::text
    ORDER BY r.created_at DESC,r.id DESC LIMIT 1) r ON true
  WHERE s.owner_org_type=$2 AND s.owner_org_id=$3 AND a.status IN ('assigned','accepted','claimed')
  AND s.milestone_status<>'cancelled' AND s.ends_at>now()`;

/** Personal assignments across all authorized gates in the active company. */
export async function listMyScheduledWatches(session:SessionPayload) {
  const owner=await actor(pool,session);
  const rows=(await pool.query(`${scheduleSql} ORDER BY s.starts_at,s.id`,[session.userId,owner.type,owner.id])).rows;
  const watches=[];
  for(const row of rows) {
    try { await requireChangeOverAccess(pool,session,row.site_location_id); }
    catch(error) { if(error instanceof ChangeOverError && [403,404].includes(error.status))continue;throw error; }
    watches.push({id:row.id,assignmentId:row.assignment_id,version:row.version,title:row.title,startsAt:iso(row.starts_at),endsAt:iso(row.ends_at),timezone:row.timezone,
      siteName:row.site_name,gateName:row.gate_name,stationId:row.gate_station_id,siteId:row.site_location_id,
      scheduler:{userId:row.scheduler_id,name:row.scheduler_name??"Scheduler",profileHref:row.scheduler_person_id?`/field-employees/${row.scheduler_person_id}`:null},
      response:row.response_type==="gate_confirm"?"confirmed":row.response_type==="gate_conflict"?"conflict":"pending",
      escalated:row.response_type==="gate_conflict"&&row.response_detail?.[0]?.escalated===true});
  }
  return {watches};
}

export type WatchScheduleResponse={operationId:string;expectedVersion:number;assignmentId:string;response:"confirm"|"conflict";reason?:string};

/** The request, its audit receipt and every recipient's notification commit atomically. */
export async function respondToScheduledWatch(session:SessionPayload,shiftId:string,input:WatchScheduleResponse) {
  const result=await changeOverTransaction(async client=>{
    const owner=await actor(client,session);
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[`${kind}:${session.userId}:${input.operationId}`]);
    const prior=(await client.query("SELECT result_json FROM work_hub_client_operations WHERE user_id=$1 AND command_kind=$2 AND operation_id=$3 AND owner_org_type=$4 AND owner_org_id=$5",[session.userId,kind,input.operationId,owner.type,owner.id])).rows[0]?.result_json;
    const command=JSON.stringify({shiftId,...input});
    if(prior) { if(prior.command!==command)fail(409,"operation_conflict","This request belongs to a different response");return prior; }
    // Same lock used by scheduling edits: never acknowledge a rescheduled or replaced assignment.
    const shift=(await client.query(`SELECT s.*,a.id AS assignment_id,a.status AS assignment_status,COALESCE(a.assigned_by_id,s.created_by_id) AS scheduler_id
      FROM work_hub_shifts s JOIN work_hub_shift_assignments a ON a.shift_id=s.id AND a.user_id=$1
      WHERE s.id=$2 AND s.owner_org_type=$3 AND s.owner_org_id=$4 FOR UPDATE OF s,a`,[session.userId,shiftId,owner.type,owner.id])).rows[0];
    if(!shift?.gate_station_id || !shift.site_location_id)fail(404,"not_found","Scheduled watch not found");
    const access=await requireChangeOverAccess(client,session,shift.site_location_id);
    if(shift.assignment_id!==input.assignmentId || shift.version!==input.expectedVersion || !['assigned','accepted','claimed'].includes(shift.assignment_status) || shift.milestone_status==='cancelled' || +new Date(shift.ends_at)<=Date.now())fail(409,"schedule_changed","This watch changed; refresh your schedule before responding");
    const station=(await client.query("SELECT name FROM gate_stations WHERE id=$1 AND site_id=$2 AND active=true",[shift.gate_station_id,shift.site_location_id])).rows[0];
    if(!station)fail(409,"schedule_changed","This gate is no longer active");
    if(input.response==='conflict'&&!input.reason?.trim())fail(400,"reason_required","Enter a brief scheduling conflict");
    // A later response supersedes the previous response, without removing the worker's assignment.
    await client.query("UPDATE work_hub_shift_requests SET status='superseded' WHERE shift_id=$1 AND requested_by_id=$2 AND request_type IN ('gate_confirm','gate_conflict') AND status IN ('pending','approved')",[shiftId,session.userId]);
    const escalated=input.response==='conflict' && +new Date(shift.starts_at)-Date.now()<24*60*60*1000;
    await client.query("INSERT INTO work_hub_shift_requests(id,shift_id,request_type,requested_by_id,target_user_id,status,warning_snapshot) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb)",
      [input.operationId,shiftId,`gate_${input.response}`,session.userId,shift.scheduler_id,input.response==='confirm'?'approved':'pending',JSON.stringify([{kind:'watch_response',assignmentId:shift.assignment_id,shiftVersion:shift.version,reason:input.response==='conflict'?input.reason!.trim():null,escalated}])]);
    if(input.response==='confirm')await client.query("UPDATE work_hub_shift_assignments SET status='accepted' WHERE id=$1 AND user_id=$2",[shift.assignment_id,session.userId]);
    await client.query("UPDATE workforce_assignment_states SET state=$3,acknowledged_at=now(),version=version+1,updated_at=now() WHERE shift_id=$1 AND worker_user_id=$2 AND state IN ('pending','acknowledged','declined')",[shiftId,session.userId,input.response==='confirm'?'acknowledged':'declined']);
    const recipients=new Set<number>();
    // A scheduler must still belong to this company to receive the response.
    const scheduler=await client.query(`SELECT m.user_id FROM user_org_memberships m JOIN users u ON u.id=m.user_id AND u.suspended_at IS NULL
      WHERE m.user_id=$1 AND m.org_type=$2 AND CASE WHEN $2='vendor' THEN m.vendor_id ELSE m.partner_id END=$3`,[shift.scheduler_id,owner.type,owner.id]);
    if(scheduler.rows.length)recipients.add(shift.scheduler_id);
    if(escalated) {
      const office=await client.query(`SELECT DISTINCT m.user_id FROM user_org_memberships m JOIN users u ON u.id=m.user_id AND u.suspended_at IS NULL
        LEFT JOIN vendor_people vp ON vp.id=m.vendor_people_id AND vp.vendor_id=m.vendor_id AND vp.is_active=true AND vp.deleted_at IS NULL
        WHERE m.org_type=$1 AND CASE WHEN $1='vendor' THEN m.vendor_id ELSE m.partner_id END=$2
        AND (m.role='admin' OR ($1='partner' AND m.role='member') OR vp.vendor_role IN ('office','both')
          OR EXISTS(SELECT 1 FROM vendor_person_operational_roles r WHERE r.vendor_people_id=vp.id AND r.is_active=true AND r.role='office'))`,[owner.type,owner.id]);
      for(const row of office.rows)recipients.add(row.user_id);
    }
    const when=new Date(shift.starts_at).toLocaleString('en-US',{timeZone:shift.timezone});
    const notifications=[];
    for(const recipient of recipients) {
      const type=input.response==='confirm'?'gate_watch_confirmed':escalated?'gate_watch_conflict_urgent':'gate_watch_conflict';
      const title=`${input.response==='confirm'?'Watch confirmed':escalated?'Urgent — watch coverage needed':'Watch scheduling conflict'} · ${access.site.name}`;
      // Personal reasons stay in the authenticated schedule record, never in SMS, push or email.
      const body=`${owner.name} ${input.response==='confirm'?'confirmed':'reported a scheduling conflict for'} ${station.name}, ${when} (${shift.timezone}).${input.response==='conflict'?' Coverage needs attention; the assignment remains recorded.':''}`;
      const notice=(await client.query(`INSERT INTO notifications(user_id,type,category,title,body,link,dedupe_key,urgent_delivery_pending)
        VALUES($1,$2,'system',$3,$4,$5,$6,true) RETURNING id,user_id AS "userId",type,title,body,link,created_at AS "createdAt"`,
      [recipient,type,title,body,`/work-hub/calendar?shift=${shiftId}`,`gate-watch-response:${input.operationId}:${recipient}`])).rows[0];
      notifications.push(notice);
    }
    const receipt={operationId:input.operationId,command,shiftId,response:input.response,escalated,notifiedCount:notifications.length,notifications};
    await client.query("INSERT INTO work_hub_client_operations(user_id,command_kind,operation_id,owner_org_type,owner_org_id,result_json,applied_at) VALUES($1,$2,$3,$4,$5,$6::jsonb,now())",[session.userId,kind,input.operationId,owner.type,owner.id,JSON.stringify(receipt)]);
    return receipt;
  });
  for(const n of result.notifications) {
    try {
      const {publishNotificationCreated}=await import('../lib/notification-events');
      publishNotificationCreated({userId:n.userId,notificationId:n.id,notifType:n.type,category:'system',title:n.title,body:n.body,link:n.link,audible:false,createdAt:iso(n.createdAt)});
      await (await import('./gate-alert-repository')).processPendingGateAlert(n);
    }catch { /* The durable notification worker retries after commit. */ }
  }
  return {operationId:result.operationId,shiftId:result.shiftId,response:result.response,escalated:result.escalated,notifiedCount:result.notifiedCount};
}
