import type { TFunction } from "i18next";

type ErrorBody = {
  error?: string;
  code?: string;
  message?: string;
  // Optional structured interpolation values forwarded to i18next as
  // `t(key, details)`. Lets the API attach the conflicting name (or
  // any other contextual data) without baking it into a generic
  // English-only `error` string. See Task #603.
  details?: Record<string, unknown>;
};

type ApiErrorish = Error & {
  status?: number;
  // Some callsites (e.g. AuthApiError) hoist the structured code onto
  // the error itself; honour that in addition to `data.code`. Mirrors
  // the mobile `apiErrors.ts` shape so the two clients stay aligned.
  code?: string;
  data?: ErrorBody | null;
  // axios-style nested response (some legacy callsites pass these through)
  response?: { status?: number; data?: ErrorBody | null };
};

function asApiError(e: unknown): ApiErrorish | null {
  if (e && typeof e === "object" && e instanceof Error) return e as ApiErrorish;
  return null;
}

// A "structured" code is a machine-readable identifier — snake_case and/or
// dot-notation, all lowercase, no spaces. Server routes use this convention
// (e.g. `vendor.not_found`, `auth.invalid_credentials`, `off_geofence`).
//
// Some legacy endpoints still put English copy in the JSON `error` field
// (e.g. `{ error: "Vendor not found" }`). We must not treat that English
// sentence as a code — otherwise we'd look up `errors.Vendor not found` and
// either miss the translation or fall through to the generic status-family
// fallback instead of the real code-based lookup attached on a sibling
// `code` field. Mirrors the mobile helper's `isStructuredCode()` guard.
const CODE_SHAPE = /^[a-z][a-z0-9_.]*$/;
function isStructuredCode(value: unknown): value is string {
  return typeof value === "string" && CODE_SHAPE.test(value);
}

/**
 * Extract the machine-readable error code from an API error, if any.
 *
 * Order of preference:
 *   1. `err.code` — set by some wrappers (e.g. AuthApiError) directly on
 *      the error object.
 *   2. `data.code` — preferred field on newer endpoints; web routes ship
 *      the structured code here alongside English `error` text.
 *   3. `data.error` — convention used by tickets/crew/schedule routes
 *      (Task #531 / #527 / #517) where the snake_case code is dropped
 *      directly into the `error` field.
 *
 * Returns null when the error is from a legacy endpoint that returns
 * English copy in `error` instead of a stable identifier, so callers can
 * fall through to generic status-family / fallback copy.
 */
export function getApiErrorCode(e: unknown): string | null {
  const err = asApiError(e);
  if (!err) return null;
  const data = err.data ?? err.response?.data ?? null;
  if (isStructuredCode(err.code)) return err.code;
  if (isStructuredCode(data?.code)) return data!.code as string;
  if (isStructuredCode(data?.error)) return data!.error as string;
  return null;
}

// Map an HTTP status onto a generic localized error key. Returning null
// means "no generic copy for this status" — the caller should fall
// through to the next strategy (caller fallback / err.message / unknown).
//
// Mirrors `statusToKey()` in `artifacts/vndrly-mobile/lib/apiErrors.ts`
// so the two clients agree on which families have generic copy. When
// adding a new family here, also add the matching key to en.json /
// es.json AND to the mobile helper.
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

// Normalize the HTTP status across the two error shapes we accept:
//   - fetch-style wrappers (`apiFetch`, `jf`, AuthApiError) hoist
//     `status` directly onto the Error object.
//   - axios-style errors keep it nested under `err.response.status`.
// Returns `undefined` when neither path produced a number — that's the
// signal `isNetworkError()` and `statusToKey()` use to mean "no HTTP
// status reached us".
function getApiErrorStatus(err: ApiErrorish | null): number | undefined {
  if (!err) return undefined;
  if (typeof err.status === "number") return err.status;
  if (typeof err.response?.status === "number") return err.response.status;
  return undefined;
}

// Detect a `fetch()` rejection caused by the network being unreachable
// (no connection, DNS failure, CORS preflight failure, etc.). Browsers
// throw a `TypeError` with a message like "Failed to fetch" or
// "NetworkError when attempting to fetch resource."; node-undici uses
// "fetch failed". The HTTP status is undefined in all of these cases
// (across both fetch-style and axios-style shapes) — nothing reached
// the server, so there's no HTTP status to map.
function isNetworkError(err: ApiErrorish | null): boolean {
  if (!err) return false;
  if (getApiErrorStatus(err) != null) return false;
  if (err.name === "TypeError") return true;
  return /failed to fetch|network ?error|fetch failed|network request failed/i.test(
    err.message ?? "",
  );
}

/**
 * Translate an API error into a user-facing string, using structured
 * codes from the response body when available and falling back through
 * generic HTTP-status families so Spanish-speaking admins never see raw
 * English server text.
 *
 * Lookup order:
 *   1. Structured code from `err.code` / `data.code` / `data.error`
 *      (looked up under `errors.<code>`, with optional interpolation
 *      values from `data.details`).
 *   2. Network-failure detection — `fetch()` rejected before the server
 *      could respond → `errors.network.unreachable`.
 *   3. HTTP status family (401, 403, 404, 409, 422, 4xx, 5xx) → generic
 *      translated copy under `errors.<key>`.
 *   4. The caller-supplied translated fallback (e.g. "Failed to deny
 *      invite") — already in the user's language.
 *   5. The raw English `data.message` if present.
 *   6. The Error.message verbatim.
 *   7. `errors.unknownError` as the last resort.
 *
 * Mirrors the mobile `translateApiError()` in
 * `artifacts/vndrly-mobile/lib/apiErrors.ts` so both clients use the
 * same precedence and key names.
 */
export function translateApiError(
  e: unknown,
  t: TFunction,
  fallback?: string,
): string {
  const err = asApiError(e);
  const data = err?.data ?? err?.response?.data ?? null;

  // Forward any structured `details` payload (e.g. `{ name: "Acme" }`)
  // to i18next as interpolation values so the localized copy can render
  // `{{name}}` placeholders. Defensive guard against `details: "string"`.
  const interpolation =
    data && data.details && typeof data.details === "object" && !Array.isArray(data.details)
      ? (data.details as Record<string, unknown>)
      : undefined;

  // 1. Code-based lookup — the preferred path for any endpoint that
  // attaches a structured code. Survives English copy changes on the
  // server and works in any UI language.
  const code = getApiErrorCode(e);
  if (code) {
    const key = `errors.${code}`;
    const translated = interpolation ? t(key, interpolation) : t(key);
    if (translated && translated !== key) return translated;
  }

  // 2. Network failure (no HTTP status reached us) — generic copy.
  if (isNetworkError(err)) {
    const key = "errors.network.unreachable";
    const translated = t(key);
    if (translated && translated !== key) return translated;
  }

  // 3. Status-family generic fallback. Read through `getApiErrorStatus`
  // so axios-style errors (status nested under `response.status`) get
  // the same treatment as fetch-style errors with `err.status` hoisted
  // onto the Error.
  const statusKey = statusToKey(getApiErrorStatus(err));
  if (statusKey) {
    const translated = t(statusKey);
    if (translated && translated !== statusKey) return translated;
  }

  // 4. Caller-supplied (already-translated) fallback.
  if (fallback) return fallback;

  // 5–7. Raw text last, then `errors.unknownError`.
  if (data?.message && typeof data.message === "string") return data.message;
  if (err?.message) return err.message;
  const unknown = t("errors.unknownError");
  if (unknown && unknown !== "errors.unknownError") return unknown;
  return "";
}
