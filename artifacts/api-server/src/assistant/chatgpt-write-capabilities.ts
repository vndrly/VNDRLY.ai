import { TICKET_RECORD_ACTIONS } from "./ticket-workflow-tools";

/** Separate write consent never follows from a read grant. */
export const CHATGPT_WRITE_CAPABILITIES = {
  "finance:write": { label: "Prepare recording an already-made ticket payment with current Accounts Payable authority", tools: ["record_ticket_payment"] },
  "workforce:write": { label: "Prepare authorized shift assignments, acknowledgements, and coverage evaluation or escalation", tools: ["confirm_workforce_coverage_action"] },
  "trips:write": { label: "Prepare authorized trip start, pause, completion, or one approval-device location update", tools: ["confirm_field_trips_action"] },
  "safety:write": { label: "Prepare authorized incident response, acknowledgement, evidence, escalation, and closure", tools: ["confirm_incident_response_action"] },
  "subscriptions:write": { label: "Prepare vendor administrator worker subscription creation, pause, termination, or reactivation", tools: ["confirm_worker_subscriptions_action"] },
  "assets:write": { label: "Prepare authorized asset creation, checkout, return, transfer, condition, and hold changes", tools: ["confirm_asset_custody_action"] },
  "invitations:write": { label: "Prepare vendor administrator account invitation creation, resends, and revocation", tools: ["confirm_account_invitations_action"] },
  "onboarding:write": { label: "Prepare your onboarding field changes and completion for authenticated approval", tools: ["start_onboarding", "set_onboarding_field", "complete_onboarding_step", "finalize_onboarding"] },
  "tickets:write": { label: "Prepare authorized ticket creation, edits, assignments, line items, lifecycle changes, and role-appropriate review", tools: ["manage_ticket_record", "schedule_ticket_crew", "set_ticket_flag", "post_ticket_comment", "set_ticket_lifecycle", "close_ticket_for_review"] },
  "operations:write": { label: "Prepare changes to your notification read status", tools: ["mark_notifications_read"] },
} as const;
export type ChatGptWriteCapabilityScope = keyof typeof CHATGPT_WRITE_CAPABILITIES;

/** Device telemetry and domain replay keys are supplied by the approval server. */
export function sanitizeChatGptActionInput(name: string, input: Record<string, unknown>): Record<string, unknown> {
  if (name === "manage_ticket_record") {
    const payload = input.payload && typeof input.payload === "object" && !Array.isArray(input.payload) ? input.payload as Record<string, unknown> : {};
    const serverFields = new Set(["latitude", "longitude", "checkInLatitude", "checkInLongitude", "accuracyMeters", "recordedAt", "operationId", "confirmed", "idempotencyKey", "locationSharingActive"]);
    return { ...input, payload: { ...Object.fromEntries(Object.entries(payload).filter(([key]) => !serverFields.has(key))), ...(input.action === "create" ? { initialState: "pending_arrival" } : {}) } };
  }
  if (!/^confirm_(field_trips|workforce_coverage|worker_subscriptions|incident_response|account_invitations)_action$/.test(name)) return input;
  const payload = input.payload && typeof input.payload === "object" && !Array.isArray(input.payload) ? input.payload as Record<string, unknown> : {};
  const fields = new Set(["operationId", "confirmed", ...(name === "confirm_field_trips_action" ? ["latitude", "longitude", "accuracyMeters", "recordedAt", "speedMps"] : [])]);
  return { ...input, payload: Object.fromEntries(Object.entries(payload).filter(([key]) => !fields.has(key))) };
}

/** Legal acceptance and credential changes use the dedicated VNDRLY screens.
 * Model-supplied acceptance flags never stand in for the person's action.
 */
export function validateChatGptActionInput(name: string, input: Record<string, unknown>): void {
  const allowed: Record<string, readonly string[]> = {
    manage_ticket_record: TICKET_RECORD_ACTIONS,
    confirm_workforce_coverage_action: ["assign", "acknowledge", "evaluate", "escalate"],
    confirm_field_trips_action: ["start", "location", "pause", "complete"],
    confirm_incident_response_action: ["create", "escalate", "acknowledge", "evidence", "hold", "close"],
    confirm_worker_subscriptions_action: ["create", "pause", "terminate", "reactivate"],
    confirm_account_invitations_action: ["create", "resend", "revoke"],
  };
  if (allowed[name] && !allowed[name].includes(String(input.action))) throw new Error("Unsupported VNDRLY action");
  if (name === "complete_onboarding_step" && input.step === "set-password") throw new Error("Complete password setup on the VNDRLY credential screen");
  if (name !== "set_onboarding_field") return;
  const path = input.path;
  if (typeof path !== "string" || !path || path.split(".").some(part =>
    !part || ["__proto__", "prototype", "constructor"].includes(part) ||
    /password|secret|token|credential/i.test(part))) throw new Error("Invalid onboarding field");
  if (["platformEula", "legalConsent"].includes(path.split(".")[0])) {
    throw new Error("Complete legal and messaging consent on the VNDRLY onboarding screen");
  }
  const value = input.value;
  const primitive = (item: unknown) => typeof item === "string" || typeof item === "boolean" || (typeof item === "number" && Number.isFinite(item));
  if (!primitive(value) && !(Array.isArray(value) && value.every(primitive))) throw new Error("Supply one exact onboarding field value");
}

/** Audit the changed field, without copying private onboarding values into logs. */
export function chatGptActionAuditInput(name: string, input: Record<string, unknown>): Record<string, unknown> {
  if (name === "confirm_incident_response_action") return { action: input.action, resourceId: input.resourceId ?? input.eventId, payload: "[redacted]" };
  return name === "set_onboarding_field" ? { path: input.path, value: "[redacted]" } : input;
}
export function chatGptActionResult(name: string, output: unknown): unknown {
  if (name === "confirm_incident_response_action" && output && typeof output === "object" && !Array.isArray(output)) {
    const record = output as Record<string, unknown>;
    return Object.fromEntries(["ok", "error", "code", "status", "id", "eventId", "responseId", "persisted", "responseStatus", "severity", "acknowledgedAt", "closedAt"].filter(key => key in record).map(key => [key, record[key]]));
  }
  if (name === "confirm_field_trips_action" && output && typeof output === "object" && !Array.isArray(output)) return { ...output, trackingCollectorStarted: false };
  if (name === "finalize_onboarding" && output && typeof output === "object" && !Array.isArray(output)) {
    const record = output as Record<string, unknown>;
    let response: unknown;
    try { response = typeof record.response === "string" ? JSON.parse(record.response) : record.response ?? record.progress; } catch { response = null; }
    const progress = response && typeof response === "object" && !Array.isArray(response) ? response as Record<string, unknown> : {};
    return { ...Object.fromEntries(["ok", "error", "code"].filter(key => key in record).map(key => [key, record[key]])),
      progress: Object.fromEntries(["orgType", "currentStep", "completedSteps", "skippedSteps", "completedAt"].filter(key => key in progress).map(key => [key, progress[key]])) };
  }
  if (name !== "set_onboarding_field" || !output || typeof output !== "object" || Array.isArray(output)) return output;
  const { value: _value, ...result } = output as Record<string, unknown>;
  return result;
}
