import { pool } from "@workspace/db";
import { ACTIVE_APPROVAL_STATUSES } from "@workspace/db/schema";
import type { SessionPayload } from "../lib/session";
import { ChangeOverError, listChangeOverSites } from "./gate-change-over";
import { gateWatchTicketReadiness } from "./gate-watch-ticket";
import { readWorkflowHelperProgress } from "./workflow-helper-progress";

type Action = { title: string; href: string };
export type FirstWatchRecord = { siteId: number; stationId: string | null; siteName: string; stationName: string | null; partnerName?: string | null; gateLabelStations?: { id: string; siteId: number; name: string; active: boolean; topology: { parentGateId?: string | null } | null }[]; employeeId: number | null; shiftId: string | null; assignedUserId: number | null; watchId: string | null; ticketId: number | null; ticketBlocker?: string | null; startsAt?: string | null; eligibleUserId?: number | null; employeeKind?: "direct" | "managed" | null; managedOrganizationId?: string | null; managedWorkerId?: string | null; stationCreatedAt?: string | null; day?: string | null };

/** Each row is one company/site/station/shift/worker chain, never pooled counts. */
export function firstWatchStep(records: FirstWatchRecord[], userId: number, office: boolean, setupSites: { id: number; name: string }[] = []) {
  const eligibleWorker = (record: FirstWatchRecord) => Boolean(record.employeeId || record.eligibleUserId);
  const score = (r: FirstWatchRecord) => r.watchId ? r.ticketId ? 6 : 5 : r.assignedUserId ? 4 : r.shiftId ? 3 : eligibleWorker(r) ? 2 : 1;
  const completed = records.find(record => record.watchId && record.ticketId);
  const visible = office ? records : records.filter(record=>record.assignedUserId===userId || record.watchId);
  const ordered = [...visible].sort((a,b) => a.siteId-b.siteId || String(a.stationCreatedAt??"").localeCompare(String(b.stationCreatedAt??"")) || String(a.stationId??"").localeCompare(String(b.stationId??"")) || String(a.startsAt??"").localeCompare(String(b.startsAt??"")) || String(a.shiftId??"").localeCompare(String(b.shiftId??"")));
  const first = ordered[0];
  const row = completed ?? (first ? ordered.filter(record => record.siteId===first.siteId && record.stationId===first.stationId && record.shiftId===first.shiftId).sort((a,b)=>score(b)-score(a))[0] : undefined);
  if (row?.watchId && row.ticketId) return { complete: true, action: null, message: null, context: row };
  if (!row && !office) return {complete:false,action:null,message:"Waiting for your company to schedule and assign your first gate watch.",context:null};
  if (!row) {
    const site = setupSites[0];
    if (!site) return {complete:false,action:null,message:"Waiting for an existing site and your company's Gate service authorization before a station can be added.",context:null};
    const context:FirstWatchRecord={siteId:site.id,siteName:site.name,stationId:null,stationName:null,employeeId:null,eligibleUserId:null,shiftId:null,assignedUserId:null,watchId:null,ticketId:null};
    return {complete:false,action:{title:"Add a gate station at this site",href:`/gate-locations?siteId=${site.id}`},message:null,context};
  }
  const query = new URLSearchParams({ siteId: String(row.siteId), ...(row.stationId ? {stationId:row.stationId}:{}), ...(row.shiftId ? { shiftId: row.shiftId } : {}), ...(row.day ? { day: row.day } : {}), ...(row.eligibleUserId ? { employee: String(row.eligibleUserId) } : {}) }).toString();
  let action: Action | null = null, message: string | null = null;
  if (!office && !row.watchId && (!eligibleWorker(row) || !row.shiftId || !row.assignedUserId)) message = "Waiting for your company to schedule and assign your first gate watch.";
  else if (row.watchId) {
    message = row.ticketBlocker ? "Watch saved. Company service setup needs attention before its automatic ticket can be confirmed." : "Watch saved. Waiting for its automatic ticket to be confirmed; do not assume this watch again.";
    if (row.ticketBlocker && office) action = { title: "Review gate service setup", href: `/vendor-catalog?${query}` };
  }
  else if (!eligibleWorker(row)) action = { title: "Give an eligible gate employee access to this site", href: `/field-employees?${query}` };
  else if (!row.shiftId) action = { title: "Create a shift for this gate station", href: `/work-hub/calendar?${query}` };
  else if (!row.assignedUserId) action = { title: "Assign an eligible gate employee to this shift", href: `/work-hub/calendar?${query}` };
  else if ((row.startsAt && new Date(row.startsAt).getTime()>Date.now()) || row.ticketBlocker==="gate_ticket.shift_not_started") message = "Waiting for this scheduled shift to begin. The assigned gatekeeper can then Assume Watch and their ticket starts automatically.";
  else if (row.ticketBlocker) {
    message = "Company service setup needs attention before the assigned gatekeeper can Assume Watch and start their automatic ticket.";
    if (office) action = {title:"Review gate service setup",href:`/vendor-catalog?${query}`};
  }
  else if (row.assignedUserId !== userId) message = "Waiting on the assigned gatekeeper to Assume Watch. Their ticket starts automatically.";
  else action = { title: "Assume Watch", href: `/gate/change-over?${query}` };
  return { complete: false, action, message, context: row };
}

