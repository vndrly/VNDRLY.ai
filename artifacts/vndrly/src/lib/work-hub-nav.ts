import {
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
  BriefcaseBusiness,
} from "lucide-react";
export type WorkHubNavItem = { key: string; label: string; href: string };
const ITEMS: WorkHubNavItem[] = [
  { key: "activity", label: "Work Hub", href: "/work-hub" },
  { key: "calendar", label: "Calendar", href: "/work-hub/calendar" },
  { key: "chat", label: "Communications", href: "/work-hub/chat" },
  { key: "managedCrews", label: "Tasks & Crews", href: "/work-hub/managed-crews" },
  { key: "coverage", label: "Coverage", href: "/work-hub/coverage" },
  { key: "assets", label: "Inventory", href: "/work-hub/assets" },
  { key: "sitePresence", label: "Site Presence", href: "/work-hub/site-presence" },
  { key: "safetyResponse", label: "Safety Response", href: "/work-hub/safety-response" },
  { key: "subscriptions", label: "Subscriptions", href: "/work-hub/subscriptions" },
  { key: "files", label: "File Library", href: "/work-hub/files" },
  { key: "finance", label: "Billing & Payroll", href: "/work-hub/finance" },
  { key: "askv", label: "AskV", href: "/work-hub/askv" },
  { key: "settings", label: "Import & Export", href: "/work-hub/settings" },
  { key: "search", label: "Search", href: "/work-hub/search" },
];
export const workHubIcons = {
  activity: BriefcaseBusiness,
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
  "chat",
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
  return path === "/work-hub" || path.startsWith("/work-hub/") || path === "/safety-score";
}
export function getWorkHubNavItems(
  _role?: string | null,
  companyName?: string | null,
) {
  const chatLabel = "Communications";
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
