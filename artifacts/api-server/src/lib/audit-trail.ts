// Task #857: shared helpers for the ticket audit-trail filter/CSV export
// surface. The same `(fromStatus, toStatus)` → kind taxonomy is used by:
//
//   • the per-ticket Audit Trail card on the web ticket-detail page
//     (so a "denied"-only filter chip in the UI hides exactly the same
//     rows the server's `?kind=denied` filter would hide), and
//   • the aggregate cross-ticket export so partner ops leads can pull
//     "every denial in the last 30 days" for an SLA review.
//
// Keeping the categorization on the server keeps the CSV stable even
// when the UI is offline / when an auditor downloads a file from a
// curl/Excel session that bypasses the React app entirely.

import { toCsv } from "./reports/csv";

export const TRANSITION_KINDS = [
  "created",
  "invite_sent",
  "accepted",
  "denied",
  "reinvited",
  "cancelled",
  "reactivated",
  "reopened",
  "other",
] as const;
export type TransitionKind = (typeof TRANSITION_KINDS)[number];

export const ACTOR_ROLE_FILTERS = [
  "admin",
  "partner",
  "vendor",
  "field_employee",
  "system",
] as const;
export type ActorRoleFilter = (typeof ACTOR_ROLE_FILTERS)[number];

/**
 * Map a `(fromStatus, toStatus)` pair to one of the audit-trail kinds the
 * UI surfaces. Mirrors the conditional cascade in
 * `artifacts/vndrly/src/pages/ticket-detail.tsx` exactly so both ends
 * agree on what a "denied" or "reinvited" row is.
 */
export function transitionKindOf(
  fromStatus: string | null,
  toStatus: string,
): TransitionKind {
  if (fromStatus == null && toStatus === "awaiting_acceptance")
    return "invite_sent";
  if (fromStatus == null) return "created";
  if (toStatus === "awaiting_acceptance") return "reinvited";
  if (fromStatus === "awaiting_acceptance" && toStatus === "initiated")
    return "accepted";
  if (fromStatus === "awaiting_acceptance" && toStatus === "denied")
    return "denied";
  if (toStatus === "cancelled") return "cancelled";
  if (fromStatus === "cancelled") return "reactivated";
  if (
    fromStatus === "submitted" ||
    fromStatus === "approved" ||
    fromStatus === "funds_dispersed"
  )
    return "reopened";
  return "other";
}

/**
 * Parse a `kind` query parameter that may arrive as a single string,
 * a comma-separated string, or an array of strings (Express defaults to
 * an array when the param is repeated). Unknown values are silently
 * dropped so an old client passing a renamed kind doesn't 400 the page.
 */
export function parseKindFilter(raw: unknown): TransitionKind[] | null {
  const list = parseStringList(raw);
  if (list == null) return null;
  const out: TransitionKind[] = [];
  for (const v of list) {
    if ((TRANSITION_KINDS as readonly string[]).includes(v)) {
      out.push(v as TransitionKind);
    }
  }
  return out.length > 0 ? out : null;
}

export function parseActorRoleFilter(raw: unknown): ActorRoleFilter[] | null {
  const list = parseStringList(raw);
  if (list == null) return null;
  const out: ActorRoleFilter[] = [];
  for (const v of list) {
    if ((ACTOR_ROLE_FILTERS as readonly string[]).includes(v)) {
      out.push(v as ActorRoleFilter);
    }
  }
  return out.length > 0 ? out : null;
}

function parseStringList(raw: unknown): string[] | null {
  if (raw == null) return null;
  if (Array.isArray(raw)) {
    return raw
      .filter((v): v is string => typeof v === "string")
      .flatMap((v) => v.split(","))
      .map((v) => v.trim())
      .filter((v) => v.length > 0);
  }
  if (typeof raw === "string") {
    return raw
      .split(",")
      .map((v) => v.trim())
      .filter((v) => v.length > 0);
  }
  return null;
}

export function parseDateBound(raw: unknown): Date | null {
  if (typeof raw !== "string" || raw.length === 0) return null;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

export type AuditTrailRow = {
  id: number;
  ticketId: number;
  fromStatus: string | null;
  toStatus: string;
  actorUserId: number | null;
  actorName: string | null;
  actorRole: string | null;
  reason: string | null;
  displayReason: string | null;
  fromVendorName: string | null;
  toVendorName: string | null;
  createdAt: Date | string;
};

export type AuditTrailFilters = {
  kinds: TransitionKind[] | null;
  actorRoles: ActorRoleFilter[] | null;
  from: Date | null;
  to: Date | null;
};

/**
 * Apply the kind/actorRole/date filters in-memory. We filter on JS rather
 * than at the SQL layer because the kind is a derived value (from the
 * `(fromStatus → toStatus)` pair plus the reinvite reason), and an audit
 * trail for a single ticket is bounded to a few dozen rows in practice.
 * For the aggregate export the caller still scopes the SQL query down to
 * a partner / vendor / status set first, so the in-memory pass stays
 * cheap.
 */
export function applyAuditTrailFilters<T extends AuditTrailRow>(
  rows: T[],
  filters: AuditTrailFilters,
): T[] {
  const { kinds, actorRoles, from, to } = filters;
  return rows.filter((r) => {
    if (kinds && kinds.length > 0) {
      const k = transitionKindOf(r.fromStatus, r.toStatus);
      if (!kinds.includes(k)) return false;
    }
    if (actorRoles && actorRoles.length > 0) {
      const role: string = r.actorRole ?? "system";
      if (!(actorRoles as readonly string[]).includes(role)) return false;
    }
    if (from != null) {
      const t = new Date(r.createdAt).getTime();
      if (t < from.getTime()) return false;
    }
    if (to != null) {
      const t = new Date(r.createdAt).getTime();
      if (t > to.getTime()) return false;
    }
    return true;
  });
}

const CSV_HEADERS = [
  "id",
  "ticketId",
  "createdAt",
  "fromStatus",
  "toStatus",
  "kind",
  "actorName",
  "actorRole",
  "reason",
];

/**
 * Render the audit-trail rows to RFC-4180 CSV. The `reason` column uses
 * `displayReason` when present (so a partner-self-service reinvite shows
 * the resolved vendor names) but falls back to the raw stored reason.
 */
export function auditTrailToCsv<T extends AuditTrailRow>(rows: T[]): string {
  return toCsv(
    CSV_HEADERS,
    rows.map((r) => {
      const created =
        r.createdAt instanceof Date
          ? r.createdAt.toISOString()
          : new Date(r.createdAt).toISOString();
      return [
        r.id,
        r.ticketId,
        created,
        r.fromStatus ?? "",
        r.toStatus,
        transitionKindOf(r.fromStatus, r.toStatus),
        r.actorName ?? "",
        r.actorRole ?? "system",
        r.displayReason ?? r.reason ?? "",
      ];
    }),
  );
}

export function auditTrailCsvFilename(parts: string[]): string {
  const stamp = new Date().toISOString().slice(0, 10);
  const safe = parts
    .filter(Boolean)
    .map((p) => p.replace(/[^A-Za-z0-9_-]+/g, "_"))
    .join("-");
  return `${safe || "audit-trail"}-${stamp}.csv`;
}
