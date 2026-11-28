/* The Gate and sign-in pages with no connection: the public application shell only.
 * API responses, credentials, records and private images never enter this cache.
 * Registered for /gate and /login, never the whole site. */
const CACHE = "vndrly-gate-public-shell-v1";
const SHELL = "/gate";
const STATIC = /\.(?:js|css|woff2?|ttf|png|webp|jpe?g|svg|ico)$/i;
const mine = (url) => url.origin === self.location.origin;
const page = (url) => mine(url) && /^\/(?:gate|login)(?:\/|$)/.test(url.pathname);
const asset = (url) => mine(url) && url.pathname.startsWith("/assets/") && !url.pathname.includes("%") && STATIC.test(url.pathname);
const publicFile = (url) => mine(url) && !url.pathname.startsWith("/api/") && !url.pathname.includes("%") && STATIC.test(url.pathname);
// These are this site's own public files: a Vary header (Origin on script and style loads) must not hide the kept copy.
const SAME_FILE = { ignoreVary: true };
const usable = (response) =>
  response.status === 200 && !response.redirected && !/text\/html|application\/json/.test(response.headers.get("content-type") ?? "");

self.addEventListener("install", (event) => event.waitUntil(self.skipWaiting()));
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("message", (event) => {
  if (event.data?.kind !== "PROVISION_GATE_SHELL" || !event.ports?.[0]) return;
  event.waitUntil((async () => {
    try {
      const client = event.source?.id ? await self.clients.get(event.source.id) : null;
      if (!client || !page(new URL(client.url)) || !Array.isArray(event.data.assets) || event.data.assets.length > 1500)
        throw Error("Invalid Gate shell request");
      const urls = [...new Set(event.data.assets.map((value) => new URL(value, self.location.origin).href))];
      if (!urls.length || urls.some((value) => !asset(new URL(value)))) throw Error("Only public application assets may be kept");
      const cache = await caches.open(CACHE);
      const shell = await fetch(new Request(SHELL, { credentials: "omit", cache: "reload" }));
      if (!shell.ok || shell.redirected || !shell.headers.get("content-type")?.includes("text/html")) throw Error("Gate application shell unavailable");
      const html = await shell.clone().text();
      const previous = await (await cache.match(SHELL))?.text();
      for (const url of urls) {
        if (await cache.match(url)) continue;
        const response = await fetch(new Request(url, { credentials: "omit", cache: "reload" }));
        if (!usable(response)) throw Error("Public application asset unavailable");
        await cache.put(url, response);
      }
      await cache.put(SHELL, shell);
      // A new release: the files of the release before it are no longer needed.
      if (previous !== undefined && previous !== html)
        for (const request of await cache.keys())
          if (asset(new URL(request.url)) && !urls.includes(request.url)) await cache.delete(request);
      event.ports[0].postMessage({ ready: true, assetCount: urls.length });
    } catch (error) {
      event.ports[0].postMessage({ ready: false, reason: error instanceof Error ? error.message : "Offline shell unavailable" });
    }
  })());
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (request.mode === "navigate" && page(url)) {
    // The server's page whenever it answers; the kept page only when it cannot be reached.
    event.respondWith(fetch(request).catch(async () => {
      const cached = await (await caches.open(CACHE)).match(SHELL);
      if (!cached) throw Error("Gate shell was not kept");
      return cached;
    }));
    return;
  }
  if (asset(url)) {
    // Release files never change under the same name: kept copy first, and anything new is kept as it loads.
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      const cached = await cache.match(request, SAME_FILE);
      if (cached) return cached;
      const response = await fetch(request);
      if (usable(response)) await cache.put(request, response.clone());
      return response;
    })());
    return;
  }
  if (publicFile(url)) {
    // Logos and other public files: the server's copy whenever it answers.
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      try {
        const response = await fetch(request);
        if (usable(response)) await cache.put(request, response.clone());
        return response;
      } catch (error) {
        const cached = await cache.match(request, SAME_FILE);
        if (cached) return cached;
        throw error;
      }
    })());
  }
});
