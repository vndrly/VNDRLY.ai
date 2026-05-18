// Mobile-side adapter over the cross-platform ticket-status metadata.
//
// The canonical map (label keys + color buckets, plus the web-only
// action-pill descriptors) lives in the shared
// `@workspace/ticket-status-meta` lib so the office web app and the
// field mobile app cannot drift apart on user-facing status text or
// urgency colors. This file re-derives the small mobile-specific
// pieces (the actual hex pill colors used by RN <View> styles and
// the helper that translates a status into its localized label)
// from that shared module.
import {
  ticketStatusMeta,
  type TicketStatusBadgeColor,
} from "@workspace/ticket-status-meta";

// Map<status, i18n label key>. Re-exported for callers that want the
// raw key (e.g. unit tests that assert which translation was passed
// to `t()`).
export const TICKET_STATUS_LABEL_KEYS: Record<string, string> =
  Object.fromEntries(
    Object.entries(ticketStatusMeta).map(([status, meta]) => [
      status,
      meta.badgeLabelKey,
    ]),
  );

// Fallback for unknown statuses: convert "snake_case" to "snake case" so
// the UI never shows a raw enum identifier.
export function ticketStatusLabel(
  status: string,
  t: (key: string) => string,
): string {
  const key = TICKET_STATUS_LABEL_KEYS[status];
  if (key) return t(key);
  return status.replace(/_/g, " ");
}

// Re-export the shared color-bucket type under the mobile-side name
// it has always had so existing imports keep working.
export type TicketStatusColorKey = TicketStatusBadgeColor;

// Map<status, color bucket>. Skips statuses whose shared bucket is
// `null` (e.g. `draft`, `initiated`) so the existing
// `?? "grey"` fallback in `ticketStatusPillStyle` still kicks in for
// them — that preserves the previous mobile behaviour of showing a
// neutral grey pill instead of nothing at all.
export const TICKET_STATUS_COLORS: Record<string, TicketStatusColorKey> =
  Object.fromEntries(
    Object.entries(ticketStatusMeta).flatMap(([status, meta]) =>
      meta.badgeColor ? [[status, meta.badgeColor] as const] : [],
    ),
  );

export type TicketStatusPillStyle = {
  background: string;
  foreground: string;
};

// Pill background/foreground per color bucket.
//
// Note on the "amber" key: the project's hard brand rule forbids any
// literal amber UI unless the active brand color is amber, so this
// bucket renders as violet (`#7c3aed`) instead. The bucket name is
// kept as "amber" to stay aligned with the cross-platform meta module
// in `@workspace/ticket-status-meta`, where it semantically means
// "blocked on someone else / waiting" (e.g. submitted,
// awaiting_payment, awaiting_acceptance). Picking violet rather than
// the previous slate `#475569` restores visual distinction from the
// neutral grey bucket without violating the no-amber rule.
const PILL_STYLES: Record<TicketStatusColorKey, TicketStatusPillStyle> = {
  amber: { background: "#7c3aed", foreground: "#ffffff" },
  babyBlue: { background: "#38bdf8", foreground: "#082f49" },
  blue: { background: "#2563eb", foreground: "#ffffff" },
  darkGreen: { background: "#166534", foreground: "#ffffff" },
  darkRed: { background: "#991b1b", foreground: "#ffffff" },
  green: { background: "#16a34a", foreground: "#ffffff" },
  red: { background: "#dc2626", foreground: "#ffffff" },
  grey: { background: "rgba(148,163,184,0.25)", foreground: "#e5e7eb" },
  hotPink: { background: "#db2777", foreground: "#ffffff" },
  indigo: { background: "#4f46e5", foreground: "#ffffff" },
  lime: { background: "#65a30d", foreground: "#ffffff" },
  navy: { background: "#1d4ed8", foreground: "#ffffff" },
  orange: { background: "#ea580c", foreground: "#ffffff" },
  pink: { background: "#ec4899", foreground: "#ffffff" },
  purple: { background: "#7c3aed", foreground: "#ffffff" },
  tan: { background: "#b89463", foreground: "#111827" },
  teal: { background: "#0d9488", foreground: "#ffffff" },
};

