import { pool } from "@workspace/db";
import { ACTIVE_APPROVAL_STATUSES } from "@workspace/db/schema";
import type { SessionPayload } from "../lib/session";
import { ChangeOverError, changeOverTransaction, listChangeOverSites, requireChangeOverAccess } from "./gate-change-over";
import { ensureGateWatchTicket, gateWatchTicketReadiness } from "./gate-watch-ticket";
import { readWorkflowHelperProgress } from "./workflow-helper-progress";

type Action = { title: string; href: string; recordType?: string; recordId?: number | string };
export type FirstWatchRecord = { siteId: number; stationId: string | null; siteName: string; stationName: string | null; partnerId?: number; partnerName?: string | null; gateLabelStations?: { id: string; siteId: number; name: string; active: boolean; topology: { parentGateId?: string | null } | null }[]; employeeId: number | null; shiftId: string | null; assignedUserId: number | null; watchId: string | null; ticketId: number | null; ticketBlocker?: string | null; startsAt?: string | null; endsAt?: string | null; canSchedule?: boolean; canConfirmTicket?: boolean; watchEndedAt?: string | null; eligibleUserId?: number | null; employeeKind?: "direct" | "managed" | null; managedOrganizationId?: string | null; managedWorkerId?: string | null; stationCreatedAt?: string | null; day?: string | null };

/** Each row is one company/site/station/shift/worker chain, never pooled counts. */
export function firstWatchStep(records: FirstWatchRecord[], userId: number, office: boolean, setupSites: { id: number; name: string }[] = []) {
  const eligibleWorker = (record: FirstWatchRecord) => Boolean(record.employeeId || record.eligibleUserId);
  const score = (r: FirstWatchRecord) => r.watchId ? r.ticketId ? 6 : 5 : r.assignedUserId ? 4 : r.shiftId ? 3 : eligibleWorker(r) ? 2 : 1;
  const visible = office ? records : records.filter(record => record.assignedUserId === userId);
  const completed = visible.find(record => record.watchId && record.ticketId);
  const ordered = [...visible].sort((a,b) => a.siteId-b.siteId || String(a.stationCreatedAt??"").localeCompare(String(b.stationCreatedAt??"")) || String(a.stationId??"").localeCompare(String(b.stationId??"")) || String(a.startsAt??"").localeCompare(String(b.startsAt??"")) || String(a.shiftId??"").localeCompare(String(b.shiftId??"")));
  const first = ordered[0];
  const savedWatch = ordered.find(record => record.watchId);
  const row = completed ?? savedWatch ?? (first ? ordered.filter(record => record.siteId===first.siteId && record.stationId===first.stationId && record.shiftId===first.shiftId).sort((a,b)=>score(b)-score(a))[0] : undefined);
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
    message = row.ticketBlocker ? "Watch saved. Its automatic ticket still needs confirmation. Keep your saved watch." : "Watch saved. Waiting for its automatic ticket to be confirmed; do not assume this watch again.";
    if (row.ticketBlocker && office) action = { title: "Review gate service setup", href: `/vendor-catalog?${query}` };
    if (row.canConfirmTicket && row.assignedUserId === userId) {
      action = {title:"Confirm saved watch ticket",href:`/gate/change-over?${query}`,recordType:"watch-ticket",recordId:row.watchId};
    }
  }
  else if (!eligibleWorker(row)) action = { title: "Give an eligible gate employee access to this site", href: `/field-employees?${query}` };
  else if (!row.shiftId) action = { title: "Create a shift for this gate station", href: `/work-hub/calendar?${query}` };
  else if (!row.assignedUserId) action = { title: "Assign an eligible gate employee to this shift", href: `/work-hub/calendar?${query}` };
  else if ((row.startsAt && new Date(row.startsAt).getTime()>Date.now()) || row.ticketBlocker==="gate_ticket.shift_not_started") message = "Waiting for this scheduled shift to begin. The assigned gatekeeper can then Assume Watch and their ticket starts automatically.";
  else if (row.ticketBlocker && row.assignedUserId !== userId && office) {
    message = "The assigned gatekeeper can assume the watch. Review company service setup to confirm its automatic ticket.";
    action = {title:"Review gate service setup",href:`/vendor-catalog?${query}`};
  }
  else if (row.assignedUserId !== userId) message = "Waiting on the assigned gatekeeper to Assume Watch. Their ticket starts automatically.";
  else action = { title: "Assume Watch", href: `/gate/change-over?${query}` };
  return { complete: false, action, message, context: row };
}

