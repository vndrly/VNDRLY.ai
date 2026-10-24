import { Router } from "express";
import { and, eq, isNull, sql } from "drizzle-orm";
import { createHash } from "node:crypto";
import { z } from "zod/v4";
import { db, pool, siteLocationsTable, siteWorkAssignmentsTable, workforceStaffingRequirementsTable as requirements, workHubShiftsTable as shifts, workHubShiftAssignmentsTable as assignments } from "@workspace/db";
import { gateAssignmentTransactionClient, guardGateShiftAssignments, lockShiftSchedulingRows } from "../services/gate-shift-assignment";
import { hasAssignmentOverlap, validateScheduleRange } from "../work-hub/site-schedule-policy";
import { siteShiftPlanSchema, hasFullDayCoverage, workHubCommandEnvelopeSchema, type SiteShiftRow, type WorkHubOwner } from "@workspace/api-zod";
import { getSessionFromRequest } from "../lib/session";
import { isWorkHubEnabled } from "../work-hub/feature-access";
import { createWorkHubAccess, requireWorkHubCapability } from "../work-hub/context-access";
import { executeWorkHubCommand } from "../work-hub/commands";
import { appendWorkHubAudit } from "../work-hub/audit";
import { validateAssistantSession } from "../assistant/chatgpt-grant-store";

const router = Router();
import coverageWorkflow from "./coverageWorkflow";
router.use("/work-hub/site-shift-plans",coverageWorkflow);
const scopeSchema = z.object({ type: z.enum(["vendor", "partner"]), id: z.coerce.number().int().positive() });
const scope = (owner: WorkHubOwner, siteId: number) => and(eq(requirements.ownerOrgType, owner.type), eq(requirements.ownerOrgId, owner.id), eq(requirements.siteId, siteId), eq(requirements.roleCode, "general"), isNull(requirements.retiredAt));
const revision = (rows: { id: string }[]) => createHash("sha256").update(rows.map(row => row.id).sort().join(",")).digest("hex");
function planFromRows(rows: typeof requirements.$inferSelect[]) {
  const shifts: SiteShiftRow[] = [];
  for (const row of rows) {
    const found = shifts.find(shift => (shift.patternName ?? null) === row.patternName && (shift.timezone ?? null) === row.timezone && shift.startsAtLocal === row.startsAtLocal && shift.endsAtLocal === row.endsAtLocal && shift.requiredCount === row.requiredCount);
    if (found) found.weekdays.push(row.weekday);
    else shifts.push({ ...(row.patternName ? { patternName: row.patternName } : {}), ...(row.timezone ? { timezone: row.timezone } : {}), startsAtLocal: row.startsAtLocal, endsAtLocal: row.endsAtLocal, requiredCount: row.requiredCount, weekdays: [row.weekday] });
  }
  shifts.sort((a, b) => a.startsAtLocal.localeCompare(b.startsAtLocal));
  const days = [...new Set(shifts.flatMap(row => row.weekdays))];
  return { revision: revision(rows), mode: days.length && days.every(day => hasFullDayCoverage(shifts, day)) ? "24_hour" : "part_time", shifts };
}

router.use("/work-hub/site-shift-plans", async (req, res, next) => {
  const session = getSessionFromRequest(req);
  if (!session?.userId) return res.status(401).json({ message: "Sign in required" });
  if (!(await isWorkHubEnabled())) return res.sendStatus(404);
  if (session.managedSubcontractor || (session.role !== "admin" && session.membershipRole !== "admin")) return res.sendStatus(403);
  return next();
});

