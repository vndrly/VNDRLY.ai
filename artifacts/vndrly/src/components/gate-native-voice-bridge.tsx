import { useEffect, useRef, useState } from "react";
import { dismissGateCheckIn } from "@workspace/gate-booth";
import { useQueryClient } from "@tanstack/react-query";
import { confirmGateCheckIn, fillGateCheckIn, gateCheckInBinding, openGateCheckIn, readGateVoiceDraft, subscribeGateVoiceDraft, notifyGateVoiceSaved, cancelGateVoiceDraft, parseGateSetupProgressHint, parseGateWorkflowOffer, type GateVoiceWorkflowResult } from "@workspace/gate-booth";
import { useAuth } from "@/hooks/use-auth";
import { useAskVGateGuidance } from "@/hooks/use-askv-gate-guidance";
import { AskVGateHelperOffer } from "./askv-gate-helper-offer";
import { readAskVPageContext, subscribeAskVPageContext } from "@/lib/askv-page-context";

export function GateNativeVoiceBridge() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const guidance = useAskVGateGuidance();
  const guidanceRef = useRef(guidance); guidanceRef.current = guidance;
  const publishRef = useRef<(() => void) | null>(null);
  const [workflowResult, setWorkflowResult] = useState<GateVoiceWorkflowResult | null>(null);
  useEffect(() => {
    if (!user || !window.location.pathname.startsWith("/gate")) return;
    setWorkflowResult(null);
    const channel = new URLSearchParams(window.location.search).get("gateVoiceChannel");
    const pageId = crypto.randomUUID();
    const publish = (requestId?: string, requestError?: string) => {
      const currentDraft = readGateVoiceDraft();
      const draft = currentDraft ? { ...currentDraft, pagePath: window.location.pathname, pageTitle: document.querySelector("h1")?.textContent?.trim().slice(0, 160) } : {};
      const message = { type: "gate-askv-state", userId: user.userId, channel, pageId, draft, pageContext: readAskVPageContext(window.location.pathname), gateGuidance: guidanceRef.current, requestId, requestError };
      const native = (window as Window & { ReactNativeWebView?: { postMessage: (text: string) => void } }).ReactNativeWebView;
      if (native) native.postMessage(JSON.stringify(message));
      else if (window.parent !== window) window.parent.postMessage(message, "http://localhost:8081");
    };
    const receive = (message: Record<string, unknown>) => {
      if (message?.type !== "gate-askv-command" || message.pageId !== pageId) return;
      if (message.action === "open-check-in" || message.action === "fill-check-in") {
        const binding = gateCheckInBinding(readGateVoiceDraft());
        if (!binding || binding !== message.binding || window.location.pathname !== "/gate") return;
        if (message.action === "open-check-in") openGateCheckIn();
        else if (message.values && typeof message.values === "object") fillGateCheckIn(message.values as Record<string, unknown>);
      } else if (message.action === "confirm-check-in" && typeof message.requestId === "string" && typeof message.reviewKey === "string" && window.location.pathname === "/gate") {
        const requestId = message.requestId;
        void confirmGateCheckIn(message.reviewKey).then(
          () => publish(requestId),
          error => publish(requestId, error instanceof Error ? error.message : "Check-in could not be saved."),
        );
      } else if (message.action === "prefill") {
        if (!readGateVoiceDraft()) return;
        window.dispatchEvent(new CustomEvent("askv:gate-prefill", { detail: message.values }));
        publish(typeof message.requestId === "string" ? message.requestId : undefined);
      } else if (message.action === "dismiss-check-in") {
        dismissGateCheckIn(); publish();
      } else if (message.action === "cancel-check-in") {
        cancelGateVoiceDraft(); publish();
      } else if (message.action === "saved" && message.submitted && typeof message.submitted === "object") {
        notifyGateVoiceSaved(message.submitted as Record<string, unknown>);
        void queryClient.invalidateQueries();
      } else if (message.action === "refresh") void queryClient.invalidateQueries();
      else if (message.action === "workflow-result" && message.result && typeof message.result === "object") {
        const result = message.result as Record<string, unknown>;
        if (typeof result.question !== "string") return;
        setWorkflowResult({ question: result.question.slice(0, 1000), gateSetupProgress: parseGateSetupProgressHint(result.gateSetupProgress), gateWorkflowOffer: parseGateWorkflowOffer(result.gateWorkflowOffer, user.vendorId) });
      }
    };
    const native = (event: Event) => receive((event as CustomEvent).detail);
    const web = (event: MessageEvent) => {
      if (event.source === window.parent && event.origin === "http://localhost:8081") receive(event.data);
    };
    window.addEventListener("gate-askv-command", native);
    window.addEventListener("message", web);
    const unsubscribe = subscribeGateVoiceDraft(() => publish());
    const unsubscribePage = subscribeAskVPageContext(() => publish());
    publishRef.current = publish;
    publish();
    return () => { publishRef.current = null; unsubscribe(); unsubscribePage(); window.removeEventListener("gate-askv-command", native); window.removeEventListener("message", web); };
  }, [user?.userId, user?.vendorId, user?.partnerId, user?.activeMembershipId, queryClient]);
  useEffect(() => { publishRef.current?.(); }, [JSON.stringify(guidance ?? null)]);
  return workflowResult ? <AskVGateHelperOffer question={workflowResult.question} workflowOffer={workflowResult.gateWorkflowOffer} setupProgress={workflowResult.gateSetupProgress} onStarted={() => setWorkflowResult(null)} /> : null;
}