/** Recover billing on the operator's saved watch without changing watch custody. */
export function confirmAccountWatchTicket(session: SessionPayload, watchId: string, shiftId: string) {
  if (!session.userId || !session.vendorId || session.publicDemo) throw new ChangeOverError(403,"change_over.forbidden","Current operator required.");
  return changeOverTransaction(async client => {
    const watch = (await client.query(`
      SELECT w.station_id,g.site_id FROM gate_shifts w
      JOIN gate_stations g ON g.id=w.station_id AND g.active
      JOIN gate_duty_sessions d ON d.station_id=w.station_id AND d.user_id=w.operator_id AND d.ended_at IS NULL
        AND (d.source_legacy_shift_id=w.id OR d.source_legacy_shift_id IS NULL)
      WHERE w.id=$1 AND w.operator_id=$2 AND w.ended_at IS NULL AND d.post_coverage->>'vendorId'=$3::text
        AND (d.work_hub_shift_id IS NULL OR d.work_hub_shift_id=$4)
      FOR UPDATE OF w,d
    `,[watchId,session.userId,session.vendorId,shiftId])).rows[0];
    if (!watch) throw new ChangeOverError(409,"change_over.watch_changed","This saved watch is no longer active for your company.");
    await requireChangeOverAccess(client,session,watch.site_id,{stationId:watch.station_id});
    return ensureGateWatchTicket(client,session,watch.station_id,watch.site_id,shiftId);
  });
}

