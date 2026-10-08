import { z } from "zod/v4";
import type { SessionPayload } from "../lib/session";
import { createWorkHubAccess, requireWorkHubCapability } from "../work-hub/context-access";

const selectionSchema = z.object({ connectionId: z.uuid(), scope: z.enum(["company", "personal"]), personalPermission: z.boolean().default(false), savePersonalContentToCompany: z.boolean().default(false) }).strict();
export type VConnectionSelection = z.infer<typeof selectionSchema>;
export type VConnectionMetadata = { id: string; ownerOrgType: string; ownerOrgId: number; provider: string; capabilities: string[]; status: string; revokedAt: Date | null; createdById: number };
export function parseVConnectionSelection(value: unknown): VConnectionSelection | null { return value == null ? null : selectionSchema.parse(value); }

/** Match actual Work Hub grants, not a model's connection name or a ChatGPT app claim.
 * Personal connection rows use the existing table's user owner namespace and are
 * never inferred from a company credential or from the company's administrator.
 */
export function authorizeVConnection(session: SessionPayload, row: VConnectionMetadata, selection: VConnectionSelection | null, capability: string) {
  if (!session.userId || !selection || selection.connectionId !== row.id || row.status !== "connected" || row.revokedAt) throw Error("Selected V connection unavailable");
  if (!row.capabilities.includes(capability)) throw Error("Selected V connection scope unavailable");
  if (selection.scope === "personal") {
    if (row.ownerOrgType !== "user" || row.ownerOrgId !== session.userId || row.createdById !== session.userId) throw Error("Personal V connection belongs to another account");
    if (!selection.personalPermission) throw Error("Worker personal connection permission required for this task");
  } else {
    const owned = row.ownerOrgType === "vendor" && row.ownerOrgId === session.vendorId || row.ownerOrgType === "partner" && row.ownerOrgId === session.partnerId;
    if (!owned) throw Error("Company V connection unavailable in current organization");
    // Existing company connector authority: membership alone does not expose all
    // externally connected company calendars/content to every employee.
    const owner = { type: row.ownerOrgType as "vendor" | "partner", id: row.ownerOrgId };
    requireWorkHubCapability(createWorkHubAccess({ session: { ...session, userId: session.userId }, owner, context: { kind: "organization", id: owner.id }, participant: false }), "connector.manage");
  }
  return { connectionId: row.id, provider: row.provider, scope: selection.scope, capability,
    personalContentMayBeSavedToCompany: selection.scope === "personal" && selection.personalPermission && selection.savePersonalContentToCompany,
  };
}

export const SELECTED_EXTERNAL_CALENDAR_TOOL = {
  name: "read_selected_external_calendar",
  description: "Read a bounded window from the explicitly selected, currently authorized external calendar connection for this task. Does not connect an account, change a calendar, inherit ChatGPT apps or save personal content to company records.",
  input_schema: { type: "object" as const, properties: { start: { type: "string", format: "date-time" }, end: { type: "string", format: "date-time" } }, required: ["start", "end"], additionalProperties: false },
};
export const vExternalCalendarWindowSchema = z.object({ start: z.iso.datetime(), end: z.iso.datetime() }).strict().refine(value => Date.parse(value.end) > Date.parse(value.start) && Date.parse(value.end) - Date.parse(value.start) <= 31 * 86400000, "Select a positive calendar window up to 31 days");
