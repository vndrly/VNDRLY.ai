import { z } from "zod/v4";
import { createHash } from "node:crypto";
import type { Anthropic } from "@workspace/integrations-anthropic-ai/sdk";
import type { WorkHubToolRequest } from "./work-hub-tool-runtime";
import { parseGateReportFilters } from "../services/gate-report-filters";

const schema = (properties: Record<string, unknown>, required: string[] = []): Anthropic.Tool["input_schema"] => ({ type: "object", properties, required, additionalProperties: false });
export const GATE_READ_TOOL_NAMES = new Set(["query_my_last_gate_shift", "query_operating_gate", "query_map_equipment", "query_gate_log"]);
const requestProperties = {
  workerUserId: { type: "integer", minimum: 1 }, vendorId: { type: "integer", minimum: 1 },
  siteId: { type: "integer", minimum: 1 }, ticketId: { type: "integer", minimum: 1 },
  purpose: { type: "string", minLength: 1, maxLength: 500 },
  idempotencyKey: { type: "string", format: "uuid", description: "Retain this exact request key across retries; inspect the saved result before creating another request." },
};
export const NATIVE_OPERATIONS_TOOL_ENTRIES: Array<{ tool: Anthropic.Tool; family: "command"; mutating: boolean }> = [
  { family: "command", mutating: false, tool: { name: "query_my_last_gate_shift", description: "Answer how many crossings were on MY LAST SHIFT directly. Requires NO selected site, Gate, page or arguments. Reads the signed-in user's newest saved completed Gate handoff, derives its actual Gate/start/end, rechecks current company/site permissions, and counts that window using the same Gate Log data. Never substitutes the current shift or 24-hour totals. Crossings are entry/exit events, not unique people; truncated counts are lower bounds. This is a read and never opens a page.", input_schema: schema({}) } },
  { family: "command", mutating: false, tool: { name: "query_operating_gate", description: "Read the signed-in worker's actual current operating Gate and station using the app's existing operating context. Use from any page for notes or shift questions when no current Gate was supplied. This read never assumes a watch or changes the selected page. A browsing selection is not proof of watch responsibility.", input_schema: schema({}) } },
  { family: "command", mutating: false, tool: { name: "query_map_equipment", description: "Read the current company's authorized equipment using the same source as Reveal Equipment. Use recorded locations only when profile.trackOnMap is true; preserve current versus last_known freshness, missing GPS and retired status. This read never starts tracking or changes custody.", input_schema: schema({}) } },
  { family: "command", mutating: false, tool: { name: "query_gate_log", description: "Answer Gate traffic questions directly using the same authorized records as Gate Log, without opening a page. Supply the exact site/gate and requested time window; timestamps require a timezone. Returns one page, total matching records and window crossing counts. For how-many questions pass from/to (or a day-length range with recordType all) and answer from crossings.checkIns/checkOuts; total also includes people who entered before the window and are still on site. Crossings are entry/exit events, not unique people. Use page to continue. Use query_shift_notes for the caller's actual last completed shift and its recorded start/end bounds first. Open Gate Log only when the user also wants to see it.", input_schema: schema({ siteId: { type: "integer", minimum: 1 }, stationId: { type: "string", format: "uuid" }, from: { type: "string", format: "date-time" }, to: { type: "string", format: "date-time" }, range: { type: "string", enum: ["current_shift", "previous_shift", "24h", "7d", "14d", "30d", "90d", "1y", "custom"] }, recordType: { type: "string", enum: ["all", "check_ins", "check_outs", "on_site", "visitors_on_site", "employees_on_site", "vehicles_on_site", "pending", "needs_review"] }, search: { type: "string", maxLength: 200 }, page: { type: "integer", minimum: 1, maximum: 1000 } }, ["siteId"]) } },
  { family:"command",mutating:false,tool:{name:"query_company_operations",description:"Read the active vendor's saved Field/Fleet/Gate categories and whether the current member can manage them. Categories control navigation; employee permissions still independently apply.",input_schema:schema({})}},
  { family:"command",mutating:true,tool:{name:"set_company_operations",description:"Set the active vendor's operations categories after explicit administrator confirmation. Read query_company_operations first, show the exact complete replacement selection, and preserve other categories unless removal was requested. Fleet selection enables its company module but never grants employee Fleet access. Canonical readback required.",input_schema:schema({categories:{type:"array",minItems:1,uniqueItems:true,items:{type:"string",enum:["field","fleet","gate"]}}},["categories"])}},
  { family: "command", mutating: false, tool: { name: "query_gate_coverage_map", description: "Read authorized Gate map coverage and on-duty staff for the active company, optionally at a historical timestamp. Preserve unavailable or stale GPS, shifts and incident states. No location collection, approval, acknowledgement or resolution is performed; reading is not action on an escalation.", input_schema: schema({ at: {type:"string",format:"date-time"} }) } },
  { family: "command", mutating: true, tool: { name: "set_my_shift_status", description: "Start or end the signed-in user's own work shift in their active vendor company. Use start for Start Shift / clock in; end for End Shift / clock out. Read query_native_work_status first. Require one authenticated confirmation, especially before ending a shift. This updates the same persistent server status as the mobile Shift pill across devices; it does not create a scheduled shift or assume a Gate station. Never change phone designation, location consent or another worker's shift. Read canonical status afterward before claiming success.", input_schema: schema({ action: { type: "string", enum: ["start", "end"] } }, ["action"]) } },
  { family: "command", mutating: true, tool: { name: "set_my_on_call_status", description: "Set the signed-in user's own On Call or Off Call status in their active vendor company, independently of their shift. Read query_native_work_status first and require authenticated confirmation of this availability change. active true means On Call; false means Off Call. Never change location-sharing consent or designate a phone. Read canonical status afterward before claiming success.", input_schema: schema({ active: { type: "boolean" } }, ["active"]) } },
  { family: "command", mutating: false, tool: { name: "query_native_work_status", description: "Read your current company native-work policy, own duty/consent and designated phone, permitted worker targets, and request states. Only enabled company modules and current authority apply. This read does not start duty or tracking, change consent, capture media, or wake a phone.", input_schema: schema({}) } },
  { family: "command", mutating: false, tool: { name: "query_native_device_requests", description: "Read authorized saved device request status and canonical results. Supply requestId to read one exact request; otherwise list permitted requests. Pending, delivered, upload-in-progress and expired are not saved photos. Last-known location is not fresh location.", input_schema: schema({ requestId: { type: "string", format: "uuid" } }) } },
  { family: "command", mutating: true, tool: { name: "request_native_location", description: "Request a fresh observation from the worker's designated work phone for an explicit work purpose after authenticated approval. Server rechecks company/site supervisor grants, active duty and saved worker consent. Five-minute per-worker limit; offline/unreachable is unavailable, not queued. No model coordinates or off-duty tracking. Read the same canonical request for its actual result.", input_schema: schema(requestProperties, ["workerUserId", "vendorId", "purpose", "idempotencyKey"]) } },
  { family: "command", mutating: true, tool: { name: "request_native_ticket_photo", description: "Request worker-reviewed photo evidence on an exact authorized ticket after authenticated approval. Worker explicitly opens camera, reviews and saves; request/delivery/upload is not attachment completion. Offline requests queue until shift end or eight hours. New camera photo is default; allowLibrary explicitly permits existing photo. Reuse request key and inspect canonical saved result.", input_schema: schema({ ...requestProperties, allowLibrary: { type: "boolean", default: false } }, ["workerUserId", "vendorId", "ticketId", "purpose", "idempotencyKey"]) } },
];