export async function readAccountNextSteps(session: SessionPayload) {
  if (!session.userId || !session.vendorId || !session.activeMembershipId) throw new ChangeOverError(403,"change_over.forbidden","Choose your current vendor company.");
  const membership = (await pool.query(`SELECT m.role FROM user_org_memberships m JOIN users u ON u.id=m.user_id
    WHERE m.id=$1 AND m.user_id=$2 AND m.vendor_id=$3 AND m.org_type='vendor'
    AND u.session_version=$4 AND u.suspended_at IS NULL`,[session.activeMembershipId,session.userId,session.vendorId,session.sv])).rows[0];
  if (!membership) throw new ChangeOverError(403,"change_over.forbidden","Current company membership required.");
  const office = session.role === "vendor" && membership.role === "admin";
  const schedulingAccess = !session.managedSubcontractor && (office || session.vendorRole === "gate_supervisor");
  const setup: Action[] = [], credentials: Action[] = [];
  const vendor = (await pool.query(`
    SELECT physical_address,billing_address,contact_phone,coi_document_url,current_catalog_version_id,operations_categories,next_steps_partner_order,next_steps_partner_order_saved_at,
      CASE WHEN $2::boolean THEN (
        SELECT jsonb_agg(jsonb_build_object('id',p.id,'name',p.name) ORDER BY p.name,p.id)
        FROM partner_vendor_relationships r JOIN partners p ON p.id=r.partner_id WHERE r.vendor_id=$1
      ) END AS partner_options,
      EXISTS(SELECT 1 FROM vendor_work_types WHERE vendor_id=$1 AND unit_price IS NOT NULL) AS has_service_rate,
      CASE WHEN $3::boolean AND ($5::boolean OR EXISTS(
        SELECT 1 FROM platform_settings WHERE id=1 AND work_hub_enabled=true
      )) THEN (
        SELECT jsonb_agg(t) FROM (
          SELECT id,title,due_at,updated_at,created_at
          FROM work_hub_tasks
          WHERE owner_org_type='vendor' AND owner_org_id=$1 AND assignee_user_id=$4
            AND status IN ('open','in_progress','blocked') AND channel_id IS NULL AND gate_hopper IS NULL
          ORDER BY (due_at<=now()+interval '1 day') DESC NULLS LAST, due_at,updated_at,id LIMIT 5
        ) t
      ) END AS assigned_work,
      CASE WHEN $2::boolean THEN (
        SELECT jsonb_agg(e ORDER BY e.stop DESC,e.partner_rank,e.created_at,e.id) FROM (
          SELECT id,title,is_stop_work AS stop,created_at,partner_id,
            array_position(ARRAY(SELECT jsonb_array_elements_text(vendors.next_steps_partner_order)),partner_id::text) AS partner_rank
          FROM safety_events
          WHERE vendor_id=$1 AND status IN ('submitted','under_review') AND (is_stop_work OR is_high_potential)
          ORDER BY is_stop_work DESC,partner_rank,created_at,id LIMIT 5
        ) e
      ) END AS open_safety
    FROM vendors WHERE id=$1
  `,[session.vendorId,office,!session.managedSubcontractor,session.userId,process.env.WORK_HUB_ENABLED === "1"])).rows[0];
  const partnerOrder = Array.isArray(vendor?.next_steps_partner_order) ? vendor.next_steps_partner_order as number[] : [];
  const partnerRank = (id?: number) => {
    const rank = id === undefined ? -1 : partnerOrder.indexOf(id);
    return rank < 0 ? undefined : rank;
  };
  const partnerSettings = office && !session.publicDemo && session.realm !== "demo" && Array.isArray(vendor?.partner_options)
    ? {partnerSettings:{companyId:session.vendorId,options:vendor.partner_options,order:partnerOrder,configured:Boolean(vendor.next_steps_partner_order_saved_at) || partnerOrder.length > 0}} : {};
  const safety = ((vendor?.open_safety ?? []) as {id:number;title:string;stop:boolean;partner_id:number;created_at:string}[]).map(event => ({
    id:`safety:${event.id}`,
    kind:"account",
    title:event.stop ? `Review work stoppage · ${event.title}` : `Review safety event · ${event.title}`,
    priority:event.stop ? -30 : -20,
    partnerRank:partnerRank(event.partner_id),
    age:event.created_at,
    action:{title:"Open saved safety event",href:`/safety/${event.id}`},
    steps:["Review the reported hazard and affected work.", "Record the response and any corrective actions in the event.", "Update the event status when the response is complete."],
  }));
  const assignedWork = ((vendor?.assigned_work ?? []) as {id:string;title:string;due_at:string|null;updated_at:string}[]).map(task => ({
    id:`work:${task.id}`,
    kind:"account",
    title:task.title,
    priority:task.due_at && Date.parse(task.due_at) <= Date.now()+86_400_000 ? 12 : 25,
    deadline:task.due_at ?? undefined,
    age:task.updated_at,
    action:{title:"Open assigned task",href:`/work-hub/tasks?task=${task.id}`},
    steps:["Review the assigned task and its due date.", "Carry out the work and record the outcome on the task.", "Mark it complete when the work is done."],
  }));
  const accountWork = [...safety,...assignedWork];
  if (office && vendor) {
    if (!vendor.physical_address || !vendor.billing_address || !vendor.contact_phone) setup.push({title:"Complete your company profile",href:`/vendors/${session.vendorId}`,recordType:"company-profile",recordId:session.vendorId});
    if (!vendor.current_catalog_version_id && !vendor.has_service_rate) setup.push({title:"Set up your services and rates",href:"/vendor-catalog",recordType:"service-catalog",recordId:session.vendorId});
    if (!session.publicDemo && session.realm !== "demo" && !vendor.coi_document_url?.trim()) {
      setup.push({title:"Add your company certificate of insurance",href:`/vendors/${session.vendorId}`,recordType:"company-coi",recordId:session.vendorId});
    }
  }
  if (session.role === "field_employee" && !session.managedSubcontractor) {
    const person = (await pool.query(`SELECT p.id,p.first_name,p.last_name,p.email,p.phone,p.photo_url,p.profile_photo_path FROM vendor_people p JOIN user_org_memberships m ON m.vendor_people_id=p.id
      WHERE m.id=$1 AND p.user_id=$2 AND p.vendor_id=$3 AND p.is_active=true AND p.deleted_at IS NULL`,[session.activeMembershipId,session.userId,session.vendorId])).rows[0];
    if (person) {
      if (!person.first_name?.trim() || !person.last_name?.trim() || !person.phone?.trim()) setup.push({title:"Complete your worker profile",href:"/field/profile/edit",recordType:"worker-profile",recordId:person.id});
      else if (!person.photo_url && !person.profile_photo_path) setup.push({title:"Add a profile photo",href:"/field/profile/edit",recordType:"worker-profile",recordId:person.id});
      const missing = (await pool.query(`SELECT id,name FROM employee_certifications WHERE employee_id=$1 AND deleted_at IS NULL
        AND (expiration_date<CURRENT_DATE OR (document_url IS NULL AND document_path IS NULL)) ORDER BY id`,[person.id])).rows;
      for (const record of missing) credentials.push({title:`Update ${record.name}`,href:"/field/compliance",recordType:"existing-credential",recordId:record.id});
    }
  }
  const helperProgress = await readWorkflowHelperProgress(session);
  if (!vendor?.operations_categories?.includes("gate")) return { setup, credentials, firstWatch: null, helperProgress, ...partnerSettings, ...(accountWork.length?{workflows:accountWork}:{}), ...(office?{coiUploadNeeded:!vendor?.coi_document_url?.trim()}:{}) };
  const sites = await listChangeOverSites(session);
  // Managed roster evidence follows gate-staffing-candidates: a current company
  // membership, sponsor, worker sponsorship and explicit Gate grant at this site.
  // Ended evidence is never promoted back to readiness by a stale active status.
  const records = (await pool.query(`SELECT l.id AS "siteId",g.id AS "stationId",l.name AS "siteName",g.name AS "stationName",g.created_at AS "stationCreatedAt",
    l.partner_id AS "partnerId",(SELECT name FROM partners WHERE id=l.partner_id) AS "partnerName",
    (SELECT jsonb_agg(jsonb_build_object('id',peer.id,'siteId',peer.site_id,'name',peer.name,'active',peer.active,
      'topology',jsonb_build_object('parentGateId',peer.topology->>'parentGateId')) ORDER BY peer.name,peer.id)
      FROM gate_stations peer WHERE peer.site_id=l.id) AS "gateLabelStations",
    p.id AS "employeeId",p.user_id AS "eligibleUserId",p.employee_kind AS "employeeKind",p.managed_organization_id AS "managedOrganizationId",p.managed_worker_id AS "managedWorkerId",
    s.starts_at AS "startsAt",s.ends_at AS "endsAt",to_char(s.starts_at AT TIME ZONE s.timezone,'YYYY-MM-DD') AS day,s.id AS "shiftId",a.user_id AS "assignedUserId",w.id AS "watchId",w.ended_at AS "watchEndedAt",t.id AS "ticketId",d.post_coverage->>'ticketBlocker' AS "ticketBlocker",
    EXISTS(SELECT 1 FROM site_work_assignments x JOIN partner_vendor_relationships r ON r.vendor_id=x.vendor_id AND r.partner_id=l.partner_id
      WHERE x.site_location_id=l.id AND x.vendor_id=$1 AND x.is_gate_contractor AND r.status='approved') AS "canSchedule"
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
    WHERE g.active=true AND l.id=ANY($2::int[]) ORDER BY l.id,g.id,s.starts_at,p.id`,[session.vendorId,sites.map(s=>s.id),schedulingAccess,session.userId])).rows as FirstWatchRecord[];
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
  if (selected?.watchId && !selected.watchEndedAt && !selected.ticketId && selected.ticketBlocker
    && selected.assignedUserId === session.userId && selected.stationId && selected.shiftId) {
    const readiness = await gateWatchTicketReadiness(pool,session,selected.stationId,selected.siteId,null,false,selected.shiftId);
    selected.canConfirmTicket = !readiness.ticketBlocker && readiness.shiftId === selected.shiftId;
  }
  const turnover = (await pool.query(`
    SELECT w.id AS "watchId", g.id AS "stationId", l.id AS "siteId", l.name AS "siteName",
      g.name AS "stationName", l.partner_id AS "partnerId", s.id AS "shiftId", s.ends_at AS "deadline",
      to_char(s.starts_at AT TIME ZONE s.timezone,'YYYY-MM-DD') AS day
    FROM gate_duty_sessions d
    JOIN gate_shifts w ON w.id=d.source_legacy_shift_id AND w.ended_at IS NULL
    JOIN gate_stations g ON g.id=d.station_id AND g.id=w.station_id AND g.active
    JOIN site_locations l ON l.id=g.site_id
    JOIN work_hub_shifts s ON s.id=d.work_hub_shift_id AND s.owner_org_type='vendor' AND s.owner_org_id=$1
    LEFT JOIN gate_preparations p ON p.id=w.preparation_id
    WHERE d.user_id=$2 AND w.operator_id=$2 AND d.ended_at IS NULL AND l.id=ANY($3::int[])
      AND d.post_coverage->>'vendorId'=$1::text
      AND s.milestone_status<>'cancelled' AND s.ends_at<=now()+interval '30 minutes'
      AND (p.summary->'signature' IS NULL OR p.summary->'signature'='null'::jsonb)
    ORDER BY s.ends_at,w.id LIMIT 1
  `,[session.vendorId,session.userId,sites.map(site => site.id)])).rows;
  const handoffs = turnover.map(({deadline,...context}) => {
    const query = new URLSearchParams({siteId:String(context.siteId),stationId:context.stationId,shiftId:context.shiftId,day:context.day});
    return {
      id: "gate-watch-handoff",
      kind: "gate-operation",
      title: "Prepare watch turnover",
      description: "Review open items, save your shift notes, and sign the handoff for the incoming gatekeeper.",
      priority: 10,
      partnerRank:partnerRank(context.partnerId),
      deadline: new Date(deadline).toISOString(),
      action: {title:"Review and sign handoff",href:`/gate/change-over?${query}`},
      context,
    };
  });
  const firstWatch = firstWatchStep(records,session.userId,office,setupSites);
  const staffedShifts = new Set(records.filter(record => record.assignedUserId).map(record => record.shiftId));
  const uncovered = schedulingAccess && (!office || firstWatch.complete) && records
    .filter(record => record.canSchedule && record.shiftId && record.eligibleUserId && record.endsAt
      && new Date(record.endsAt).getTime() > Date.now() && !staffedShifts.has(record.shiftId))
    .sort((a,b) => String(a.startsAt).localeCompare(String(b.startsAt))
      || (partnerRank(a.partnerId) ?? Number.MAX_SAFE_INTEGER) - (partnerRank(b.partnerId) ?? Number.MAX_SAFE_INTEGER))[0];
  let canOfferScheduling = Boolean(uncovered);
  if (uncovered && !office) {
    try {
      canOfferScheduling = (await requireChangeOverAccess(pool,session,uncovered.siteId)).supervisor;
    } catch (error) {
      if (!(error instanceof ChangeOverError) || error.status !== 403) throw error;
      canOfferScheduling = false;
    }
  }
  const scheduling = uncovered && canOfferScheduling ? [{
    id:"gate-shift-scheduling",
    kind:"gate-operation",
    title:"Assign coverage to an unstaffed gate shift",
    description:"Open the saved shift, review eligible employees, and save the assignment.",
    priority:15,
    partnerRank:partnerRank(uncovered.partnerId),
    deadline:uncovered.startsAt,
    action:{title:"Review shift assignments",href:`/work-hub/calendar?${new URLSearchParams({siteId:String(uncovered.siteId),stationId:uncovered.stationId!,shiftId:uncovered.shiftId!,...(uncovered.day?{day:uncovered.day}:{})})}`},
    context:uncovered,
  }] : [];
  return { setup, credentials, firstWatch, helperProgress, ...partnerSettings, workflows:[...accountWork,...handoffs,...scheduling], ...(office?{coiUploadNeeded:!vendor?.coi_document_url?.trim()}:{}) };
}

