import { z } from "zod/v4";
import { FleetLocationObservationSchema, FleetDestinationSchema } from "@workspace/api-zod";
import type { WorkspaceOutput, WorkspaceView, WorkspaceRow } from "./chatgpt-workspace";

export const OPERATIONS_VIEWS = ["gate_coverage", "fleet_history", "fleet_plan", "fleet_settings", "company_operations"] as const;
type OperationsView = typeof OPERATIONS_VIEWS[number];
const sources: Record<OperationsView, string> = {gate_coverage:"query_gate_coverage_map",fleet_history:"query_fleet_location_history",fleet_plan:"query_fleet_ticket_plan",fleet_settings:"query_fleet_commercial_settings",company_operations:"query_company_operations"};
const titles: Record<OperationsView, string> = {gate_coverage:"Gate Coverage",fleet_history:"Fleet History & Replay",fleet_plan:"Fleet Ticket Plan",fleet_settings:"Fleet Commercial Settings",company_operations:"Company Operations"};
const isView = (view: string): view is OperationsView => (OPERATIONS_VIEWS as readonly string[]).includes(view);
const record = (v: unknown): Record<string, any> => v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, any> : {};
const text = (v: unknown, fallback = "") => typeof v === "string" ? v.slice(0,500) : fallback;
const time = (v: unknown) => typeof v === "string" && Number.isFinite(Date.parse(v)) ? v : undefined;
const rows = (v: unknown) => Array.isArray(v) ? v.slice(0,50).map(record) : [];
export function operationsRequest(input: Record<string, unknown>) {
  const view=String(input.view); if(!isView(view)) return null;
  let sourceArguments: Record<string, unknown> = {};
  if(view === "fleet_history") sourceArguments={runId:z.uuid().parse(input.runId)};
  if(view === "fleet_plan") sourceArguments={ticketId:z.number().int().positive().parse(input.ticketId)};
  if(view === "gate_coverage" && input.at!==undefined) sourceArguments={at:z.iso.datetime().parse(input.at)};
  if(view === "fleet_settings" && input.siteId!==undefined) sourceArguments={siteId:z.number().int().positive().parse(input.siteId)};
  return {view,sourceTool:sources[view],sourceArguments};
}
function destinationRows(value: unknown): WorkspaceRow[] {
  if(!Array.isArray(value)) throw new Error("Incomplete destination result");
  return value.slice(0,50).map(item=>{const d=FleetDestinationSchema.parse(item);return {title:d.name,detail:[d.kind,d.address,d.active?"Active":"Inactive",`Revision ${d.revision}`,d.hours,d.instructions].filter(Boolean).join(" · ")};});
}
function postStatus(value: unknown): string {
  const coverage=record(value);
  return ["incident","sharingIncident"].flatMap(key=>{const incident=record(coverage[key]);return incident.id?[`${key === "incident"?"Post coverage":"Location sharing"}: ${incident.resolvedAt?"resolved":incident.acknowledgedAt?"acknowledged, unresolved":"unresolved"}${incident.escalatedAt?" · escalated":""}`]:[];}).join(" · ")||"No incident state returned";
}
/** Project canonical fields only; private audit metadata and device identifiers stay outside the embedded view. */
export function operationsOutput(view: WorkspaceView, sourceTool: string, sourceArguments: Record<string, unknown>, raw: unknown, now: Date): WorkspaceOutput | null {
  if(!isView(view)) return null;
  const d=record(raw);
  if(sourceTool!==sources[view] || d.error || d.ok===false) throw new Error("Operations workspace source unavailable");
  const out: WorkspaceOutput={view,title:titles[view],sourceTool,sourceArguments,generatedAt:now.toISOString(),sections:[],attention:[],metrics:[]};
  if(view === "company_operations") {
    const categories=z.array(z.enum(["field","fleet","gate"])).max(3).parse(d.categories);
    if(typeof d.canManage!=="boolean") throw new Error("Incomplete company result");
    out.sections=[{title:"Saved company services",rows:categories.map(title=>({title})),empty:"No selected company services returned"},{title:"Administration",rows:[{title:d.canManage?"Company administrator":"Company member",detail:"Changing the complete selection requires company:settings consent and authenticated confirmation. Company services do not grant employee access."}],empty:"Unavailable"}];
  } else if(view === "fleet_settings") {
    if(!Number.isSafeInteger(d.version)||!Array.isArray(d.sites))throw new Error("Incomplete Fleet settings result");
    out.sections=[{title:"Saved policy",rows:[{title:text(d.defaultMode,"Mode unavailable"),detail:`Revision ${d.version} · Changes require current revision and authenticated confirmation.`}],empty:"Unavailable"},{title:"Approved destination catalog",rows:destinationRows(d.destinations),empty:"No approved destinations returned"}];
    if(d.destinations.length>50)out.attention.push({title:"Destination list limited",detail:"Only the first 50 returned destinations are shown; ask V for the exact destination."});
  } else if(view === "fleet_plan") {
    if(d.ticketId!==sourceArguments.ticketId||!Number.isSafeInteger(d.siteId)||!("plan" in d)||!d.charges)throw new Error("Incomplete or mismatched ticket plan");
    const plan=record(d.plan);
    out.sections=[{title:"Ticket origin and policy",rows:[{title:`Ticket #${d.ticketId}`,detail:`Origin site #${d.siteId} · One originating site per ticket`},...(d.plan?[{title:text(plan.mode),detail:`${text(plan.closure)} closure · Revision ${plan.version}`,time:time(plan.closesAt)}]:[])],empty:"No saved plan"},{title:"Approved destinations",rows:d.plan?destinationRows(plan.destinations):[],empty:"No saved approved destinations"},{title:"Accepted run charges",rows:[{title:typeof d.charges.total==="string"?`${d.charges.total} USD`:"Total unavailable",detail:Number.isSafeInteger(d.charges.runs)?`${d.charges.runs} billed runs`:"Run count unavailable"}],empty:"Unavailable"}];
    if(Array.isArray(d.runs))out.sections.push({title:"Run review and ticket submission",rows:[{title:text(d.status,"Status unavailable"),detail:`AFE ${text(d.afeNumber)} · Work date ${text(d.workDate)} · ${d.canFinalize===true?"Ready for office finalization":"Ticket remains open until all noncancelled runs are reviewed"}`},...rows(d.runs).map(run=>({title:text(run.title,"Run"),detail:`${text(run.status)} · Revision ${run.version}`}))],empty:"No runs returned"});
    out.attention=[{title:"Office finalization",detail:"Close Run submits one run for office review. Accepting it leaves the shared ticket open. Finalize only on explicit office instruction, with current plan version, separate fleet:billing consent and authenticated confirmation. Verify finalizationOperationId and submitted status."},{title:"Confirmed changes only",detail:"Recommendations are not destination approval. Save requires current revision, retained operation ID and authenticated confirmation."}];
  } else if(view === "fleet_history") {
    if(d.runId!==sourceArguments.runId||!Array.isArray(d.points)||!Array.isArray(d.events)||typeof d.truncated!=="boolean")throw new Error("Incomplete or mismatched run history");
    const points=d.points.map((v:unknown)=>FleetLocationObservationSchema.parse(v));
    if(points.some((p:{runId:string})=>p.runId!==d.runId))throw new Error("History belongs to another run");
    out.sections=[{title:"Recorded samples",rows:points.slice(0,50).map((p:z.infer<typeof FleetLocationObservationSchema>,i:number)=>({title:`Sample ${i+1}`,detail:`${p.latitude}, ${p.longitude} · Accuracy ${p.accuracyMeters??"unknown"} m · ${p.freshness}`,time:p.recordedAt})),empty:"No authorized recorded samples"},{title:"Reported run events",rows:rows(d.events).map(e=>({title:text(e.label,"Reported event"),time:time(e.recordedAt)})),empty:"No reported events"}];
    out.metrics=[{label:"Returned samples",value:points.length}];
    out.fleetMap={points:points.slice(0,500).map((p:z.infer<typeof FleetLocationObservationSchema>,i:number)=>({latitude:p.latitude,longitude:p.longitude,recordedAt:p.recordedAt,freshness:p.freshness,label:`Sample ${i+1}`}))};
    out.attention=[{title:"Recorded replay",detail:"Saved timestamps only. Missing samples remain gaps; replay does not establish live position, road speed or physical work."}];
    if(d.truncated||points.length>50)out.attention.push({title:"Display limited",detail:`${points.length} samples returned; list shows first 50 and map first 500.${d.truncated?" Server history is truncated.":""}`});
  } else {
    if(!Array.isArray(d.gates)||!Array.isArray(d.staff)||!Array.isArray(d.duties)||!time(d.at)||typeof d.historical!=="boolean")throw new Error("Incomplete Gate coverage result");
    out.sections=[{title:d.historical?"Historical duty coverage":"Duty coverage",rows:rows(d.staff).map(s=>({title:text(s.name,"Authorized staff"),detail:[text(s.assignment),text(s.locationReason,"Location unavailable")].filter(Boolean).join(" · "),time:time(s.location?.capturedAt)})),empty:"No authorized on-duty staff returned"},{title:"Saved gates",rows:rows(d.gates).map(g=>({title:text(g.name,"Gate"),detail:text(g.siteName)})),empty:"No authorized gates"},{title:"Duty post status",rows:rows(d.duties).map(s=>({title:text(s.name,"Authorized duty"),detail:postStatus(s.coverage),time:time(s.startedAt)})),empty:"No authorized duty sessions"}];
    out.attention=[{title:`Coverage at ${d.at}`,detail:"Missing or stale GPS stays explicit. Reading coverage never acknowledges or resolves an incident."}];
    out.fleetMap={points:rows(d.staff).flatMap(s=>{const p=record(s.location);return Number.isFinite(p.latitude)&&Math.abs(p.latitude)<=90&&Number.isFinite(p.longitude)&&Math.abs(p.longitude)<=180&&time(p.capturedAt)?[{latitude:p.latitude,longitude:p.longitude,recordedAt:p.capturedAt,freshness:s.fresh?"recent":"stale",label:text(s.name,"Authorized staff")}]:[];})};
    if(d.staff.length>50||d.gates.length>50||d.duties.length>50)out.attention.push({title:"Display limited",detail:"Each section shows the first 50 authorized records."});
  }
  return out;
}
/** Pure presentation controls; all actions still go through the authenticated server action panel. */
export const OPERATIONS_CLIENT=String.raw`
function renderOperationsControls(output,parent){
 const allowed=output.availableViews||[];
 if(allowed.includes('fleet_plan')){const area=add(parent,'p','');const input=add(area,'input','');input.type='number';input.min='1';input.placeholder='Exact ticket number';input.setAttribute('aria-label','Fleet plan ticket number');const button=add(area,'button','Open ticket plan');button.onclick=()=>{const ticketId=Number(input.value);if(!Number.isSafeInteger(ticketId)||ticketId<1){el('status').textContent='Select an exact authorized ticket number.';return;}load('fleet_plan',false,{ticketId});};}
 if(allowed.includes('fleet_history')&&output.view!=='fleet_run'&&output.view!=='fleet_history'){const area=add(parent,'p','');const input=add(area,'input','');input.placeholder='Exact run identifier';input.setAttribute('aria-label','Recorded Fleet run identifier');const button=add(area,'button','Open recorded history');button.onclick=()=>{if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.value)){el('status').textContent='Select an exact authorized run identifier.';return;}load('fleet_history',false,{runId:input.value});};}
 if(output.view==='fleet_run'&&allowed.includes('fleet_history')){const button=add(parent,'button','History & Replay');button.onclick=()=>load('fleet_history',false,{runId:output.sourceArguments.runId});}
 if(output.view==='fleet_history'){
  const points=output.fleetMap?.points||[];if(points.length){const label=add(parent,'p','');const range=add(parent,'input','');range.type='range';range.min='0';range.max=String(points.length-1);range.value='0';range.setAttribute('aria-label','Recorded sample replay');const show=()=>{const p=points[Number(range.value)];fleetMap?.focus?.(p);label.textContent='Recorded sample '+(Number(range.value)+1)+' · '+new Date(p.recordedAt).toLocaleString()+' · '+p.latitude+', '+p.longitude+' · '+p.freshness;};range.oninput=show;show();}
  const back=add(parent,'button','Back to run');back.onclick=()=>load('fleet_run',false,{runId:output.sourceArguments.runId});
 }
 if(output.view==='gate_coverage'){const input=add(parent,'input','');input.type='datetime-local';input.setAttribute('aria-label','Historical coverage time');const button=add(parent,'button','Show selected time');button.onclick=()=>{const at=new Date(input.value);if(!Number.isFinite(at.getTime())){el('status').textContent='Select a coverage time.';return;}load('gate_coverage',false,{at:at.toISOString()});};}
}
`;
