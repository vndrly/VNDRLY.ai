// Canonical list of structured error codes emitted by the visitor /
// guest-session routes (see `artifacts/api-server/src/routes/visits.ts`)
// and consumed by the mobile visitor screens.
//
// Why a single shared module:
//   These codes used to live as inline string literals at every emit
//   site on the server AND as inline keys in the mobile locale files.
//   A typo on either side compiled cleanly and only surfaced when a
//   test happened to cover that exact path — otherwise the mobile
//   translator silently fell back to the generic status-family copy
//   ("The request couldn't be processed…") instead of the real,
//   localized message. Funnelling every emit + every translator
//   reference through this typed module means a typo or rename now
//   fails the build on both sides.
//
// Scope:
//   Only codes emitted by the visits route file. That includes:
//     - guest-session auth errors (`auth.guest_required`,
//       `auth.guest_expired`) and the staff-side auth gate
//       (`auth.required`) used by the visitor list/detail/SSE
//       endpoints.
//     - guest-signup validation (`guest.name_required`,
//       `guest.safety_required`).
//     - site lookup (`site.not_found`) — only the visit-flow uses are
//       covered here; tickets routes have their own `site_not_found`
//       snake_case variant.
//     - visit-flow validation (`visit.invalid_input`,
//       `visit.partner_host_mismatch`, `visit.host_vendor_required`,
//       `visit.vendor_not_assigned`, `visit.location_required`,
//       `visit.invalid_id`, `visit.not_found`, `visit.no_access`).
//
//   `off_geofence` is also included even though its dedicated
//   translator branch in `apiErrors.ts` interpolates
//   `distanceMeters` / `radiusMeters` instead of going through the
//   generic `errors.${code}` lookup. It is the only non-namespaced
//   code emitted by `visits.ts`, and the same string literal appears
//   in the mobile translator and in two web pages — funnelling all of
//   them through this constant means a typo or rename fails the build
//   in lockstep across every consumer. (The api-server only emits
//   `off_geofence` from the visits route today; if a future ticket
//   check-in route starts emitting it too, that route should import
//   the same constant from here.)
//
// Naming policy:
//   - Codes use lowercase dot-notation (`<scope>.<reason>`) to match
//     the existing wire format. The mobile i18next loader nests dotted
//     keys, so each code maps to `errors.<code>` in `locales/en.json`
//     and `locales/es.json`.
//   - Constants are SCREAMING_SNAKE_CASE so server route handlers can
//     write `code: VISIT_PARTNER_HOST_MISMATCH` and a misspelled
//     identifier fails to import.

// Auth gates — visits/guest-session edition.
export const AUTH_GUEST_REQUIRED = "auth.guest_required" as const;
export const AUTH_GUEST_EXPIRED = "auth.guest_expired" as const;
export const AUTH_REQUIRED = "auth.required" as const;

// Guest signup body validation.
export const GUEST_NAME_REQUIRED = "guest.name_required" as const;
export const GUEST_SAFETY_REQUIRED = "guest.safety_required" as const;

// Site lookup (visit flow).
export const SITE_NOT_FOUND = "site.not_found" as const;

// Visit-flow request validation and access control.
export const VISIT_INVALID_INPUT = "visit.invalid_input" as const;
export const VISIT_PARTNER_HOST_MISMATCH = "visit.partner_host_mismatch" as const;
export const VISIT_HOST_VENDOR_REQUIRED = "visit.host_vendor_required" as const;
export const VISIT_VENDOR_NOT_ASSIGNED = "visit.vendor_not_assigned" as const;
export const VISIT_LOCATION_REQUIRED = "visit.location_required" as const;
export const VISIT_INVALID_ID = "visit.invalid_id" as const;
export const VISIT_NOT_FOUND = "visit.not_found" as const;
export const VISIT_NO_ACCESS = "visit.no_access" as const;

// Visit-flow geofence rejection. Emitted by `POST /visits/check-in`
// when the supplied lat/lng is further from the site than the site's
// `siteRadiusMeters`. The mobile translator handles this code with a
// dedicated branch that interpolates `{distance}` / `{radius}` into
// the user-facing string (`tickets.offGeofence`), so it does NOT
// resolve through the generic `errors.<code>` path the other codes
// in this list use. Two web pages (`visit-public.tsx`,
// `field-new-ticket.tsx`) also key behaviour off this exact string.
export const OFF_GEOFENCE = "off_geofence" as const;

// Codes that resolve through the generic `errors.<code>` i18next
// lookup. The mobile parity test in `apiErrors.test.ts` iterates this
// list and asserts every entry has a translation in BOTH en.json and
// es.json — so adding a new locale-keyed code on the server without
// translating it fails the build.
//
// `OFF_GEOFENCE` is intentionally excluded from this list because it
// is translated through a dedicated branch (`tickets.offGeofence`)
// that interpolates `{distance}` / `{radius}`. It IS still a visit
// error code (and is therefore a member of the broader
// `AnyVisitErrorCode` union below) — callers that handle it should
// import the `OFF_GEOFENCE` constant directly so a typo still fails
// the build.
export const VISIT_ERROR_CODES = [
  AUTH_GUEST_REQUIRED,
  AUTH_GUEST_EXPIRED,
  AUTH_REQUIRED,
  GUEST_NAME_REQUIRED,
  GUEST_SAFETY_REQUIRED,
  SITE_NOT_FOUND,
  VISIT_INVALID_INPUT,
  VISIT_PARTNER_HOST_MISMATCH,
  VISIT_HOST_VENDOR_REQUIRED,
  VISIT_VENDOR_NOT_ASSIGNED,
  VISIT_LOCATION_REQUIRED,
  VISIT_INVALID_ID,
  VISIT_NOT_FOUND,
  VISIT_NO_ACCESS,
] as const;

export type VisitErrorCode = (typeof VISIT_ERROR_CODES)[number];

/** Every code emitted by `visits.ts`, including `off_geofence` which
 *  uses a dedicated translator branch instead of the generic
 *  `errors.<code>` path. */
export const ALL_VISIT_ERROR_CODES = [
  ...VISIT_ERROR_CODES,
  OFF_GEOFENCE,
] as const;

export type AnyVisitErrorCode = (typeof ALL_VISIT_ERROR_CODES)[number];

const VISIT_ERROR_CODE_SET: ReadonlySet<string> = new Set(VISIT_ERROR_CODES);
const ALL_VISIT_ERROR_CODE_SET: ReadonlySet<string> = new Set(
  ALL_VISIT_ERROR_CODES,
);

/** Type guard: narrows an arbitrary string-like value to a known
 *  visit error code that resolves through the generic
 *  `errors.<code>` i18next lookup. Lets the mobile translator (and
 *  any other consumer) decide whether a code coming off the wire is
 *  one of the locale-keyed codes the JSON files are guaranteed to
 *  cover. Returns false for `off_geofence` — use
 *  `isAnyVisitErrorCode` if you also want to accept that. */
export function isVisitErrorCode(value: unknown): value is VisitErrorCode {
  return typeof value === "string" && VISIT_ERROR_CODE_SET.has(value);
}

/** Type guard: narrows an arbitrary string-like value to ANY code
 *  emitted by `visits.ts`, including `off_geofence`. */
export function isAnyVisitErrorCode(
  value: unknown,
): value is AnyVisitErrorCode {
  return typeof value === "string" && ALL_VISIT_ERROR_CODE_SET.has(value);
}
