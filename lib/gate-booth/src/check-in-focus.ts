type Context = { path?: string; gateDraft?: unknown };
const draftOf = (context: Context): Record<string, unknown> => context.gateDraft && typeof context.gateDraft === "object" ? context.gateDraft as Record<string, unknown> : {};
const CHECK_IN_FIELDS = ["firstName", "lastName", "company", "vehiclePlate", "plateState", "purpose", "notes", "expectedDurationMinutes", "siteLocationId", "gateStationId", "hostType", "hostPartnerId", "hostVendorId", "entryCategory", "phone", "email", "platePhotoUrl", "vehiclePhotoUrl", "destinationId", "destinationGateId", "latitude", "longitude"];

export function gateCheckInFocusAvailable(context: Context): boolean {
  return /^\/(?:mobile\/)?gate\/?(?:\?|$)/.test(context.path ?? "") && draftOf(context).voiceMode === "check-in";
}

/** Conversation hints only. No requests, timers, microphone prerequisites or business writes. */
export function createGateCheckInFocus() {
  let scope = "", phase = "collect", readbackGiven = false, addMoreAsked = false, hadVisitor = false;
  function sync(context: Context) {
    const draft = draftOf(context), next = JSON.stringify([context.path, draft.siteLocationId, draft.gateStationId]);
    if (next !== scope) { scope = next; phase = "collect"; readbackGiven = false; addMoreAsked = false; }
    const hasVisitor = ["firstName", "lastName", "vehiclePlate"].some(key => Boolean(draft[key]));
    if (hadVisitor && !hasVisitor && phase !== "cancelled") { phase = "collect"; readbackGiven = false; addMoreAsked = false; }
    hadVisitor = hasVisitor;
    return gateCheckInFocusAvailable(context);
  }
  return {
    observe(context: Context, role: "user" | "assistant", text: string): { cancelled: boolean; changed: boolean } {
      if (!sync(context)) return { cancelled: false, changed: false };
      const before = JSON.stringify([phase, readbackGiven, addMoreAsked]);
      const value = text.trim().replace(/’/g, "'");
      let cancelled = false;
      if (role === "user") {
        if (/^(?:(?:uh|okay|please)[, ]+)*(?:cancel(?:\s+(?:that|this|the|it))?(?:\s+(?:check[ -]?in|entry|draft))?|never\s?mind|cancela(?:\s+(?:esta|esa|la))?(?:\s+(?:entrada|registro|borrador))?)[.!]?$/i.test(value)) { phase = "cancelled"; cancelled = true; }
        else if (/\b(?:next (?:truck|vehicle|visitor)|new check[ -]?in)\b/i.test(value)) { phase = "collect"; readbackGiven = false; addMoreAsked = false; }
        else if (phase === "add_more") phase = /^(?:yes|yeah|yep|si|sí)[.!]?$/i.test(value) ? "more_details" : "confirm";
        else if (phase === "more_details") phase = "confirm";
        else if (phase === "confirm" && /^(?:yes|yeah|yep|confirmed|confirm|i confirm|that's right|correct|si|sí|confirmo)[.!]?$/i.test(value)) phase = "submit";
        else if (phase === "confirm" && /^(?:no|nope)[.!]?$/i.test(value)) { phase = "cancelled"; cancelled = true; }
        else if (phase === "cancelled" && /\b(?:check[ -]?in|checking in|name|plate|company)\b/i.test(value)) { phase = "collect"; readbackGiven = false; addMoreAsked = false; }
      } else {
        if (/\b(?:add more|anything (?:else|more)|algo más|agregar más)\s*\?/i.test(value)) { readbackGiven = true; addMoreAsked = true; phase = "add_more"; }
        else if (/\b(?:confirm|confirmar|confirmas)\s*\?/i.test(value)) phase = "confirm";
      }
      return { cancelled, changed: before !== JSON.stringify([phase, readbackGiven, addMoreAsked]) };
    },
    input(context: Context, name: string, args: Record<string, unknown>): Record<string, unknown> {
      if (!sync(context) || !["resolve_gate_check_in", "prepare_visitor_check_in", "confirm_visitor_check_in"].includes(name)) return args;
      const draft = draftOf(context), result = { ...args };
      for (const key of CHECK_IN_FIELDS) if ((result[key] == null || result[key] === "") && draft[key] != null && draft[key] !== "") result[key] = draft[key];
      return result;
    },
    instructions(context: Context): string {
      if (!sync(context)) return "";
      return `\nGATE CHECK-IN FOCUS MODE. For a visitor check-in on this screen, this overrides the general spoken check-in style.
Allowed spoken turns: one brief missing/unclear-field question; ONE short readback ending "Add more?"; "What else?" if the operator asks to add details; "Confirm?"; and the actual result "Checked in." or "Cancelled." Do not speak a preparation acknowledgment, describe a tool call, or announce that you will fill, resolve, review or stage anything. Perform those steps silently and proceed directly to the next allowed turn.
Use the selected site/gate and the live form, including OCR-populated plate/state and manual edits. Do not ask the operator to repeat values already present. Other questions and check-outs remain normal conversation.
Fill the visible form immediately as details arrive using the existing check-in tools. Use the selected IDs directly; resolve only a genuinely missing or ambiguous match. Do tools silently: no greetings, explanations, running commentary, lists, or promises to fill/stage.
Ask one brief question only for a missing or unclear name, plate/state, or company. If the operator explicitly says there is none or it is unavailable, preserve the existing entry policy rather than repeatedly asking. Do not solicit purpose, duration, notes, photos or other optional fields.
Once the details are ready, silently stage the exact current draft with confirm_visitor_check_in BEFORE the readback. Give ONE short line with name, company, plate/state and selected gate, then ask exactly "Add more?" (Spanish: "¿Algo más?"). No invented or default details in the readback.
After the operator declines more details, ask ONLY "Confirm?" (Spanish: "¿Confirmar?"). No summary again. A yes to "Add more?" requests details; it is never permission to submit. If details are added, update the form and silently restage the changed draft before "Confirm?" without repeating the full readback. Clarify an ambiguous/corrected name, plate or company briefly when necessary.
After the answer to "Confirm?", submit the staged exact draft with the existing confirmation tool. Never ask a second approval. Only a successful saved result permits the brief completion reply "Checked in." Wait for the next vehicle.
"Cancel that check-in" cancels the CURRENT UNSUBMITTED DRAFT, never searches for or checks out an existing visit. The app clears that draft; reply only "Cancelled." Do not invoke visitor lookup or checkout tools for draft cancellation.
Current Focus conversation: ${JSON.stringify({ phase, readbackGiven, addMoreAsked })}. Respect this state: when readbackGiven is true, do not repeat it; when phase is confirm after the Add-more answer, only ask Confirm after silently staging any changed fields.`;
    },
    staged(context: Context, result: Record<string, any>): Record<string, any> {
      if (!sync(context) || !result.requiresConfirmation) return result;
      return { ...result, message: readbackGiven
        ? "Current draft staged. Do not repeat the readback. Ask only Confirm? when additional details are finished. Nothing has been submitted."
        : "Current draft staged. Give one short readback and ask Add more? Then ask only Confirm? after additional details are finished. Nothing has been submitted." };
    },
    completed() { phase = "collect"; readbackGiven = false; addMoreAsked = false; },
  };
}