export async function readAccountNextSteps(session: SessionPayload) {
  if (!session.userId || !session.vendorId || !session.activeMembershipId) throw new ChangeOverError(403,"change_over.forbidden","Choose your current vendor company.");
  const membership = (await pool.query(`SELECT m.role FROM user_org_memberships m JOIN users u ON u.id=m.user_id
    WHERE m.id=$1 AND m.user_id=$2 AND m.vendor_id=$3 AND m.org_type='vendor'
    AND u.session_version=$4 AND u.suspended_at IS NULL`,[session.activeMembershipId,session.userId,session.vendorId,session.sv])).rows[0];
  if (!membership) throw new ChangeOverError(403,"change_over.forbidden","Current company membership required.");
  const office = session.role === "vendor" && membership.role === "admin";
  const setup: Action[] = [], credentials: Action[] = [];
  const vendor = (await pool.query("SELECT physical_address,billing_address,contact_phone,federal_tax_id,state_tax_id,coi_document_url,current_catalog_version_id,operations_categories FROM vendors WHERE id=$1",[session.vendorId])).rows[0];
  if (office && vendor) {
    if (!vendor.physical_address || !vendor.billing_address || !vendor.contact_phone || !vendor.federal_tax_id || !vendor.state_tax_id) setup.push({title:"Complete your company profile and applicable business IDs",href:`/vendors/${session.vendorId}`});
    if (!vendor.current_catalog_version_id) setup.push({title:"Set up and publish your service catalog",href:"/vendor-catalog"});
  }
  if (session.role === "field_employee" && !session.managedSubcontractor) {
    const person = (await pool.query(`SELECT p.id,p.first_name,p.last_name,p.email,p.phone,p.photo_url,p.profile_photo_path FROM vendor_people p JOIN user_org_memberships m ON m.vendor_people_id=p.id
      WHERE m.id=$1 AND p.user_id=$2 AND p.vendor_id=$3 AND p.is_active=true AND p.deleted_at IS NULL`,[session.activeMembershipId,session.userId,session.vendorId])).rows[0];
    if (person) {
      if (!person.first_name?.trim() || !person.last_name?.trim() || !person.email?.trim() || !person.phone?.trim()) setup.push({title:"Complete your worker profile",href:"/field/profile/edit"});
      if (!person.photo_url && !person.profile_photo_path) setup.push({title:"Add a profile photo",href:"/field/profile/edit"});
      const missing = (await pool.query(`SELECT name FROM employee_certifications WHERE employee_id=$1 AND deleted_at IS NULL
        AND (expiration_date<CURRENT_DATE OR (document_url IS NULL AND document_path IS NULL)) ORDER BY id`,[person.id])).rows;
      for (const record of missing) credentials.push({title:`Update ${record.name}`,href:"/field/compliance"});
    }
  }
  const helperProgress = await readWorkflowHelperProgress(session);
  if (!vendor?.operations_categories?.includes("gate")) return { setup, credentials, firstWatch: null, helperProgress, ...(office?{coiUploadNeeded:!vendor?.coi_document_url?.trim()}:{}) };
  const sites = await listChangeOverSites(session);
  // Managed roster evidence follows gate-staffing-candidates: a current company
  // membership, sponsor, worker sponsorship and explicit Gate grant at this site.
  // Ended evidence is never promoted back to readiness by a stale active status.
  const records = (await pool.query(`SELECT l.id AS "siteId",g.id AS "stationId",l.name AS "siteName",g.name AS "stationName",g.created_at AS "stationCreatedAt",
    (SELECT name FROM partners WHERE id=l.partner_id) AS "partnerName",
    (SELECT jsonb_agg(jsonb_build_object('id',peer.id,'siteId',peer.site_id,'name',peer.name,'active',peer.active,
      'topology',jsonb_build_object('parentGateId',peer.topology->>'parentGateId')) ORDER BY peer.name,peer.id)
      FROM gate_stations peer WHERE peer.site_id=l.id) AS "gateLabelStations",
    p.id AS "employeeId",p.user_id AS "eligibleUserId",p.employee_kind AS "employeeKind",p.managed_organization_id AS "managedOrganizationId",p.managed_worker_id AS "managedWorkerId",
    s.starts_at AS "startsAt",to_char(s.starts_at AT TIME ZONE s.timezone,'YYYY-MM-DD') AS day,s.id AS "shiftId",a.user_id AS "assignedUserId",w.id AS "watchId",t.id AS "ticketId",d.post_coverage->>'ticketBlocker' AS "ticketBlocker"
    FROM gate_stations g JOIN site_locations l ON l.id=g.site_id
    LEFT JOIN LATERAL (SELECT DISTINCT ON (user_id) * FROM (
      SELECT p.id,p.user_id,'direct'::text AS employee_kind,NULL::uuid AS managed_organization_id,NULL::uuid AS managed_worker_id
      FROM vendor_people p JOIN users u ON u.id=p.user_id AND u.suspended_at IS NULL
      JOIN user_org_memberships m ON m.vendor_people_id=p.id AND m.user_id=p.user_id AND m.vendor_id=p.vendor_id AND m.org_type='vendor'
      WHERE p.vendor_id=$1 AND p.is_active=true AND p.deleted_at IS NULL
      AND EXISTS(SELECT 1 FROM vendor_person_site_access x WHERE x.vendor_people_id=p.id AND x.site_location_id=l.id AND x.is_active=true)
      AND (p.vendor_role IN ('gatekeeper','gate_supervisor') OR EXISTS(SELECT 1 FROM vendor_person_operational_roles r WHERE r.vendor_people_id=p.id AND r.is_active=true AND r.role IN ('gatekeeper','gate_supervisor')))
      AND ($3::boolean OR p.user_id=$4)
      UNION ALL
      SELECT NULL::int AS id,w.worker_user_id AS user_id,'managed'::text AS employee_kind,w.managed_organization_id,w.id AS managed_worker_id
      FROM managed_subcontractor_worker_sponsorships w JOIN users u ON u.id=w.worker_user_id AND u.suspended_at IS NULL
      JOIN managed_subcontractor_organizations o ON o.id=w.managed_organization_id AND o.status<>'archived'
      JOIN managed_subcontractor_sponsors sponsor ON sponsor.managed_organization_id=w.managed_organization_id
        AND sponsor.sponsor_vendor_id=w.sponsor_vendor_id AND sponsor.status='active' AND sponsor.ended_at IS NULL
      WHERE w.sponsor_vendor_id=$1 AND w.status='active' AND w.ended_at IS NULL
      AND EXISTS(SELECT 1 FROM user_org_memberships m WHERE m.user_id=w.worker_user_id AND m.vendor_id=w.sponsor_vendor_id AND m.org_type='vendor')
      AND EXISTS(SELECT 1 FROM managed_subcontractor_role_grants r WHERE r.sponsorship_id=w.id AND r.site_id=l.id
        AND r.status='active' AND r.ended_at IS NULL AND r.role IN ('gatekeeper','gate_supervisor'))
      AND ($3::boolean OR w.worker_user_id=$4)
      ) roster ORDER BY user_id,id NULLS LAST,managed_worker_id) p ON true
    LEFT JOIN work_hub_shifts s ON s.gate_station_id=g.id AND s.site_location_id=l.id AND s.owner_org_type='vendor' AND s.owner_org_id=$1 AND s.milestone_status<>'cancelled'
      AND (s.ends_at>now() OR EXISTS(SELECT 1 FROM gate_duty_sessions history WHERE history.work_hub_shift_id=s.id AND history.station_id=g.id AND history.source_legacy_shift_id IS NOT NULL))
    LEFT JOIN work_hub_shift_assignments a ON a.shift_id=s.id AND a.user_id=p.user_id AND a.status IN ('assigned','accepted','claimed')
    LEFT JOIN gate_duty_sessions d ON d.station_id=g.id AND d.user_id=a.user_id AND (d.work_hub_shift_id=s.id OR (d.work_hub_shift_id IS NULL AND d.ended_at IS NULL)) AND d.post_coverage->>'vendorId'=$1::text
    LEFT JOIN gate_shifts w ON (w.id=d.source_legacy_shift_id OR (d.source_legacy_shift_id IS NULL AND w.station_id=d.station_id AND w.operator_id=d.user_id AND w.ended_at IS NULL)) AND w.station_id=g.id AND w.operator_id=a.user_id
    LEFT JOIN tickets t ON d.work_hub_shift_id=s.id AND t.id::text=d.post_coverage->>'ticketId' AND t.vendor_id=$1 AND t.site_location_id=l.id AND t.status<>'cancelled'
    WHERE g.active=true AND l.id=ANY($2::int[]) ORDER BY l.id,g.id,s.starts_at,p.id`,[session.vendorId,sites.map(s=>s.id),office,session.userId])).rows as FirstWatchRecord[];
  for (const record of records) {
    if (record.startsAt) record.startsAt = new Date(record.startsAt).toISOString();
    if (record.stationCreatedAt) record.stationCreatedAt = new Date(record.stationCreatedAt).toISOString();
  }
  // Gate Locations' existing serviced-site policy also covers authorized sites
  // that do not have a station yet; operational discovery alone cannot do that.
  const setupSites = office && !records.length ? (await pool.query(`SELECT s.id,s.name FROM site_locations s
    WHERE s.is_active IS DISTINCT FROM false AND s.hidden IS DISTINCT FROM true
      AND EXISTS(SELECT 1 FROM site_work_assignments a WHERE a.vendor_id=$1 AND a.site_location_id=s.id)
      AND EXISTS(SELECT 1 FROM partner_vendor_relationships r WHERE r.vendor_id=$1 AND r.partner_id=s.partner_id AND r.status=ANY($2::text[]))
      AND NOT EXISTS(SELECT 1 FROM gate_stations g WHERE g.site_id=s.id AND g.active=true)
    ORDER BY s.name,s.id`,[session.vendorId,ACTIVE_APPROVAL_STATUSES])).rows as {id:number;name:string}[] : [];
  const selected = firstWatchStep(records,session.userId,office,setupSites).context;
  if (selected?.assignedUserId && selected.stationId && !selected.watchId) {
    const readiness = await gateWatchTicketReadiness(pool,{...session,userId:selected.assignedUserId},selected.stationId,selected.siteId,undefined,false,selected.shiftId);
    selected.ticketBlocker = readiness.ticketBlocker;
  }
  return { setup, credentials, firstWatch: firstWatchStep(records,session.userId,office,setupSites), helperProgress, ...(office?{coiUploadNeeded:!vendor?.coi_document_url?.trim()}:{}) };
}