const id = z.number().int().positive();
const request = z.object({ workerUserId: id, vendorId: id, siteId: id.optional(), ticketId: id.optional(), purpose: z.string().trim().min(1).max(500), idempotencyKey: z.uuid(), allowLibrary: z.boolean().optional() }).strict();
export function nativeOperationsToolRequest(name: string, raw: unknown, mutationAuthorizedByServer = false): WorkHubToolRequest | null {
  if (!NATIVE_OPERATIONS_TOOL_ENTRIES.some(entry => entry.tool.name === name)) return null;
  try {
    if (name === "query_my_last_gate_shift") { z.object({}).strict().parse(raw); return { method: "GET", path: "/gate-change-over/my-last-shift", body: {} }; }
    if (name === "query_operating_gate") { z.object({}).strict().parse(raw); return { method: "GET", path: "/gate-change-over/operating-context", body: {} }; }
    if (name === "query_map_equipment") { z.object({}).strict().parse(raw); return { method: "GET", path: "/equipment", body: {} }; }
    if (name === "query_gate_log") {
      const value = z.object({ siteId: id, stationId: z.uuid().optional(), from: z.string().max(80).optional(), to: z.string().max(80).optional(), range: z.string().optional(), recordType: z.string().optional(), search: z.string().max(200).optional(), page: z.number().int().min(1).max(1000).default(1) }).strict().parse(raw);
      const { page, ...fields } = value;
      const filters = parseGateReportFilters({ ...fields, range: fields.from != null || fields.to != null ? "custom" : fields.range ?? "current_shift", recordType: fields.recordType ?? "all" });
      return { method: "POST", path: "/gate-report/query", body: { reportKind: "history", filters, page } };
    }
    if(name === "query_company_operations") {z.object({}).strict().parse(raw);return {method:"GET",path:"/company-operations",body:{}};}
    if(name === "set_company_operations") {if(!mutationAuthorizedByServer)return {error:"Confirm the complete company category selection first.",requiresConfirmation:true};const {confirmed:_c,voiceSessionId:_v,idempotencyKey:_i,operationId:_op,...fields}=raw as Record<string,unknown>;const value=z.object({categories:z.array(z.enum(["field","fleet","gate"])).min(1).max(3).refine(values=>new Set(values).size===values.length)}).strict().parse(fields);return {method:"PATCH",path:"/company-operations",body:value};}
    if (name === "query_gate_coverage_map") { const value=z.object({at:z.string().datetime().optional()}).strict().parse(raw);return {method:"GET",path:"/gate-change-over/coverage-map"+(value.at?"?at="+encodeURIComponent(value.at):""),body:{}}; }
    if (name === "query_native_work_status") {
      z.object({}).strict().parse(raw);
      return { method: "GET", path: "/native-operations/status", body: {} };
    }
    if (name === "query_native_device_requests") {
      const value = z.object({ requestId: z.uuid().optional() }).strict().parse(raw);
      return { method: "GET", path: value.requestId ? `/native-operations/requests/${value.requestId}` : "/native-operations/requests", body: {} };
    }
    if (name === "set_my_shift_status" || name === "set_my_on_call_status") {
      if (!mutationAuthorizedByServer) return { error: "Confirm your own shift or on-call change first.", requiresConfirmation: true };
      const { confirmed: _confirmed, voiceSessionId: _session, idempotencyKey: _key, operationId: _operationId, ...fields } = raw as Record<string, unknown>;
      if (name === "set_my_shift_status") {
        const value = z.object({ action: z.enum(["start", "end"]) }).strict().parse(fields);
        return { method: "POST", path: "/native-operations/duty", body: { action: value.action, mode: "manual" } };
      }
      const value = z.object({ active: z.boolean() }).strict().parse(fields);
      return { method: "PUT", path: "/native-operations/on-call", body: { active: value.active, consent: true } };
    }
    let canonicalInput = raw;
    if (mutationAuthorizedByServer && raw && typeof raw === "object" && !Array.isArray(raw)) {
      const { confirmed: _confirmation, voiceSessionId: _session, idempotencyKey, ...fields } = raw as Record<string, unknown>;
      if (typeof idempotencyKey !== "string" || !idempotencyKey.trim()) return { error: "Server-bound operation identity is required." };
      // Typed AskV/ChatGPT inject their own durable execution keys, which are not
      // necessarily UUIDs. Translate that trusted identity without letting model
      // confirmation or session markers enter the canonical native request schema.
      const hash = createHash("sha256").update(`native-work-request:${idempotencyKey}`).digest("hex");
      const key = z.uuid().safeParse(idempotencyKey).success ? idempotencyKey : `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
      canonicalInput = { ...fields, idempotencyKey: key };
    }
    const value = request.parse(canonicalInput);
    if (name === "request_native_ticket_photo" && !value.ticketId) return { error: "Read and select the exact authorized ticket first." };
    if (name === "request_native_location" && value.allowLibrary !== undefined) return { error: "Photo-library settings cannot be supplied for location requests." };
    return { method: "POST", path: "/native-operations/requests", body: { ...value, kind: name === "request_native_location" ? "location" : "photo" } };
  } catch {
    return { error: "Supply the exact authorized worker, company, ticket where required, purpose and original request key. Device measurements and permission claims are not accepted." };
  }
}
