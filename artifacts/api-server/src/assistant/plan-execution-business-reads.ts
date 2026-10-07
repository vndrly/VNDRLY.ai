import { z } from "zod/v4";
import { currentPlanExecutionAuthority } from "./plan-execution-authorization";
import { requireChatGptReadableTool } from "./chatgpt-tool-access";
import { planExecutionFingerprint, planExecutionResultSchema, type PlanExecutionAuthorization, type PlanExecutionStep } from "./plan-execution";
import type { SessionPayload } from "../lib/session";

import { PLAN_EXECUTION_BUSINESS_READ_CANDIDATES } from "./plan-execution-read-policy";
export { PLAN_EXECUTION_BUSINESS_READ_CANDIDATES } from "./plan-execution-read-policy";
const positive = z.number().int().positive();
type Name = keyof typeof PLAN_EXECUTION_BUSINESS_READ_CANDIDATES;
type Dependencies = { authorize: typeof currentPlanExecutionAuthority; execute: (name: Name, args: Record<string, unknown>, session: SessionPayload) => Promise<unknown>; now: () => number };
const object = (value: unknown) => z.record(z.string(), z.unknown()).parse(value);
const id = z.union([positive, z.uuid()]);
const text = z.string().max(200);
const scalar = z.union([text, z.number().finite(), z.boolean(), z.null()]);
function fields(value: unknown, keys: string[]) {
  const source = object(value), output: Record<string, unknown> = {};
  if (keys.includes("id")) id.parse(source.id);
  for (const key of ["name", "title", "status", "invoiceNumber", "shiftId", "shiftTitle", "crewEmployeeId", "userId", "firstName", "lastName"]) if (keys.includes(key)) {
    if (["shiftId"].includes(key)) z.uuid().parse(source[key]);
    else if (["crewEmployeeId", "userId"].includes(key)) positive.parse(source[key]);
    else if (["firstName", "lastName"].includes(key)) text.nullable().parse(source[key]);
    else text.parse(source[key]);
  }
  for (const key of keys) if (source[key] !== undefined) output[key] = key === "id" ? id.parse(source[key]) : scalar.parse(source[key]);
  return output;
}
const rows = (value: unknown) => z.array(z.record(z.string(), z.unknown())).parse(value);
export function createPlanExecutionBusinessReads(overrides: Partial<Dependencies> = {}) {
  const deps: Dependencies = {
    authorize: currentPlanExecutionAuthority, now: Date.now,
    execute: async (name, args, session) => { const { runTool } = await import("../routes/assistant"); return JSON.parse(await runTool(name, args, session, "", false, false)); }, ...overrides,
  };
  return async (authorization: PlanExecutionAuthorization, step: PlanExecutionStep) => {
    if (step.adapter !== "authorized_read" || !Object.hasOwn(PLAN_EXECUTION_BUSINESS_READ_CANDIDATES, step.toolName) || !authorization.steps.some(saved => planExecutionFingerprint(saved) === planExecutionFingerprint(step))) throw Error("Read is not an exact approved business read");
    const name = step.toolName as Name;
    const args = object(PLAN_EXECUTION_BUSINESS_READ_CANDIDATES[name].parse(step.arguments));
    const authority = await deps.authorize(authorization);
    // These legacy aggregates can be global for platform admins. No company-scoped
    // delegation may use that bypass; a dedicated scoped adapter would be needed.
    if (authority.session.role === "admin") throw Error("Business reads require an operational company context");
    requireChatGptReadableTool(authority.session, authority.scopes, name);
    const raw = object(await deps.execute(name, args, authority.session));
    await deps.authorize(authorization);
    if (raw.error || raw.ok === false) throw Error("Canonical business read failed");
    let sourceRows: Record<string, unknown>[] = [], projected: Record<string, unknown>[] = [], limitations: string[] = [];
    let generatedAt: string | null = null, stale = false;
    if (raw.generatedAt !== undefined) { generatedAt = z.iso.datetime().parse(raw.generatedAt); const age = deps.now() - Date.parse(generatedAt); stale = age < -60000 || age > 300000; }
    if (name === "query_invoices") { sourceRows = rows(raw.invoices); projected = sourceRows.map(row => fields(row, ["id", "invoiceNumber", "status", "createdAt", "periodStart", "periodEnd", "dueDate", "total", "paidAmount"])); limitations.push("Invoice records are not payment authorization or money movement. createdAt is record creation time, not verified issue time; latest record within this window does not prove the last issued invoice."); }
    else if (name === "query_ar_aging") { sourceRows = rows(raw.rows); projected = sourceRows.map(row => { positive.parse(authority.session.role === "vendor" ? row.partnerId : row.vendorId); for (const key of ["current", "bucket1_15", "bucket16_30", "bucket31_60", "bucket60_plus", "total"]) z.string().regex(/^-?\d+(?:\.\d+)?$/).parse(row[key]); return fields(row, ["partnerId", "partnerName", "vendorId", "vendorName", "current", "bucket1_15", "bucket16_30", "bucket31_60", "bucket60_plus", "total"]); }); limitations.push("Recorded aging buckets; no payment decision was approved."); }
    else if (name === "query_tickets") { sourceRows = rows(raw.tickets); projected = sourceRows.map(row => fields(row, ["id", "status", "siteLocationId", "createdAt"])); limitations.push("Ticket status does not prove uninvoiced eligibility or accounts-payable approval."); }
    else if (name === "query_gate_stations") { sourceRows = rows(args.siteId ? raw.stations : raw.sites); projected = sourceRows.map(row => fields(row, ["id", "name", "site_id", "supervisor"])); limitations.push("Authorized Gate discovery does not establish worker qualifications or coverage readiness."); }
    else if (name === "query_gate_change_over") { const station = fields(raw.station, ["id", "name", "site_id"]); if (station.id !== args.stationId) throw Error("Gate record differs from approved station"); const shift = raw.shift == null ? null : fields(raw.shift, ["id", "started_at", "ended_at"]); projected = [{ ...station, shift, stale: z.boolean().parse(raw.stale) }]; sourceRows = [object(raw.station)]; stale ||= raw.stale === true; limitations.push("Recorded active shift only; no shift means coverage unknown, not zero demand. Candidate qualification not established."); }
    else if (name === "query_workforce_coverage") { sourceRows = rows(raw.coverage); projected = sourceRows.map(row => fields(row, ["id", "shiftId", "shiftTitle", "startsAt", "endsAt", "requiredCount", "assignedCount", "actualCount", "state", "version"])); limitations.push("Recorded coverage counts are not physical attendance or candidate qualification."); }
    else if (name === "query_ticket_assignment_candidates") { sourceRows = rows(raw.candidates); projected = sourceRows.map(row => fields(row, ["crewEmployeeId", "userId", "firstName", "lastName", "vendorRole"])); limitations.push("Active roster only; ticket and Gate eligibility, qualification and availability remain unverified."); }
    else if (name === "query_hotlist_jobs") { sourceRows = rows(raw.rows); projected = sourceRows.map(row => fields(row, ["id", "title", "status", "deadline"])); limitations.push("Visible marketplace jobs only; service catalog matching and bid eligibility are not established."); }
    else if (name === "query_asset_custody") { sourceRows = rows(raw.assets); projected = sourceRows.map(row => ({ ...fields(row, ["id", "name", "category", "status", "holderUserId", "currentHolderDisplayName", "checkedOutAt", "custodyDays", "expectedReturnAt"]), responsibleCompanyKey: authorization.requester.organizationKey })); limitations.push("Recorded custody age only; assets with unknown custody dates may be omitted. No physical possession proof."); }
    else {
      for (const family of ["tasks", "shifts", "meetings"]) for (const wrapper of rows(raw[family])) {
        const item = object(wrapper.item); const value = family === "meetings" ? { ...fields(item.meeting, ["id", "title"]), ...fields(item.occurrence, ["id", "startsAt", "endsAt", "status"]) } : fields(item, ["id", "title", "startsAt", "endsAt", "dueAt", "status"]);
        sourceRows.push(wrapper); projected.push({ kind: family, ...value });
      }
      limitations.push("Authorized calendar records only; external commitments and real attendance are unknown.");
    }
    const bound = projected.slice(0, 20);
    const summary = JSON.stringify({ tool: name, observedAt: new Date(deps.now()).toISOString(), generatedAt, stale, partial: sourceRows.length >= 20 || raw.nextCursor != null || raw.nextBefore != null, records: bound, missingRecords: sourceRows.length === 0, ...(name === "query_asset_custody" ? { unknownCustodyDatesCount: rows(raw.unknownCustodyDates).length, evaluatedAt: z.iso.datetime().parse(raw.evaluatedAt) } : {}), limitations: [...limitations, "At most 20 records; read observations alone do not complete the business workflow."] });
    return planExecutionResultSchema.parse({ operationId: step.operationId, sourceReferences: [`query:${name}`, ...bound.flatMap(row => row.id !== undefined ? [`record:${name}:${row.id}`] : row.partnerId !== undefined ? [`partner:${positive.parse(row.partnerId)}`] : row.vendorId !== undefined ? [`vendor:${positive.parse(row.vendorId)}`] : row.crewEmployeeId !== undefined ? [`vendor-person:${positive.parse(row.crewEmployeeId)}`] : [])], summary });
  };
}
