import type { TFunction } from "i18next";

import { CREW_VALIDATION_CODES } from "@workspace/crew-validation-codes";
import { TICKET_STATE_CONFLICT_CODES } from "@workspace/ticket-state-conflict-codes";
import {
  OFF_GEOFENCE,
  isVisitErrorCode,
  type VisitErrorCode,
} from "@workspace/visit-error-codes";
import {
  VALIDATION_FAILED,
  hasValidationIssues,
  interpolationFor,
  pathToString,
  translationKeyFor,
  type ZodIssueWire,
  type ZodIssueWirePath,
} from "@workspace/zod-validation-issues";

type ApiError = Error & {
  status?: number;
  code?: string;
  data?: {
    code?: string;
    message?: string;
    error?: string;
    status?: string;
    distanceMeters?: number;
    radiusMeters?: number;
    // Structured Zod issues attached by the api-server's
    // `sendValidationFailed()` helper. Each entry has `path` (the
    // address of the offending field, e.g. `["password"]`) and
    // `code` (Zod's machine-readable issue type, e.g. `too_small`,
    // `invalid_string`). The mobile translator walks this array
    // with `translateValidationIssues()` to produce per-field
    // localized messages instead of dropping the user back at the
    // generic "Some information is missing or invalid" copy.
    issues?: ZodIssueWire[];
    // Optional structured interpolation values forwarded to i18next as
    // `t(key, details)`. Lets the API attach the conflicting name (or
    // any other contextual data) without baking it into a generic
    // English-only `error` string. Mirrors the web's translateApiError
    // contract so EN/ES copy can render `{{name}}` placeholders.
    details?: Record<string, unknown>;
  } | null;
};

function asApiError(e: unknown): ApiError | null {
  if (e && typeof e === "object" && e instanceof Error) return e as ApiError;
  return null;
}

// A "structured" code is a machine-readable identifier — snake_case and/or
// dot-notation, all lowercase, no spaces. The server uses this convention
// (e.g. `site_not_found`, `field.account_inactive`, `off_geofence`).
//
// Some legacy endpoints still put English copy in the JSON `error` field
// (e.g. `{ error: "Site not found" }`). We must not treat that English
// sentence as a code — otherwise we'd look up `errors.Site not found` and
// fall through to the generic status-family translation instead of the
// real code-based lookup attached on a sibling field.
const CODE_SHAPE = /^[a-z][a-z0-9_.]*$/;
function isStructuredCode(value: unknown): value is string {
  return typeof value === "string" && CODE_SHAPE.test(value);
}

/**
 * Extract the machine-readable error code from an API error, if any.
 *
 * Order of preference:
 *   1. `err.code` — set by `apiFetch()` when the body has `code`
 *   2. `err.data.code` — preferred field on newer endpoints
 *   3. `err.data.error` — convention used by tickets.ts (Task #509 / #517)
 *
 * Returns null when the error is from a legacy endpoint that returns
 * English copy in the `error` field rather than a stable identifier, so
 * callers can distinguish "no structured code" from "code = X". Screens
 * use this to decide whether to surface the error inline next to a
 * specific form field (when there's a code) or as a generic toast/alert.
 */
export function getApiErrorCode(e: unknown): string | null {
  const err = asApiError(e);
  if (!err) return null;
  if (isStructuredCode(err.code)) return err.code;
  if (isStructuredCode(err.data?.code)) return err.data!.code as string;
  if (isStructuredCode(err.data?.error)) return err.data!.error as string;
  return null;
}

function statusToKey(status: number | undefined): string | null {
  if (status == null) return null;
  if (status === 401) return "errors.unauthorized";
  if (status === 403) return "errors.forbidden";
  if (status === 404) return "errors.notFound";
  if (status === 409) return "errors.conflict";
  if (status === 422) return "errors.validationFailed";
  if (status >= 500) return "errors.server.internal_error";
  if (status >= 400) return "errors.badRequest";
  return null;
}

/**
 * Translate an API error into a human-readable string in the user's language.
 *
 * Lookup order:
 *   1. `getApiErrorCode(e)` — machine-readable code returned by the API
 *      (looked up at `errors.<code>`, supporting both flat snake_case
 *      keys like `errors.site_not_found` and nested dot-notation keys
 *      like `errors.field.account_inactive`)
 *   2. err.status mapped to a generic family (401 -> unauthorized, etc.)
 *   3. The provided fallback (already-translated string, e.g. "Failed to check in")
 *   4. err.message verbatim
 *   5. errors.unknownError
 *
 * Use this anywhere an API error is shown to the user (Alert, toast, banner)
 * so Spanish-speaking field employees never see English text from the API.
 */
