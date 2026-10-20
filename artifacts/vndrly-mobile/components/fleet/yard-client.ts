import { FleetCapabilitySchema, type FleetCapability } from "@workspace/api-zod";
import { apiFetch } from "@/lib/api";
import { getApiErrorCode } from "@/lib/apiErrors";
import { isAuthScopeCurrent } from "@/lib/auth";

export type FleetYardActor = {
  companyId: number;
  userId: number;
  membershipId: number;
  sessionVersion: number;
  capabilities: FleetCapability[];
};

export async function readFleetYardActor(identity: { companyId: number; userId: number; membershipId: number }, authScope: ReturnType<typeof import("@/lib/auth").captureAuthScope>): Promise<FleetYardActor> {
  const [overview, grant] = await Promise.all([
    apiFetch<{ accountScope?: { companyId: number; userId: number; membershipId: number; sessionVersion: number } }>("/api/fleet/overview", {}, authScope),
    apiFetch<{ companyId: number; userId: number; capabilities: unknown }>("/api/fleet/capabilities", {}, authScope),
  ]);
  if (!isAuthScopeCurrent(authScope) || !overview.accountScope ||
    overview.accountScope.companyId !== identity.companyId || overview.accountScope.userId !== identity.userId ||
    overview.accountScope.membershipId !== identity.membershipId || grant.companyId !== identity.companyId || grant.userId !== identity.userId)
    throw Error("Fleet account changed. Refresh this workspace.");
  return { ...overview.accountScope, capabilities: FleetCapabilitySchema.array().parse(grant.capabilities) };
}

export function yardScope(actor: FleetYardActor) {
  return { owner: { type: "vendor" as const, id: actor.companyId }, userId: actor.userId, membershipId: actor.membershipId, sessionVersion: actor.sessionVersion };
}

type FeedbackForm = "asset" | "custody" | "yard";

const fleetErrorCopy: Record<string, string> = {
  "fleet.permission_denied": "You do not have permission for this Fleet action.",
  "fleet.asset_not_found": "This asset is no longer available in your Fleet group.",
  "fleet.detail_not_found": "The selected Detail is no longer available.",
  "fleet.detail_attachment_required": "Review the current Detail and rigging before attaching this asset.",
  "fleet.yard_not_found": "The selected Yard is no longer available.",
  "fleet.yard_order_not_found": "This Yard Order is no longer available.",
  "fleet.run_not_found": "The selected Run is no longer available.",
  "fleet.version_conflict": "This Fleet record changed. Refresh and review before reapplying.",
  "fleet.yard_order_transition_conflict": "This Yard Order changed. Refresh and review before reapplying.",
  "fleet.operation_conflict": "The saved operation does not match this request. Review before retrying.",
};

function validationMessage(issues: unknown, form: FeedbackForm, copy: (value: string) => string): string {
  const paths = Array.isArray(issues) ? issues.map(issue => Array.isArray(issue?.path) ? issue.path.join(".") : "") : [];
  if (form === "asset") {
    const missingName = paths.includes("name"), missingOwner = paths.includes("legalOwner"), missingTag = paths.some(path => path.startsWith("identifier"));
    if (missingName && missingOwner && missingTag) return copy("Enter the asset name, legal owner, and tag.");
    const messages = [missingName && "Enter an asset name.", missingOwner && "Enter the legal owner.", missingTag && "Enter an asset tag."].filter((item): item is string => !!item);
    return messages.length ? messages.map(copy).join(" ") : copy("Review the asset intake fields before saving.");
  }
  if (form === "custody" && paths.includes("observation.notes")) return copy("Keep the custody reason within 2,000 characters.");
  return copy(form === "custody" ? "Review the custody fields before recording." : "Review the Yard request fields before saving.");
}

/** Fleet endpoints return stable codes without prose; never display HTTP text or Zod JSON. */
export function yardFeedback(cause: unknown, copy: (value: string) => string, fallback: string, form: FeedbackForm): string {
  const error = cause && typeof cause === "object" ? cause as { message?: string; status?: number; issues?: unknown; data?: { details?: unknown } } : null;
  const code = getApiErrorCode(cause);
  if (code === "fleet.invalid_request" || Array.isArray(error?.issues)) return validationMessage(error?.issues ?? error?.data?.details, form, copy);
  if (code && fleetErrorCopy[code]) return copy(fleetErrorCopy[code]);
  if (code || (error?.message && /^HTTP \d+$/.test(error.message))) return copy(fallback);
  return copy(error?.message || fallback);
}
