export type VoicePageContext = {
  path: string; title?: string; parameters?: Record<string, string>;
  recordsView?: { loading: boolean; error: boolean; page: number; total: number; records: string[] };
  mapView?: { target: string; state: "loading" | "displayed" | "unavailable" | "error" | "none" };
  activity?: { title: string; kind: "dialog" | "form" | "page"; currentField?: string;
    fields: { label: string; filled: boolean; required: boolean; invalid: boolean }[];
    controls: { label: string; disabled: boolean }[] };
};
const record = (value: unknown): Record<string, any> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {};
const text = (value: unknown, limit: number) => typeof value === "string" ? value.trim().slice(0, limit) : "";
/** UI descriptions/status only: input values, credentials and arbitrary properties are omitted. */
export function parseVoicePageContext(raw: unknown): VoicePageContext | undefined {
  const source = record(raw), path = text(source.path, 512);
  if (!path.startsWith("/") || path.includes("\n")) return undefined;
  const activity = record(source.activity);
  const allowed = ["siteId", "siteLocationId", "stationId", "range", "recordType", "from", "to", "search", "page", "recordId", "view", "section", "staffUserId", "equipmentId", "reveal"];
  const parameters = Object.fromEntries(Object.entries(record(source.parameters)).filter(([key, value]) => allowed.includes(key) && typeof value === "string").map(([key, value]) => [key, text(value, 512)]));
  return { path, ...(text(source.title, 160) ? { title: text(source.title, 160) } : {}),
    ...(Object.keys(parameters).length ? { parameters } : {}),
    ...(source.mapView && ["loading", "displayed", "unavailable", "error", "none"].includes(source.mapView.state) ? { mapView: { target: text(source.mapView.target, 80), state: source.mapView.state } } : {}),
    ...(source.recordsView && typeof source.recordsView === "object" ? { recordsView: { loading: source.recordsView.loading === true, error: source.recordsView.error === true, page: Math.max(1, Math.min(1000, Number(source.recordsView.page) || 1)), total: Math.max(0, Math.min(25000, Number(source.recordsView.total) || 0)), records: (Array.isArray(source.recordsView.records) ? source.recordsView.records : []).slice(0, 25).map((value: unknown) => text(value, 500)) } } : {}),
    ...(text(activity.title, 160) && ["dialog", "form", "page"].includes(activity.kind) ? { activity: {
      title: text(activity.title, 160), kind: activity.kind,
      ...(text(activity.currentField, 100) ? { currentField: text(activity.currentField, 100) } : {}),
      fields: (Array.isArray(activity.fields) ? activity.fields : []).slice(0, 30).map((field: unknown) => { const f = record(field); return { label: text(f.label, 100), filled: f.filled === true, required: f.required === true, invalid: f.invalid === true }; }).filter((f: { label: string }) => f.label),
      controls: (Array.isArray(activity.controls) ? activity.controls : []).slice(0, 16).map((control: unknown) => { const c = record(control); return { label: text(c.label, 100), disabled: c.disabled === true }; }).filter((c: { label: string }) => c.label),
    } } : {}),
  };
}
const pages = new Map<symbol, () => VoicePageContext | undefined>(), listeners = new Set<() => void>();
export function notifyVoicePageContextChanged() { listeners.forEach(listener => listener()); }
export function registerVoicePageContext(read: () => VoicePageContext | undefined) {
  const key = Symbol(); pages.set(key, read); notifyVoicePageContextChanged();
  return () => { pages.delete(key); notifyVoicePageContextChanged(); };
}
export function readVoicePageContext(path: string) {
  const normalize = (value: string) => value.replace(/^\/mobile(?=\/|$)/, "").replace(/\/\([^/]+\)/g, "").split(/[?#]/)[0].replace(/\/$/, "").replace(/^\/gate-history$/, "/gate/history").replace(/^\/gate-map$/, "/gate/map").replace(/^\/shift-notes$/, "/gate/shift-notes").replace(/^\/change-over$/, "/gate/change-over");
  return [...pages.values()].reverse().map(read => read()).find(page => page && normalize(page.path) === normalize(path));
}
export function subscribeVoicePageContext(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