export function translateApiError(
  e: unknown,
  t: TFunction,
  fallback?: string,
): string {
  const err = asApiError(e);

  // 1. Special-case off_geofence — needs interpolation with distance & radius.
  // getApiErrorCode() already covers err.code, err.data.code, AND err.data.error
  // (Task #527 endpoints emit codes via the `error` field) with snake_case
  // shape validation, so we don't need to re-derive the code inline here.
  const code = getApiErrorCode(e);
  if (
    code === OFF_GEOFENCE &&
    typeof err?.data?.distanceMeters === "number" &&
    typeof err?.data?.radiusMeters === "number"
  ) {
    return t("tickets.offGeofence", {
      distance: err.data.distanceMeters,
      radius: err.data.radiusMeters,
    });
  }

  // 2. Structured Zod issues (Task #164): if the API returned the new
  // `validation.failed` shape with an `issues` array, render each issue
  // in the user's language and join them so the banner-level message
  // is informative ("Email isn't valid. Password must be at least 8
  // characters.") instead of the generic "Some information is missing
  // or invalid." copy. Per-field inline rendering is exposed
  // separately via `translateValidationIssues()`.
  //
  // This runs BEFORE the generic code lookup so that the more specific
  // per-issue messages win over the catch-all `errors.validation.failed`
  // banner when both are present. When the issues array is empty the
  // generic banner still wins via the lookup below.
  const issues = err?.data?.issues;
  if (Array.isArray(issues) && issues.length > 0) {
    const parts = issues
      .map((issue) => translateZodIssue(issue, t))
      .filter((s): s is string => typeof s === "string" && s.length > 0);
    if (parts.length > 0) return parts.join(" ");
  }

  // 3. Code-based lookup (the preferred path for any endpoint that
  // attaches a structured code — survives English copy changes on the
  // server and works in any UI language).
  if (code) {
    const key = `errors.${code}`;
    // Forward any structured `details` payload (e.g. `{ name: "Acme" }`)
    // to i18next as interpolation values so the localized copy can
    // render `{{name}}` placeholders. Mirrors the web's translateApiError
    // helper. Defensive guard against bogus `details: "string"` etc.
    const rawDetails = err?.data?.details;
    const interpolation =
      rawDetails && typeof rawDetails === "object" && !Array.isArray(rawDetails)
        ? (rawDetails as Record<string, unknown>)
        : undefined;
    const translated = interpolation ? t(key, interpolation) : t(key);
    if (translated !== key) return translated;
  }

  // 4. Status-based generic fallback.
  const statusKey = statusToKey(err?.status);
  if (statusKey) {
    const translated = t(statusKey);
    if (translated !== statusKey) return translated;
  }

  // 4. Caller-supplied (already-translated) fallback.
  if (fallback) return fallback;

  // 5. Last resort.
  return err?.message || t("common.unknownError");
}

// ── Task #550: typed helper for visits-flow error codes ──
//
// `translateApiError()` above already handles every visit error code via
// the generic `errors.${code}` lookup, so screens that pass the raw
// thrown error don't need to know any of the codes. This helper is for
// callers that have already discriminated to a specific visit error
// code (e.g. mapping a host-mismatch to an inline message under the
// host picker) and want compile-time safety:
//
//   - `code` is typed as the shared `VisitErrorCode` union, so a typo
//     fails `pnpm run typecheck` instead of silently shipping.
//   - The lookup key is derived from the same constant, so a server
//     rename propagates through `@workspace/visit-error-codes` to both
//     the route emit site and this consumer in lockstep.
//
// `errors.<dot.code>` resolves through i18next's nested-key behaviour
// against the `visit.*`, `auth.*`, `guest.*`, and `site.*` blocks in
// `locales/{en,es}.json`. The locale parity test in `apiErrors.test.ts`
// asserts that every `VisitErrorCode` has a matching entry in both
// languages — so adding a new code on the server without translating
// it fails the build instead of falling through to the generic
// status-family copy at runtime.
export function translateVisitError(
  code: VisitErrorCode,
  t: TFunction,
): string {
  return t(`errors.${code}`);
}

/** Re-export the runtime guard so callers can narrow an arbitrary
 *  string (off `err.code` or `err.data.code`) to the visit-namespace
 *  union before calling `translateVisitError`. */
export { isVisitErrorCode };
export type { VisitErrorCode };

