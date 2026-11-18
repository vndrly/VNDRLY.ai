type Navigate = (to: string, options?: { replace?: boolean }) => void;

const INDEX_KEY = "__vndrlyNavigationIndex";
const INSTALL_KEY = "__vndrlyNavigationTrackingInstalled";

type TrackedWindow = Window & { [INSTALL_KEY]?: boolean };

function stateWithIndex(state: unknown, index: number) {
  const value = state && typeof state === "object" ? state : {};
  return { ...value, [INDEX_KEY]: index };
}

function currentIndex() {
  const value = window.history.state?.[INDEX_KEY];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function hasPreviousSameOriginPage() {
  if (window.history.length < 2 || !document.referrer) return false;
  try {
    const previous = new URL(document.referrer);
    return previous.origin === window.location.origin && previous.href !== window.location.href;
  } catch { return false; }
}

/** Mark entries created inside VNDRLY so Back never leaves a deep-linked user outside the app. */
export function installInAppNavigationTracking() {
  if (typeof window === "undefined") return;
  const trackedWindow = window as TrackedWindow;
  if (trackedWindow[INSTALL_KEY]) return;
  trackedWindow[INSTALL_KEY] = true;

  const history = window.history;
  const nativePushState = history.pushState.bind(history);
  const nativeReplaceState = history.replaceState.bind(history);
  if (typeof history.state?.[INDEX_KEY] !== "number") {
    // Real anchors may reload the document rather than use pushState. The
    // referrer identifies that same-origin predecessor without trusting a tab's
    // total history length, which may otherwise point outside VNDRLY.
    nativeReplaceState(stateWithIndex(history.state, hasPreviousSameOriginPage() ? 1 : 0), "", window.location.href);
  }
  history.pushState = (state, unused, url) => {
    if (url == null || new URL(url, window.location.href).href === window.location.href) {
      nativeReplaceState(stateWithIndex(state, currentIndex()), unused, url);
      return;
    }
    nativePushState(stateWithIndex(state, currentIndex() + 1), unused, url);
  };
  history.replaceState = (state, unused, url) => {
    nativeReplaceState(stateWithIndex(state, currentIndex()), unused, url);
  };
}

export function canNavigateBackInApp() {
  return typeof window !== "undefined" && currentIndex() > 0;
}

/** Back only returns through real history; legacy destination arguments never replace it. */
export function navigateBackInApp(_navigate: Navigate, _fallbackHref: string) {
  const params = new URLSearchParams(window.location.search);
  const channel = params.get("gateVoiceChannel");
  if (params.get("gateDashboardEmbed") === "1" && params.get("gateBackBridge") === "1" && channel) {
    const message = { type: "gate-page-back", channel };
    const bridge = (window as Window & { ReactNativeWebView?: { postMessage: (value: string) => void } }).ReactNativeWebView;
    if (bridge) {
      bridge.postMessage(JSON.stringify(message));
      return;
    }
    if (window.parent !== window && document.referrer) {
      try {
        const parentOrigin = new URL(document.referrer).origin;
        if (parentOrigin === window.location.origin || (import.meta.env.DEV && new URL(parentOrigin).hostname === "localhost")) {
          window.parent.postMessage(message, parentOrigin);
          return;
        }
      } catch { /* A standalone page continues through its own history. */ }
    }
  }
  if (canNavigateBackInApp()) {
    window.history.back();
    return;
  }
}
