import { pool } from "@workspace/db";
import { WorkforceRosterSchema, WorkdaySnapshotSchema } from "@workspace/api-zod";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "@workspace/db/schema";
import type { Pool, PoolClient } from "pg";
import type { SessionPayload } from "../lib/session";
import { z } from "zod/v4";
import { canManageVendorPeople } from "../lib/vendor-people-management";
import { validateAssistantSession } from "../assistant/chatgpt-grant-store";
import { createWorkHubAccess } from "../work-hub/context-access";
import { requireChangeOverAccess, ChangeOverError } from "./gate-change-over";
import { currentGateShift, GateShiftAssignmentError } from "./gate-shift-assignment";

/** Legacy Gate fallback predates normalized site grants. Workforce never expands that fallback into company-wide access. */
export async function assertWorkforceSiteAccess(client: Pick<PoolClient, "query">, session: SessionPayload, siteId: number, supervisor = false) {
  if (session.membershipRole === "admin" && !session.managedSubcontractor) return;
  if (session.managedSubcontractor) {
    const grants = await client.query(`SELECT g.id FROM managed_subcontractor_worker_sponsorships w JOIN managed_subcontractor_role_grants g ON g.sponsorship_id=w.id
      WHERE w.worker_user_id=$1 AND w.sponsor_vendor_id=$2 AND w.status='active' AND g.site_id=$3 AND g.status='active' AND g.role=ANY($4::text[])`,
    [session.userId, session.vendorId, siteId, supervisor ? ["gate_supervisor"] : ["gatekeeper", "gate_supervisor"]]);
    if (grants.rows.length) return;
  } else {
    const grants = await client.query(`SELECT p.id AS workforce_access FROM vendor_people p
      JOIN user_org_memberships m ON m.user_id=p.user_id AND m.vendor_id=p.vendor_id AND m.org_type='vendor' AND m.id=$4
      JOIN vendor_person_site_access a ON a.vendor_people_id=p.id AND a.site_location_id=$3 AND a.is_active=true
      WHERE p.user_id=$1 AND p.vendor_id=$2 AND p.is_active=true AND p.deleted_at IS NULL
      AND (EXISTS(SELECT 1 FROM vendor_person_operational_roles r WHERE r.vendor_people_id=p.id AND r.is_active=true AND r.role=ANY($5::text[]))
        OR (NOT EXISTS(SELECT 1 FROM vendor_person_operational_roles r WHERE r.vendor_people_id=p.id) AND p.vendor_role=ANY($5::text[])))`,
    [session.userId, session.vendorId, siteId, session.activeMembershipId, supervisor ? ["gate_supervisor"] : ["gatekeeper", "gate_supervisor"]]);
    if (grants.rows.length) return;
  }
  throw new GateShiftAssignmentError("work_hub.forbidden", 403);
}

export async function currentWorkforceGateShift(client: PoolClient, session: SessionPayload, shiftId: string, supervisor = true) {
  const shift = await currentGateShift(client, session, shiftId, supervisor);
  await assertWorkforceSiteAccess(client, session, shift.site_location_id, supervisor);
  return shift;
}

/** A missing saved preference is unknown, never an inferred unavailable worker. */
export function workforceOnCall(native: unknown, at: Date): "active" | "inactive" | "unknown" {
  const parsed = z.object({ onCallActive: z.boolean().optional(), onCallWindows: z.array(z.object({ startsAt: z.iso.datetime(), endsAt: z.iso.datetime(), consent: z.literal(true) }).refine(window => Date.parse(window.startsAt) < Date.parse(window.endsAt))).optional() }).passthrough().safeParse(native);
  if (!parsed.success) return "unknown";
  const saved = parsed.data;
  if (saved.onCallActive === true) return "active";
  if (Array.isArray(saved.onCallWindows) && saved.onCallWindows.some(window =>
    window?.consent === true && Date.parse(window.startsAt) <= at.getTime() && Date.parse(window.endsAt) > at.getTime())) return "active";
  return typeof saved.onCallActive === "boolean" || Array.isArray(saved.onCallWindows) ? "inactive" : "unknown";
}

export async function workforceActor(client: PoolClient, session: SessionPayload) {
  if (!session.userId || !session.vendorId || !session.activeMembershipId || !["vendor", "field_employee"].includes(session.role ?? ""))
    throw new GateShiftAssignmentError("work_hub.forbidden", 403);
  return validateAssistantSession(session, drizzle(client, { schema }));
}

