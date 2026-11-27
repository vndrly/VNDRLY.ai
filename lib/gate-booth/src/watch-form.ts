import { notifyGateVoiceDraftChanged, registerWatchGateForm, type GateVoiceDraft } from "./voice-draft";
import { gateCheckInReview, gateCheckOutQuery, gateVoiceTrigger } from "./silent-check-in";
import { CHECK_OUT_PROMPT, GATE_VOICE_DECLINED, decideGateVoiceReply } from "./voice-reply";

type WatchGateApi = {
  /** Calls the VNDRLY API as the signed-in operator and returns its JSON; rejects with the server's own message. */
  request: (method: "GET" | "POST", path: string, body?: unknown) => Promise<any>;
  /** The device's position now, or null when it cannot be had. */
  position: () => Promise<{ latitude: number; longitude: number } | null>;
  /** Applies a spoken plate and state to the ones already entered, as the Gate form does. */
  plate: (update: { currentPlate: string; currentState: string | null; automatedPlate: string | undefined; automatedState: string | undefined }) => { vehiclePlate: string | null; plateState: string | null };
};
type Watch = { stationId: string; siteId: number; gateName: string; siteName: string };
type Visitor = { id: number; firstName: string; lastName: string; company: string; plateState: string; vehiclePlate: string };
const blank = () => ({ firstName: "", lastName: "", company: "", vehiclePlate: "", plateState: null as string | null, notes: "", destinationName: "" });
const reason = (error: unknown, fallback: string) => error instanceof Error && error.message ? error.message : fallback;
const fullName = (visitor: Visitor) => `${visitor.firstName} ${visitor.lastName}`.trim();

/**
 * Check-in and check-out for an operator who is not on the Gate page. The entry is held in memory and
 * saved against the gate where they hold the watch; the server still decides whether they may record there.
 * Photos stay on the Gate page.
 */
