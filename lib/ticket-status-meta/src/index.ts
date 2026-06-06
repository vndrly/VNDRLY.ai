// Canonical ticket-status display metadata shared by both the
// office web app (`artifacts/vndrly`) and the field mobile app
// (`artifacts/vndrly-mobile`).
//
// Why a single shared module:
//   The label keys, color buckets, and (web-side) action-pill icons
//   used to live in two parallel records — one for web and one for
//   mobile. Adding or relabelling a status meant editing both copies,
//   and historically the two surfaces drifted apart in user-facing
//   text. Funnelling every status through this module means a rename
//   propagates to both builds at once and the typechecker rejects any
//   accidental partial update.
//
// Scope:
//   This file owns *only* what is shared cross-platform:
//     - the i18n key for the badge label,
//     - the abstract lifecycle color bucket used by status pills,
//     - the testid stem used by web e2e tests,
//     - the action-pill descriptor referenced by the web ticket
//       detail header (variant + icon name + label key).
//
//   Each platform still owns the rendering details that don't make
//   sense to share: the web side maps `actionPill.icon` to a
//   `lucide-react` component and renders pill backgrounds with PNG
//   assets; the mobile side maps `badgeColor` to RN-friendly hex
//   values. Both consume this module for the source-of-truth map.
//
// Drift prevention:
//   The ticket-status portion of the map is typed
//   `Record<TicketStatus, TicketStatusMeta>` where `TicketStatus` is
//   the generated enum from `@workspace/api-client-react`. Adding a
//   value to the OpenAPI `TicketStatus` enum without adding a meta
//   entry here surfaces as a compile error at every consumer — same
//   pattern `SiteLocationStatus` already uses for the site-status
//   badge (`artifacts/vndrly/src/components/status-badge.tsx`). The
//   crew-tracker `ackStatus` keys (pending / confirmed / declined)
//   live in a separate `Record<CrewAckStatus, ...>` map because they
//   come from `ScheduledTicketAckStatus`, not `TicketStatus`. The
//   merged `ticketStatusMeta` export is what every consumer reads.

import { TicketStatus } from "@workspace/api-client-react";

export type TicketStatusBadgeColor =
  | "amber"
  | "babyBlue"
  | "blue"
  | "darkGreen"
  | "darkRed"
  | "green"
  | "grey"
  | "hotPink"
  | "indigo"
  | "lime"
  | "navy"
  | "orange"
  | "pink"
  | "purple"
  | "red"
  | "tan"
  | "teal";

export type TicketStatusActionPillVariant =
  | "green-square"
  | "orange-disabled"
  | "amber-disabled"
  | "red-disabled";

// Stable, framework-agnostic icon identifiers. The web layer maps
// these to `lucide-react` components; mobile currently does not
// render the action pill, but if it ever does it can pick its own
// icon set (e.g. @expo/vector-icons) keyed off the same identifier.
export type TicketStatusActionPillIcon =
  | "check-circle-2"
  | "dollar-sign"
  | "rotate-ccw"
  | "send"
  | "x-circle";

export interface TicketStatusActionPillMeta {
  variant: TicketStatusActionPillVariant;
  icon: TicketStatusActionPillIcon;
  labelKey: string;
}

export interface TicketStatusMeta {
  // `null` means "render as plain text without a colored pill".
  badgeColor: TicketStatusBadgeColor | null;
  badgeLabelKey: string;
  testIdStem: string;
  // `null` means the ticket-detail header should not render an
  // action pill for this status (e.g. while work is `in_progress`
  // the header shows the actual action buttons instead).
  actionPill: TicketStatusActionPillMeta | null;
}

// Crew-tracker ack values returned by `/api/tickets/:id/crew-tracker`
// (and mirrored as `ScheduledTicketAckStatus` in the OpenAPI spec).
// They flow through `<TicketStatusBadge />` (Task #604) so they share
// the same meta shape, but they are NOT in the `TicketStatus` enum and
// must not pollute the `Record<TicketStatus, …>` typing below.
export type CrewAckStatus = "pending" | "confirmed" | "declined";