async function authorize(req: Parameters<typeof getSessionFromRequest>[0], owner: WorkHubOwner, siteId?: number) {
  const session = await validateAssistantSession(getSessionFromRequest(req)!,db);
  requireWorkHubCapability(createWorkHubAccess({ session: { ...session, userId: session.userId! }, owner, context: { kind: "organization", id: owner.id }, participant: true }), "shift.manage");
  const sites = await db.select({ id: siteLocationsTable.id, name: siteLocationsTable.name }).from(siteLocationsTable).where(and(
    siteId ? eq(siteLocationsTable.id, siteId) : undefined,
    owner.type === "partner" ? eq(siteLocationsTable.partnerId, owner.id) : sql`exists (select 1 from ${siteWorkAssignmentsTable} a where a.site_location_id = ${siteLocationsTable.id} and a.vendor_id = ${owner.id})`,
  ));
  if (siteId && !sites.length) throw Object.assign(new Error("Site is not available to this company"), { status: 403 });
  return { session, sites };
}
function failure(res: import("express").Response, error: unknown) {
  if (error instanceof z.ZodError) return res.status(400).json({ message: error.issues[0]?.message ?? "Invalid shift plan" });
  const status = error && typeof error === "object" && "status" in error ? Number(error.status) : 500;
  return res.status([403, 404, 409].includes(status) ? status : 500).json({ message: status === 409 ? "This plan changed. Reload it before saving." : status === 403 ? "You cannot manage this site’s shifts." : "Shift plans are unavailable. Please try again." });
}
router.get("/work-hub/site-shift-plans", async (req, res) => {
  try {
    const owner = scopeSchema.parse(req.query);
    const { sites } = await authorize(req, owner);
    return res.json({ sites });
  } catch (error) { return failure(res, error); }
});
router.get("/work-hub/site-shift-plans/:siteId", async (req, res) => {
  try {
    const owner = scopeSchema.parse(req.query), siteId = z.coerce.number().int().positive().parse(req.params.siteId);
    await authorize(req, owner, siteId);
    return res.json(planFromRows(await db.select().from(requirements).where(scope(owner, siteId))));
  } catch (error) { return failure(res, error); }
});
router.put("/work-hub/site-shift-plans/:siteId", async (req, res) => {
  try {
    const envelope = workHubCommandEnvelopeSchema.parse(req.body);
    const siteId = z.coerce.number().int().positive().parse(req.params.siteId);
    const input = z.object({ revision: z.string().regex(/^[a-f0-9]{64}$/), plan: siteShiftPlanSchema }).parse(envelope.payload);
    const { session } = await authorize(req, envelope.owner, siteId);
    const result = await executeWorkHubCommand({ userId: session.userId!, source: "web" }, `site-shift-plan.save:${siteId}`, envelope, async tx => {
      // Serialize replacements even when the site has no existing requirements.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`site-shift-plan:${envelope.owner.type}:${envelope.owner.id}:${siteId}`}))`);
      const current = await tx.select().from(requirements).where(scope(envelope.owner, siteId));
      if (revision(current) !== input.revision) throw Object.assign(new Error("Plan changed"), { status: 409 });
      await tx.update(requirements).set({ retiredAt: new Date() }).where(scope(envelope.owner, siteId));
      const saved = await tx.insert(requirements).values(input.plan.shifts.flatMap(shift => [...new Set(shift.weekdays)].map(weekday => ({ ownerOrgType: envelope.owner.type, ownerOrgId: envelope.owner.id, siteId, roleCode: "general", patternName: shift.patternName ?? null, timezone: shift.timezone ?? null, weekday, startsAtLocal: shift.startsAtLocal, endsAtLocal: shift.endsAtLocal, requiredCount: shift.requiredCount, createdById: session.userId! })))).returning();
      await appendWorkHubAudit({ actorUserId: session.userId!, owner: envelope.owner, action: "site-shift-plan.save", subjectType: "site", subjectId: siteId, source: "web", operationId: envelope.operationId, metadata: { shiftCount: input.plan.shifts.length, mode: input.plan.mode } }, tx);
      return planFromRows(saved);
    });
    return res.json(result);
  } catch (error) { return failure(res, error); }
});
const scheduleRange = z.object({ from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), through: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).refine(v => validateScheduleRange(v.from,v.through), "Choose up to 93 days");
router.get("/work-hub/site-shift-plans/:siteId/schedule", async (req,res) => {
  try {
    const owner = scopeSchema.parse(req.query), siteId = z.coerce.number().int().positive().parse(req.params.siteId), range = scheduleRange.parse(req.query);
    const { session } = await authorize(req,owner,siteId);
    if (owner.type !== "vendor" || session.vendorId !== owner.id) return res.status(403).json({message:"Use the vendor workspace to assign gatekeepers."});
    const people = await pool.query(`SELECT DISTINCT p.user_id AS id, concat_ws(' ',p.first_name,p.last_name) AS name FROM vendor_people p JOIN users u ON u.id=p.user_id
      WHERE p.vendor_id=$1 AND p.is_active=true AND p.deleted_at IS NULL AND u.suspended_at IS NULL
      AND EXISTS(SELECT 1 FROM user_org_memberships m WHERE m.user_id=p.user_id AND m.org_type='vendor' AND m.vendor_id=$1)
      AND EXISTS(SELECT 1 FROM vendor_person_site_access a WHERE a.vendor_people_id=p.id AND a.site_location_id=$2 AND a.is_active=true)
      AND (EXISTS(SELECT 1 FROM vendor_person_operational_roles r WHERE r.vendor_people_id=p.id AND r.is_active=true AND r.role IN ('gatekeeper','gate_supervisor'))
        OR (NOT EXISTS(SELECT 1 FROM vendor_person_operational_roles r WHERE r.vendor_people_id=p.id) AND p.vendor_role IN ('gatekeeper','gate_supervisor'))) ORDER BY name`,[owner.id,siteId]);
    const scheduled = await pool.query(`SELECT s.id,s.version,s.title,s.starts_at AS "startsAt",s.ends_at AS "endsAt",s.timezone,
      to_char(s.starts_at AT TIME ZONE s.timezone,'YYYY-MM-DD') AS date, extract(dow FROM s.starts_at AT TIME ZONE s.timezone)::int AS weekday,
      to_char(s.starts_at AT TIME ZONE s.timezone,'HH24:MI') AS starts,to_char(s.ends_at AT TIME ZONE s.timezone,'HH24:MI') AS ends,
      coalesce(s.required_staff_count,1) AS required,
      coalesce((SELECT r.pattern_name FROM workforce_staffing_requirements r WHERE r.owner_org_type=s.owner_org_type AND r.owner_org_id=s.owner_org_id AND r.site_id=s.site_location_id AND r.retired_at IS NULL AND r.weekday=extract(dow FROM s.starts_at AT TIME ZONE s.timezone) AND r.starts_at_local=to_char(s.starts_at AT TIME ZONE s.timezone,'HH24:MI') AND r.ends_at_local=to_char(s.ends_at AT TIME ZONE s.timezone,'HH24:MI') ORDER BY r.created_at DESC LIMIT 1),s.title) AS pattern,
      coalesce((SELECT json_agg(a.user_id) FROM work_hub_shift_assignments a WHERE a.shift_id=s.id AND a.status NOT IN ('cancelled','declined')), '[]'::json) AS assignees,
      coalesce((SELECT jsonb_object_agg(a.user_id::text,u.display_name) FROM work_hub_shift_assignments a JOIN users u ON u.id=a.user_id WHERE a.shift_id=s.id AND a.status NOT IN ('cancelled','declined')), '{}'::jsonb) AS "assigneeNames"
      FROM work_hub_shifts s WHERE s.owner_org_type='vendor' AND s.owner_org_id=$1 AND s.site_location_id=$2 AND s.gate_station_id IS NOT NULL AND s.recurrence IS NULL
      AND s.milestone_status NOT IN ('cancelled','completed') AND (s.starts_at AT TIME ZONE s.timezone)::date BETWEEN $3::date AND $4::date ORDER BY s.starts_at,s.id`,[owner.id,siteId,range.from,range.through]);
    const busy = await pool.query(`SELECT a.user_id AS "userId",s.id AS "shiftId",s.starts_at AS "startsAt",s.ends_at AS "endsAt" FROM work_hub_shift_assignments a JOIN work_hub_shifts s ON s.id=a.shift_id
      WHERE a.user_id=ANY($1::int[]) AND a.status NOT IN ('cancelled','declined') AND s.milestone_status<>'cancelled' AND s.ends_at>$2::date-interval '2 days' AND s.starts_at<$3::date+interval '3 days'`,[people.rows.map(p=>p.id),range.from,range.through]);
    const ready=await pool.query("SELECT to_regclass('public.workforce_coverage_resolutions') IS NOT NULL AS ready");
    if(ready.rows[0]?.ready&&scheduled.rows.length){
      const covers=await pool.query("SELECT anchor_shift_id,original_user_id,replacement_user_id FROM workforce_coverage_resolutions WHERE vendor_id=$1 AND kind='temporary' AND anchor_shift_id=ANY($2::uuid[]) ORDER BY created_at DESC,id DESC",[owner.id,scheduled.rows.map(s=>s.id)]);
      for(const shift of scheduled.rows){
        const owners=new Set<number>(shift.assignees);
        for(const cover of covers.rows.filter(c=>c.anchor_shift_id===shift.id))if(owners.delete(cover.replacement_user_id)&&cover.original_user_id)owners.add(cover.original_user_id);
        shift.recurringAssignees=[...owners];
      }
    }
    return res.json({ shifts:scheduled.rows,people:people.rows,busy:busy.rows,readOnly:process.env.LOCAL_COVERAGE_READ_ONLY === "1" });
  } catch(error) { return failure(res,error); }
});
router.post("/work-hub/site-shift-plans/:siteId/assign", async (req,res) => {
  try {
    const envelope = workHubCommandEnvelopeSchema.parse(req.body), siteId = z.coerce.number().int().positive().parse(req.params.siteId);
    const change = z.object({id:z.string().uuid(),version:z.number().int().positive(),addUserId:z.number().int().positive().optional(),removeUserId:z.number().int().positive().optional()}).refine(v => Boolean(v.addUserId || v.removeUserId) && v.addUserId !== v.removeUserId,"Choose a different replacement gatekeeper");
    const input = z.union([
      z.object({changes:z.array(change).min(1).max(200)}),
      z.object({ userId:z.number().int().positive(),shifts:z.array(z.object({id:z.string().uuid(),version:z.number().int().positive()})).min(1).max(200) }).transform(v => ({changes:v.shifts.map(s=>({...s,addUserId:v.userId,removeUserId:undefined}))})),
    ]).parse(envelope.payload);
    if (new Set(input.changes.map(s=>s.id)).size !== input.changes.length) return res.status(400).json({message:"Choose each shift only once."});
    const { session } = await authorize(req,envelope.owner,siteId);
    if (envelope.owner.type !== "vendor" || session.vendorId !== envelope.owner.id) return res.sendStatus(403);
    const fingerprint = createHash("sha256").update(JSON.stringify([...input.changes].sort((a,b)=>a.id.localeCompare(b.id)))).digest("hex");
    const result = await executeWorkHubCommand({userId:session.userId!,source:"web"},`site-shift.assign:${siteId}`,envelope,async tx => {
      const client = gateAssignmentTransactionClient(tx);
      await lockShiftSchedulingRows(client,session.userId!,null,[...new Set(input.changes.flatMap(c=>[c.addUserId,c.removeUserId].filter((id):id is number=>id!==undefined)))]);
      const windows = new Map<number,{id:string;startsAt:Date;endsAt:Date}[]>();
      const prepared: {change:typeof input.changes[number];shift:typeof shifts.$inferSelect;existing:typeof assignments.$inferSelect[]}[] = [];
      for(const selected of [...input.changes].sort((a,b)=>a.id.localeCompare(b.id))) {
        const [shift] = await tx.select().from(shifts).where(and(eq(shifts.id,selected.id),eq(shifts.ownerOrgType,"vendor"),eq(shifts.ownerOrgId,envelope.owner.id),eq(shifts.siteLocationId,siteId))).for("update");
        if (!shift || shift.version !== selected.version || shift.startsAt < new Date() || shift.recurrence || ["completed","cancelled"].includes(shift.milestoneStatus)) throw Object.assign(new Error("Schedule changed"),{status:409});
        const existing = await tx.select().from(assignments).where(eq(assignments.shiftId,shift.id));
        const active = existing.filter(a=>!["cancelled","declined"].includes(a.status));
        if (selected.removeUserId && !active.some(a=>a.userId===selected.removeUserId)) throw Object.assign(new Error("Assignment changed"),{status:409});
        if (selected.addUserId && (active.some(a=>a.userId===selected.addUserId) || active.length-(selected.removeUserId?1:0) >= (shift.requiredStaffCount ?? 1))) throw Object.assign(new Error("Staffing changed"),{status:409});
        if (selected.addUserId) {
          const userWindows = windows.get(selected.addUserId) ?? [];
          userWindows.push({id:shift.id,startsAt:shift.startsAt,endsAt:shift.endsAt}); windows.set(selected.addUserId,userWindows);
          if (hasAssignmentOverlap(userWindows)) throw Object.assign(new Error("Overlap"),{status:409});
        }
        // Removal-only changes still require current gate/site scheduling authority.
        if (selected.removeUserId) await guardGateShiftAssignments(client,session,shift.id,[]);
        prepared.push({change:selected,shift,existing});
      }
      // Retain assignment history; only the reviewed person's assignment is cancelled.
      // Everything remains inside one transaction, including all eligibility checks.
      for (const {change,shift} of prepared) if (change.removeUserId) await tx.update(assignments).set({status:"cancelled"}).where(and(eq(assignments.shiftId,shift.id),eq(assignments.userId,change.removeUserId)));
      for (const {change:selected,shift,existing} of prepared) {
        if (selected.addUserId) {
        const overlap = await client.query(`SELECT 1 FROM work_hub_shift_assignments a JOIN work_hub_shifts s ON s.id=a.shift_id WHERE a.user_id=$1 AND a.status NOT IN ('cancelled','declined') AND s.milestone_status<>'cancelled' AND s.starts_at<$3 AND s.ends_at>$2 LIMIT 1`,[selected.addUserId,shift.startsAt,shift.endsAt]);
        if (overlap.rows.length) throw Object.assign(new Error("Overlap"),{status:409});
        await guardGateShiftAssignments(client,session,shift.id,[selected.addUserId]);
        if (existing.some(a=>a.userId===selected.addUserId)) await tx.update(assignments).set({status:"assigned",assignedById:session.userId!}).where(and(eq(assignments.shiftId,shift.id),eq(assignments.userId,selected.addUserId)));
        else await tx.insert(assignments).values({shiftId:shift.id,userId:selected.addUserId,assignedById:session.userId!});
        }
        await tx.update(shifts).set({version:shift.version+1,updatedAt:new Date()}).where(eq(shifts.id,shift.id));
      }
      await appendWorkHubAudit({actorUserId:session.userId!,owner:envelope.owner,action:"site-shift.assign",subjectType:"site",subjectId:siteId,source:"web",operationId:envelope.operationId,metadata:{changes:input.changes}},tx);
      return {changed:input.changes.length,fingerprint};
    });
    if (result.replayed && result.resource.fingerprint !== fingerprint) return res.status(409).json({message:"This save request was already used for different changes. Refresh and review again."});
    return res.json(result);
  } catch(error) {
    if (error instanceof Error && /gate_assignment\.|assignment_conflict/.test(error.message)) return res.status(422).json({message:"Assignment blocked: check recorded availability, qualifications, rest time and overlapping commitments. No assignments were saved."});
    if ((error as {status?:number})?.status===409) return res.status(409).json({message:"The schedule changed, a shift is full, or the gatekeeper has a conflict. Refresh and review again. No assignments were saved."});
    return failure(res,error);
  }
});
export default router;

