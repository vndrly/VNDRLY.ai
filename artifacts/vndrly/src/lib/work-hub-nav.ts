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
  UsersRound,
  CalendarCheck,
  PackageSearch,
  MapPinned,
  ShieldAlert,
  CreditCard,
  Activity,
} from "lucide-react";
export type WorkHubNavItem = { key: string; label: string; href: string };
const ITEMS: WorkHubNavItem[] = [
  { key: "activity", label: "Activity", href: "/work-hub" },
  { key: "calendar", label: "Calendar", href: "/work-hub/calendar" },
  { key: "channels", label: "Groups", href: "/work-hub/channels" },
  { key: "chat", label: "Company Chat", href: "/work-hub/chat" },
  { key: "managedCrews", label: "Managed Crews", href: "/work-hub/managed-crews" },
  { key: "coverage", label: "Coverage", href: "/work-hub/coverage" },
  { key: "assets", label: "Inventory", href: "/work-hub/assets" },
  { key: "sitePresence", label: "Site Presence", href: "/work-hub/site-presence" },
  { key: "safetyResponse", label: "Safety Response", href: "/work-hub/safety-response" },
  { key: "subscriptions", label: "Worker Subscriptions", href: "/work-hub/subscriptions" },
  { key: "operationsHealth", label: "Operations Health", href: "/work-hub/operations-health" },
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
  managedCrews: UsersRound,
  coverage: CalendarCheck,
  assets: PackageSearch,
  sitePresence: MapPinned,
  safetyResponse: ShieldAlert,
  subscriptions: CreditCard,
  operationsHealth: Activity,
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
  "calendar",
  "channels",
  "chat",
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
export function getWorkHubNavItems(
  _role?: string | null,
  companyName?: string | null,
) {
  const chatLabel = `${companyName?.trim() || "Company"} Chat`;
  return ITEMS.map((item) =>
    item.key === "chat" ? { ...item, label: chatLabel } : { ...item },
  );
}
export function getWorkHubReturnPath(candidate?: string | null) {
  return candidate &&
    candidate.startsWith("/") &&
    !candidate.startsWith("//") &&
    !isWorkHubPath(candidate)
    ? candidate
    : "/";
}