const ticketLifecycleMeta: Record<TicketStatus, TicketStatusMeta> = {
  draft: {
    badgeColor: "grey",
    badgeLabelKey: "tickets.draft",
    testIdStem: "draft",
    actionPill: null,
  },
  initiated: {
    badgeColor: "babyBlue",
    badgeLabelKey: "tickets.initiated",
    testIdStem: "initiated",
    actionPill: null,
  },
  in_progress: {
    badgeColor: "blue",
    badgeLabelKey: "tickets.inProgress",
    testIdStem: "in-progress",
    actionPill: null,
  },
  pending_review: {
    badgeColor: "purple",
    badgeLabelKey: "tickets.pendingReview",
    testIdStem: "pending-review",
    actionPill: {
      variant: "orange-disabled",
      icon: "send",
      labelKey: "ticketDetail.pendingOfficeReview",
    },
  },
  completed: {
    badgeColor: "teal",
    badgeLabelKey: "tickets.completed",
    testIdStem: "completed",
    actionPill: null,
  },
  submitted: {
    badgeColor: "amber",
    badgeLabelKey: "tickets.submitted",
    testIdStem: "submitted",
    actionPill: {
      variant: "orange-disabled",
      icon: "send",
      labelKey: "ticketDetail.submitted",
    },
  },
  kicked_back: {
    badgeColor: "red",
    badgeLabelKey: "tickets.kickedBack",
    testIdStem: "kicked-back",
    actionPill: {
      variant: "red-disabled",
      icon: "rotate-ccw",
      labelKey: "ticketDetail.kickedBack",
    },
  },
  approved: {
    badgeColor: "lime",
    badgeLabelKey: "tickets.approved",
    testIdStem: "approved",
    actionPill: {
      variant: "green-square",
      icon: "check-circle-2",
      labelKey: "ticketDetail.approved",
    },
  },
  // Task #576: amber matches the "needs office attention" treatment we
  // already use for submitted tickets — awaiting_payment is the same
  // shape of work-blocked-on-someone-else from the office's perspective.
  awaiting_payment: {
    badgeColor: "orange",
    badgeLabelKey: "tickets.awaitingPaymentStatus",
    testIdStem: "awaiting-payment",
    actionPill: {
      variant: "amber-disabled",
      icon: "dollar-sign",
      labelKey: "ticketDetail.statusAwaitingPayment",
    },
  },
  funds_dispersed: {
    badgeColor: "darkGreen",
    badgeLabelKey: "tickets.fundsDispersed",
    testIdStem: "funds-dispersed",
    actionPill: {
      variant: "green-square",
      icon: "dollar-sign",
      labelKey: "ticketDetail.fundsDispersed",
    },
  },
  cancelled: {
    badgeColor: "darkRed",
    badgeLabelKey: "tickets.cancelled",
    testIdStem: "cancelled",
    actionPill: {
      variant: "red-disabled",
      icon: "x-circle",
      labelKey: "ticketDetail.cancelled",
    },
  },
  // The vendor-invite phase (`awaiting_acceptance` / `denied`) is
  // rendered by a bespoke Accept/Deny/Reinvite card in
  // `artifacts/vndrly/src/pages/ticket-detail.tsx` rather than the
  // shared status badge. These statuses still get lifecycle colors so
  // list views and analytics bars can distinguish them at a glance.
  awaiting_acceptance: {
    badgeColor: "grey",
    badgeLabelKey: "tickets.awaitingAcceptance",
    testIdStem: "awaiting-acceptance",
    actionPill: null,
  },
  denied: {
    badgeColor: "pink",
    badgeLabelKey: "tickets.denied",
    testIdStem: "denied",
    actionPill: null,
  },
};

// Task #604: crew-tracker acknowledgement pills share the unified
// status palette (Task #598) so "Pending" reads as the same shape of
// amber-blocked work that "Submitted" / "Awaiting payment" do, and
// "Confirmed" / "Declined" line up with the green/red pills used
// throughout the rest of the office UI. These keys are the literal
// values returned by `/api/tickets/:id/crew-tracker` -> crew[].ackStatus
// so callers can pass `row.ackStatus` straight into <TicketStatusBadge />
// (web) or `ticketStatusPillStyle` (mobile).
const crewAckMeta: Record<CrewAckStatus, TicketStatusMeta> = {
  pending: {
    badgeColor: "amber",
    badgeLabelKey: "crewTracker.ackPending",
    testIdStem: "ack-pending",
    actionPill: null,
  },
  confirmed: {
    badgeColor: "green",
    badgeLabelKey: "crewTracker.ackConfirmed",
    testIdStem: "ack-confirmed",
    actionPill: null,
  },
  declined: {
    badgeColor: "red",
    badgeLabelKey: "crewTracker.ackDeclined",
    testIdStem: "ack-declined",
    actionPill: null,
  },
};

// Merged map keyed by string so existing call sites (which look up by
// the raw API-returned status) keep working. The compile-time
// invariants live on `ticketLifecycleMeta` and `crewAckMeta` above.
export const ticketStatusMeta: Record<string, TicketStatusMeta> = {
  ...ticketLifecycleMeta,
  ...crewAckMeta,
};

// Canonical ticket lifecycle order. Consumers (e.g. the dashboard
// "Tracking Status Breakdown" chart) render status buckets in this
// order rather than alphabetical / insertion-by-data order. Pre-accept
// handshake statuses (`awaiting_acceptance`, `denied`) are included at
// the front/tail because the dashboard chart groups them separately from
// the field-work progression. Crew-tracker ack values (pending/confirmed/
// declined) are intentionally excluded — they are not part of the ticket
// lifecycle.
//
// Tail convention: the two "exit-without-completion" statuses live at
// the end of the array — `kicked_back` second-from-right, `cancelled`
// far-right — so charts visually read left-to-right as "happy path
// progression → fail-state buckets". Everything in between is in
// natural lifecycle order.
//
// This list is explicit (rather than `Object.keys(ticketLifecycleMeta)`)
// so the order is decoupled from the meta-map declaration order, and
// it's typed `TicketStatus[]` so a missing or stale entry surfaces as
// a compile error if the OpenAPI enum changes.
export const TICKET_LIFECYCLE_ORDER: readonly TicketStatus[] = [
  "awaiting_acceptance",
  "draft",
  "initiated",
  "in_progress",
  "pending_review",
  "completed",
  "submitted",
  "approved",
  "awaiting_payment",
  "funds_dispersed",
  "denied",
  "kicked_back",
  "cancelled",
];

// Field GPS phases that should appear on the crew map and receive live pings.
// Shared by api-server (locations SSE) and mobile (liveLocationReporter).
export const LIVE_TRACKED_LIFECYCLE_STATES = [
  "en_route",
  "on_location",
  "on_site",
] as const;

export type LiveTrackedLifecycleState =
  (typeof LIVE_TRACKED_LIFECYCLE_STATES)[number];

export const LIVE_TRACKED_LIFECYCLE_SET: ReadonlySet<string> = new Set(
  LIVE_TRACKED_LIFECYCLE_STATES,
);
