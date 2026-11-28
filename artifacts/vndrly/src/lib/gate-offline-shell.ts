export type GateOfflineShell =
  | { ready: true; /** False when the browser would not promise to keep its storage. */ protectedStorage: boolean; assetCount: number }
  | { ready: false; reason: string };

const WORKER = "/gate-offline-worker.js";
/** The Gate and the sign-in page only. A whole-site worker would take the Fleet offline scope with it. */
const SCOPES = ["/gate", "/login"];

/**
 * Keeps a copy of the Gate and sign-in pages in this browser, so they open with no connection.
 * Run from the Gate while connected; it has to be repeated after each release, which the Gate does by opening.
 */
export async function provisionGateOfflineShell(options = { production: import.meta.env.PROD }): Promise<GateOfflineShell> {
  try {
    if (!options.production) return { ready: false, reason: "Opening with no connection requires a production web build" };
    if (!navigator.serviceWorker || !window.caches) return { ready: false, reason: "This browser cannot keep the Gate for use with no connection" };
    const registrations = await navigator.serviceWorker.getRegistrations();
    const script = new URL(WORKER, location.origin).href;
    if (registrations.some((registration) => {
      const path = new URL(registration.scope).pathname;
      return path === "/" || (SCOPES.some((scope) => path.startsWith(scope))
        && ![registration.active, registration.installing, registration.waiting].some((worker) => worker?.scriptURL === script));
    })) return { ready: false, reason: "Another service worker already covers the Gate" };
    // Asked for, never required: without it the browser may clear its storage when the disk is short.
    const protectedStorage = Boolean(await navigator.storage?.persisted?.() || await navigator.storage?.persist?.());
    // The sign-in page is part of the copy: it is what opens when the session is gone and there is no connection.
    await import("@/pages/login");
    const assets = [...new Set([
      ...performance.getEntriesByType("resource").map((entry) => entry.name),
      ...Array.from(document.querySelectorAll("script[src],link[rel='stylesheet'],link[rel='modulepreload']"))
        .map((node) => node.getAttribute("src") ?? node.getAttribute("href") ?? ""),
    ].map((value) => new URL(value, location.href))
      .filter((url) => url.origin === location.origin && url.pathname.startsWith("/assets/") && !url.pathname.includes("%")
        && /\.(js|css|woff2?|ttf|png|webp|jpe?g|svg|ico)$/i.test(url.pathname))
      .map((url) => url.href))];
    if (!assets.some((url) => new URL(url).pathname.endsWith(".js"))) return { ready: false, reason: "The production application files are not loaded" };
    let assetCount = 0;
    for (const scope of SCOPES) {
      const registration = await navigator.serviceWorker.register(WORKER, { scope });
      let worker = registration.active ?? registration.installing ?? registration.waiting;
      if (!worker) throw Error("Gate worker is unavailable");
      if (worker.state !== "activated")
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => reject(Error("Gate worker activation timed out")), 10_000);
          worker!.addEventListener("statechange", () => {
            if (worker!.state === "activated") { clearTimeout(timer); resolve(); }
            else if (worker!.state === "redundant") { clearTimeout(timer); reject(Error("Gate worker activation failed")); }
          });
        });
      worker = registration.active ?? worker;
      // Both scopes share one copy; the worker that controls this page fills it.
      if (scope !== SCOPES[0]) continue;
      const result = await new Promise<{ ready: boolean; assetCount: number; reason?: string }>((resolve, reject) => {
        const channel = new MessageChannel();
        const timer = setTimeout(() => { channel.port1.close(); reject(Error("Gate shell acknowledgement timed out")); }, 60_000);
        channel.port1.onmessage = (event) => { clearTimeout(timer); channel.port1.close(); resolve(event.data); };
        worker!.postMessage({ kind: "PROVISION_GATE_SHELL", assets }, [channel.port2]);
      });
      if (!result.ready) return { ready: false, reason: result.reason ?? "The Gate copy was not confirmed" };
      assetCount = result.assetCount;
    }
    return { ready: true, protectedStorage, assetCount };
  } catch (error) {
    return { ready: false, reason: error instanceof Error ? error.message : "The Gate could not be kept for use with no connection" };
  }
}
