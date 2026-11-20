export type GateVoiceDraft = Record<string, unknown>;
type GateVoiceForm = { read: () => GateVoiceDraft; saved: (submitted: GateVoiceDraft) => void; fill?: (values: GateVoiceDraft) => void; cancel?: () => void; open?: () => void; fillCheckIn?: (values: GateVoiceDraft) => void };
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
/** Photo recognition can finish before evidence storage. One spoken submit waits
 * quietly for that evidence instead of dropping it or requesting another click. */
export async function waitForGateCapture(): Promise<void> {
  const current = readGateVoiceDraft();
  const initial = current ? { ...current } : undefined;
  if (!initial?.capturePending) {
    if (initial?.captureError) throw new Error(String(initial.captureError));
    return;
  }
  await new Promise<void>((resolve, reject) => {
    const check = () => {
      const draft = readGateVoiceDraft();
      if (!draft || draft.siteLocationId !== initial.siteLocationId || draft.gateStationId !== initial.gateStationId || draft.captureId !== initial.captureId) {
        finish(new Error("The check-in changed while its photo was saving."));
      } else if (!draft.capturePending) finish(draft.captureError ? new Error(String(draft.captureError)) : undefined);
    };
    // React replaces the form registration during a render. Inspect after its
    // cleanup/setup pair, not during the transient unregistered state.
    const unsubscribe = subscribeGateVoiceDraft(() => queueMicrotask(check));
    const timeout = setTimeout(() => finish(new Error("Photo is still saving. Please try submit again.")), 30_000);
    function finish(error?: Error) { unsubscribe(); clearTimeout(timeout); error ? reject(error) : resolve(); }
    check();
  });
}
export function notifyGateVoiceSaved(submitted: GateVoiceDraft): void { activeForm?.saved(submitted); }
export function fillGateVoiceDraft(values: GateVoiceDraft): void { activeForm?.fill?.(values); }
export function openGateCheckIn(): void { activeForm?.open?.(); }
export function fillGateCheckIn(values: GateVoiceDraft): void { (activeForm?.fillCheckIn ?? activeForm?.fill)?.(values); }
export function cancelGateVoiceDraft(): void { activeForm?.cancel?.(); }
export function gateDraftMatches(left: GateVoiceDraft, right: GateVoiceDraft): boolean {
  return ["firstName", "lastName", "company", "vehiclePlate", "siteLocationId"].every(key =>
    String(left[key] ?? "").trim().toLocaleLowerCase() === String(right[key] ?? "").trim().toLocaleLowerCase());
}
