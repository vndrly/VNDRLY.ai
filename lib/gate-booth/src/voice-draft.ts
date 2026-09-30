export type GateVoiceDraft = Record<string, unknown>;
type GateVoiceForm = { read: () => GateVoiceDraft; saved: (submitted: GateVoiceDraft) => void };
let activeForm: GateVoiceForm | null = null;
const listeners = new Set<() => void>();
export function notifyGateVoiceDraftChanged(): void { for (const listener of listeners) listener(); }
export function subscribeGateVoiceDraft(listener: () => void): () => void { listeners.add(listener); return () => { listeners.delete(listener); }; }

/** The mounted gate screen owns the draft; AskV reads current manual edits on each call. */
export function registerGateVoiceForm(form: GateVoiceForm): () => void {
  activeForm = form;
  notifyGateVoiceDraftChanged();
  return () => { if (activeForm === form) { activeForm = null; notifyGateVoiceDraftChanged(); } };
}
export function readGateVoiceDraft(): GateVoiceDraft | undefined { return activeForm?.read(); }
export function notifyGateVoiceSaved(submitted: GateVoiceDraft): void { activeForm?.saved(submitted); }
export function gateDraftMatches(left: GateVoiceDraft, right: GateVoiceDraft): boolean {
  return ["firstName", "lastName", "company", "vehiclePlate", "siteLocationId"].every(key =>
    String(left[key] ?? "").trim().toLocaleLowerCase() === String(right[key] ?? "").trim().toLocaleLowerCase());
}
