import {
  Bell,
  MessageSquare,
  Users,
  CalendarDays,
  Phone,
  Files,
  CheckSquare2,
  Headphones,
  Receipt,
  Bot,
  ArrowDownUp,
  Settings,
  Search,
} from "lucide-react";
export type WorkHubNavItem = { key: string; label: string; href: string };
const ITEMS: WorkHubNavItem[] = [
  { key: "activity", label: "Activity", href: "/work-hub" },
  { key: "chat", label: "Chat", href: "/work-hub/chat" },
  { key: "channels", label: "Crews & Channels", href: "/work-hub/channels" },
  { key: "calendar", label: "Calendar", href: "/work-hub/calendar" },
  { key: "calls", label: "Calls", href: "/work-hub/calls" },
  { key: "files", label: "Files & Notes", href: "/work-hub/files" },
  { key: "tasks", label: "Tasks & Forms", href: "/work-hub/tasks" },
  { key: "meetings", label: "Meetings", href: "/work-hub/meetings" },
  { key: "finance", label: "Billing & Payroll", href: "/work-hub/finance" },
  { key: "askv", label: "AskV", href: "/work-hub/askv" },
  { key: "settings", label: "Import & Export", href: "/work-hub/settings" },
  {
    key: "administration",
    label: "Administration",
    href: "/work-hub/administration",
  },
  { key: "search", label: "Search", href: "/work-hub/search" },
];
export const workHubIcons = {
  activity: Bell,
  chat: MessageSquare,
  channels: Users,
  calendar: CalendarDays,
  calls: Phone,
  files: Files,
  tasks: CheckSquare2,
  meetings: Headphones,
  finance: Receipt,
  askv: Bot,
  settings: ArrowDownUp,
  administration: Settings,
  search: Search,
};
export const DEFAULT_WORK_HUB_PINS = [
  "activity",
  "chat",
  "channels",
  "calendar",
  "calls",
  "files",
  "askv",
];
export function orderWorkHubItems(items: WorkHubNavItem[], order: string[]) {
  const ranks = new Map(order.map((key, index) => [key, index]));
  return [...items].sort(
    (a, b) => (ranks.get(a.key) ?? 1000) - (ranks.get(b.key) ?? 1000),
  );
}
export function isWorkHubPath(path: string) {
  return path === "/work-hub" || path.startsWith("/work-hub/");
}
export function getWorkHubNavItems(_role?: string | null) {
  return ITEMS;
}
export function getWorkHubReturnPath(candidate?: string | null) {
  return candidate &&
    candidate.startsWith("/") &&
    !candidate.startsWith("//") &&
    !isWorkHubPath(candidate)
    ? candidate
    : "/";
}
