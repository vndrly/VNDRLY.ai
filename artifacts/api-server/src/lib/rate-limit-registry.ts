import type {
  RateBudget,
  RateLimitTripWindowSummary,
} from "./rate-limit-factory";
import {
  getTicketsBudgetForRole,
  KNOWN_ROLES,
  summarizeRecentTicketsTrips,
  type KnownRole,
} from "./tickets-rate-limit";
import {
  getNotificationsBudgetForRole,
  summarizeRecentNotificationsTrips,
} from "./notifications-rate-limit";
import {
  getCommentsBudgetForRole,
  summarizeRecentCommentsTrips,
} from "./comments-rate-limit";
import {
  getHotlistBudgetForRole,
  summarizeRecentHotlistTrips,
} from "./hotlist-rate-limit";
import {
  getDashboardBudgetForRole,
  summarizeRecentDashboardTrips,
} from "./dashboard-rate-limit";
import {
  getLiveLocationsBudgetForRole,
  summarizeRecentLiveLocationsTrips,
} from "./live-locations-rate-limit";
import {
  getVisitsBudgetForRole,
  summarizeRecentVisitsTrips,
} from "./visits-rate-limit";
import {
  getParticipantsBudgetForRole,
  summarizeRecentParticipantsTrips,
} from "./participants-rate-limit";

// Default rolling window the budgets readout uses to count recent
// 429 trips per role (Task #763). 15 minutes is short enough that
// "tripped 12× in the last 15 min" is operationally relevant — a
// limiter that hasn't tripped in a quarter hour probably isn't
// actively under-sized — but long enough that a brief burst doesn't
// fall off between dashboard polls. Each per-resource limiter still
// retains 24h of trip history in its ring buffer (see
// `DEFAULT_TRIPS_BUFFER_OPTIONS` in `rate-limit-factory.ts`); we
// just slice the most recent 15 minutes for the at-a-glance count.
export const RECENT_TRIPS_WINDOW_MS = 15 * 60 * 1000;

// Central registry of every per-role rate-limited endpoint family in
// the API. This is the single source of truth read by the admin
// operations dashboard (Task #697 extends Task #688's tickets-only
// readout to a multi-endpoint listing). Task #698 expanded the set
// of per-role limiters (dashboard, live-locations, visits,
// participants), so this registry pulls them all in.
//
// Each entry exposes:
//   • `key` — short stable id used in the URL/JSON; same value the
//     `code` in 429 bodies uses (so an operator can grep logs for
//     "<key>.rate_limit.trip" and click the matching row in the UI)
//   • `label` — human-readable name rendered in the admin card
//   • `description` — one-line "what this protects" explanation; the
//     UI shows it under the label so an operator who doesn't yet
//     know which routes are covered doesn't have to read source
//   • `routes` — list of HTTP routes the limiter is wired into;
//     surfaced in the UI as a hint so an operator knows exactly
//     which calls are throttled
//   • `envVarPrefix` — `<PREFIX>_RATE_LIMIT_MAX[_<ROLE>]` etc.,
//     mirrored into `envVarHint` on the response so the UI can
//     render the exact env-var names without hardcoding them. Must
//     match the `resourcePrefix` the underlying limiter was created
//     with so the hint actually points at a knob that works.
//   • `getBudgetForRole` — the limiter's own resolver, called live
//     so env-var changes (after a restart) are reflected without
//     redeploying the registry
//
// Ordering is the order rendered in the UI; keep the noisiest /
// most-tunable endpoints first so a tired operator skimming the
// dashboard sees them up top.
export interface RateLimitedEndpointDescriptor {
  key: string;
  label: string;
  description: string;
  routes: string[];
  envVarPrefix: string;
  getBudgetForRole: (role: string | null | undefined) => RateBudget;
  /**
   * Per-resource trip-summary resolver — returns the in-process
   * ring-buffer rollup for a given window. Used by the admin
   * readout (Task #763) so each per-role row can show "tripped N×
   * in the last 15 min" without operators grepping logs for
   * `<resource>.rate_limit.trip` warn lines.
   */
  summarizeRecentTrips: (opts: {
    windowMs: number;
    now?: number;
  }) => RateLimitTripWindowSummary;
}

