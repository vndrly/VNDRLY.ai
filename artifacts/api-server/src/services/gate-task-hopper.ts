import { linkedGateScope } from "./gate-links";
import { createHash } from "node:crypto";
import { pool } from "@workspace/db";
import type { PoolClient } from "pg";
import type { SessionPayload } from "../lib/session";
import { requireActiveGateTaskWorkday, WorkdayError } from "./workday";

export class GateTaskError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
type Actor = { userId: number; vendorId: number | null; manager: boolean; platform: boolean; hopper: boolean };
export async function gateTaskActor(c: PoolClient, session: SessionPayload, assignedTaskId?: string): Promise<Actor> {
  const user = (await c.query("SELECT role,session_version,suspended_at,must_change_password FROM users WHERE id=$1 FOR SHARE", [session.userId])).rows[0];
  if (!user || user.session_version !== session.sv || user.suspended_at || user.must_change_password) throw new GateTaskError(403, "Current account access required");
  if (session.role === "admin" && user.role === "admin") return { userId: session.userId!, vendorId: session.vendorId ?? null, manager: true, platform: true, hopper: true };
  if (!session.vendorId || !session.activeMembershipId) throw new GateTaskError(403, "Vendor context required");
  const rows = (await c.query(`SELECT m.role,p.id AS person_id,p.vendor_role,
    EXISTS(SELECT 1 FROM vendor_person_operational_roles r WHERE r.vendor_people_id=p.id AND r.is_active=true AND r.role IN ('gatekeeper','gate_supervisor')) AS gate_role,
    EXISTS(SELECT 1 FROM managed_subcontractor_worker_sponsorships w JOIN managed_subcontractor_role_grants g ON g.sponsorship_id=w.id
      WHERE w.worker_user_id=m.user_id AND w.sponsor_vendor_id=m.vendor_id AND w.status='active' AND g.status='active' AND g.role IN ('gatekeeper','gate_supervisor')) AS managed_gate_role
    FROM user_org_memberships m LEFT JOIN vendor_people p ON p.id=m.vendor_people_id AND p.user_id=m.user_id AND p.vendor_id=m.vendor_id AND p.is_active=true AND p.deleted_at IS NULL
    WHERE m.id=$1 AND m.user_id=$2 AND m.vendor_id=$3 AND m.org_type='vendor' AND m.role=$4 FOR SHARE OF m`,
    [session.activeMembershipId, session.userId, session.vendorId, session.membershipRole])).rows;
  const member = rows[0], manager = member?.role === "admin" || ["office", "both"].includes(member?.vendor_role);
  const hopper = Boolean(manager || member?.gate_role || member?.managed_gate_role || ["gatekeeper", "gate_supervisor"].includes(member?.vendor_role));
  if (!member || !manager && !member.person_id && !member.managed_gate_role) throw new GateTaskError(403, "Current vendor employee access required");
  if (!hopper && (!assignedTaskId || !(await c.query(`SELECT id FROM work_hub_tasks WHERE id=$1 AND owner_org_type='vendor' AND owner_org_id=$2 AND gate_hopper IS NOT NULL AND (assignee_user_id=$3 OR gate_hopper->>'completedById'=$3::text)`, [assignedTaskId, session.vendorId, session.userId])).rows.length)) throw new GateTaskError(403, "Current gatekeeper or assigned employee access required");
  return { userId: session.userId!, vendorId: session.vendorId, manager, platform: false, hopper };
}
function owns(actor: Actor, task: any) {
  if (!task || !task.gate_hopper || task.owner_org_type !== "vendor" || !actor.platform && task.owner_org_id !== actor.vendorId) throw new GateTaskError(404, "Task not found");
}
async function transaction<T>(work: (c: PoolClient) => Promise<T>) {
  const c = await pool.connect();
  try { await c.query("BEGIN"); await c.query("SET LOCAL lock_timeout='5s'"); const value = await work(c); await c.query("COMMIT"); return value; }
  catch (error) { await c.query("ROLLBACK"); throw error; } finally { c.release(); }
}
export const gateTaskProjection = (task: any) => ({ id: task.id, title: task.title, description: task.description, status: task.status,
  ownerOrgId: task.owner_org_id, assigneeUserId: task.assignee_user_id, assigneeName: task.assignee_name ?? null,
  createdById: task.created_by_id, createdAt: new Date(task.created_at).toISOString(), version: task.version, gateHopper: task.gate_hopper,
  siteName: task.site_name, gateName: task.gate_name, completedByName: task.completed_by_name ?? null });
