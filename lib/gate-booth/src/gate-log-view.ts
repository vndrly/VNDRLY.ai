import type { VoicePageContext } from "./voice-page-context";
const isLog = (path: string) => /\/(?:gate\/history|(?:\(tabs\)\/)?gate-history)\/?$/.test(path);
/** A next-page request keeps the same on-screen query; it never grants data access. */
export function gateLogViewPath(target: string, current?: VoicePageContext): string {
  const [path, query = ""] = target.split("?");
  if (!isLog(path) || !current || !isLog(current.path)) return target;
  const requested = new URLSearchParams(query), params = new URLSearchParams();
  const nextSite = requested.get("siteId") ?? requested.get("siteLocationId");
  for (const [key, value] of Object.entries(current.parameters ?? {})) {
    if (key === "section" || key === "stationId" && nextSite && nextSite !== current.parameters?.siteId) continue;
    params.set(key, value);
  }
  for (const [key, value] of requested) params.set(key, value);
  return path + (params.size ? "?" + params : "");
}
/** Wait only for a requested view's own load; never participates in voice startup. */
export function waitForGateLogView(target: string, read: () => VoicePageContext | undefined, subscribe: (listener: () => void) => () => void): Promise<{ ok: boolean; message: string; page?: number; total?: number; records?: string[] }> {
  const [, query = ""] = target.split("?"), expected = new URLSearchParams(query);
  return new Promise(resolve => {
    let unsubscribe = () => {};
    const finish = (result: { ok: boolean; message: string; page?: number; total?: number; records?: string[] }) => { clearTimeout(timer); unsubscribe(); resolve(result); };
    const check = () => {
      const current = read(), view = current?.recordsView;
      if (!current || !isLog(current.path.replace(/^\/mobile/, "")) || !view) return;
      for (const key of ["siteId", "stationId", "range", "from", "to", "recordType", "search"]) if (expected.has(key) && current.parameters?.[key] !== expected.get(key)) return;
      if (view.error) return finish({ ok: false, message: "Gate Log opened, but its requested records could not be loaded." });
      if (view.loading) return;
      const requested = Math.max(1, Number(expected.get("page")) || 1), last = Math.max(1, Math.ceil(view.total / 25));
      if (view.page !== Math.min(requested, last)) return;
      finish({ ok: true, message: "Gate Log is displaying the matching recorded traffic.", page: view.page, total: view.total, records: view.records });
    };
    const timer = setTimeout(() => finish({ ok: false, message: "Gate Log navigation was requested; the matching records are still loading. Do not claim the results are displayed yet." }), 5000);
    unsubscribe = subscribe(check); check();
  });
}