// ── Task #532: per-control inline errors for the mobile ticket screen ──
//
// Mirrors the web app's `inlineErrorFor()` mapping in
// `schedule-ticket-dialog.tsx`. Given an API error and a preferred field
// (the control the user just tapped), this returns:
//   - `field`: which control should render the error inline. Some codes
//     belong on a different control than the one tapped (e.g. a
//     `foreman_*_mismatch` returned from a crew check-in belongs on the
//     crew picker, not the check-in button).
//   - `message`: the localized message ready to render.
//   - `isStateConflict`: true when the error means the ticket has moved
//     on (someone else accepted/denied/cancelled, the lifecycle changed,
//     etc). Callers should refresh the ticket and clear the inline error
//     instead of pinning it under the button — the button may not even
//     be there after the refresh.
export type TicketActionField =
  | "accept"
  | "deny"
  | "en_route"
  // T003: vendor pressed "On Location" — physically arrived but not on
  // the clock yet. Inline errors from POST /tickets/:id/on-location pin
  // under the new button between "En Route" and "Check In" so the
  // failure surfaces next to the control that triggered it.
  | "on_location"
  | "check_in"
  | "check_out"
  | "close"
  | "awaiting_payment"
  // Task #600: AP-side action that flips an approved or awaiting_payment
  // ticket into funds_dispersed. The button + modal both pin their
  // inline error here so the user sees what failed without dismissing
  // the modal first.
  | "disperse_funds"
  // Task #853: AP self-service action that snapshots the payment columns
  // into payment_audit and flips a funds_dispersed ticket back to
  // approved. Errors pin under the reason input in the reverse-dispersal
  // sheet so the user can correct and retry without dismissing it.
  | "reverse_dispersal"
  | "crew_picker"
  | "general";

export type InlineActionError = {
  field: TicketActionField;
  message: string;
  isStateConflict: boolean;
};

// Codes that indicate the server's view of the ticket no longer matches
// the device's view. The right UX is to silently re-fetch and let the
// user decide what to do next, rather than pinning a stale error under
// a control that may have just disappeared.
//
// Task #870: the canonical 409 set lives in the shared workspace lib
// `@workspace/ticket-state-conflict-codes` (and is also mirrored in
// the OpenAPI spec). Importing the constant array from the lib means a
// server rename propagates here through `pnpm run typecheck` — no
// hand-maintained mirror to drift out of sync. We extend the canonical
// set with a few extra codes that aren't part of the 409 contract but
// should still trigger the same "refresh and try again" UX (see
// per-entry comments below).
const STATE_CONFLICT_CODES: ReadonlySet<string> = new Set<string>([
  ...TICKET_STATE_CONFLICT_CODES,
  // Legacy dot-notation alias still emitted on the `code` field by the
  // en-route route alongside the canonical snake_case `error`. Kept here
  // so an older client that reads `code` still routes through the
  // refresh UX. Not part of the canonical server-side set.
  "ticket.en_route_invalid_state",
  // Task #561: another device (or this device, racing) already removed
  // the crew member from the ticket roster. The chip the foreman tapped
  // should silently disappear on the next refresh — there's no point
  // pinning "not on roster" under a chip that's about to vanish.
  "crew.not_on_roster",
  // Task #575: the awaiting-payment route returns this when the ticket
  // has already moved out of in_progress (e.g. another device just
  // submitted it for review). The button is about to disappear after
  // the refresh, so we silently reload instead of pinning a stale error.
  "ticket_not_in_progress",
]);

// Codes that name a crew/foreman membership problem — even when they
// surface from a different mutation, they belong on the crew picker.
//
// Task #870: the canonical set lives in the shared workspace lib
// `@workspace/crew-validation-codes` (which the api-server route emit
// sites also import from). Importing `CREW_VALIDATION_CODES` here
// means a server rename or addition propagates through
// `pnpm run typecheck` — no hand-maintained mirror to silently drift
// out of sync and surface a new code as a generic toast instead of an
// inline error pinned to the crew picker.
const CREW_PICKER_CODES: ReadonlySet<string> = new Set<string>(
  CREW_VALIDATION_CODES,
);

export function inlineErrorForTicketAction(
  e: unknown,
  t: TFunction,
  preferredField: Exclude<TicketActionField, "general">,
  fallback: string,
): InlineActionError {
  const code = getApiErrorCode(e);
  const message = translateApiError(e, t, fallback);
  const isStateConflict = code != null && STATE_CONFLICT_CODES.has(code);
  let field: TicketActionField = preferredField;
  if (code != null && CREW_PICKER_CODES.has(code)) {
    field = "crew_picker";
  }
  return { field, message, isStateConflict };
}