const taskSelect = `SELECT t.*,s.name AS site_name,g.name AS gate_name,u.display_name AS assignee_name,done.display_name AS completed_by_name
  FROM work_hub_tasks t LEFT JOIN gate_stations g ON g.id::text=t.gate_hopper->>'stationId'
  LEFT JOIN site_locations s ON s.id=(t.gate_hopper->>'siteId')::int
  LEFT JOIN users u ON u.id=t.assignee_user_id LEFT JOIN users done ON done.id=(t.gate_hopper->>'completedById')::int`;

export async function readGateTaskHopper(session: SessionPayload, filter: { stationId?: string; taskId?: string; before?: string }) {
  return transaction(async c => {
    const actor = await gateTaskActor(c, session, filter.taskId);
    let linkedSites: number[] = [];
    if (filter.stationId) {
      const gate = (await c.query("SELECT site_id FROM gate_stations WHERE id=$1",[filter.stationId])).rows[0];
      if (gate) {const scope = await linkedGateScope(c,session,gate.site_id); if(scope.groupId) linkedSites=scope.siteIds;}
    }

    const rows = (await c.query(`${taskSelect} WHERE t.owner_org_type='vendor' AND t.gate_hopper IS NOT NULL AND ($1::int IS NULL OR t.owner_org_id=$1)
      AND ($2::text IS NULL OR t.gate_hopper->>'stationId'=$2 OR (t.gate_hopper->>'siteId')::int=ANY($5::int[])) AND ($3::uuid IS NULL OR t.id=$3)
      AND ($3::uuid IS NOT NULL OR (t.assignee_user_id IS NULL AND t.status IN ('open','in_progress') AND t.gate_hopper->>'clearedAt' IS NULL))
      AND ($4::uuid IS NULL OR (t.created_at,t.id)<(SELECT created_at,id FROM work_hub_tasks WHERE id=$4))
      ORDER BY t.created_at DESC,t.id DESC LIMIT 101`, [actor.platform ? actor.vendorId : actor.vendorId, filter.stationId ?? null, filter.taskId ?? null, filter.before ?? null, linkedSites])).rows;
    // An exact-task request is subject to the same vendor boundary as the hopper.
    const tasks = rows.slice(0, 100).map(gateTaskProjection);
    const total = (await c.query(`SELECT count(*)::int AS count FROM work_hub_tasks t WHERE t.owner_org_type='vendor' AND t.gate_hopper IS NOT NULL AND ($1::int IS NULL OR t.owner_org_id=$1)
      AND ($2::text IS NULL OR t.gate_hopper->>'stationId'=$2 OR (t.gate_hopper->>'siteId')::int=ANY($3::int[])) AND t.assignee_user_id IS NULL AND t.status IN ('open','in_progress') AND t.gate_hopper->>'clearedAt' IS NULL`, [actor.vendorId, filter.stationId ?? null, linkedSites])).rows[0].count;
    const unimported = actor.hopper && !filter.taskId ? (await c.query(`WITH latest AS (
      SELECT DISTINCT ON(a.item_id) a.* FROM gate_shift_actions a WHERE a.kind IN ('open','resolve','reopen') ORDER BY a.item_id,a.created_at DESC,a.id DESC
    ) SELECT a.item_id AS id,a.station_id AS "stationId",a.text,a.created_at AS "createdAt",s.name AS "siteName",g.name AS "gateName" FROM latest a
      JOIN gate_stations g ON g.id=a.station_id JOIN site_locations s ON s.id=g.site_id
      WHERE a.kind<>'resolve' AND ($1::text IS NULL OR a.station_id::text=$1 OR g.site_id=ANY($3::int[])) AND NOT EXISTS(SELECT 1 FROM work_hub_tasks t WHERE t.id=a.item_id)
      AND ($2::int IS NULL OR EXISTS(SELECT 1 FROM site_work_assignments w WHERE w.site_location_id=g.site_id AND w.vendor_id=$2 AND w.is_gate_contractor=true))
      ORDER BY a.created_at DESC,a.item_id DESC LIMIT 100`, [filter.stationId ?? null, actor.vendorId, linkedSites])).rows : [];
    return { tasks, total: actor.hopper ? total : 0, unimported, canManage: actor.manager, nextBefore: rows.length > 100 ? tasks.at(-1)!.id : null };
  });
}
export async function gateTaskOptions(session: SessionPayload, taskId?: string) {
  return transaction(async c => {
    const actor = await gateTaskActor(c, session, taskId);
    const gates = (await c.query(`SELECT DISTINCT g.id AS "stationId",g.name AS "gateName",s.id AS "siteId",s.name AS "siteName",v.id AS "vendorId",v.name AS "vendorName"
      FROM gate_stations g JOIN site_locations s ON s.id=g.site_id JOIN site_work_assignments a ON a.site_location_id=s.id AND a.is_gate_contractor=true
      JOIN vendors v ON v.id=a.vendor_id WHERE ($1::int IS NULL OR v.id=$1) AND g.active=true AND s.is_active=true AND s.hidden IS DISTINCT FROM true ORDER BY s.name,g.name,v.name`, [actor.vendorId])).rows;
    const people = actor.manager ? (await c.query(`SELECT DISTINCT u.id AS "userId",u.display_name AS name,m.vendor_id AS "vendorId" FROM user_org_memberships m
      JOIN users u ON u.id=m.user_id AND u.suspended_at IS NULL LEFT JOIN vendor_people p ON p.id=m.vendor_people_id
      WHERE m.org_type='vendor' AND ($1::int IS NULL OR m.vendor_id=$1) AND (m.role='admin' OR (p.is_active=true AND p.deleted_at IS NULL)) ORDER BY u.display_name,u.id`, [actor.vendorId])).rows : [];
    let canComplete = false;
    try { await requireActiveGateTaskWorkday(c, session); canComplete = true; }
    catch (error) { if (!(error instanceof WorkdayError) || error.status !== 403) throw error; }
    return { gates: actor.hopper ? gates : [], people, canManage: actor.manager, canComplete };
  });
}
export type GateTaskCommand = { operationId: string; action: "create" | "import" | "complete" | "assign" | "clear" | "delete" | "reopen";
  actorUserId?: number; taskId?: string; expectedVersion?: number; vendorId?: number; stationId?: string; text?: string; note?: string; assigneeUserId?: number | null };