export function createWatchGateForm(api: WatchGateApi) {
  let watch: Watch | null = null, release: (() => void) | undefined;
  let entry = blank(), entering = false, revision = 0, saving = false, checkout: Visitor | null = null, working = false;
  const clear = () => { entry = blank(); entering = false; checkout = null; revision++; };
  const read = (): GateVoiceDraft => ({
    watchForm: true, siteLocationId: watch?.siteId, gateStationId: watch?.stationId, siteName: watch?.siteName, gateStationName: watch?.gateName,
    entryRevision: revision, silentCheckIn: entering, ...entry, destinationNeedsReview: Boolean(entry.destinationName),
    ...(checkout ? { checkoutReview: checkout } : {}),
  });
  const fill = (values: GateVoiceDraft) => {
    if (saving) return;
    const text = (key: string) => typeof values[key] === "string" ? (values[key] as string).trim() : "";
    const plate = api.plate({ currentPlate: entry.vehiclePlate, currentState: entry.plateState, automatedPlate: text("vehiclePlate") || undefined, automatedState: text("plateState") || undefined });
    entry = { ...entry, vehiclePlate: plate.vehiclePlate ?? "", plateState: plate.plateState };
    for (const key of ["firstName", "lastName", "company"] as const) if (text(key)) entry[key] = text(key);
    if (text("destination")) entry.destinationName = text("destination").slice(0, 120);
    const note = text("note");
    if (note && !entry.notes.split("\n").includes(note)) entry.notes = [entry.notes, note].filter(Boolean).join("\n");
    entering = true;
    notifyGateVoiceDraftChanged();
  };
  const confirmCheckIn = async (reviewKey: string) => {
    const gate = watch;
    if (!gate || gateCheckInReview(read())?.key !== reviewKey) throw new Error("The check-in changed. Review it before confirming.");
    if (saving) throw new Error("A check-in is already saving.");
    saving = true;
    try {
      const position = await api.position().catch(() => null);
      const notes = [entry.notes, entry.destinationName && "Destination stated: " + entry.destinationName].filter(Boolean).join("\n");
      await api.request("POST", "/visits/gate/check-in", {
        firstName: entry.firstName, lastName: entry.lastName, company: entry.company || undefined, vehiclePlate: entry.vehiclePlate, plateState: entry.plateState ?? undefined,
        notes: notes || undefined, expectedDurationMinutes: 240, siteLocationId: gate.siteId, gateStationId: gate.stationId, ...position,
      });
      clear();
      notifyGateVoiceDraftChanged();
    } finally { saving = false; }
  };
  const findCheckOut = async (query: string, gate: Watch): Promise<Visitor[]> => {
    const rows = await api.request("GET", `/visits?activeOnly=true&limit=1000&siteLocationId=${gate.siteId}`);
    const needle = query.toLowerCase();
    return (Array.isArray(rows) ? rows : []).filter(row => [row.firstName, row.lastName, `${row.firstName} ${row.lastName}`, row.company, row.vehiclePlate]
      .some(value => String(value ?? "").toLowerCase().includes(needle))).slice(0, 8)
      .map(row => ({ id: row.id, firstName: row.firstName ?? "", lastName: row.lastName ?? "", company: row.company ?? "", plateState: row.plateState ?? "", vehiclePlate: row.vehiclePlate ?? "" }));
  };
  const confirmCheckOut = async (visitor: Visitor, gate: Watch) => {
    const position = await api.position().catch(() => null);
    const saved = await api.request("POST", `/visits/gate/${visitor.id}/check-out`, { gateStationId: gate.stationId, ...position });
    // An inner gate records a departure from its area, which is not a check-out from the property.
    if (!saved?.checkOutTime) throw new Error("Check-out from the property is not confirmed. Review this visit on the Gate page.");
  };
  /** Takes the form away and drops whatever was not saved: on arriving at the Gate page, or when V stops. */
  const close = () => {
    if (!release) return;
    watch = null; clear();
    release(); release = undefined;
  };
  return {
    close,
    /** Reads the operator's watch and puts its form in place. False when they hold no single watch. */
    async open(): Promise<boolean> {
      const gate = (await api.request("GET", "/gate-change-over/operating-context"))?.operatingGate as Watch | null | undefined;
      if (!gate?.stationId) { close(); return false; }
      if (watch?.stationId !== gate.stationId) clear();
      watch = gate;
      if (release) notifyGateVoiceDraftChanged();
      else release = registerWatchGateForm({ read, saved: () => undefined, fill, fillCheckIn: fill, confirmCheckIn,
        open: () => { entering = true; checkout = null; notifyGateVoiceDraftChanged(); },
        dismissCheckIn: () => { entering = false; notifyGateVoiceDraftChanged(); },
        cancel: () => { clear(); notifyGateVoiceDraftChanged(); } });
      return true;
    },
    /** A spoken or typed turn that belongs to check-out at the operator's watch. False when it is not one. */
    hearCheckOut(text: string, voice: { say: (text: string) => void; fail: (message: string) => void }): boolean {
      const gate = watch;
      if (!gate || !release) return false;
      const trigger = gateVoiceTrigger(text), waiting = checkout;
      if (!trigger && waiting) {
        const decision = decideGateVoiceReply(text, "check_out");
        if (decision === "repeat") voice.say(CHECK_OUT_PROMPT);
        else if (decision !== "submit") { checkout = null; notifyGateVoiceDraftChanged(); voice.say(GATE_VOICE_DECLINED); }
        else if (!working) {
          working = true;
          void confirmCheckOut(waiting, gate).then(() => {
            if (checkout === waiting) { checkout = null; notifyGateVoiceDraftChanged(); }
            voice.say(fullName(waiting) + " is checked out.");
          }, error => voice.fail(reason(error, "Check-out could not be saved."))).finally(() => { working = false; });
        }
        return true;
      }
      if (trigger !== "out") return false;
      const query = gateCheckOutQuery(text);
      if (!query) { voice.say("Say check out, then the name or tag."); return true; }
      if (working) return true;
      working = true;
      void findCheckOut(query, gate).then(matches => {
        if (watch?.stationId !== gate.stationId) return;
        if (matches.length !== 1) { voice.say(matches.length ? "More than one match. Say check out with the full name or tag." : "No matching visitor found."); return; }
        checkout = matches[0]; entering = false;
        notifyGateVoiceDraftChanged();
        voice.say(fullName(matches[0]) + ". " + CHECK_OUT_PROMPT);
      }, error => voice.fail(reason(error, "Check-out could not be looked up."))).finally(() => { working = false; });
      return true;
    },
  };
}
