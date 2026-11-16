import { useEffect } from "react";
import { useNextSteps } from "./next-steps";

export const nativeGateHeader = new URLSearchParams(window.location.search).get("gateNativeHeader") === "1";

/** Keep guidance in the page that owns its targets, not in a tiny header WebView. */
export function GateNativeHeaderBridge() {
  const state = useNextSteps();
  useEffect(() => {
    if (!state) return;
    const toggle = () => { if (state.open) state.close(); else state.show(); };
    const receive = (event: MessageEvent) => {
      if (event.source === window.parent && event.origin === "http://localhost:8081" && event.data?.type === "gate-next-steps-toggle") toggle();
    };
    window.addEventListener("gate-next-steps-toggle", toggle);
    window.addEventListener("message", receive);
    const message = { type: "gate-next-steps-state", enabled: state.enabled, count: state.count, open: state.open, pending: state.isPending, error: state.isError };
    const native = (window as Window & { ReactNativeWebView?: { postMessage: (value: string) => void } }).ReactNativeWebView;
    if (native) native.postMessage(JSON.stringify(message));
    else if (window.parent !== window) window.parent.postMessage(message, "http://localhost:8081");
    return () => {
      window.removeEventListener("gate-next-steps-toggle", toggle);
      window.removeEventListener("message", receive);
    };
  }, [state]);
  return null;
}