// ── Task #164: per-issue Zod validation translation ──
//
// The api-server's `sendValidationFailed()` helper attaches a
// structured `issues` array on every failed `safeParse` (see
// `@workspace/zod-validation-issues` for the wire shape). The
// helpers below translate that array on the client so:
//
//   * `translateZodIssue(issue, t)` returns a single localized string
//     for one issue, picking the right key for the issue's code +
//     bound type + sub-validator (so `too_small` on a string is
//     "Must be at least 8 characters" but on a number is "Must be at
//     least 1.").
//
//   * `translateValidationIssues(e, t)` walks an entire API error
//     and returns an array of `{ path, field, message }` entries
//     ready to render inline next to a form control. `field` is the
//     top-level path segment (typical case: a flat body shape like
//     `{ email, password }`), so a form can keep a
//     `Record<field, message>` map and look up each control's error
//     in one go.
//
// When the API returns a generic banner-level message
// (translateApiError) AND the form pins per-control errors via
// `translateValidationIssues`, the user sees both: a top-of-screen
// summary and inline arrows next to the offending fields.

/** Translate a single structured Zod issue into a localized string.
 *  Returns the raw English `issue.message` only as a last resort if
 *  no translation key matches and there's no generic fallback. */
export function translateZodIssue(
  issue: ZodIssueWire,
  t: TFunction,
): string {
  const key = translationKeyFor(issue);
  const interpolation = interpolationFor(issue);
  const translated = Object.keys(interpolation).length > 0
    ? t(key, interpolation)
    : t(key);
  if (translated !== key) return translated;
  // Specific key missing — try the same code without the sub-suffix
  // (`errors.validation.issues.too_small_string` → `..._too_small`).
  const baseKey = `errors.validation.issues.${issue.code}`;
  if (baseKey !== key) {
    const baseTranslated = Object.keys(interpolation).length > 0
      ? t(baseKey, interpolation)
      : t(baseKey);
    if (baseTranslated !== baseKey) return baseTranslated;
  }
  // Generic catch-all so a brand-new Zod issue code never leaks raw
  // English to a Spanish-speaking user.
  const defaultKey = "errors.validation.issues.default";
  const defaultTranslated = t(defaultKey);
  if (defaultTranslated !== defaultKey) return defaultTranslated;
  // Last resort: Zod's English copy. Always preferred over a raw key.
  return issue.message;
}

export interface ValidationIssueDescriptor {
  /** Address of the offending field, e.g. `["addresses", 0, "zip"]`. */
  path: ZodIssueWirePath;
  /** Top-level path segment (e.g. `"email"` for `["email"]`,
   *  `"addresses"` for `["addresses", 0, "zip"]`). Empty string when
   *  the issue applies to the root of the body — useful as a Map
   *  key for forms whose field names mirror the request body. */
  field: string;
  /** Stable string form of `path`. Useful as a key in nested forms
   *  (`addresses.0.zip` vs just `addresses`). */
  pathKey: string;
  /** Localized message ready to render. */
  message: string;
}

/** Walk an API error's `issues` array and return one descriptor per
 *  issue. Returns an empty array when the error wasn't a structured
 *  validation failure — callers can then fall back to
 *  `translateApiError()` for a banner-level message. */
export function translateValidationIssues(
  e: unknown,
  t: TFunction,
): ValidationIssueDescriptor[] {
  const err = asApiError(e);
  const issues = err?.data?.issues;
  if (!Array.isArray(issues) || issues.length === 0) return [];
  return issues.map((issue) => {
    const path = Array.isArray(issue.path) ? issue.path : [];
    const field = path.length > 0 ? String(path[0]) : "";
    return {
      path,
      field,
      pathKey: pathToString(path),
      message: translateZodIssue(issue, t),
    };
  });
}

/** Build a `{ field → message }` map from an API error's structured
 *  Zod issues, keyed by the top-level field name (`"email"`,
 *  `"password"`, etc). Suitable for forms whose controls have one
 *  input per top-level body key — the common case for the mobile
 *  signup, login, and check-in screens. Later issues for the same
 *  field overwrite earlier ones (Zod typically only emits one issue
 *  per leaf, so this is rarely a problem in practice).
 *
 *  Returns an empty object when the error isn't a validation
 *  failure, so callers can safely splat it into existing state. */
export function inlineFieldErrors(
  e: unknown,
  t: TFunction,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const desc of translateValidationIssues(e, t)) {
    if (desc.field) out[desc.field] = desc.message;
  }
  return out;
}

/** Did the API return a structured validation-failed body? Used by
 *  forms to decide whether to render inline field errors in addition
 *  to (or instead of) the banner-level translateApiError message. */
export function isValidationFailedError(e: unknown): boolean {
  const err = asApiError(e);
  if (!err?.data) return false;
  if (err.data.code === VALIDATION_FAILED) return true;
  return hasValidationIssues(err.data);
}

export type { ZodIssueWire };
