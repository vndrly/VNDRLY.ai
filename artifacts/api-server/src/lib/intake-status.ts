// Task #494: pure helper for default-status branching at ticket creation
// time. Extracted from POST /tickets so it can be unit-tested without
// standing up the full DB read chain.
//
// Rules:
//   - Partner self-service tickets must be Accepted by the vendor before
//     work begins, so they land on `awaiting_acceptance` regardless of any
//     auto-check-in hint (auto-check-in is suppressed at the call site).
//   - Office-on-behalf and field-employee intake skip the accept step
//     because a human (admin/foreman) has already coordinated with the
//     vendor out-of-band — those keep the legacy `initiated` start state,
//     or jump straight to `in_progress` when the geofenced auto-check-in
//     condition fired.
export type IntakeChannel =
  | "partner_self_service"
  | "partner_hotlist"
  | "office_on_behalf_of_partner"
  | "office_on_behalf_of_field_employee"
  | "vendor_field_self_service";

export const OFFICE_INTAKE_CHANNELS: ReadonlySet<IntakeChannel> = new Set([
  "office_on_behalf_of_partner",
  "office_on_behalf_of_field_employee",
] as const);

export type InitialTicketStatus =
  | "awaiting_acceptance"
  | "initiated"
  | "in_progress";

// Task #498: phone intake (office channels) inherits the same gating rule as
// before — partner-on-behalf must be vendor-accepted unless the office
// operator explicitly marks the partner as "already aware" via
// `acceptanceImplicit=true` (treated then like a field-self-service start).
export function computeInitialStatus(
  intakeChannel: IntakeChannel,
  shouldCheckIn: boolean,
  acceptanceImplicit: boolean = false,
): InitialTicketStatus {
  if (intakeChannel === "partner_self_service" || intakeChannel === "partner_hotlist") return "awaiting_acceptance";
  if (intakeChannel === "office_on_behalf_of_partner") {
    // Office operator opening a ticket the partner phoned in: by default
    // we still bounce through the vendor accept gate so the field crew
    // gets the standard handshake. The acceptanceImplicit flag is the
    // escape hatch for "partner already coordinated, just open it".
    return acceptanceImplicit
      ? shouldCheckIn ? "in_progress" : "initiated"
      : "awaiting_acceptance";
  }
  if (intakeChannel === "office_on_behalf_of_field_employee") {
    // Per Task #498: a field-employee phoning the office to start a
    // ticket means the crew is already physically coordinating the
    // work; the office operator is acting as their dispatcher. Skip
    // both the accept gate and the geofence requirement and jump
    // straight to in_progress so the FE can resume work without a
    // round-trip through the mobile check-in flow.
    return "in_progress";
  }
  // vendor_field_self_service: crew is on-site already; honour the
  // existing geofence-based auto-check-in path.
  return shouldCheckIn ? "in_progress" : "initiated";
}

// Task #494: states from which the owning partner may reinvite a
// different vendor. Per the product spec, reinvite is allowed at any
// point before work actually starts (vendor check-in flips status to
// `in_progress`). That means:
//   - `awaiting_acceptance`: invite is still pending; partner changed mind
//   - `denied`: vendor opted out; partner picks a replacement
//   - `initiated`: vendor accepted but has not checked in yet; partner
//     can still pull the work and reassign it
export const REINVITE_ELIGIBLE_STATUSES: ReadonlySet<string> = new Set([
  "awaiting_acceptance",
  "denied",
  "initiated",
]);