export const RATE_LIMITED_ENDPOINTS: RateLimitedEndpointDescriptor[] = [
  {
    key: "tickets",
    label: "Tickets API",
    description:
      "Ticket list and detail reads — the busiest authenticated endpoint in the app.",
    routes: ["GET /api/tickets", "GET /api/tickets/:id"],
    envVarPrefix: "TICKETS",
    getBudgetForRole: getTicketsBudgetForRole,
    summarizeRecentTrips: summarizeRecentTicketsTrips,
  },
  {
    key: "dashboard",
    label: "Dashboard",
    description:
      "Dashboard summary, recent-activity, and ticket-stats reads — fan out to multiple joined aggregate queries on every page mount.",
    routes: [
      "GET /api/dashboard/summary",
      "GET /api/dashboard/recent-activity",
      "GET /api/dashboard/ticket-stats",
    ],
    envVarPrefix: "DASHBOARD",
    getBudgetForRole: getDashboardBudgetForRole,
    summarizeRecentTrips: summarizeRecentDashboardTrips,
  },
  {
    key: "live_locations",
    label: "Live crew/locations",
    description:
      "Live crew map snapshot and SSE stream — the most expensive joined read in the API.",
    routes: ["GET /api/live-locations", "GET /api/live-locations/events"],
    envVarPrefix: "LIVE_LOCATIONS",
    getBudgetForRole: getLiveLocationsBudgetForRole,
    summarizeRecentTrips: summarizeRecentLiveLocationsTrips,
  },
  {
    key: "visits",
    label: "Visits API",
    description:
      "Visitor list, detail, and SSE-invalidated check-in/out reads driven by both the web visitor list and the field mobile app.",
    routes: [
      "GET /api/visits",
      "GET /api/visits/:id",
      "GET /api/visits/events",
    ],
    envVarPrefix: "VISITS",
    getBudgetForRole: getVisitsBudgetForRole,
    summarizeRecentTrips: summarizeRecentVisitsTrips,
  },
  {
    key: "notifications",
    label: "Notifications bell",
    description:
      "Notification list and unread-count polling driven by every signed-in tab.",
    routes: [
      "GET /api/notifications",
      "GET /api/notifications/unread-count",
    ],
    envVarPrefix: "NOTIFICATIONS",
    getBudgetForRole: getNotificationsBudgetForRole,
    summarizeRecentTrips: summarizeRecentNotificationsTrips,
  },
  {
    key: "comments",
    label: "Comment threads",
    description:
      "SSE-invalidated ticket and hotlist comment thread reads (mark-as-seen on each fetch).",
    routes: [
      "GET /api/tickets/:id/comments",
      "GET /api/hotlist/jobs/:id/comments",
    ],
    envVarPrefix: "COMMENTS",
    getBudgetForRole: getCommentsBudgetForRole,
    summarizeRecentTrips: summarizeRecentCommentsTrips,
  },
  {
    key: "participants",
    label: "Mention picker participants",
    description:
      "Participant-graph + users-by-id fan-out powering the @-mention dropdown in the comments composer.",
    routes: [
      "GET /api/tickets/:id/comments-participants",
      "GET /api/hotlist/jobs/:id/comments-participants",
    ],
    envVarPrefix: "PARTICIPANTS",
    getBudgetForRole: getParticipantsBudgetForRole,
    summarizeRecentTrips: summarizeRecentParticipantsTrips,
  },
  {
    key: "hotlist",
    label: "Hotlist jobs",
    description:
      "Hotlist job list and detail reads, invalidated on every bid mutation.",
    routes: ["GET /api/hotlist/jobs", "GET /api/hotlist/jobs/:id"],
    envVarPrefix: "HOTLIST",
    getBudgetForRole: getHotlistBudgetForRole,
    summarizeRecentTrips: summarizeRecentHotlistTrips,
  },
];

