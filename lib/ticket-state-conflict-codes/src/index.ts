// Canonical list of "ticket state conflict" error codes returned by the
// ticket mutation routes. These all mean the same thing to a client:
// the server's view of the ticket no longer matches the device's view
// (someone else accepted/denied/cancelled, the lifecycle moved on,
// etc.) so the right UX is to silently refresh the ticket and let the
// user decide what to do next, rather than pinning a stale inline error
// under a control that may have just disappeared.
//
// Why a single shared workspace lib (Task #870):
//   The api-server, the mobile app, and the web app each need this
//   exact set. The OpenAPI spec also mirrors the canonical 409 enum
//   as `TicketStateConflictCode`. Before this lib the api-server file
//   was the source of truth and the mobile + web kept hand-maintained
//   string-set mirrors of it (a typo on either side compiled cleanly
//   and silently routed the error to the wrong UX). Funnelling every
//   consumer through this typed module means a typo or rename now
//   fails the build on both sides — no more silent drift.
//
// Naming policy:
//   - All codes are lowercase snake_case so they match the rest of the
//     `error` field convention in the api-server routes package.
//   - Codes are emitted on the JSON `error` field. Some endpoints also
//     attach a structured dot-notation `code` (e.g.
//     `ticket.en_route_invalid_state`) for legacy reasons; the
//     snake_case `error` field is the contract clients should rely on.
//   - Constants are SCREAMING_SNAKE_CASE so server route handlers can
//     write `error: TICKET_NOT_ACCEPTED` and a misspelled identifier
//     fails to import.
//
// Spec contract:
//   The canonical set is also mirrored in the OpenAPI spec at
//   `lib/api-spec/openapi.yaml` as the `TicketStateConflictCode`
//   enum (and the `TicketStateConflictError` 409 response shape).
//   Codegen surfaces both to clients via `@workspace/api-client-react`.
//   Adding or renaming a code here also requires updating the spec
//   and re-running `pnpm --filter @workspace/api-spec run codegen`.
//
// Per-code meaning:
//   - `ticket_not_accepted`            — caller tried to act on a ticket
//                                        that has not yet cleared the
//                                        accept gate (still in invite
//                                        phase). See `ensureAccepted()`
//                                        and the cancel route.
//   - `ticket_not_awaiting_acceptance` — accept/deny was attempted on a
//                                        ticket that is no longer in
//                                        `awaiting_acceptance` (someone
//                                        already responded).
//   - `ticket_state_changed`           — compare-and-swap on a status
//                                        transition (accept/deny/reinvite)
//                                        lost its race; the underlying
//                                        ticket moved between read and
//                                        write.
//   - `ticket_not_checkinable`         — check-in was attempted on a
//                                        ticket whose status no longer
//                                        permits it.
//   - `ticket_en_route_invalid_state`  — en-route was attempted on a
//                                        ticket whose lifecycle/status
//                                        no longer permits it.
//   - `ticket_on_location_invalid_state` — on-location was attempted on
//                                        a ticket whose lifecycle/status
//                                        no longer permits it.
export const TICKET_NOT_ACCEPTED = "ticket_not_accepted" as const;
export const TICKET_NOT_AWAITING_ACCEPTANCE =
  "ticket_not_awaiting_acceptance" as const;
export const TICKET_STATE_CHANGED = "ticket_state_changed" as const;
export const TICKET_NOT_CHECKINABLE = "ticket_not_checkinable" as const;
export const TICKET_EN_ROUTE_INVALID_STATE =
  "ticket_en_route_invalid_state" as const;
export const TICKET_ON_LOCATION_INVALID_STATE =
  "ticket_on_location_invalid_state" as const;

export const TICKET_STATE_CONFLICT_CODES = [
  TICKET_NOT_ACCEPTED,
  TICKET_NOT_AWAITING_ACCEPTANCE,
  TICKET_STATE_CHANGED,
  TICKET_NOT_CHECKINABLE,
  TICKET_EN_ROUTE_INVALID_STATE,
  TICKET_ON_LOCATION_INVALID_STATE,
] as const;

export type TicketStateConflictCode =
  (typeof TICKET_STATE_CONFLICT_CODES)[number];

const STATE_CONFLICT_SET: ReadonlySet<string> = new Set(
  TICKET_STATE_CONFLICT_CODES,
);

/** Type guard: narrows an arbitrary string-like value to a known
 *  ticket-state-conflict code. Clients use this to decide whether to
 *  silently re-fetch the ticket (and clear any inline error) instead
 *  of pinning a stale message under a control that may have just
 *  disappeared. */
export function isTicketStateConflictCode(
  value: unknown,
): value is TicketStateConflictCode {
  return typeof value === "string" && STATE_CONFLICT_SET.has(value);
}