/** Upload completion is independent of any partner approval or expiry review. */
export async function saveAccountCoi(session:SessionPayload,objectPath:string) {
  if(session.publicDemo||session.realm==='demo'||session.role!=='vendor'||!session.userId||!session.vendorId||!session.activeMembershipId)throw new ChangeOverError(403,'coi.forbidden','Current company administrator access required.');
  const authorized=await pool.query(`SELECT m.id FROM user_org_memberships m JOIN users u ON u.id=m.user_id
    WHERE m.id=$1 AND m.user_id=$2 AND m.vendor_id=$3 AND m.org_type='vendor' AND m.role='admin'
    AND u.session_version=$4 AND u.suspended_at IS NULL`,[session.activeMembershipId,session.userId,session.vendorId,session.sv]);
  if(!authorized.rows.length)throw new ChangeOverError(403,'coi.forbidden','Current company administrator access required.');
  if(!/^\/objects\/uploads\/[0-9a-f-]{36}$/i.test(objectPath))throw new ChangeOverError(400,'coi.invalid_upload','Choose a finalized COI upload.');
  const {ObjectStorageService}=await import('../lib/objectStorage');
  const object=await new ObjectStorageService().getStoredObject(objectPath);
  if(object.acl?.owner!==String(session.userId)||object.acl.visibility!=='private'||!['application/pdf','image/jpeg','image/png','image/webp'].includes(object.contentType.toLowerCase().split(';')[0].trim())||object.size<=0||object.size>25*1024*1024)throw new ChangeOverError(400,'coi.invalid_upload','Choose your private PDF or image upload (up to 25 MB).');
  const saved=await pool.query(`UPDATE vendors SET coi_document_url=$1 WHERE id=$2 AND EXISTS(
    SELECT 1 FROM user_org_memberships m JOIN users u ON u.id=m.user_id WHERE m.id=$3 AND m.user_id=$4
    AND m.vendor_id=vendors.id AND m.org_type='vendor' AND m.role='admin' AND u.session_version=$5 AND u.suspended_at IS NULL) RETURNING id`,
    ['/api/storage'+objectPath,session.vendorId,session.activeMembershipId,session.userId,session.sv]);
  if(!saved.rows.length)throw new ChangeOverError(403,'coi.forbidden','Current company administrator access required.');
  return {uploaded:true};
}
