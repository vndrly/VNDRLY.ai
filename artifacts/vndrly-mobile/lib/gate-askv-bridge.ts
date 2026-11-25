import { gateCheckInBinding, registerGateVoiceForm, notifyGateVoiceDraftChanged, parseAskVGateGuidance, registerGateVoiceGuidance, notifyGateVoiceGuidanceChanged, subscribeGateVoiceWorkflowResult, type AskVGateGuidance } from "@workspace/gate-booth";
import { subscribeAskVGatePrefill, subscribeAskVDataChanged } from "./askv-client-tools";
import { parseVoicePageContext, registerVoicePageContext, notifyVoicePageContextChanged, type VoicePageContext } from "@workspace/gate-booth";
type GateVoiceDraft = Record<string, unknown>;

/** Only the authenticated, mounted Gate page may supply native AskV's draft. */
export function createGateAskVBridge(userId: number, send: (message: Record<string, unknown>) => void) {
  let pageId: string | null = null;
  let draft: GateVoiceDraft = {};
  let unregister: (() => void) | undefined;
  let guidance: AskVGateGuidance | undefined;
  let unregisterGuidance: (() => void) | undefined;
  let pageContext: VoicePageContext | undefined, unregisterPage: (() => void) | undefined;
  let sequence = 0;
  const pending = new Map<string, { resolve: () => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  const clear = () => {
    pageId = null; draft = {}; guidance = undefined; unregister?.(); unregister = undefined; unregisterGuidance?.(); unregisterGuidance = undefined;
    pageContext = undefined; unregisterPage?.(); unregisterPage = undefined;
    for (const item of pending.values()) { clearTimeout(item.timer); item.reject(new Error("Gate page changed. Review the current gate before continuing.")); }
    pending.clear();
  };
  const request = (command: Record<string, unknown>, timeout: number, timeoutMessage: string) => {
    if (!pageId) throw new Error("Open Gate and wait for the current form before preparing a crossing.");
    const requestId = `${pageId}:${++sequence}`;
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(requestId); reject(new Error(timeoutMessage)); }, timeout);
      pending.set(requestId, { resolve, reject, timer });
      send({ ...command, type: "gate-askv-command", pageId, requestId });
    });
  };
  const prefill = subscribeAskVGatePrefill(values => request({ action: "prefill", values }, 5000, "Gate form did not acknowledge the draft. Nothing was submitted."));
  const refresh = subscribeAskVDataChanged(() => { if (pageId) send({ type: "gate-askv-command", pageId, action: "refresh" }); });
  const workflow = subscribeGateVoiceWorkflowResult(result => { if (pageId) send({ type: "gate-askv-command", pageId, action: "workflow-result", result }); });
  return {
    receive(message: Record<string, unknown>) {
      if (!message || message.type !== "gate-askv-state" || message.userId !== userId || typeof message.pageId !== "string" ||
        !message.draft || typeof message.draft !== "object" || Array.isArray(message.draft)) return;
      if (pageId !== message.pageId) { clear(); pageId = message.pageId; }
      const nextPage = parseVoicePageContext(message.pageContext), pageChanged = JSON.stringify(nextPage) !== JSON.stringify(pageContext);
      pageContext = nextPage;
      if (!unregisterPage) unregisterPage = registerVoicePageContext(() => pageContext);
      else if (pageChanged) notifyVoicePageContextChanged();
      const nextGuidance = parseAskVGateGuidance(message.gateGuidance);
      const guidanceChanged = JSON.stringify(guidance) !== JSON.stringify(nextGuidance);
      guidance = nextGuidance;
      if (!unregisterGuidance) unregisterGuidance = registerGateVoiceGuidance(() => guidance);
      else if (guidanceChanged) notifyGateVoiceGuidanceChanged();
      const next = message.draft as GateVoiceDraft;
      const changed = JSON.stringify(draft) !== JSON.stringify(next);
      draft = next;
      if (!Object.keys(draft).length) { unregister?.(); unregister = undefined; }
      else if (!unregister) unregister = registerGateVoiceForm({ read: () => draft, saved: submitted => {
        if (pageId) send({ type: "gate-askv-command", pageId, action: "saved", submitted });
      }, fill: values => {
        if (pageId) send({ type: "gate-askv-command", pageId, action: "prefill", values: { mode: "check-in", values, missing: ["firstName", "lastName"].filter(key => !values[key]) } });
      }, open: () => {
        if (pageId) send({ type: "gate-askv-command", pageId, action: "open-check-in", binding: gateCheckInBinding(draft) });
      }, dismissCheckIn: () => {
        draft = { ...draft, silentCheckIn: false };
        notifyGateVoiceDraftChanged();
        if (pageId) send({ type: "gate-askv-command", pageId, action: "dismiss-check-in" });
      }, fillCheckIn: values => {
        if (pageId) send({ type: "gate-askv-command", pageId, action: "fill-check-in", binding: gateCheckInBinding(draft), values });
      }, confirmCheckIn: reviewKey => request({ action: "confirm-check-in", reviewKey }, 45_000, "Check-in status is unknown. Check the Gate log before trying again."),
      cancel: () => { if (pageId) send({ type: "gate-askv-command", pageId, action: "cancel-check-in" }); } });
      else if (changed) notifyGateVoiceDraftChanged();
      const item = typeof message.requestId === "string" ? pending.get(message.requestId) : undefined;
      if (item) {
        clearTimeout(item.timer); pending.delete(message.requestId as string);
        if (typeof message.requestError === "string") item.reject(new Error(message.requestError));
        else item.resolve();
      }
    },
    clear,
    dispose() { clear(); prefill(); refresh(); workflow(); },
  };
}
