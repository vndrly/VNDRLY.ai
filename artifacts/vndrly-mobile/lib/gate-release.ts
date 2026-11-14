/** First App Store release: one Gate workspace on iPhone and iPad. */
export const GATE_ONLY_RELEASE = true;
export const GATE_HOME = "/(tabs)/change-over";
const pages = new Set([
  "change-over",
  "gate",
  "gate-map",
  "gate-history",
  "handoff",
  "shift-notes",
  "profile",
  "askv",
  "gate-notifications",
  "gate-notification-preferences",
  "notifications",
  "notification-preferences",
  "edit-profile",
  "location-consent",
  "compliance",
  "gate-admin",
  "gate-staff",
  "gate-person",
  "gate-locations",
  "gate-billing",
  "gate-services",
  "gate-documents",
  "gate-account",
  "gate-password",
  "gate-setup",
  "gate-companies",
  "site-gate-contractors",
  "safety-report",
  "safety-my-reports",
  "safety-event",
  "safety-score",
  "work-hub",
]);
const hubPages = new Set([
  "calendar",
  "chat",
  "calls",
  "meetings",
  "meeting",
  "tasks-forms",
  "task",
  "my-work",
  "attention",
  "safety",
  "safety-response",
  "search",
  "search-item",
  "record",
  "notification",
  "native-entry",
  "native-operations",
  "payroll-documents",
  "form",
  "campaign",
  "checklist",
  "assignment",
]);
export function isGateReleasePath(path: string): boolean {
  if (!path.startsWith("/") || path.startsWith("//") || /\\/.test(path))
    return false;
  const parts = path
    .split(/[?#]/, 1)[0]
    .split("/")
    .filter(Boolean)
    .filter((p) => p !== "(tabs)");
  if (parts.some((p) => p === "." || p === ".." || /%2f|%5c|%2e/i.test(p)))
    return false;
  if (!parts.length || parts[0] === "index") return true;
  if (!pages.has(parts[0])) return false;
  if (parts[0] === "safety-event") return parts.length === 2;
  if (parts[0] !== "work-hub") return parts.length === 1;
  if (parts.length === 1) return true;
  if (!hubPages.has(parts[1])) return false;
  if (parts[1] === "search-item")
    return [
      "document",
      "task",
      "meeting",
      "file",
      "announcement",
      "message",
      "note",
      "form",
      "transcript",
    ].includes(parts[2] ?? "");
  return true;
}
export function gateReleaseDestination(path: string): string {
  return isGateReleasePath(path) ? path : GATE_HOME;
}
export function gateManager(
  user:
    | {
        role?: string;
        vendorRole?: string | null;
        availableMemberships?: { id: number; role: string }[];
        activeMembershipId?: number | null;
      }
    | null
    | undefined,
) {
  return (
    user?.role === "admin" ||
    ["admin", "office", "gate_supervisor"].includes(user?.vendorRole ?? "") ||
    user?.availableMemberships?.some(
      (m) => m.id === user.activeMembershipId && m.role === "admin",
    ) === true
  );
}
