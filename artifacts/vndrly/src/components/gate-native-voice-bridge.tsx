import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { readGateVoiceDraft, subscribeGateVoiceDraft, notifyGateVoiceSaved } from "@workspace/gate-booth";
import { useAuth } from "@/hooks/use-auth";

export function GateNativeVoiceBridge() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!user || !window.location.pathname.startsWith("/gate")) return;
    const channel = new URLSearchParams(window.location.search).get("gateVoiceChannel");
    const pageId = crypto.randomUUID();
    const publish = (requestId?: string) => {
      const draft = readGateVoiceDraft() ?? {};
      const message = { type: "gate-askv-state", userId: user.userId, channel, pageId, draft, requestId };
      const native = (window as Window & { ReactNativeWebView?: { postMessage: (text: string) => void } }).ReactNativeWebView;
      if (native) native.postMessage(JSON.stringify(message));
      else if (window.parent !== window) window.parent.postMessage(message, "http://localhost:8081");
    };
    const receive = (message: Record<string, unknown>) => {
      if (message?.type !== "gate-askv-command" || message.pageId !== pageId) return;
      if (message.action === "prefill") {
        if (!readGateVoiceDraft()) return;
        window.dispatchEvent(new CustomEvent("askv:gate-prefill", { detail: message.values }));
        publish(typeof message.requestId === "string" ? message.requestId : undefined);
      } else if (message.action === "saved" && message.submitted && typeof message.submitted === "object") {
        notifyGateVoiceSaved(message.submitted as Record<string, unknown>);
        void queryClient.invalidateQueries();
      } else if (message.action === "refresh") void queryClient.invalidateQueries();
    };
    const native = (event: Event) => receive((event as CustomEvent).detail);
    const web = (event: MessageEvent) => {
      if (event.source === window.parent && event.origin === "http://localhost:8081") receive(event.data);
    };
    window.addEventListener("gate-askv-command", native);
    window.addEventListener("message", web);
    const unsubscribe = subscribeGateVoiceDraft(() => publish());
    publish();
    return () => { unsubscribe(); window.removeEventListener("gate-askv-command", native); window.removeEventListener("message", web); };
  }, [user?.userId, queryClient]);
  return null;
}

