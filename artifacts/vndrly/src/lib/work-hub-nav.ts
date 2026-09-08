export type WorkHubNavItem = { key: string; label: string; href: string };

const ITEMS: WorkHubNavItem[] = [
  { key: "home", label: "Home", href: "/work-hub" },
  { key: "channels", label: "Channels", href: "/work-hub/channels" },
  { key: "calendar", label: "Calendar", href: "/work-hub/calendar" },
  { key: "files", label: "Files & Notes", href: "/work-hub/files" },
  { key: "tasks", label: "Tasks & Forms", href: "/work-hub/tasks" },
  { key: "meetings", label: "Meetings", href: "/work-hub/meetings" },
  { key: "search", label: "Search", href: "/work-hub/search" },
  { key: "settings", label: "Settings & Connections", href: "/work-hub/settings" },
];

export function isWorkHubPath(path: string) { return path === "/work-hub" || path.startsWith("/work-hub/"); }
export function getWorkHubNavItems(_role?: string | null) { return ITEMS; }
export function getWorkHubReturnPath(candidate?: string | null) {
  return candidate && candidate.startsWith("/") && !candidate.startsWith("//") && !isWorkHubPath(candidate) ? candidate : "/";
}
