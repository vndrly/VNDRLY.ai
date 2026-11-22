export const embeddedGateHeader = window.location.pathname === "/gate/header" && new URLSearchParams(window.location.search).get("gateDashboardEmbed") === "1";
export const embeddedGatePage = new URLSearchParams(window.location.search).get("gateDashboardEmbed") === "1"
  && ["/gate/change-over", "/gate", "/gate/map", "/gate/history", "/gate/shift-notes", "/personal-agreements"].includes(window.location.pathname);
export const embeddedIosGatePage = embeddedGatePage && new URLSearchParams(window.location.search).get("gateDevice") === "ios";

function installSession(token: string, apiOrigin = location.origin) {
  const originalFetch = window.fetch.bind(window);
  window.fetch = (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input), location.href);
    if (url.origin !== location.origin || !url.pathname.startsWith("/api/")) return originalFetch(input, init);
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    headers.set("Authorization", `Bearer ${token}`);
    const target = new URL(url.pathname + url.search, apiOrigin);
    const request = input instanceof Request ? new Request(target, input) : target;
    return originalFetch(request, { ...init, headers, credentials: "omit", redirect: "error" });
  };
}

export async function prepareGateDashboardSession() {
  if (!embeddedGatePage && !embeddedGateHeader) return;
  const host = window as Window & { __gateDashboardSession?: string };
  const nativeToken = host.__gateDashboardSession;
  delete host.__gateDashboardSession;
  if (nativeToken) {
    installSession(nativeToken);
    return;
  }
  if (window.parent === window || location.origin !== "http://localhost:5173") return;
  const previewOrigin = "http://localhost:8081";
  const token = await new Promise<string | null>(resolve => {
    const finish = (value: string | null) => {
      window.removeEventListener("message", receive);
      window.clearTimeout(timeout);
      resolve(value);
    };
    const receive = (event: MessageEvent) => {
      if (event.origin === previewOrigin && event.source === window.parent &&
          event.data?.type === "gate-dashboard-session" && typeof event.data.token === "string") {
        finish(event.data.token);
      }
    };
    const timeout = window.setTimeout(() => finish(null), 5000);
    window.addEventListener("message", receive);
    window.parent.postMessage({ type: "gate-dashboard-ready" }, previewOrigin);
  });
  if (token) installSession(token, "http://localhost:8099");
}