export async function readWorkforceRoster(session: SessionPayload, database: Pick<Pool, "connect"> = pool, at = new Date()) {
  const client = await database.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const fresh = await workforceActor(client, session);
    const fullProfiles = await canManageVendorPeople({ ...fresh, userId: session.userId!, role: fresh.role!, vendorId: session.vendorId! }, session.vendorId!);
    const company = (fresh.membershipRole === "admin" || (fresh.role === "vendor" && fullProfiles)) && !fresh.managedSubcontractor;
    const sites = (await client.query(`SELECT DISTINCT s.id FROM site_locations s
      JOIN site_work_assignments a ON a.site_location_id=s.id AND a.vendor_id=$1 AND a.is_gate_contractor=true
      JOIN partner_vendor_relationships r ON r.vendor_id=a.vendor_id AND r.partner_id=s.partner_id AND r.status='approved'
      WHERE s.is_active=true AND s.hidden=false ORDER BY s.id`, [session.vendorId])).rows;
    const managedSites: number[] = [];
    for (const site of sites) {
      try {
        await assertWorkforceSiteAccess(client, session, site.id, true);
        const access = await requireChangeOverAccess(client, session, site.id);
        const capabilities = createWorkHubAccess({ session: { ...fresh, userId: session.userId! }, owner: { type: "vendor", id: session.vendorId! }, context: { kind: "gate", id: site.id }, participant: true }).capabilities;
        if (access.supervisor && capabilities.has("shift.manage")) managedSites.push(site.id);
      } catch (error) { if (!((error instanceof ChangeOverError || error instanceof GateShiftAssignmentError) && error.status === 403)) throw error; }
    }
    const scope = company ? "company" : managedSites.length ? "managed_sites" : "self";
    const rows = (await client.query(`SELECT DISTINCT ON(p.user_id) p.id,p.user_id,p.first_name,p.last_name,prefs.native_operations,
      clock.tool_output AS workday,assignment.title AS assignment
      FROM vendor_people p JOIN users u ON u.id=p.user_id
      LEFT JOIN work_hub_device_preferences prefs ON prefs.user_id=p.user_id AND prefs.owner_org_type='vendor' AND prefs.owner_org_id=$1
      LEFT JOIN LATERAL (SELECT tool_output FROM (SELECT DISTINCT ON(target_id) id,tool_output FROM assistant_action_audit
        WHERE vendor_id=$1 AND partner_id IS NULL AND target_type='workday' AND tool_output->>'workerUserId'=p.user_id::text
        ORDER BY target_id,id DESC) latest ORDER BY (tool_output->'summary'->>'endedAt' IS NULL) DESC,id DESC LIMIT 1) clock ON true
      LEFT JOIN LATERAL (SELECT s.title FROM work_hub_shift_assignments sa JOIN work_hub_shifts s ON s.id=sa.shift_id
        WHERE sa.user_id=p.user_id AND s.owner_org_type='vendor' AND s.owner_org_id=$1 AND s.starts_at<=$5 AND s.ends_at>$5
        AND s.milestone_status<>'cancelled' AND sa.status IN ('assigned','accepted','claimed')
        AND ($2::boolean OR p.user_id=$4 OR s.site_location_id=ANY($3::int[])) ORDER BY s.starts_at,s.id LIMIT 1) assignment ON true
      WHERE p.vendor_id=$1 AND p.is_active=true AND p.deleted_at IS NULL AND u.suspended_at IS NULL
      AND EXISTS(SELECT 1 FROM user_org_memberships m WHERE m.user_id=p.user_id AND m.vendor_id=$1 AND m.org_type='vendor')
      AND (EXISTS(SELECT 1 FROM vendor_person_operational_roles r WHERE r.vendor_people_id=p.id AND r.is_active=true AND r.role IN ('gatekeeper','gate_supervisor'))
        OR (NOT EXISTS(SELECT 1 FROM vendor_person_operational_roles r WHERE r.vendor_people_id=p.id) AND p.vendor_role IN ('gatekeeper','gate_supervisor')))
      AND ($2::boolean OR p.user_id=$4 OR EXISTS(SELECT 1 FROM vendor_person_site_access a WHERE a.vendor_people_id=p.id AND a.is_active=true AND a.site_location_id=ANY($3::int[])))
      ORDER BY p.user_id,p.id`, [session.vendorId, company, managedSites, session.userId, at])).rows;
    const employees = rows.map(row => {
      const parsed = WorkdaySnapshotSchema.safeParse(row.workday);
      const clock = parsed.success && parsed.data.owner.type === "vendor" && parsed.data.owner.id === session.vendorId && parsed.data.workerUserId === row.user_id ? parsed.data : null;
      return { userId: row.user_id, vendorPeopleId: row.id, name: `${row.first_name} ${row.last_name}`.trim(),
        onCall: workforceOnCall(row.native_operations, at), onShift: clock ? clock.summary.endedAt === null : null,
        shiftStartedAt: clock && clock.summary.endedAt === null ? clock.summary.startedAt : null, assignment: row.assignment ?? null,
        profileHref: fullProfiles ? `/field-employees/${row.id}` : null, canMessage: row.user_id !== session.userId };
    });
    const result = WorkforceRosterSchema.parse({ owner: { type: "vendor", id: session.vendorId }, observedAt: at.toISOString(), scope, employees, canManageOffers: managedSites.length > 0 });
    await client.query("COMMIT"); return result;
  } catch (error) { await client.query("ROLLBACK").catch(() => undefined); throw error; }
  finally { client.release(); }
}
