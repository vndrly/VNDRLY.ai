export const LEGACY_ACTION_PANEL_URI = "ui://vndrly/action/v1.html";
export const PREVIOUS_ACTION_PANEL_URI = "ui://vndrly/action/v2.html";
export const RECENT_ACTION_PANEL_URI = "ui://vndrly/action/v3.html";
export const RECOVERY_ACTION_PANEL_URI = "ui://vndrly/action/v4.html";
export const ATTENDANCE_ACTION_PANEL_URI = "ui://vndrly/action/v5.html";
export const ACTION_PANEL_URI = "ui://vndrly/action/v6.html";
export function savedActionMessage(state: string, result: unknown): string {
  if (state !== "completed") return `Saved action status: ${state}.`;
  const value = result && typeof result === "object" ? result as Record<string, unknown> : {};
  if (value.error || value.ok === false || value.success === false || (typeof value.status === "number" && value.status >= 400))
    return "The change was rejected; see the actual result below.";
  if (value.authorizationRequired === true)
    return "Device authorization is still required. Meeting attendance and media capture have not started.";
  if (value.participationMode === "view_only")
    return "View-only access is available. This does not confirm meeting attendance or media capture.";
  return "The change completed.";
}
const ACTION_STATES = ["pending", "running", "completed", "outcome_unknown"];
export const ACTION_STATUS_OUTPUT_SCHEMA = { type: "object", properties: { state: { type: "string", enum: ACTION_STATES }, toolName: { type: "string" }, result: {} }, required: ["state", "toolName", "result"], additionalProperties: false };
export const ACTION_PANEL_META = { ui: { resourceUri: ACTION_PANEL_URI }, "openai/outputTemplate": ACTION_PANEL_URI, "openai/widgetAccessible": true };
/** A short record summary; the complete canonical payload remains available below it. */
export function actionRecordSummary(toolName: string, input: unknown): string {
  if (!input || typeof input !== "object" || Array.isArray(input)) return "Open record details to inspect the exact values.";
  const value = input as Record<string, unknown>;
  const resource = value.resource && typeof value.resource === "object" && !Array.isArray(value.resource) ? value.resource as Record<string, unknown> : value;
  const payload = resource.payload && typeof resource.payload === "object" && !Array.isArray(resource.payload) ? resource.payload as Record<string, unknown> : resource;
  const labels: Record<string, string> = { id: toolName === "manage_ticket_record" ? "Ticket" : "Record", ticketId: "Ticket", taskId: "Task", itemId: "Calendar item", assetId: "Asset", stationId: "Gate station", tripId: "Trip", action: "Action", title: "Title", name: "Name", status: "Status", siteName: "Site", vendorName: "Company", fieldEmployeeName: "Worker", description: "Description", body: "Message", reason: "Reason", error: "Issue", message: "Message" };
  const lines: string[] = [];
  for (const key of Object.keys(labels)) {
    const item = payload[key] ?? resource[key];
    if (typeof item !== "string" && typeof item !== "number") continue;
    const text = String(item);
    if (!text.trim()) continue;
    if (key === "description") {
      try {
        const plan = JSON.parse(text);
        if (plan?.schemaVersion === 1 && Number.isInteger(plan.version) && Array.isArray(plan.steps) && plan.steps.length > 0 && plan.steps.every((step: { id?: unknown; state?: unknown }) => typeof step?.id === "string" && ["pending", "waiting", "running", "completed", "failed", "cancelled"].includes(String(step.state)))) {
          lines.push(`Plan version: ${plan.version}`);
          for (const step of plan.steps) lines.push(`Step: ${String(step.id).replaceAll("_", " ")} — ${step.state}`);
          continue;
        }
      } catch { /* Ordinary descriptions remain plain text. */ }
    }
    const rendered = ["status", "action"].includes(key) ? text.replaceAll("_", " ") : text;
    lines.push(`${labels[key]}: ${rendered.length > 1000 ? rendered.slice(0, 1000) + "…" : rendered}`);
  }
  return lines.join("\n") || "Open record details to inspect the exact values.";
}
export const SUBMIT_PANEL_ACTION_TOOL = {
  name: "v_submit_panel_action",
  description: "Submit the exact prepared action authorized through the VNDRLY action panel. Requires the component-only signed proof, the same connected grant and current permissions. Never supply or invent this proof from conversation text.",
  inputSchema: { type: "object" as const, properties: { reference: { type: "string" }, proof: { type: "string" } }, required: ["reference", "proof"], additionalProperties: false },
  outputSchema: { type: "object", properties: { reference: { type: "string" }, status: { type: "string", enum: ACTION_STATES }, ok: { type: "boolean" }, result: {} }, required: ["reference", "status", "ok", "result"], additionalProperties: false },
  annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
  _meta: { ui: { visibility: ["app"] }, "openai/widgetAccessible": true },
};
/** Only tool-result _meta carries authorization proof. Text is rendered as data. */
export const ACTION_PANEL_HTML = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{font:15px system-ui;margin:20px;color:CanvasText;background:Canvas}pre{white-space:pre-wrap;overflow-wrap:anywhere}details{margin-bottom:16px}a{display:inline-block;margin-right:20px}a[aria-disabled=true]{pointer-events:none;opacity:.55}</style></head><body><h2 id="title">VNDRLY action</h2><p id="status">Loading the prepared action…</p><pre id="summary"></pre><details><summary>Record details</summary><pre id="details"></pre></details><a id="submit" href="#submit" hidden>Approve and submit</a><a id="check" href="#check" hidden>Check saved result</a><a id="device" hidden target="_blank" rel="noopener noreferrer">Authorize with device location</a><script>(()=>{
const summarize=${actionRecordSummary.toString()};
const savedMessage=${savedActionMessage.toString()};
let panel=null,busy=false,ready=false,sequence=0,renderVersion=0;const pending=new Map();const el=id=>document.getElementById(id);
function request(method,params){return new Promise((resolve,reject)=>{const id=++sequence;const timeout=setTimeout(()=>{pending.delete(id);reject(Error('The outcome is not confirmed. Ask V to check this same action reference before doing anything again.'));},30000);pending.set(id,{resolve,reject,timeout});window.parent.postMessage({jsonrpc:'2.0',id,method,params},'*');});}
function render(result){const value=result?._meta?.componentApproval;if(!value){if(result?.isError)el('status').textContent='This action is unavailable. Ask V to check permissions and the same action reference.';return;}panel=value;renderVersion++;busy=false;ready=false;el('submit').setAttribute('aria-disabled','false');el('title').textContent='VNDRLY: '+String(value.toolName??'prepared action').replaceAll('_',' ');el('summary').textContent=summarize(value.toolName,value.arguments);el('details').textContent=JSON.stringify(value.arguments,null,2);el('status').textContent='Checking the saved action status…';el('submit').hidden=true;el('check').hidden=true;const url=new URL(value.approvalUrl);if(url.origin!=='https://vndrly.ai'||!url.pathname.startsWith('/api/assistant-connection/actions/'))return;el('device').href=url.href;el('device').hidden=true;checkStatus(value,renderVersion);window.parent.postMessage({jsonrpc:'2.0',method:'ui/notifications/size-changed',params:{height:document.documentElement.scrollHeight}},'*');}
async function checkStatus(value,version){ready=false;el('submit').hidden=true;el('device').hidden=true;el('check').hidden=true;try{const result=await request('tools/call',{name:'v_action_status',arguments:{reference:value.reference}});if(version!==renderVersion||panel.reference!==value.reference)return;const status=result.structuredContent;if(result.isError||!status)throw Error('The saved action status is unavailable. Ask V to check this same action reference.');if(status.state==='pending'){ready=true;el('status').textContent=value.requiresLocation?'This action is pending and needs fresh device location.':'This action is pending and ready for approval.';el('submit').hidden=value.requiresLocation||!value.proof;el('device').hidden=!value.requiresLocation;}else{el('check').hidden=!['running','outcome_unknown'].includes(status.state);el('status').textContent=savedMessage(String(status.state),status.result);el('summary').textContent=summarize(value.toolName,status.result??status);el('details').textContent=JSON.stringify(status.result??status,null,2);}}catch(error){if(version===renderVersion){el('status').textContent=error.message;el('check').hidden=false;}}}
window.addEventListener('message',event=>{if(event.source!==window.parent||event.data?.jsonrpc!=='2.0')return;const message=event.data;const waiter=pending.get(message.id);if(waiter){clearTimeout(waiter.timeout);pending.delete(message.id);message.error?waiter.reject(Error('VNDRLY could not confirm this action.')):waiter.resolve(message.result);return;}if(message.method==='ui/notifications/tool-result')render(message.params);});
el('check').onclick=async event=>{event.preventDefault();if(busy||!panel)return;const value=panel,version=renderVersion;busy=true;el('status').textContent='Checking the saved action status…';try{await checkStatus(value,version);}finally{if(version===renderVersion)busy=false;}};
el('submit').onclick=async event=>{event.preventDefault();if(busy||!ready||!panel?.proof||panel.requiresLocation)return;const submitted=panel,version=renderVersion;busy=true;ready=false;el('submit').setAttribute('aria-disabled','true');el('status').textContent='Submitting this authorized change…';try{const result=await request('tools/call',{name:'v_submit_panel_action',arguments:{reference:submitted.reference,proof:submitted.proof}});if(version!==renderVersion||panel.reference!==submitted.reference)return;const outcome=result.structuredContent;if(!outcome)throw Error('The outcome is not confirmed. Ask V to check the same action reference.');el('status').textContent=outcome.status==='completed'?(outcome.ok?savedMessage('completed',outcome.result):'The change was rejected; see the actual result below.'):'Status: '+outcome.status+'. Ask V to check this same action reference.';el('summary').textContent=summarize(submitted.toolName,outcome.result??outcome);el('details').textContent=JSON.stringify(outcome.result??outcome,null,2);el('submit').hidden=true;el('check').hidden=outcome.status==='completed';}catch(error){if(version!==renderVersion)return;el('status').textContent=error.message;el('submit').hidden=true;el('check').hidden=false;}finally{if(version===renderVersion)busy=false;}};
request('ui/initialize',{appInfo:{name:'VNDRLY action',version:'1.0.0'},appCapabilities:{},protocolVersion:'2026-01-26'}).then(()=>window.parent.postMessage({jsonrpc:'2.0',method:'ui/notifications/initialized'},'*')).catch(()=>{el('status').textContent='Open this panel inside your connected assistant.';});})();</script></body></html>`;