export async function saveNextStepsPartnerOrder(session: SessionPayload, order: number[]) {
  if (session.role !== "vendor" || session.managedSubcontractor || session.publicDemo || session.realm === "demo") {
    throw new ChangeOverError(403, "next_steps.forbidden", "Company administrator access required.");
  }
  const saved = await pool.query(`
    UPDATE vendors SET next_steps_partner_order=$1::jsonb,next_steps_partner_order_saved_at=now() WHERE id=$2
      AND EXISTS(SELECT 1 FROM user_org_memberships m JOIN users u ON u.id=m.user_id
        WHERE m.id=$3 AND m.user_id=$4 AND m.vendor_id=$2 AND m.org_type='vendor'
          AND m.role='admin' AND u.session_version=$5 AND u.suspended_at IS NULL)
      AND NOT EXISTS(SELECT 1 FROM unnest($6::int[]) requested(id)
        WHERE NOT EXISTS(SELECT 1 FROM partner_vendor_relationships r WHERE r.vendor_id=$2 AND r.partner_id=requested.id))
    RETURNING id
  `,[JSON.stringify(order),session.vendorId,session.activeMembershipId,session.userId,session.sv,order]);
  if (!saved.rows.length) throw new ChangeOverError(403, "next_steps.forbidden", "Company or partner access changed. Refresh Next Steps and try again.");
  return {order};
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
