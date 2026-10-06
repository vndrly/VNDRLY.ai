/** Separate write consent never follows from a read grant. */
export const CHATGPT_WRITE_CAPABILITIES = {
  "assets:write": { label: "Prepare authorized asset creation, checkout, return, transfer, condition, and hold changes", tools: ["confirm_asset_custody_action"] },
  "invitations:write": { label: "Prepare vendor administrator account invitation creation, resends, and revocation", tools: ["confirm_account_invitations_action"] },
  "onboarding:write": { label: "Prepare your onboarding field changes and completion for authenticated approval", tools: ["start_onboarding", "set_onboarding_field", "complete_onboarding_step", "finalize_onboarding"] },
  "tickets:write": { label: "Prepare authorized ticket assignments, flags, comments, lifecycle changes, and review submission", tools: ["schedule_ticket_crew", "set_ticket_flag", "post_ticket_comment", "set_ticket_lifecycle", "close_ticket_for_review"] },
  "operations:write": { label: "Prepare changes to your notification read status", tools: ["mark_notifications_read"] },
} as const;
export type ChatGptWriteCapabilityScope = keyof typeof CHATGPT_WRITE_CAPABILITIES;

/** Legal acceptance and credential changes use the dedicated VNDRLY screens.
 * Model-supplied acceptance flags never stand in for the person's action.
 */
export function validateChatGptActionInput(name: string, input: Record<string, unknown>): void {
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
  return name === "set_onboarding_field" ? { path: input.path, value: "[redacted]" } : input;
}
export function chatGptActionResult(name: string, output: unknown): unknown {
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
