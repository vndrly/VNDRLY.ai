export type GateVoiceDraft = Record<string, unknown>;
export type GateVoiceForm = { read: () => GateVoiceDraft; saved: (submitted: GateVoiceDraft) => void; fill?: (values: GateVoiceDraft) => void; cancel?: () => void; open?: () => void; dismissCheckIn?: () => void; fillCheckIn?: (values: GateVoiceDraft) => void; confirmCheckIn?: (reviewKey: string) => Promise<void> };
let pageForm: GateVoiceForm | null = null;
let watchForm: GateVoiceForm | null = null;
// Off the Gate page the operator's own watch supplies the form; while it is in place it stands in for the page's.
const activeForm = () => watchForm ?? pageForm;
const listeners = new Set<() => void>();
export function notifyGateVoiceDraftChanged(): void { for (const listener of listeners) listener(); }
export function subscribeGateVoiceDraft(listener: () => void): () => void { listeners.add(listener); return () => { listeners.delete(listener); }; }

/** The mounted gate screen owns the draft; AskV reads current manual edits on each call. */
export function registerGateVoiceForm(form: GateVoiceForm): () => void {
  pageForm = form;
  notifyGateVoiceDraftChanged();
  return () => { if (pageForm === form) { pageForm = null; notifyGateVoiceDraftChanged(); } };
}
/** The form of an operator who is away from the Gate page. Whoever registers it removes it on arriving there. */
export function registerWatchGateForm(form: GateVoiceForm): () => void {
  watchForm = form;
  notifyGateVoiceDraftChanged();
  return () => { if (watchForm === form) { watchForm = null; notifyGateVoiceDraftChanged(); } };
}
export function readGateVoiceDraft(): GateVoiceDraft | undefined { return activeForm()?.read(); }
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
export function notifyGateVoiceSaved(submitted: GateVoiceDraft): void { activeForm()?.saved(submitted); }
export function fillGateVoiceDraft(values: GateVoiceDraft): void { activeForm()?.fill?.(values); }
export function openGateCheckIn(): void { activeForm()?.open?.(); }
export function dismissGateCheckIn(): void { activeForm()?.dismissCheckIn?.(); }
export function fillGateCheckIn(values: GateVoiceDraft): void { const form = activeForm(); (form?.fillCheckIn ?? form?.fill)?.(values); }
export async function confirmGateCheckIn(reviewKey: string): Promise<void> {
  const form = activeForm();
  if (!form?.confirmCheckIn) throw new Error("Open the current Gate form before confirming.");
  await form.confirmCheckIn(reviewKey);
}
export function cancelGateVoiceDraft(): void { activeForm()?.cancel?.(); }
export function gateDraftMatches(left: GateVoiceDraft, right: GateVoiceDraft): boolean {
  return ["firstName", "lastName", "company", "vehiclePlate", "siteLocationId"].every(key =>
    String(left[key] ?? "").trim().toLocaleLowerCase() === String(right[key] ?? "").trim().toLocaleLowerCase());
}
