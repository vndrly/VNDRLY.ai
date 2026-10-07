import { getFlow, type OrgPersona } from "./prompts/onboarding-flows";
import { FLEET_MAP_CLIENT } from "./chatgpt-fleet-map";
import { VENDRY_FLEET_INTEGRATION } from "./chatgpt-fleet-integration";
import { FleetRunSchema, FleetEtaSchema, FleetEvidenceSchema, FleetMaintenanceRecordSchema, FleetReportSchema, FleetReportFilterSchema, FleetSiteActivityFilterSchema, FleetReviewPacketSchema } from "@workspace/api-zod";

export type WorkspaceView = "my_workday" | "gate_board" | "work_calendar" | "onboarding" | "tickets" | "notifications" | "fleet" | "fleet_map" | "fleet_dispatch" | "fleet_run" | "fleet_evidence" | "fleet_review" | "fleet_eta" | "fleet_maintenance" | "fleet_reports" | "fleet_site" | "inventory";
export const WORKSPACE_URI = "ui://vndrly/workspace/v1.html";
const WORKSPACE_VIEWS = ["my_workday", "gate_board", "work_calendar", "onboarding", "tickets", "notifications", "fleet", "fleet_map", "fleet_dispatch", "fleet_run", "fleet_evidence", "fleet_review", "fleet_eta", "fleet_maintenance", "fleet_reports", "fleet_site", "inventory"];
const ROW_SCHEMA = { type: "object", properties: { title: { type: "string" }, detail: { type: "string" }, time: { type: "string" }, attention: { type: "string" }, runId: { type: "string", format: "uuid" } }, required: ["title"], additionalProperties: false };
export const WORKSPACE_OUTPUT_SCHEMA = {
  type: "object", properties: {
    view: { type: "string", enum: WORKSPACE_VIEWS }, title: { type: "string" }, generatedAt: { type: "string", format: "date-time" },
    availableViews: { type: "array", items: { type: "string", enum: WORKSPACE_VIEWS } }, sourceTool: { type: "string" }, sourceArguments: { type: "object" },
    sections: { type: "array", items: { type: "object", properties: { title: { type: "string" }, rows: { type: "array", items: ROW_SCHEMA }, empty: { type: "string" } }, required: ["title", "rows", "empty"], additionalProperties: false } },
    attention: { type: "array", items: ROW_SCHEMA }, metrics: { type: "array", items: { type: "object", properties: { label: { type: "string" }, value: { type: "number" } }, required: ["label", "value"], additionalProperties: false } },
    fleetMap: { type: "object", properties: { publicToken: { type: "string" }, points: { type: "array", items: { type: "object", properties: { latitude: { type: "number", minimum: -90, maximum: 90 }, longitude: { type: "number", minimum: -180, maximum: 180 }, recordedAt: { type: "string", format: "date-time" }, freshness: { type: "string" }, label: { type: "string" } }, required: ["latitude", "longitude", "recordedAt", "freshness", "label"], additionalProperties: false } } }, required: ["points"], additionalProperties: false },
  }, required: ["view", "title", "generatedAt", "sourceTool", "sourceArguments", "sections", "attention", "metrics"], additionalProperties: false,
};
export const WORKSPACE_TOOL = {
  name: "v_show_workspace",
  outputSchema: WORKSPACE_OUTPUT_SCHEMA,
  description: "Show embedded authorized VNDRLY work records. Fleet Desk/Map use the canonical Fleet overview when granted, otherwise Fleet shows legacy authorized work trips. Fleet Dispatch requires dispatch resource access; Fleet Run requires an exact authorized runId. Views show saved records and sourced observations, not proof of physical movement, inspection, tracking or media capture. Calendar requires explicit start/end. This read does not change records.",
  inputSchema: { type: "object" as const, properties: { view: { type: "string", enum: WORKSPACE_VIEWS }, runId: { type: "string", format: "uuid" }, fleetId: { type: "string", format: "uuid" }, limit: { type: "integer", minimum: 1, maximum: 50 }, cursor: { type: "string", pattern: "^[0-9]{1,10}(:[0-9]{1,10})?$" }, siteId: { type: "integer", minimum: 1 }, stationId: { type: "string", format: "uuid" }, start: { type: "string", format: "date-time" }, end: { type: "string", format: "date-time" } }, required: ["view"], additionalProperties: false },
  annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
  _meta: { ui: { resourceUri: WORKSPACE_URI }, "openai/outputTemplate": WORKSPACE_URI, "openai/widgetAccessible": true },
};
export function workspaceRequest(input: Record<string, unknown>, availableTools: ReadonlySet<string> = new Set()) {
  const view = input.view;
  if (!WORKSPACE_VIEWS.includes(String(view))) throw new Error("Unknown workspace view");
  let sourceTool: string;
  let sourceArguments: Record<string, unknown> = {};
  if (view === "my_workday") sourceTool = "get_work_hub_briefing";
  else if (view === "onboarding") sourceTool = "lookup_user_progress";
  else if (view === "tickets") { sourceTool = "query_tickets"; sourceArguments = { limit: 50, sinceDays: 30 }; }
  else if (view === "notifications") { sourceTool = "query_notifications"; sourceArguments = { limit: 50, unreadOnly: true }; }
  else if (view === "fleet") sourceTool = availableTools.has("query_fleet_briefing") ? "query_fleet_briefing" : "query_field_trips";
  else if (view === "fleet_map") sourceTool = "query_fleet_briefing";
  else if (view === "fleet_maintenance") sourceTool = "query_fleet_maintenance";
  else if (view === "fleet_site") {
    sourceTool="query_fleet_site_activity";
    if(input.siteId!==undefined){if(!Number.isSafeInteger(input.siteId)||Number(input.siteId)<1)throw new Error("Select an authorized site");sourceArguments={siteId:input.siteId,...FleetSiteActivityFilterSchema.parse({...(input.start!==undefined?{startsAt:input.start}:{}),...(input.end!==undefined?{endsAt:input.end}:{})})};}
  }
  else if (view === "fleet_reports") { sourceTool = "query_fleet_report"; sourceArguments = FleetReportFilterSchema.parse({ ...(input.fleetId !== undefined ? {fleetId:input.fleetId}:{}), ...(input.siteId !== undefined ? {siteId:input.siteId}:{}), ...(input.start !== undefined ? {startsAt:input.start}:{}), ...(input.end !== undefined ? {endsAt:input.end}:{}) }); }
  else if (view === "fleet_dispatch") sourceTool = "query_fleet_resources";
  else if (view === "fleet_run") { sourceTool = "query_fleet_run_detail"; sourceArguments = {runId: FleetRunSchema.shape.id.parse(input.runId)}; }
  else if (view === "fleet_evidence") { sourceTool = "query_fleet_evidence"; sourceArguments = {runId: FleetRunSchema.shape.id.parse(input.runId)}; }
  else if (view === "fleet_review") { sourceTool = "query_fleet_review_packet"; sourceArguments = {runId: FleetRunSchema.shape.id.parse(input.runId)}; }
  else if (view === "fleet_eta") { sourceTool = "query_fleet_run_eta"; sourceArguments = {runId: FleetRunSchema.shape.id.parse(input.runId)}; }
  else if (view === "inventory") sourceTool = "query_asset_custody";
  else if (view === "gate_board") {
    if (input.stationId !== undefined) {
      if (typeof input.stationId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.stationId)) throw new Error("Select an authorized gate");
      sourceTool = "query_gate_change_over"; sourceArguments = { stationId: input.stationId };
    } else {
      if (input.siteId !== undefined && (!Number.isSafeInteger(input.siteId) || Number(input.siteId) <= 0)) throw new Error("Select an authorized site");
      sourceTool = "query_gate_stations"; sourceArguments = input.siteId === undefined ? {} : { siteId: input.siteId };
    }
  } else {
    const start = typeof input.start === "string" ? Date.parse(input.start) : NaN;
    const end = typeof input.end === "string" ? Date.parse(input.end) : NaN;
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || end - start > 31 * 86400000) throw new Error("Provide a calendar window of up to 31 days");
    sourceTool = "get_work_hub_calendar"; sourceArguments = { start: input.start, end: input.end };
  }
  if (sourceTool === "query_fleet_briefing") {
    if (input.limit !== undefined && (!Number.isInteger(input.limit) || Number(input.limit) < 1 || Number(input.limit) > 50)) throw new Error("Select a Fleet page size from 1 to 50");
    if (input.cursor !== undefined && (typeof input.cursor !== "string" || !/^[0-9]{1,10}:[0-9]{1,10}$/.test(input.cursor))) throw new Error("Use the returned Fleet page cursor");
    sourceArguments = { ...(input.limit !== undefined ? {limit: input.limit} : {}), ...(input.cursor !== undefined ? {cursor: input.cursor} : {}) };
  }
  if (sourceTool === "query_fleet_maintenance") {
    if (input.limit !== undefined && (!Number.isInteger(input.limit) || Number(input.limit) < 1 || Number(input.limit) > 50)) throw new Error("Select a Fleet page size from 1 to 50");
    if (input.cursor !== undefined && (typeof input.cursor !== "string" || !/^[0-9]{1,10}$/.test(input.cursor))) throw new Error("Use the returned maintenance page cursor");
    sourceArguments = { ...(input.limit !== undefined ? {limit: input.limit} : {}), ...(input.cursor !== undefined ? {cursor: input.cursor} : {}) };
  }
  return { view: view as WorkspaceView, sourceTool, sourceArguments };
}
export interface WorkspaceRow { title: string; detail?: string; time?: string; attention?: string; runId?: string; }
export interface WorkspaceSection { title: string; rows: WorkspaceRow[]; empty: string; }
export interface WorkspaceOutput {
  view: WorkspaceView; title: string; generatedAt: string;
  availableViews?: WorkspaceView[];
  fleetMap?: { publicToken?: string; points: { latitude: number; longitude: number; recordedAt: string; freshness: string; label: string }[] };
  sourceTool: string; sourceArguments: Record<string, unknown>;
  sections: WorkspaceSection[]; attention: WorkspaceRow[]; metrics: { label: string; value: number }[];
}
const object = (value: unknown): Record<string, any> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {};
const list = (value: unknown): Record<string, any>[] => Array.isArray(value) ? value.slice(0, 50).map(object) : [];
const text = (value: unknown, fallback = "") => typeof value === "string" ? value.slice(0, 500) : fallback;
const moment = (value: unknown) => typeof value === "string" && Number.isFinite(Date.parse(value)) ? value : undefined;
function taskRow(row: Record<string, any>, now: number): WorkspaceRow {
  const overdue = moment(row.dueAt) && Date.parse(row.dueAt) < now && !["complete", "completed", "cancelled", "canceled"].includes(row.status);
  return { title: text(row.title, "Work task"), detail: text(row.status), time: moment(row.dueAt), ...(overdue ? { attention: "Overdue" } : {}) };
}
/** Presentation derives only from canonical, permission-scoped read results. */
export function workspaceOutput(view: WorkspaceView, sourceTool: string, sourceArguments: Record<string, unknown>, raw: unknown, now = new Date()): WorkspaceOutput {
  const data = object(raw);
  if (data.error || (data.ok === false && view !== "fleet_eta")) throw new Error("Workspace source unavailable");
  if (["my_workday", "work_calendar"].includes(view) && ![data.tasks, data.shifts, data.meetings].every(Array.isArray)) throw new Error("Incomplete workspace result");
  if (view === "gate_board" && sourceTool === "query_gate_stations" && !Array.isArray(data.sites) && !Array.isArray(data.stations)) throw new Error("Incomplete gate result");
  if (view === "gate_board" && sourceTool === "query_gate_change_over" && (!data.station || !("shift" in data) || !("snapshot" in data) || !Array.isArray(data.items))) throw new Error("Incomplete gate result");
  const result: WorkspaceOutput = { view, title: { my_workday: "My Workday", gate_board: "Gate Board", work_calendar: "Work Calendar", onboarding: "Onboarding", tickets: "Tickets", notifications: "Notifications", fleet: "Fleet", fleet_map: "Fleet Recorded Map", fleet_dispatch: "Fleet Dispatch", fleet_run: "Fleet Run", fleet_eta: "Fleet Driving Estimate", fleet_evidence: "Fleet Saved Evidence", fleet_review: "Fleet Operational Review", fleet_maintenance: "Fleet Maintenance", fleet_reports: "Fleet Reports", fleet_site: "Site Fleet Activity", inventory: "Inventory" }[view], generatedAt: moment(data.generatedAt) ?? now.toISOString(), sourceTool, sourceArguments, sections: [], attention: [], metrics: [] };
  if (view === "my_workday") {
    const tasks = list(data.tasks).map(row => taskRow(row, now.getTime()));
    const announcements = list(data.announcements).map(row => ({ title: text(object(row.announcement).title, "Announcement"), detail: text(object(row.announcement).body), ...(object(row.announcement).acknowledgementRequired === true && object(row.recipient).acknowledgedAt == null ? { attention: "Acknowledgement pending" } : {}) }));
    result.attention = [...tasks.filter(row => row.attention), ...announcements.filter(row => row.attention)];
    result.sections = [
      { title: "Your shifts", rows: list(data.shifts).map(row => ({ title: text(object(row.shift).title, "Assigned shift"), time: moment(object(row.shift).startsAt), detail: text(object(row.assignment).status) })), empty: "No assigned shifts returned." },
      { title: "Tasks", rows: tasks, empty: "No tasks returned." },
      { title: "Meetings", rows: list(data.meetings).map(row => ({ title: text(object(row.meeting).title, "Meeting"), time: moment(object(row.occurrence).startsAt) })), empty: "No meetings returned." },
      { title: "Announcements", rows: announcements, empty: "No announcements returned." },
    ];
  } else if (view === "work_calendar") {
    result.sections = ["shifts", "meetings", "tasks"].map(kind => ({ title: kind[0].toUpperCase() + kind.slice(1), rows: list(data[kind]).map(row => { const item = object(row.item); const record = kind === "meetings" ? object(item.meeting) : item; const timing = kind === "meetings" ? object(item.occurrence) : item; return { title: text(record.title, kind === "tasks" ? "Task" : "Scheduled work"), detail: text(record.status), time: moment(timing.startsAt ?? timing.dueAt), ...(kind === "tasks" ? { attention: taskRow(item, now.getTime()).attention } : {}) }; }), empty: `No ${kind} in this window.` }));
    result.attention = result.sections.flatMap(section => section.rows.filter(row => row.attention));
  } else if (view === "fleet_dispatch") {
    if (!Array.isArray(data.drivers) || !Array.isArray(data.equipment)) throw new Error("Incomplete Fleet resources");
    result.sections = [
      {title: "Authorized drivers", rows: list(data.drivers).map(row => ({title: text(row.name, "Driver"), detail: `User ${Number.isSafeInteger(row.userId) ? row.userId : "unknown"}`})), empty: "No eligible drivers returned."},
      {title: "Equipment selection", rows: list(data.equipment).map(row => ({title: text(row.name, "Equipment"), detail: [text(row.category),text(row.status)].filter(Boolean).join(" · "), ...(row.dispatchable === false ? {attention: "Not dispatchable"} : {})})), empty: "No equipment returned."},
    ];
    result.attention = result.sections.flatMap(section => section.rows.filter(row => row.attention));
  } else if (view === "fleet_site") {
    if(Array.isArray(data.sites)) result.sections=[{title:"Your authorized sites",rows:list(data.sites).map(site=>({title:text(site.name,"Site"),detail:`Site ${site.siteId} · ask V to show its recorded Fleet activity`})),empty:"No authorized sites returned."}];
    else {
      if(!Array.isArray(data.records)||data.source!=="recorded_fleet_events"||data.coordinateDisclosure!==false)throw new Error("Incomplete site Fleet result");
      result.title=text(data.siteName,"Site Fleet Activity");
      result.sections=[{title:"Recorded site activity",rows:list(data.records).map(record=>({title:text(record.vendorName,"Authorized vendor"),detail:[text(record.status),...list(record.stops).map(stop=>`${text(stop.kind)}: ${list(stop.events).map(event=>`${text(event.type)} ${moment(event.recordedAt)??"time unavailable"}`).join(", ")}`),...list(record.loads).map(load=>`${text(load.commodity)} · ${load.quantity} ${text(load.unit)} · ${text(load.direction)}`)].filter(Boolean).join(" · ")})),empty:"No recorded activity in this authorized window."},{title:"Scope and source",rows:[{title:"Own-site recorded events",detail:"Date filters select run creation cohorts. This view omits other routes, personal coordinates and financial records; reported events are not physical proof."},...list((Array.isArray(data.unavailableMetrics)?data.unavailableMetrics:[]).map(metric=>({metric}))).map(item=>({title:text(item.metric),detail:"Unavailable"}))],empty:""}];
    }
  } else if (view === "fleet_reports") {
    const report = FleetReportSchema.parse(data);
    result.metrics = [{label:"Recorded runs",value:report.runCount},{label:"Completed runs",value:report.completedRunCount},{label:"Submitted runs",value:report.submittedRunCount},{label:"Reported inspection exceptions",value:report.inspectionExceptions}];
    result.sections = [
      {title:"Report basis",rows:[{title:"Recorded run creation cohort",detail:"Date filters select runs by creation time. Totals include the recorded entries on those runs; they are not daily physical telemetry totals."}],empty:""},
      {title:"Recorded load totals",rows:report.loadTotals.map(total=>({title:`${total.commodity} · ${total.unit}`,detail:`${total.quantity} recorded · ${total.deliveredQuantity} delivery recorded`})),empty:"No loads in this authorized report."},
      {title:"Reported meter distance",rows:report.distanceTotals.map(total=>({title:total.unit,detail:`${total.distance} · recorded meter readings`})),empty:"No comparable meter records."},
      {title:"Authorized reported fuel",rows:(report.fuelTotals??[]).map(total=>({title:total.unit,detail:String(total.quantity)})),empty:report.fuelTotals===null?"Fuel totals are not available under this grant.":"No fuel records."},
      {title:"Unavailable metrics",rows:report.unavailableMetrics.map(metric=>({title:metric.metric,detail:metric.reason})),empty:"No unavailable metrics reported."},
    ];
    if (report.recordedTiming) {
      const timing = report.recordedTiming;
      result.sections.push({title:"Recorded timing and saved plans", rows:[
        {title:`${timing.eligibleRunCount} runs with recorded start and closeout`,detail:`${timing.elapsedMinutes.toFixed(1)} elapsed minutes · ${timing.pausedMinutes.toFixed(1)} recorded paused minutes · ${timing.activeMinutes.toFixed(1)} minutes excluding recorded pauses`},
        {title:"Compared with the saved plan",detail:`${timing.lateStartCount} of ${timing.plannedStartCount} starts recorded after plan · ${timing.lateFinishCount} of ${timing.plannedFinishCount} closeouts recorded after plan`},
        {title:"Source and limits",detail:"Server-accepted start, pause and closeout times; not verified physical presence, payroll time, billable detention or contractual delivery performance."},
      ],empty:""});
      if(timing.invalidSequenceCount) result.attention.push({title:"Record timing needs attention",detail:`${timing.invalidSequenceCount} runs excluded from timing totals because their event sequence is inconsistent.`});
    }
  } else if (view === "fleet_maintenance") {
    if (!Array.isArray(data.records)) throw new Error("Incomplete Fleet maintenance result");
    const records = list(data.records).map(record => FleetMaintenanceRecordSchema.parse(record));
    result.sections = [{title: "Authorized maintenance and defect reports", rows: records.map(record => ({title: record.title, detail: `${record.kind} · ${record.status} · asset ${record.assetId} · version ${record.version}${record.allowedActions.length ? " · permitted: " + record.allowedActions.join(", ") : ""}`, ...(record.dueAt ? {time: record.dueAt} : {}), ...(record.holdId && record.status !== "released" ? {attention: "Equipment hold recorded; repair notes alone do not release it"} : {})})), empty: "No authorized maintenance records returned."}];
    result.attention = result.sections[0].rows.filter(row => row.attention);
    if (data.nextCursor) result.attention.push({title: "More maintenance records available", detail: "Ask V for the next authorized maintenance page."});
  } else if (view === "fleet_review") {
    const packet = FleetReviewPacketSchema.parse(data);
    if (sourceTool !== "query_fleet_review_packet" || packet.runId !== sourceArguments.runId) throw new Error("Fleet review packet is for another run");
    result.metrics = [{label:"Missing required evidence",value:packet.missingRequiredCount},{label:"Recorded inspection exceptions",value:packet.inspectionExceptions},{label:"Undelivered loads",value:packet.undeliveredLoadCount}];
    result.sections = [{title:`Run version ${packet.runVersion} · ${packet.status}`,rows:packet.requirements.map(item=>({title:item.label,detail:`${item.missing ? item.required ? "Missing" : "Optional, no saved file" : item.evidenceIds.length ? "Saved" : "Optional"} · ${item.kind}${item.loadId ? ` · load ${item.loadId}` : " · run"}${item.required ? " · required" : ""}`,...(item.required && item.missing ? {attention:"Required saved evidence is missing"} : {})})),empty:"No saved evidence requirements configured for this run."},
      {title:"Operational review",rows:[{title:packet.readyForOperationalReview ? "Record requirements satisfied" : "Record requirements need attention",detail:"This snapshot supports an operational review; it does not approve the run, prove physical work, verify a signature or authorize payment."},...([{title:"Inspection records",complete:packet.inspectionComplete},{title:"Load manifests",complete:packet.manifestComplete},{title:"Stops, delivery and meter records",complete:packet.closeoutRecordsComplete}]).map(item=>({title:item.title,detail:item.complete ? "Complete saved records" : "Incomplete saved records",...(item.complete ? {} : {attention:"Required operational records need attention"})})),...packet.limitations.map(detail=>({title:"Source limitation",detail}))],empty:""}];
    result.attention = result.sections.flatMap(section=>section.rows.filter(row=>row.attention));
  } else if (view === "fleet_evidence") {
    if (sourceTool !== "query_fleet_evidence" || data.runId !== sourceArguments.runId || !Array.isArray(data.evidence)) throw new Error("Incomplete Fleet evidence result");
    const evidence = data.evidence.map((item: unknown) => FleetEvidenceSchema.parse(item));
    if (evidence.some((item: {runId:string}) => item.runId !== sourceArguments.runId)) throw new Error("Fleet evidence is for another run");
    result.sections = [{title:"Saved private associations",rows:evidence.map((item: {kind:string;notes:string;contentType:string;size:number;recordedAt:string;capturedAt:string|null})=>({title:item.kind,detail:`${item.notes} · ${item.contentType} · ${item.size} bytes${item.capturedAt ? " · user-reported capture " + item.capturedAt : ""}`,time:item.recordedAt})),empty:"No private evidence associations saved."}];
    result.attention = [{title:"Device-uploaded records",detail:"Association is saved; physical work and signature identity are not verified. Open the authenticated run device screen to view the private file."}];
  } else if (view === "fleet_eta") {
    const eta = FleetEtaSchema.parse(data);
    if(sourceTool !== "query_fleet_run_eta" || eta.runId !== sourceArguments.runId) throw new Error("Fleet estimate is for another run");
    result.attention = [{title: "Ordinary driving estimate", detail: "Not verified truck-safe routing or proof of arrival."}];
    const reasons: Record<string,string> = {"fleet.eta_run_inactive":"The run is not active.","fleet.eta_run_paused":"The run is paused.","fleet.eta_location_unavailable":"A recent, reliable phone location is unavailable.","fleet.eta_next_stop_unavailable":"No next stop is saved.","fleet.eta_destination_unavailable":"The destination has no usable coordinates.","fleet.eta_context_changed":"The run or source changed; request a fresh estimate.","mapbox.missing_token":"Routing is not configured.","mapbox.request_failed":"The routing provider could not respond.","mapbox.no_route":"No driving route was returned."};
    result.sections = eta.ok ? [{title:"Recorded-source estimate", rows:[{title:eta.siteName, detail:`${eta.distanceMiles} miles · ${eta.durationMinutes} minutes · ${eta.provider} · ${eta.trafficAware ? "Traffic-aware" : "No traffic adjustment"} · ${eta.routeConfidence} confidence`,time:eta.estimatedAt},{title:"Driver-phone source", detail:`Accuracy ±${eta.sourceAccuracyMeters} m · received ${eta.sourceReceivedAt}`,time:eta.sourceRecordedAt}],empty:""}] : [{title:"Estimate unavailable",rows:[{title:reasons[eta.code] ?? "The estimate is unavailable.",detail:"No arrival time or route distance was estimated."}],empty:""}];
  } else if (view === "fleet_run") {
    const run = FleetRunSchema.parse(data);
    result.title = run.title;
    result.sections = [
      {title: "Planned hours", rows: run.schedule ? [{title: run.schedule.timezone, detail: `${run.schedule.plannedStartAt} → ${run.schedule.plannedEndAt} · Informational; does not end duty automatically.`}] : [], empty: "No planned hours saved."},
      {title: "Saved operational requirements", rows: [...(run.operationalProfile?.inspectionItems ?? []).map(item => ({title: item.label, detail: `Inspection · ${item.required ? "Required" : "Optional"}`})), ...(run.operationalProfile?.manifestFields ?? []).map(item => ({title: item.label, detail: `Manifest · ${item.required ? "Required" : "Optional"}`}))], empty: "No configured requirement snapshot saved."},
      {title: "Draft editing", rows: run.canEditDraft === true ? [{title: "Draft edits permitted", detail: "Ask V to edit this exact saved draft using its current version."}] : [], empty: "Draft editing is not currently permitted."},
      {title: "Saved assignment", rows: [{title: run.labels?.driverName ?? `Driver ${run.driverUserId}`, detail: [run.labels?.vehicleName ?? run.vehicleAssetId, run.labels?.trailerName, run.status, run.phase, `Version ${run.version}`].filter(Boolean).join(" · ")}], empty: ""},
      {title: "Ordered stops", rows: [...run.stops].sort((a,b) => a.sequence-b.sequence).map(stop => ({title: `${stop.sequence + 1}. ${stop.kind}`, detail: `${run.labels?.sites.find(site => site.siteId === stop.siteId)?.name ?? `Site ${stop.siteId}`} · ${run.currentStopId === stop.id ? "Current stop" : run.visitedStopIds.includes(stop.id) ? "Visit recorded" : "Visit not recorded"}`})), empty: "No stops saved."},
      {title: "Reported inspections", rows: run.inspections.map(inspection => ({title: inspection.outcome.replaceAll("_", " "), detail: `${inspection.notes} · ${(inspection.responses ?? []).map(answer => `${run.operationalProfile?.inspectionItems.find(item => item.id === answer.id)?.label ?? answer.id}: ${answer.outcome}${answer.notes ? " (" + answer.notes + ")" : ""}`).join("; ")} · ${inspection.source} · user ${inspection.recordedByUserId}`, time: inspection.recordedAt, ...(inspection.outcome === "defect_reported" ? {attention: "Defect reported"} : {})})), empty: "No inspection reports saved."},
      {title: "Reported meters and fuel", rows: run.records.map(record => ({title: record.kind, detail: `${record.reading ?? record.quantity ?? "No value"} ${record.unit} · ${record.notes} · ${record.source}`, time: record.recordedAt})), empty: "No meter or fuel records saved."},
      {title: "Loads and delivery records", rows: run.loads.map(load => ({title: load.commodity, detail: `${load.quantity} ${load.unit} · ${load.manifestReference} · ${Object.entries(load.manifestValues ?? {}).map(([id,value]) => `${run.operationalProfile?.manifestFields.find(item => item.id === id)?.label ?? id}: ${value}`).join("; ")}${load.deliveryReference ? " · " + load.deliveryReference : ""}${load.transferOut ? " · Reported transfer out; original capture retained" : ""}${load.transferIn ? " · Reported transfer in; original capture retained" : ""}`, time: load.deliveredAt ?? load.recordedAt, ...(!load.deliveredAt && !load.transferOut ? {attention: "Delivery not recorded"} : {})})), empty: "No loads saved."},
      {title: "Permitted next actions", rows: run.allowedActions.map(action => ({title: action.replaceAll("_", " "), detail: "Ask V to perform this action with the required actual observations."})), empty: "No actions currently permitted."},
      {title: "Saved timeline", rows: run.events.slice(-50).map(event => ({title: event.type, detail: `Recorded by user ${event.actorUserId}${event.source ? " · " + event.source : ""}${event.capturedAt ? " · captured " + event.capturedAt : ""}`, time: event.recordedAt})), empty: "No saved events."},
    ];
    result.attention = result.sections.flatMap(section => section.rows.filter(row => row.attention));
  } else if ((view === "fleet" || view === "fleet_map") && sourceTool === "query_fleet_briefing") {
    if (!Array.isArray(data.runs) || !Array.isArray(data.roles) || !Array.isArray(data.observations) || !Array.isArray(data.unavailableIntegrations) || (!data.roles.length && object(data.capabilities).canSetup !== true)) throw new Error("Fleet workspace unavailable");
    result.title = view === "fleet_map" ? "Fleet Recorded Map" : "Fleet Desk";
    const runs = list(data.runs).map(row => FleetRunSchema.parse(row));
    result.sections = [{title: "Authorized runs", rows: runs.map(run => ({title: run.title, runId: run.id, detail: [run.labels?.driverName ?? `Driver ${run.driverUserId}`, run.labels?.vehicleName, run.status, run.phase].filter(Boolean).join(" · "), ...(run.status === "submitted_for_review" ? {attention: "Operational review pending"} : {})})), empty: "No authorized runs returned."},
      {title: "Integration status", rows: list(data.unavailableIntegrations.map((name: unknown) => ({name}))).map(row => ({title: text(row.name), detail: "Not configured or verified."})), empty: "No unavailable integrations reported."}];
    result.attention = result.sections.flatMap(section => section.rows.filter(row => row.attention));
    result.metrics = ["draft", "dispatched", "acknowledged", "in_progress", "submitted_for_review"].map(status => ({label: `Shown ${status.replaceAll("_", " ")}`, value: runs.filter(run => run.status === status).length}));
    if (object(data.page).nextCursor) result.attention.push({title: "More authorized runs available", detail: "Counts and map cover this returned page. Ask V for the next page or a specific run."});
    result.fleetMap = {points: list(data.observations).flatMap(observation => {
      const run = runs.find(run => run.id === observation.runId);
      const timestamp = moment(observation.recordedAt);
      return run && timestamp && observation.source === "driver_phone" && observation.freshness !== "unavailable" && typeof observation.latitude === "number" && Number.isFinite(observation.latitude) && Math.abs(observation.latitude) <= 90 && typeof observation.longitude === "number" && Number.isFinite(observation.longitude) && Math.abs(observation.longitude) <= 180
        ? [{latitude: observation.latitude, longitude: observation.longitude, recordedAt: timestamp, freshness: text(observation.freshness), label: `${run.labels?.driverName ?? "Driver"} phone · ${run.title}${typeof observation.accuracyMeters === "number" ? " · reported accuracy ±" + observation.accuracyMeters + " m" : ""}`}]
        : [];
    })};
  } else if (view === "fleet") {
    if (!Array.isArray(data.trips)) throw new Error("Incomplete fleet result");
    const trips = list(data.trips);
    const rows = trips.map(trip => ({ title: [text(trip.vehicleName, "Vehicle not linked"), text(trip.driverName, "Driver")].join(" · "), detail: [text(trip.presenceState), text(trip.trackingState), text(trip.siteName), text(trip.freshness)].filter(Boolean).join(" · "), time: moment(trip.recordedAt), ...(["stale", "unavailable"].includes(trip.freshness) ? { attention: "Location needs updating" } : {}) }));
    result.sections = [{ title: "Authorized active and paused trips", rows, empty: "No active or paused trips returned." }];
    result.sections.push({ title: VENDRY_FLEET_INTEGRATION.name, rows: [{ title: "Not connected", detail: VENDRY_FLEET_INTEGRATION.message }], empty: "" });
    result.attention = rows.filter(row => row.attention);
    if (data.truncated === true) result.attention.push({ title: "Trip result limited", detail: "The server returned its first 200 trips." });
    result.metrics = ["en_route", "on_site", "off_site"].map(state => ({ label: state.replaceAll("_", " "), value: trips.filter(trip => trip.presenceState === state).length }));
    result.fleetMap = { points: trips.flatMap(trip => { const location = object(trip.location); const recordedAt = moment(trip.recordedAt); return typeof location.latitude === "number" && Number.isFinite(location.latitude) && Math.abs(location.latitude) <= 90 && typeof location.longitude === "number" && Number.isFinite(location.longitude) && Math.abs(location.longitude) <= 180 && recordedAt ? [{ latitude: location.latitude, longitude: location.longitude, recordedAt, freshness: text(trip.freshness), label: [text(trip.vehicleName, "Vehicle"), text(trip.driverName, "Driver")].join(" · ") }] : []; }) };
  } else if (view === "inventory") {
    if (!Array.isArray(data.assets)) throw new Error("Incomplete inventory result");
    const rows = list(data.assets).map(asset => ({ title: text(asset.name, "Asset"), detail: [text(asset.category), text(asset.status), text(asset.currentHolderDisplayName), text(asset.condition), asset.holderUserId != null ? (Number.isSafeInteger(asset.custodyDays) && asset.custodyDays >= 0 ? `${asset.custodyDays} days checked out` : "Checkout date unknown") : ""].filter(Boolean).join(" · "), time: moment(asset.expectedReturnAt), ...(["missing", "stolen", "damaged"].includes(asset.condition) || asset.hold ? { attention: asset.hold ? "Asset on hold" : text(asset.condition) } : Number.isSafeInteger(asset.custodyDays) && asset.custodyDays > 90 && asset.holderUserId != null ? { attention: "Checked out longer than 90 days" } : {}) }));
    result.sections = [{ title: "Authorized inventory", rows, empty: "No authorized inventory returned. Ask V to add an asset if your account permits it." }];
    result.attention = rows.filter(row => row.attention);
    result.metrics = [{ label: "Assets shown", value: rows.length }];
  } else if (view === "tickets") {
    if (!Array.isArray(data.tickets)) throw new Error("Incomplete ticket result");
    const rows = list(data.tickets).map(ticket => ({ title: `Ticket ${Number.isSafeInteger(ticket.id) ? ticket.id : "record"}`, detail: text(ticket.status, "Status unavailable"), time: moment(ticket.createdAt), ...(["kicked_back", "pending_review"].includes(ticket.status) ? { attention: ticket.status === "kicked_back" ? "Returned for changes" : "Review pending" } : {}) }));
    result.sections = [{ title: "Recent authorized tickets", rows, empty: "No tickets returned for the last 30 days." }];
    result.attention = rows.filter(row => row.attention);
    result.metrics = [{ label: "Tickets shown", value: rows.length }];
  } else if (view === "notifications") {
    if (!Array.isArray(data.rows)) throw new Error("Incomplete notification result");
    result.sections = [{ title: "Unread notifications", rows: list(data.rows).map(row => ({ title: text(row.title, "Notification"), detail: text(row.body), time: moment(row.createdAt) })), empty: "No unread notifications returned." }];
  } else if (view === "onboarding") {
    if (!("progress" in data)) throw new Error("Incomplete onboarding result");
    if (data.progress === null) {
      result.sections = [{ title: "Setup progress", rows: [], empty: "No saved onboarding progress returned. Ask V to help start setup." }];
    } else {
      const progress = object(data.progress);
      if (!["partner", "vendor", "field_employee"].includes(progress.orgType) || !Array.isArray(progress.completedSteps) || !Array.isArray(progress.skippedSteps)) throw new Error("Incomplete onboarding result");
      const completed = new Set(progress.completedSteps);
      const skipped = new Set(progress.skippedSteps);
      const flow = getFlow(progress.orgType as OrgPersona);
      const rows = flow.map(step => ({ title: step.title, detail: completed.has(step.step) ? "Completed" : skipped.has(step.step) ? "Deferred" : progress.currentStep === step.step ? "Current step" : "Remaining", ...(progress.currentStep === step.step && !progress.completedAt && !completed.has(step.step) ? { attention: "Continue this step with V" } : {}) }));
      result.sections = [{ title: progress.completedAt ? "Setup submitted" : "Your setup steps", rows, empty: "No setup steps returned." }];
      result.attention = rows.filter(row => row.attention);
      result.metrics = [{ label: "Steps completed", value: flow.filter(step => completed.has(step.step)).length }, { label: "Total steps", value: flow.length }];
    }
  } else if (sourceTool === "query_gate_stations") {
    const choosingStations = Array.isArray(data.stations);
    result.sections = [{ title: choosingStations ? "Available gates" : "Available sites", rows: list(choosingStations ? data.stations : data.sites).map(row => ({ title: text(row.name ?? row.siteName, "Authorized location"), detail: "Ask V to show this gate's current shift." })), empty: "No authorized locations returned." }];
  } else {
    const snapshot = object(data.snapshot);
    const metrics = object(snapshot.metrics);
    const labels: Record<string, string> = { checkIns: "Entry records", checkOuts: "Exit records", onSiteVisitorRecords: "Visitor records on site", onSiteEmployeeRecords: "Employee records on site", onSiteVehicles: "Vehicles on site", pendingAdmission: "Pending admission" };
    result.metrics = Object.entries(labels).flatMap(([key, label]) => typeof metrics[key] === "number" ? [{ label, value: metrics[key] }] : []);
    result.generatedAt = moment(snapshot.generatedAt ?? snapshot.at) ?? result.generatedAt;
    result.attention = [ ...(data.stale === true ? [{ title: "Handoff needs refreshing", detail: "The saved preparation differs from the current gate snapshot." }] : []), ...list(snapshot.exceptions).map(row => ({ title: text(row.text, "Gate exception") })), ...list(data.items).filter(row => row.status !== "resolved").map(row => ({ title: text(row.text, "Unresolved handoff item"), detail: text(row.status) })) ];
    result.sections = [
      { title: text(object(data.station).name, "Gate shift"), rows: data.shift ? [{ title: "Active shift", time: moment(object(data.shift).started_at) }] : [], empty: "No active gate shift. Shift totals are unavailable." },
      { title: "Outstanding records", rows: list(snapshot.outstanding).map(row => ({ title: text(row.name, "Gate record"), detail: [text(row.company), text(row.plate)].filter(Boolean).join(" · "), time: moment(row.checkIn) })), empty: data.shift ? "No outstanding records returned." : "Start or select a shift to inspect its snapshot." },
    ];
  }
  for (const [label, values] of Object.entries({ ...data, outstanding: object(data.snapshot).outstanding, exceptions: object(data.snapshot).exceptions })) {
    if (Array.isArray(values) && values.length > 50) result.attention.push({ title: "More records available", detail: `Showing the first 50 of ${values.length} ${label} records. Ask V to narrow the requested view.` });
  }
  return result;
}

