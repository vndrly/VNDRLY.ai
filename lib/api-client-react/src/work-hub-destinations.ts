/** Exact record destinations shared by search, assistant links and both clients.
 * A destination never grants access: readPath must be loaded in the current session.
 */
export function workHubItemDestination(subjectType: string, subjectId: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(subjectId)) return null;
  const id = encodeURIComponent(subjectId);
  if (subjectType === "asset") return {
    webPath: `/work-hub/search?type=asset&item=${id}`,
    nativePath: `/work-hub/files-notes?section=inventory&assetId=${id}`,
    readPath: `/implementation-a/assets/${id}`,
  };
  if (!["task", "meeting", "file", "announcement", "message", "note", "form", "transcript"].includes(subjectType)) return null;
  return {
    webPath: `/work-hub/search?type=${subjectType}&item=${id}`,
    nativePath: subjectType === "meeting" ? `/work-hub/meeting/${id}` : `/work-hub/search-item/${subjectType}/${id}`,
    readPath: `/work-hub/search/items/${subjectType}/${id}`,
  };
}

export const WORK_HUB_MODULE_ALIASES: Readonly<Record<string, { web: string; native: string }>> = {
  files: { web: "files", native: "files-notes" },
  "files-notes": { web: "files", native: "files-notes" },
  inventory: { web: "assets", native: "files-notes" },
  assets: { web: "assets", native: "files-notes" },
  tasks: { web: "tasks", native: "tasks-forms" },
  "tasks-forms": { web: "tasks", native: "tasks-forms" },
  "implementation-exports": { web: "implementation-exports", native: "implementation-exports" },
  settings: { web: "settings", native: "settings-connections" },
  connections: { web: "settings", native: "settings-connections" },
  "settings-connections": { web: "settings", native: "settings-connections" },
  search: { web: "search", native: "search" },
  calendar: { web: "calendar", native: "calendar" },
  meetings: { web: "meetings", native: "meetings" },
  channels: { web: "channels", native: "channels" },
  chat: { web: "chat", native: "chat" },
  calls: { web: "calls", native: "calls" },
  askv: { web: "askv", native: "askv" },
};