export interface ResolvedRoleRow {
  role: KnownRole;
  max: number;
  windowMs: number;
  /** True iff this role's resolved budget differs from the default. */
  overridden: boolean;
  /**
   * 429 trip count from this role inside the rolling
   * `recentTripsWindowMs` window (Task #763). `0` when the role has
   * not tripped lately. Counts only wall-clock trips on this
   * replica's in-process ring buffer; persistent record is the
   * structured `<resource>.rate_limit.trip` log line.
   */
  recentTrips: number;
}

export interface ResolvedEndpointBudgets {
  key: string;
  label: string;
  description: string;
  routes: string[];
  default: { max: number; windowMs: number };
  roles: ResolvedRoleRow[];
  envVarHint: { max: string; windowMs: string };
  /**
   * Length in ms of the rolling window used to populate each row's
   * `recentTrips` count. Surfaced so the UI can render the exact
   * "in the last N min" caption from the same value the backend
   * sliced on, without hardcoding a copy of the constant.
   */
  recentTripsWindowMs: number;
  /**
   * Trips inside `recentTripsWindowMs` whose session role was
   * unauthenticated or didn't match the sanitized role pattern
   * (these callers always inherit the default budget). Surfaced
   * separately because the per-role `roles[]` only enumerates
   * `KNOWN_ROLES`, so an under-sized default that's only being
   * tripped by guests would otherwise be invisible.
   */
  recentTripsUnknown: number;
  /**
   * Total trips inside `recentTripsWindowMs` across every role
   * (including unknown/unauthenticated). Lets the card show an
   * at-a-glance "tripped N× in the last 15 min" header without the
   * UI re-summing the per-role rows.
   */
  recentTripsTotal: number;
}

/**
 * Resolve the live budget table for a single endpoint descriptor.
 * Reads env on every call (via the descriptor's resolver) so an
 * operator restart picks up overrides without rebuilding the
 * registry. Mirrors the row shape the existing tickets-only readout
 * already returned, so the admin card can keep its row-level UI.
 */
export function resolveEndpointBudgets(
  endpoint: RateLimitedEndpointDescriptor,
  opts: { recentTripsWindowMs?: number; now?: number } = {},
): ResolvedEndpointBudgets {
  const recentTripsWindowMs =
    opts.recentTripsWindowMs ?? RECENT_TRIPS_WINDOW_MS;
  const now = opts.now ?? Date.now();
  const defaultBudget = endpoint.getBudgetForRole(null);
  // Roll the trip ring buffer up once per resolve call so the
  // per-role rows below can index into it in O(1). The summary
  // already returns roles sorted by trip count; we re-key it by
  // role string to map onto the canonical KNOWN_ROLES order the
  // budgets table uses.
  const tripsSummary = endpoint.summarizeRecentTrips({
    windowMs: recentTripsWindowMs,
    now,
  });
  const tripsByRole = new Map<string, number>();
  for (const row of tripsSummary.byRole) {
    tripsByRole.set(row.role, row.trips);
  }
  // KNOWN_ROLES does not include the "unknown" bucket the limiter
  // uses for unauthenticated / pattern-rejected callers, so capture
  // that count separately from the per-role total. Avoid double-
  // counting it inside the per-role rows.
  const recentTripsUnknown = tripsByRole.get("unknown") ?? 0;
  const roles = KNOWN_ROLES.map((role): ResolvedRoleRow => {
    const budget = endpoint.getBudgetForRole(role);
    return {
      role,
      max: budget.max,
      windowMs: budget.windowMs,
      overridden:
        budget.max !== defaultBudget.max ||
        budget.windowMs !== defaultBudget.windowMs,
      recentTrips: tripsByRole.get(role) ?? 0,
    };
  });
  return {
    key: endpoint.key,
    label: endpoint.label,
    description: endpoint.description,
    routes: endpoint.routes,
    default: { max: defaultBudget.max, windowMs: defaultBudget.windowMs },
    roles,
    envVarHint: {
      max: `${endpoint.envVarPrefix}_RATE_LIMIT_MAX_<ROLE>`,
      windowMs: `${endpoint.envVarPrefix}_RATE_LIMIT_WINDOW_MS_<ROLE>`,
    },
    recentTripsWindowMs,
    recentTripsUnknown,
    recentTripsTotal: tripsSummary.totalTrips,
  };
}
