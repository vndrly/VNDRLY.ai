type Context = { path?: string; gateDraft?: unknown };
const draftOf = (context: Context): Record<string, unknown> => context.gateDraft && typeof context.gateDraft === "object" ? context.gateDraft as Record<string, unknown> : {};
const CHECK_IN_FIELDS = ["firstName", "lastName", "company", "vehiclePlate", "plateState", "purpose", "notes", "expectedDurationMinutes", "siteLocationId", "gateStationId", "hostType", "hostPartnerId", "hostVendorId", "entryCategory", "phone", "email", "platePhotoUrl", "vehiclePhotoUrl", "gateCapture", "destinationId", "destinationGateId", "latitude", "longitude"];

export function gateCheckInFocusAvailable(context: Context): boolean {
  return /^\/(?:mobile\/)?gate\/?(?:\?|$)/.test(context.path ?? "") && draftOf(context).voiceMode === "check-in";
}

/** Conversation hints only. No requests, timers, microphone prerequisites or business writes. */
export function createGateCheckInFocus() {
  let scope = "", phase = "collect", hadVisitor = false;
  function sync(context: Context) {
    const draft = draftOf(context), next = JSON.stringify([context.path, draft.siteLocationId, draft.gateStationId]);
    if (next !== scope) { scope = next; phase = "collect"; }
    const hasVisitor = ["firstName", "lastName", "vehiclePlate"].some(key => Boolean(draft[key]));
    if (hadVisitor && !hasVisitor && phase !== "cancelled") { phase = "collect"; }
    hadVisitor = hasVisitor;
    return gateCheckInFocusAvailable(context);
  }
  return {
    observe(context: Context, role: "user" | "assistant", text: string): { cancelled: boolean; changed: boolean } {
      if (!sync(context)) return { cancelled: false, changed: false };
      const before = phase;
      const value = text.trim().replace(/’/g, "'");
      let cancelled = false;
      if (role === "user") {
        if (/^(?:(?:uh|okay|please)[, ]+)*(?:cancel(?:\s+(?:that|this|the|it))?(?:\s+(?:check[ -]?in|entry|draft))?|never\s?mind|cancela(?:\s+(?:esta|esa|la))?(?:\s+(?:entrada|registro|borrador))?)[.!]?$/i.test(value)) { phase = "cancelled"; cancelled = true; }
        else if (/\b(?:next (?:truck|vehicle|visitor)|new check[ -]?in)\b/i.test(value)) { phase = "collect"; }
        else if (phase === "cancelled" && /\b(?:check[ -]?in|checking in|name|plate|company)\b/i.test(value)) { phase = "collect"; }
      }
      return { cancelled, changed: before !== phase };
    },
    input(context: Context, name: string, args: Record<string, unknown>): Record<string, unknown> {
      if (!sync(context) || !["resolve_gate_check_in", "prepare_visitor_check_in", "confirm_visitor_check_in"].includes(name)) return args;
      const draft = draftOf(context), result = { ...args };
      for (const key of CHECK_IN_FIELDS) if ((name === "confirm_visitor_check_in" || result[key] == null || result[key] === "") && draft[key] != null && draft[key] !== "") result[key] = draft[key];
      return result;
    },
    instructions(context: Context): string {
      if (!sync(context)) return "";
      return `\nGATE CHECK-IN FOCUS MODE. For a visitor check-in on this screen, this overrides the general spoken check-in style.
Use the live check-in form as the current draft, including photo recognition and manual edits. Enter focus immediately whenever this form is active. Keep dialogue minimal and do not greet or narrate tool calls.
Fill the visible form silently as details arrive. Use the selected site and gate directly; resolve only a missing or ambiguous target. Ask one short question only for information required to save. Never ask for information already in the form or solicit optional fields.
The operator reviews the current details in the top panel. Do not require a spoken readback, Add more?, Confirm?, or a button click. Wait quietly when the form is ready.
One explicit spoken submit, such as "submit" or "check him in", authorizes saving the current form. Immediately call confirm_visitor_check_in with its exact current contents. Do not stage a separate approval round or ask for a second confirmation. A photo or field edit alone never authorizes submission. A question, negation, or correction is not authorization to save old details.
Inspect the actual tool result. Say only "Checked in." after a successful save; otherwise briefly state the missing field or actual failure. Do not claim success while a tool is pending. Wait for the next vehicle.
"Cancel that check-in" cancels the CURRENT UNSUBMITTED DRAFT, never searches for or checks out an existing visit. The app clears that draft; reply only "Cancelled." Do not invoke visitor lookup or checkout tools for draft cancellation.
Current Focus conversation: ${JSON.stringify({ phase })}.`;
    },
    staged(context: Context, result: Record<string, any>): Record<string, any> {
      if (!sync(context) || !result.requiresConfirmation) return result;
      return { ...result, message: "Not submitted. Use the current form and wait for one explicit spoken submit. Do not ask Add more or require a confirmation button." };
    },
    completed() { phase = "collect"; },
  };
}
