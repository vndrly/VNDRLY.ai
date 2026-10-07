import { z } from "zod/v4";
import type { SessionPayload } from "../lib/session";
import { chatGptActionTools } from "./chatgpt-tool-access";
import { callNaturalVoiceDomainApi } from "./natural-voice-write-tools";
import { normalizeRecurrenceRule } from "../work-hub/domain-rules";

const defaults: Record<string, unknown> = { open: false, assigneeUserIds: [], qualificationCodes: [], calendarType: "company", milestoneStatus: "upcoming", percentComplete: 0, sharedWithUserIds: [] };
const nullable = ["projectName", "instructions", "dependencyTitle", "blockers", "ownerUserId", "afeCode", "ticketNumber", "budgetAmount", "budgetUsedAmount", "invoicedAmount", "invoiceReference", "siteLocationId", "gateStationId", "requiredStaffCount", "workStartPolicy"];
const allowed = new Set(["title", "startsAt", "endsAt", "timezone", "recurrence", ...Object.keys(defaults), ...nullable]);
const monetary = new Set(["budgetAmount", "budgetUsedAmount", "invoicedAmount"]);
const ids = new Set(["assigneeUserIds", "sharedWithUserIds"]);
const stable = (value: unknown): string => JSON.stringify(value, (_key, item) => item && typeof item === "object" && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);

/** Recover the exact actor's immutable shift.create operation, never execute creation again. */
export async function recoverWorkHubShiftCreationAction(
  action: { toolName: string; tokenHash: string; arguments: Record<string, unknown> },
  session: SessionPayload, scopes: string[], request = callNaturalVoiceDomainApi,
) {
  if (action.arguments.action !== "create" || !/^[a-f0-9]{64}$/.test(action.tokenHash)
    || !(action.toolName === "manage_work_hub_shift" || (action.toolName === "manage_work_hub_calendar_item" && action.arguments.kind === "shift"))
    || !chatGptActionTools(session, scopes).some(tool => tool.name === action.toolName)) return null;
  try {
    const args = action.arguments;
    const owner = z.object({ type: z.enum(["vendor", "partner"]), id: z.number().int().positive() }).strict().parse(args.owner);
    if (owner.id !== (owner.type === "vendor" ? session.vendorId : session.partnerId)) return null;
    if (args.expectedVersion !== undefined && args.expectedVersion !== null) return null;
    const payload = z.record(z.string(), z.unknown()).parse(args.payload);
    if (Object.keys(payload).some(key => !allowed.has(key))) return null;
    const expected: Record<string, unknown> = { ...defaults, ...Object.fromEntries(nullable.map(key => [key, null])), ...payload };
    expected.title = z.string().trim().min(1).max(200).parse(payload.title);
    z.iso.datetime().parse(payload.startsAt); z.iso.datetime().parse(payload.endsAt);
    z.string().min(3).max(80).parse(payload.timezone);
    expected.recurrence = payload.recurrence ? normalizeRecurrenceRule(payload.recurrence as never) : null;
    for (const [key, value] of Object.entries(expected)) {
      if (nullable.includes(key) && value == null) expected[key] = null;
      if (nullable.includes(key) && typeof value === "string" && !monetary.has(key)) expected[key] = value.trim();
      if (ids.has(key)) expected[key] = [...new Set(z.array(z.number().int().positive()).parse(value))].sort((a, b) => a - b);
    }
    const hex = action.tokenHash.slice(0, 32);
    const operationId = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
    const result = z.object({ receipt: z.object({ operationId: z.uuid(), appliedAt: z.iso.datetime(), replayed: z.literal(true), resource: z.record(z.string(), z.unknown()) }).nullable() }).strict().parse(await request(`/work-hub/shifts/operations/${operationId}`, "GET", {}, session));
    const receipt = result.receipt;
    if (!receipt || receipt.operationId !== operationId) return null;
    const saved = receipt.resource;
    z.uuid().parse(saved.id);
    if (saved.createdById !== session.userId || saved.ownerOrgType !== owner.type || saved.ownerOrgId !== owner.id) return null;
    for (const [key, value] of Object.entries(expected)) {
      let actual = saved[key];
      if (ids.has(key)) actual = [...new Set(z.array(z.number().int().positive()).parse(actual))].sort((a, b) => a - b);
      if (key === "startsAt" || key === "endsAt") { if (typeof actual !== "string" || Date.parse(actual) !== Date.parse(String(value))) return null; }
      else if (monetary.has(key) && value !== null) { if (typeof actual !== "string" || !Number.isFinite(Number(actual)) || Number(actual) !== value) return null; }
      else if (stable(actual) !== stable(value)) return null;
    }
    return receipt;
  } catch { return null; }
}
