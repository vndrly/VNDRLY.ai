import type { TicketFieldLifecycleState } from "./intake-status";

/** Office statuses where field work is on the clock. */
const ON_CLOCK_STATUS = "in_progress";

/** Office statuses that imply the crew has left the site. */
const OFF_SITE_OFFICE_STATUSES = new Set([
  "pending_review",
  "completed",
  "submitted",
  "approved",
  "awaiting_payment",
  "funds_dispersed",
  "kicked_back",
  "denied",
  "cancelled",
]);

/** Pre-checkout office statuses that may still be en route / on location. */
const PRE_FIELD_OFFICE_STATUSES = new Set([
  "initiated",
  "draft",
  "awaiting_acceptance",
]);

const PRE_CHECKIN_LIFECYCLE = new Set<TicketFieldLifecycleState>([
  "pending_arrival",
  "en_route",
  "on_location",
]);

/**
 * Canonical lifecycle phase for a ticket after a status-only mutation
 * (cancel, reactivate, unlock). Keeps the dual-axis model coherent.
 */
export function lifecycleStateForOfficeStatus(
  status: string,
): TicketFieldLifecycleState {
  if (status === ON_CLOCK_STATUS) return "on_site";
  if (OFF_SITE_OFFICE_STATUSES.has(status)) return "off_site";
  return "pending_arrival";
}

/**
 * Returns true when `status` and `lifecycleState` obey VNDRLY's pairing rules:
 *   - in_progress ↔ on_site
 *   - post-field office statuses ↔ off_site
 *   - pre-field office statuses ↔ pending_arrival | en_route | on_location
 */
export function isLifecycleCoherent(
  status: string,
  lifecycleState: string | null | undefined,
): boolean {
  const ls = (lifecycleState ?? "pending_arrival") as TicketFieldLifecycleState;

  if (status === ON_CLOCK_STATUS) return ls === "on_site";
  if (OFF_SITE_OFFICE_STATUSES.has(status)) return ls === "off_site";
  if (PRE_FIELD_OFFICE_STATUSES.has(status)) return PRE_CHECKIN_LIFECYCLE.has(ls);
  return true;
}

/** Allowed source statuses for POST /tickets/:id/submit. */
export const SUBMIT_ALLOWED_STATUSES = new Set([
  "pending_review",
  "completed",
  "kicked_back",
]);

/** Allowed source statuses for POST /tickets/:id/kickback. */
export const KICKBACK_ALLOWED_STATUSES = new Set(["submitted", "approved"]);
