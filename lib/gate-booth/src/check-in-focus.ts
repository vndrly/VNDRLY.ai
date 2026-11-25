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
      return `\nGATE CHECK-IN. The form owns spoken visitor check-in. It collects first name, last name, tag, issuing state, and company without an assistant reply. The operator submits on the form. Never ask for check-in fields, read them back, request confirmation, or invoke a visitor check-in tool for a spoken check-in on this screen.
Current Focus conversation: ${JSON.stringify({ phase })}.`;
    },
    staged(_context: Context, result: Record<string, any>): Record<string, any> {
      // Tool approval belongs to that exact operation. A visible check-in form
      // must never turn checkout (or another tool's) approval into check-in advice.
      return result;
    },
    completed() { phase = "collect"; },
  };
}
