import { getFlow, type OrgPersona } from "./prompts/onboarding-flows";
import { FLEET_MAP_CLIENT } from "./chatgpt-fleet-map";
import { VENDRY_FLEET_INTEGRATION } from "./chatgpt-fleet-integration";

export type WorkspaceView = "my_workday" | "gate_board" | "work_calendar" | "onboarding" | "tickets" | "notifications" | "fleet" | "inventory";
export const WORKSPACE_URI = "ui://vndrly/workspace/v1.html";
export const WORKSPACE_TOOL = {
  name: "v_show_workspace",
  description: "Show an embedded VNDRLY My Workday, Gate Board, Work Calendar, Tickets, Notifications, Inventory, or Fleet using fresh permission-scoped records. Onboarding shows saved setup steps without changing fields. Gate selection without a station lists authorized locations. Calendar requires an explicit start and end window. Fleet shows existing authorized trips and an explicitly disconnected VENDRY Fleet placeholder; tagged vehicle location and routes are unavailable. This view does not start tracking or change records.",
  inputSchema: { type: "object" as const, properties: { view: { type: "string", enum: ["my_workday", "gate_board", "work_calendar", "onboarding", "tickets", "notifications", "fleet", "inventory"] }, siteId: { type: "integer", minimum: 1 }, stationId: { type: "string", format: "uuid" }, start: { type: "string", format: "date-time" }, end: { type: "string", format: "date-time" } }, required: ["view"], additionalProperties: false },
  annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  _meta: { ui: { resourceUri: WORKSPACE_URI }, "openai/outputTemplate": WORKSPACE_URI, "openai/widgetAccessible": true },
};
export function workspaceRequest(input: Record<string, unknown>) {
  const view = input.view;
  if (!["my_workday", "gate_board", "work_calendar", "onboarding", "tickets", "notifications", "fleet", "inventory"].includes(String(view))) throw new Error("Unknown workspace view");
  let sourceTool: string;
  let sourceArguments: Record<string, unknown> = {};
  if (view === "my_workday") sourceTool = "get_work_hub_briefing";
  else if (view === "onboarding") sourceTool = "lookup_user_progress";
  else if (view === "tickets") { sourceTool = "query_tickets"; sourceArguments = { limit: 50, sinceDays: 30 }; }
  else if (view === "notifications") { sourceTool = "query_notifications"; sourceArguments = { limit: 50, unreadOnly: true }; }
  else if (view === "fleet") sourceTool = "query_field_trips";
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
  return { view: view as WorkspaceView, sourceTool, sourceArguments };
}
export interface WorkspaceRow { title: string; detail?: string; time?: string; attention?: string; }
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
  if (data.error || data.ok === false) throw new Error("Workspace source unavailable");
  if (["my_workday", "work_calendar"].includes(view) && ![data.tasks, data.shifts, data.meetings].every(Array.isArray)) throw new Error("Incomplete workspace result");
  if (view === "gate_board" && sourceTool === "query_gate_stations" && !Array.isArray(data.sites) && !Array.isArray(data.stations)) throw new Error("Incomplete gate result");
  if (view === "gate_board" && sourceTool === "query_gate_change_over" && (!data.station || !("shift" in data) || !("snapshot" in data) || !Array.isArray(data.items))) throw new Error("Incomplete gate result");
  const result: WorkspaceOutput = { view, title: { my_workday: "My Workday", gate_board: "Gate Board", work_calendar: "Work Calendar", onboarding: "Onboarding", tickets: "Tickets", notifications: "Notifications", fleet: "Fleet", inventory: "Inventory" }[view], generatedAt: moment(data.generatedAt) ?? now.toISOString(), sourceTool, sourceArguments, sections: [], attention: [], metrics: [] };
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
    const rows = list(data.assets).map(asset => ({ title: text(asset.name, "Asset"), detail: [text(asset.category), text(asset.status), text(asset.currentHolderDisplayName), text(asset.condition)].filter(Boolean).join(" · "), time: moment(asset.expectedReturnAt), ...(["missing", "stolen", "damaged"].includes(asset.condition) || asset.hold ? { attention: asset.hold ? "Asset on hold" : text(asset.condition) } : {}) }));
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
</style></head><body><header><div><p class="muted">VNDRLY.ai · V</p><h1 id="title">Your work desk</h1></div><a href="#refresh" id="refresh">Refresh</a></header><nav aria-label="Workspace views"><a href="#my_workday" data-view="my_workday">My Workday</a><a href="#gate_board" data-view="gate_board">Gate Board</a><a href="#work_calendar" data-view="work_calendar">Work Calendar</a><a href="#onboarding" data-view="onboarding">Onboarding</a><a href="#tickets" data-view="tickets">Tickets</a><a href="#notifications" data-view="notifications">Notifications</a><a href="#fleet" data-view="fleet">Fleet</a><a href="#inventory" data-view="inventory">Inventory</a></nav><p id="status" role="status">Waiting for your authorized VNDRLY records…</p><div id="content"></div><footer class="muted" id="updated"></footer><script>
(()=>{${FLEET_MAP_CLIENT}
const pending=new Map();let id=1,current=null,navigationVersion=0,selectedView=null,navigationPending=false;const el=id=>document.getElementById(id);const add=(parent,tag,value,cls)=>{const node=document.createElement(tag);node.textContent=value;if(cls)node.className=cls;parent.append(node);return node;};
function request(method,params){const requestId=id++;return new Promise((resolve,reject)=>{const timeout=setTimeout(()=>{pending.delete(requestId);reject(Error('The request timed out. Your previous view has not been refreshed.'));},20000);pending.set(requestId,{resolve,reject,timeout});window.parent.postMessage({jsonrpc:'2.0',id:requestId,method,params},'*');});}
function render(output){if(!output||!Array.isArray(output.sections)||(navigationPending&&output.view!==selectedView))return;if(fleetMap){fleetMap.remove();fleetMap=null;}current=output;selectedView=output.view;el('title').textContent=output.title;document.querySelectorAll('[data-view]').forEach(link=>{link.hidden=!Array.isArray(output.availableViews)||!output.availableViews.includes(link.dataset.view);if(link.dataset.view===output.view)link.setAttribute('aria-current','page');else link.removeAttribute('aria-current');});el('status').textContent='';el('status').className='';const content=el('content');content.replaceChildren();renderFleetMap(output,content);function row(parent,item){const card=add(parent,'div','','row');add(card,'strong',item.title);if(item.detail)add(card,'p',item.detail,'muted');if(item.time){const date=new Date(item.time);if(Number.isFinite(date.getTime()))add(card,'p',date.toLocaleString(),'muted');}if(item.attention)add(card,'p',item.attention);}
if(output.attention.length){const area=add(content,'section','','attention');add(area,'h2','Needs attention');output.attention.forEach(item=>row(area,item));}if(output.metrics.length){const area=add(content,'section','','metrics');output.metrics.forEach(item=>{const metric=add(area,'div','','metric');add(metric,'b',String(item.value));add(metric,'span',item.label);});}const grid=add(content,'div','','grid');output.sections.forEach(section=>{const panel=add(grid,'article','');add(panel,'h2',section.title);if(!section.rows.length)add(panel,'p',section.empty,'muted');section.rows.forEach(item=>row(panel,item));});el('updated').textContent='Records fetched '+new Date(output.generatedAt).toLocaleString()+'. Refresh for the latest state.';window.parent.postMessage({jsonrpc:'2.0',method:'ui/notifications/size-changed',params:{height:document.documentElement.scrollHeight}},'*');}
async function load(view,refresh){const version=++navigationVersion;selectedView=view;navigationPending=true;el('status').textContent='Refreshing authorized work records…';try{let args=refresh&&current?current.sourceArguments:{};if(view==='work_calendar'&&!args.start){const start=new Date();start.setHours(0,0,0,0);const end=new Date(start);end.setDate(end.getDate()+7);args={start:start.toISOString(),end:end.toISOString()};}const next=await request('tools/call',{name:'v_show_workspace',arguments:{view,...args}});if(version!==navigationVersion)return;if(next.isError||!next.structuredContent)throw Error('This view is unavailable for your account or requested location. Ask V to select an authorized site or reconnect VNDRLY.');render(next.structuredContent);}catch(error){if(version!==navigationVersion)return;el('status').textContent=error.message;el('status').className='error';}finally{if(version===navigationVersion)navigationPending=false;}}
window.addEventListener('message',event=>{if(event.source!==window.parent)return;const message=event.data;if(!message||message.jsonrpc!=='2.0')return;const waiting=pending.get(message.id);if(waiting){clearTimeout(waiting.timeout);pending.delete(message.id);message.error?waiting.reject(Error('VNDRLY could not complete this request.')):waiting.resolve(message.result);return;}if(message.method==='ui/notifications/tool-result'){if(message.params?.isError){el('status').textContent='VNDRLY could not load this view. Ask V to check the connection.';return;}render(message.params?.structuredContent);}});
el('refresh').onclick=event=>{event.preventDefault();if(current)load(current.view,true);};document.querySelectorAll('[data-view]').forEach(link=>link.onclick=event=>{event.preventDefault();load(link.dataset.view,false);});request('ui/initialize',{appInfo:{name:'VNDRLY work desk',version:'1.0.0'},appCapabilities:{},protocolVersion:'2026-01-26'}).then(()=>{window.parent.postMessage({jsonrpc:'2.0',method:'ui/notifications/initialized'},'*');}).catch(()=>{el('status').textContent='Open this view inside your connected assistant to load work records.';});})();
</script></body></html>`;