// Threshold (in days) after which an open ticket is considered stalled
// and its pill escalates to amber. Mirrors `INACTIVE_DAYS` in
// artifacts/vndrly/src/components/ticket-status-badge.tsx so a ticket
// flagged as cold on the dispatcher web view reads the same on the
// field employee's phone.
export const TICKET_INACTIVE_DAYS = 7;

// Statuses that escalate to the amber "stale" pill once the ticket has
// sat untouched past TICKET_INACTIVE_DAYS. Matches the web set:
//   * draft / pending_review / kicked_back: waiting on the field
//     employee to push it forward
//   * in_progress: started but never finished
// Statuses owned by the back office (submitted / awaiting_payment) or
// terminal (approved / completed / funds_dispersed / cancelled) are
// intentionally NOT in this set — re-coloring them as "stale" would
// just blame the field employee for office turnaround time.
// `kicked_back` is intentionally excluded: its base color is red, the
// most urgent bucket we render. Re-keying it to the "amber" (waiting)
// bucket when stale would visually demote it from "act now" to
// "blocked on someone else" — exactly the wrong signal. Red already
// dominates amber semantically, so a stale kicked_back ticket simply
// stays red and still gets the "Xd stale" suffix from
// `ticketStaleDays` below.
const INACTIVE_ESCALATION_STATUSES = new Set([
  "draft",
  "pending_review",
  "in_progress",
]);

// True when `updatedAt` is older than TICKET_INACTIVE_DAYS days. Returns
// false for null / undefined / unparseable values so callers can pass
// the raw API value without first guarding it.
export function isTicketInactive(
  updatedAt?: string | Date | null,
): boolean {
  if (!updatedAt) return false;
  const updated =
    updatedAt instanceof Date ? updatedAt : new Date(updatedAt);
  const ms = updated.getTime();
  if (Number.isNaN(ms)) return false;
  const diffDays = (Date.now() - ms) / (1000 * 60 * 60 * 24);
  return diffDays >= TICKET_INACTIVE_DAYS;
}

// Task #890: How many whole days a ticket has been stalled, or `null`
// when no stale suffix should be shown. Returns the floored day count
// only when BOTH conditions that drive the amber pill escalation hold:
//   1. `status` is one of INACTIVE_ESCALATION_STATUSES (i.e. a status
//      a field employee can act on — office-owned and terminal
//      statuses never get a stale suffix, same as they never get the
//      amber pill)
//   2. `updatedAt` is at least TICKET_INACTIVE_DAYS old
// Sharing the same gate as `ticketStatusPillStyle` ensures the pill
// color and the "Xd stale" suffix can never disagree on the same row.
export function ticketStaleDays(
  status: string,
  updatedAt?: string | Date | null,
): number | null {
  if (!INACTIVE_ESCALATION_STATUSES.has(status)) return null;
  if (!updatedAt) return null;
  const updated =
    updatedAt instanceof Date ? updatedAt : new Date(updatedAt);
  const ms = updated.getTime();
  if (Number.isNaN(ms)) return null;
  const diffDays = Math.floor((Date.now() - ms) / (1000 * 60 * 60 * 24));
  if (diffDays < TICKET_INACTIVE_DAYS) return null;
  return diffDays;
}

// Returns the pill background/foreground colors for a status. When the
// status has no mapped color (e.g. `draft`, `initiated`) we fall back
// to a neutral grey pill so the badge never disappears.
//
// If `updatedAt` is supplied and the ticket has gone stale (see
// `isTicketInactive`) AND the status is one a field employee can act
// on (see INACTIVE_ESCALATION_STATUSES), the pill escalates to amber
// regardless of its base color. This mirrors the web TicketStatusBadge
// at artifacts/vndrly/src/components/ticket-status-badge.tsx so a
// stalled in_progress / draft / pending_review / kicked_back ticket
// reads the same urgency on mobile as it does in the dispatcher view.
export function ticketStatusPillStyle(
  status: string,
  updatedAt?: string | Date | null,
): TicketStatusPillStyle {
  let key = TICKET_STATUS_COLORS[status] ?? "grey";
  if (
    INACTIVE_ESCALATION_STATUSES.has(status) &&
    isTicketInactive(updatedAt)
  ) {
    key = "amber";
  }
  return PILL_STYLES[key];
}
