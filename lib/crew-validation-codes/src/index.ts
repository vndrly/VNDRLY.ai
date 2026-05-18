// Canonical list of "crew/foreman validation" error codes returned by
// the ticket-creation, ticket-edit, and ticket-schedule routes. These
// all describe the SAME class of problem to a client: the foreman or
// crew the caller is trying to set on a ticket isn't a valid choice
// for that ticket's vendor — either the foreman/employee belongs to a
// different vendor, the foreman isn't part of the chosen crew, or one
// of the crew picks isn't valid for the vendor at all.
//
// Why a single shared workspace lib (Task #870):
//   These constants used to live only in `artifacts/api-server` and
//   the mobile + web clients kept hand-maintained MIRRORS of the same
//   strings (the file headers literally said "If you add or rename a
//   code on the server, update this set too"). A typo or rename on
//   either side compiled cleanly today and silently routed the error
//   to the wrong UX (generic toast instead of the crew picker, or a
//   stale inline error instead of a refresh). Funnelling every emit
//   site AND every consumer through this typed module means a typo or
//   rename now fails the build on both sides — no more silent drift.
//
// Naming policy:
//   - All codes are lowercase snake_case so they match the rest of the
//     `error` field convention in the api-server routes package.
//   - Codes are emitted on the JSON `error` field. The ticket routes
//     may also attach a structured dot-notation `code` (e.g.
//     `schedule.invalid_crew`) for legacy reasons; the snake_case
//     `error` field is the contract clients should rely on.
//   - Constants are SCREAMING_SNAKE_CASE so server route handlers can
//     write `error: FOREMAN_VENDOR_MISMATCH` and a misspelled
//     identifier fails to import.
//
// Per-code meaning:
//   - `foreman_vendor_mismatch`
//       The foreman user resolved by the ticket-create / -edit route
//       does not belong to the ticket's vendor. Emitted by tickets.ts
//       (POST /tickets) when the foreman_user_id can't be matched to a
//       vendor_people row on the target vendor.
//   - `foreman_field_employee_mismatch`
//       Both `fieldEmployeeId` and `foremanUserId` were supplied on a
//       create/edit, but they refer to different vendor_people rows.
//       The office_on_behalf_of_field_employee channel requires the
//       named FE to ALSO be the foreman on the ticket.
//   - `field_employee_vendor_mismatch`
//       The fieldEmployeeId on a PATCH /tickets/:id update belongs to
//       a different vendor than the existing ticket. Prevents an edit
//       from re-assigning a ticket to a worker on another vendor.
//   - `crew_invalid_for_vendor`
//       One or more of the crewEmployeeIds passed to the schedule
//       endpoint do not belong to the ticket's vendor (or are deleted).
//   - `foreman_not_in_crew`
//       The foremanUserId passed to the schedule endpoint is not one
//       of the crew members supplied in the same request, so the
//       foreman wouldn't actually be on the crew they're leading.
export const FOREMAN_VENDOR_MISMATCH = "foreman_vendor_mismatch" as const;
export const FOREMAN_FIELD_EMPLOYEE_MISMATCH =
  "foreman_field_employee_mismatch" as const;
export const FIELD_EMPLOYEE_VENDOR_MISMATCH =
  "field_employee_vendor_mismatch" as const;
export const CREW_INVALID_FOR_VENDOR = "crew_invalid_for_vendor" as const;
export const FOREMAN_NOT_IN_CREW = "foreman_not_in_crew" as const;

export const CREW_VALIDATION_CODES = [
  FOREMAN_VENDOR_MISMATCH,
  FOREMAN_FIELD_EMPLOYEE_MISMATCH,
  FIELD_EMPLOYEE_VENDOR_MISMATCH,
  CREW_INVALID_FOR_VENDOR,
  FOREMAN_NOT_IN_CREW,
] as const;

export type CrewValidationCode = (typeof CREW_VALIDATION_CODES)[number];

const CREW_VALIDATION_SET: ReadonlySet<string> = new Set(
  CREW_VALIDATION_CODES,
);

/** Type guard: narrows an arbitrary string-like value to a known
 *  crew/foreman validation code. Mobile and web both use this to
 *  decide whether to re-route an error to the crew picker UX,
 *  regardless of which mutation surfaced it. */
export function isCrewValidationCode(
  value: unknown,
): value is CrewValidationCode {
  return typeof value === "string" && CREW_VALIDATION_SET.has(value);
}