export async function mutateGateTask(session: SessionPayload, command: GateTaskCommand) {
  if (session.realm === "demo" || session.publicDemo) throw new GateTaskError(403, "This session is read only");
  return transaction(async c => mutateGateTaskInTransaction(c, session, command));
}
export async function mutateGateTaskInTransaction(c: PoolClient, session: SessionPayload, command: GateTaskCommand) {
  if (session.realm === "demo" || session.publicDemo) throw new GateTaskError(403, "This session is read only");
  // Match Gate handoff's station -> task/clock order before taking user locks.
  const stationId = command.action === "create" || command.action === "import" ? command.stationId : (await c.query("SELECT gate_hopper->>'stationId' AS id FROM work_hub_tasks WHERE id=$1", [command.taskId])).rows[0]?.id;
  if (stationId) await c.query("SELECT id FROM gate_stations WHERE id=$1 FOR UPDATE", [stationId]);
  const actor = await gateTaskActor(c, session, command.action === "create" || command.action === "import" ? undefined : command.taskId);
  if (command.actorUserId !== undefined && command.actorUserId !== actor.userId) throw new GateTaskError(409, "Account changed; refresh before acting");
  if (!actor.platform && command.vendorId !== undefined && command.vendorId !== actor.vendorId) throw new GateTaskError(409, "Vendor context changed; refresh before acting");
  const fingerprint = createHash("sha256").update(JSON.stringify(command)).digest("hex");
  await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`gate-task:${actor.userId}:${command.operationId}`]);
  const receipt = (await c.query(`SELECT detail FROM work_hub_task_events WHERE actor_user_id=$1 AND detail->>'operationId'=$2 LIMIT 1`, [actor.userId, command.operationId])).rows[0]?.detail;
  if (receipt) {
    if (receipt.fingerprint !== fingerprint) throw new GateTaskError(409, "Operation already used for different task details");
    if (!actor.platform && receipt.result.ownerOrgId !== actor.vendorId) throw new GateTaskError(404, "Task not found");
    return { task: receipt.result, replayed: true };
  }
  let task: any, eventType: string;
  if (command.action === "create" || command.action === "import") {
    if (command.action === "import" && !actor.manager) throw new GateTaskError(403, "Office or admin must select the original task's vendor");
    if (!actor.manager) await requireActiveGateTaskWorkday(c, session);
    if (command.action === "create" && (await c.query("SELECT id FROM gate_shift_actions WHERE item_id=$1 LIMIT 1", [command.taskId ?? command.operationId])).rows.length) throw new GateTaskError(409, "An original action with this identity requires office attribution");
    const vendorId = actor.platform ? command.vendorId ?? actor.vendorId : actor.vendorId;
    const gate = (await c.query(`SELECT g.id,g.site_id FROM gate_stations g JOIN site_locations s ON s.id=g.site_id WHERE g.id=$1 AND g.active=true AND s.is_active=true AND s.hidden IS DISTINCT FROM true AND EXISTS(SELECT 1 FROM site_work_assignments a WHERE a.site_location_id=g.site_id AND a.vendor_id=$2 AND a.is_gate_contractor=true)`, [command.stationId, vendorId])).rows[0];
    if (!gate || !vendorId) throw new GateTaskError(403, "Choose a gate served by this vendor");
    const original = command.action === "import" ? (await c.query(`SELECT * FROM gate_shift_actions WHERE station_id=$1 AND item_id=$2 AND kind IN ('open','resolve','reopen') ORDER BY created_at DESC,id DESC LIMIT 1`, [gate.id, command.taskId])).rows[0] : null;
    if (command.action === "import" && (!original || original.kind === "resolve")) throw new GateTaskError(409, "The original action is no longer open");
    const text = original?.text ?? command.text?.trim(); if (!text) throw new GateTaskError(400, "Task details are required");
    task = (await c.query(`INSERT INTO work_hub_tasks(id,owner_org_type,owner_org_id,title,description,created_by_id,gate_hopper,created_at)
      VALUES($1,'vendor',$2,$3,$4,$5,$6::jsonb,$7) ON CONFLICT(id) DO NOTHING RETURNING *`, [command.taskId ?? command.operationId, vendorId, text.slice(0, 200), text, original?.actor_id ?? actor.userId, JSON.stringify({ stationId: gate.id, siteId: gate.site_id, ...(original ? { legacy: true } : {}) }), original?.created_at ?? new Date()])).rows[0];
    if (!task) throw new GateTaskError(409, "Task was already added; refresh");
    eventType = original ? "hopper.imported" : "created";
  } else {
    task = (await c.query("SELECT * FROM work_hub_tasks WHERE id=$1 FOR UPDATE", [command.taskId])).rows[0];
    owns(actor, task);
    if (task.version !== command.expectedVersion) throw new GateTaskError(409, "Task changed; refresh before acting");
    const context = { ...task.gate_hopper }, at = new Date().toISOString();
    if (context.clearedAt) throw new GateTaskError(409, "Task was removed from the hopper");
    if (command.action === "complete") {
      if (!["open", "in_progress"].includes(task.status)) throw new GateTaskError(409, "Task is no longer open");
      if (task.assignee_user_id && task.assignee_user_id !== actor.userId && !actor.manager) throw new GateTaskError(403, "This task is assigned to another employee");
      await requireActiveGateTaskWorkday(c, session);
      if (!command.note?.trim()) throw new GateTaskError(400, "Completion note is required");
      Object.assign(context, { completedById: actor.userId, completedAt: at, completionNote: command.note.trim() });
      task.status = "completed"; eventType = "status.completed";
    } else if (command.action === "assign") {
      if (!actor.manager) throw new GateTaskError(403, "Office or admin access required");
      if (!["open", "in_progress"].includes(task.status)) throw new GateTaskError(409, "Only open tasks can be assigned");
      if (command.assigneeUserId && !(await c.query(`SELECT m.id FROM user_org_memberships m JOIN users u ON u.id=m.user_id AND u.suspended_at IS NULL
        LEFT JOIN vendor_people p ON p.id=m.vendor_people_id WHERE m.user_id=$1 AND m.vendor_id=$2 AND m.org_type='vendor' AND (m.role='admin' OR (p.is_active=true AND p.deleted_at IS NULL))`, [command.assigneeUserId, task.owner_org_id])).rows.length) throw new GateTaskError(403, "Choose a current employee of this vendor");
      task.assignee_user_id = command.assigneeUserId ?? null; eventType = "assigned";
    } else if (command.action === "reopen") {
      if (task.assignee_user_id && task.assignee_user_id !== actor.userId && !actor.manager) throw new GateTaskError(403, "This task is assigned to another employee");
      await requireActiveGateTaskWorkday(c, session);
      if (task.status !== "completed") throw new GateTaskError(409, "Only completed tasks can be reopened");
      delete context.completedById; delete context.completedAt; delete context.completionNote;
      task.status = "open"; eventType = "status.open";
    } else {
      if (!actor.manager || task.assignee_user_id || !["open", "in_progress"].includes(task.status)) throw new GateTaskError(403, "Only office or admin can remove an unassigned open task");
      context.clearedAt = at; task.status = "cancelled"; eventType = `hopper.${command.action}`;
    }
    task = (await c.query(`UPDATE work_hub_tasks SET status=$2,assignee_user_id=$3,gate_hopper=$4::jsonb,version=version+1,updated_at=now() WHERE id=$1 RETURNING *`, [task.id, task.status, task.assignee_user_id, JSON.stringify(context)])).rows[0];
  }
  const result = gateTaskProjection((await c.query(`${taskSelect} WHERE t.id=$1`, [task.id])).rows[0]);
  // Compatibility projection for saved handoff snapshots and existing clients.
  // The task update and its Gate action are committed together, never copied per watch.
  const kind = command.action === "create" ? "open" : command.action === "reopen" || command.action === "assign" && !task.assignee_user_id ? "reopen" : "resolve";
  const actionText = command.action === "create" ? task.description : `${task.description ?? task.title}\n${command.action === "assign" ? task.assignee_user_id ? `Assigned to employee ${task.assignee_user_id}` : "Returned to unassigned hopper" : command.note ?? command.action}`;
  if (command.action !== "import") await c.query("INSERT INTO gate_shift_actions(station_id,actor_id,item_id,kind,text) VALUES($1,$2,$3,$4,$5)", [task.gate_hopper.stationId, actor.userId, task.id, kind, actionText]);
  await c.query("INSERT INTO work_hub_task_events(task_id,actor_user_id,event_type,detail) VALUES($1,$2,$3,$4::jsonb)", [task.id, actor.userId, eventType, JSON.stringify({ operationId: command.operationId, fingerprint, result, note: command.note ?? null, assigneeUserId: task.assignee_user_id })]);
  return { task: result, replayed: false };
}
