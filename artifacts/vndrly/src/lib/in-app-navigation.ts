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
    nativeReplaceState(stateWithIndex(history.state, 0), "", window.location.href);
  }
  history.pushState = (state, unused, url) => {
    nativePushState(stateWithIndex(state, currentIndex() + 1), unused, url);
  };
  history.replaceState = (state, unused, url) => {
    nativeReplaceState(stateWithIndex(state, currentIndex()), unused, url);
  };
}

export function canNavigateBackInApp() {
  return typeof window !== "undefined" && currentIndex() > 0;
}

export function navigateBackInApp(navigate: Navigate, fallbackHref: string) {
  if (canNavigateBackInApp()) {
    window.history.back();
    return;
  }
  navigate(fallbackHref, { replace: true });
}