// Records use the authenticated MCP bridge. Fleet basemap images use the existing public Mapbox configuration.
export const WORKSPACE_HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>VNDRLY work desk</title><style>
*{box-sizing:border-box}body{margin:0;padding:20px;font:14px/1.5 system-ui,sans-serif;color:var(--color-text-primary,#20252a);background:var(--color-background-primary,#fff)}header{display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #ddd;padding-bottom:14px}h1{font-size:22px;margin:0}h2{font-size:16px;margin:0 0 10px}p{margin:5px 0}.muted{color:var(--color-text-secondary,#66717b)}a{color:inherit;text-underline-offset:4px}nav{display:flex;gap:18px;flex-wrap:wrap;padding:16px 0}nav a[aria-current=page]{font-weight:700}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(235px,1fr));gap:14px}article,.attention{border:1px solid #ddd;border-radius:12px;padding:16px}.attention{margin-bottom:14px;border-left:4px solid #F59E0B}.row{padding:10px 0;border-top:1px solid #eee}.row:first-of-type{border-top:0}.row strong{display:block}.metrics{display:flex;gap:18px;flex-wrap:wrap;margin:0 0 16px}.metric b{display:block;font-size:24px}#status{min-height:24px}.error{border-left:4px solid #DC2626;padding-left:12px}footer{margin-top:16px;font-size:12px}@media(prefers-color-scheme:dark){body{color:#eee;background:#202123}article,.attention,header{border-color:#555}.row{border-color:#444}}
</style></head><body><header><div><p class="muted">VNDRLY.ai · V</p><h1 id="title">Your work desk</h1></div><a href="#refresh" id="refresh">Refresh</a></header><nav aria-label="Workspace views"><a href="#my_workday" data-view="my_workday">My Workday</a><a href="#gate_board" data-view="gate_board">Gate Board</a><a href="#work_calendar" data-view="work_calendar">Work Calendar</a><a href="#onboarding" data-view="onboarding">Onboarding</a><a href="#tickets" data-view="tickets">Tickets</a><a href="#notifications" data-view="notifications">Notifications</a><a href="#fleet" data-view="fleet">Fleet</a><a href="#fleet_map" data-view="fleet_map">Fleet Map</a><a href="#fleet_dispatch" data-view="fleet_dispatch">Dispatch</a><a href="#fleet_maintenance" data-view="fleet_maintenance">Maintenance</a><a href="#fleet_reports" data-view="fleet_reports">Reports</a><a href="#fleet_site" data-view="fleet_site">Site Activity</a><a href="#inventory" data-view="inventory">Inventory</a></nav><p id="status" role="status">Waiting for your authorized VNDRLY records…</p><div id="content"></div><footer class="muted" id="updated"></footer><script>
(()=>{${FLEET_MAP_CLIENT}
const pending=new Map();let id=1,current=null,navigationVersion=0,selectedView=null,navigationPending=false;const el=id=>document.getElementById(id);const add=(parent,tag,value,cls)=>{const node=document.createElement(tag);node.textContent=value;if(cls)node.className=cls;parent.append(node);return node;};
function renderFleetEstimateControl(output,parent){const runId=output.sourceArguments?.runId;if(!['fleet_run','fleet_eta','fleet_evidence','fleet_review'].includes(output.view)||typeof runId!=='string'||!Array.isArray(output.availableViews))return;if(output.view==='fleet_run'&&output.availableViews.includes('fleet_eta')){const button=add(parent,'button','Request driving estimate');button.onclick=()=>load('fleet_eta',false,{runId});}if(output.view==='fleet_run'&&output.availableViews.includes('fleet_evidence')){const button=add(parent,'button','Saved evidence');button.onclick=()=>load('fleet_evidence',false,{runId});}if(output.view==='fleet_run'&&output.availableViews.includes('fleet_review')){const button=add(parent,'button','Review packet');button.onclick=()=>load('fleet_review',false,{runId});}if(output.view==='fleet_eta'||output.view==='fleet_evidence'||output.view==='fleet_review'){const button=add(parent,'button','Back to run');button.onclick=()=>load('fleet_run',false,{runId});}}
function request(method,params){const requestId=id++;return new Promise((resolve,reject)=>{const timeout=setTimeout(()=>{pending.delete(requestId);reject(Error('The request timed out. Your previous view has not been refreshed.'));},20000);pending.set(requestId,{resolve,reject,timeout});window.parent.postMessage({jsonrpc:'2.0',id:requestId,method,params},'*');});}
function render(output){if(!output||!Array.isArray(output.sections)||(navigationPending&&output.view!==selectedView))return;if(fleetMap){fleetMap.remove();fleetMap=null;}current=output;selectedView=output.view;el('title').textContent=output.title;document.querySelectorAll('[data-view]').forEach(link=>{link.hidden=!Array.isArray(output.availableViews)||!output.availableViews.includes(link.dataset.view);if(link.dataset.view===output.view)link.setAttribute('aria-current','page');else link.removeAttribute('aria-current');});el('status').textContent='';el('status').className='';const content=el('content');content.replaceChildren();renderFleetMap(output,content);renderFleetEstimateControl(output,content);function row(parent,item){const card=add(parent,'div','','row');add(card,'strong',item.title);if(item.detail)add(card,'p',item.detail,'muted');if(item.time){const date=new Date(item.time);if(Number.isFinite(date.getTime()))add(card,'p',date.toLocaleString(),'muted');}if(item.attention)add(card,'p',item.attention);if(typeof item.runId==='string'&&/^[0-9a-f-]{36}$/i.test(item.runId)){const open=add(card,'button','Open run');open.onclick=()=>load('fleet_run',false,{runId:item.runId});}}
if(output.attention.length){const area=add(content,'section','','attention');add(area,'h2','Needs attention');output.attention.forEach(item=>row(area,item));}if(output.metrics.length){const area=add(content,'section','','metrics');output.metrics.forEach(item=>{const metric=add(area,'div','','metric');add(metric,'b',String(item.value));add(metric,'span',item.label);});}const grid=add(content,'div','','grid');output.sections.forEach(section=>{const panel=add(grid,'article','');add(panel,'h2',section.title);if(!section.rows.length)add(panel,'p',section.empty,'muted');section.rows.forEach(item=>row(panel,item));});el('updated').textContent='Records fetched '+new Date(output.generatedAt).toLocaleString()+'. Refresh for the latest state.';window.parent.postMessage({jsonrpc:'2.0',method:'ui/notifications/size-changed',params:{height:document.documentElement.scrollHeight}},'*');}
async function load(view,refresh,providedArgs){const version=++navigationVersion;selectedView=view;navigationPending=true;el('status').textContent='Refreshing authorized work records…';try{let args=providedArgs||(refresh&&current?current.sourceArguments:{});if(view==='fleet_reports'||view==='fleet_site'){args={...(args.fleetId?{fleetId:args.fleetId}:{}),...(args.siteId?{siteId:args.siteId}:{}),...(args.startsAt||args.start?{start:args.startsAt||args.start}:{}),...(args.endsAt||args.end?{end:args.endsAt||args.end}:{})};}if(view==='work_calendar'&&!args.start){const start=new Date();start.setHours(0,0,0,0);const end=new Date(start);end.setDate(end.getDate()+7);args={start:start.toISOString(),end:end.toISOString()};}const next=await request('tools/call',{name:'v_show_workspace',arguments:{view,...args}});if(version!==navigationVersion)return;if(next.isError||!next.structuredContent)throw Error('This view is unavailable for your account or requested location. Ask V to select an authorized site or reconnect VNDRLY.');render(next.structuredContent);}catch(error){if(version!==navigationVersion)return;el('status').textContent=error.message;el('status').className='error';}finally{if(version===navigationVersion)navigationPending=false;}}
window.addEventListener('message',event=>{if(event.source!==window.parent)return;const message=event.data;if(!message||message.jsonrpc!=='2.0')return;const waiting=pending.get(message.id);if(waiting){clearTimeout(waiting.timeout);pending.delete(message.id);message.error?waiting.reject(Error('VNDRLY could not complete this request.')):waiting.resolve(message.result);return;}if(message.method==='ui/notifications/tool-result'){if(message.params?.isError){el('status').textContent='VNDRLY could not load this view. Ask V to check the connection.';return;}render(message.params?.structuredContent);}});
el('refresh').onclick=event=>{event.preventDefault();if(current)load(current.view,true);};document.querySelectorAll('[data-view]').forEach(link=>link.onclick=event=>{event.preventDefault();load(link.dataset.view,false);});request('ui/initialize',{appInfo:{name:'VNDRLY work desk',version:'1.0.0'},appCapabilities:{},protocolVersion:'2026-01-26'}).then(()=>{window.parent.postMessage({jsonrpc:'2.0',method:'ui/notifications/initialized'},'*');}).catch(()=>{el('status').textContent='Open this view inside your connected assistant to load work records.';});})();
</script></body></html>`;



