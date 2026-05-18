// Wire format + helpers for Zod validation failures emitted by the
// API and consumed by the web/mobile clients.
//
// Why a single shared module
// --------------------------
// Several routes used to return Zod's raw `error.message` JSON in the
// `error` or `message` field — which is human-readable English (e.g.
// `"Required"`, `"String must contain at least 8 character(s)"`) or
// JSON-shaped issue lists. The mobile/web error translators couldn't
// localize those because the only signal was a status code (400) and
// raw English copy; the most they could do was render a generic
// "Some information is missing or invalid." string.
//
// The contract introduced here:
//
//   * Server: any failed `safeParse` is converted into a structured
//     wire body via `zodErrorToWire(error)`. The body always includes
//     `code: "validation.failed"` (or a more specific semantic code
//     when the route caller has one), an English `message` for logs
//     and dev tools, and an `issues` array of `{ path, code, ... }`
//     entries derived directly from the Zod issue list.
//
//   * Mobile/web: the i18n-aware translator reads the issues array and
//     renders per-issue, per-rule, per-language copy — `"Required"`
//     becomes `"Este campo es obligatorio."` in `es`, and the form
//     can pin each message under the offending field via the `path`.
//
// Codes
// -----
// `VALIDATION_FAILED` is the default top-level code attached to the
// response. Routes that already have a more meaningful semantic code
// (e.g. `ticket.invalid_check_in_body`) can pass it via the helper's
// options; the `issues` array is attached either way so the client
// can surface inline messages even when the top-level code is more
// specific than `validation.failed`.

export const VALIDATION_FAILED = "validation.failed" as const;

/**
 * Path segment for a single Zod issue. Strings address object keys,
 * numbers address array indices. Mirrors `ZodIssue["path"]`.
 */
export type ZodIssueWirePath = ReadonlyArray<string | number>;

/**
 * Wire-shape of a single Zod issue. We keep the field set narrow and
 * stable — every property here is JSON-safe and survives a round trip
 * through `JSON.stringify`. Optional discriminator fields are present
 * only when the underlying issue type carries them, so the client can
 * pick the right localized rule (e.g. `validation: "email"` →
 * `errors.validation.issues.invalid_string_email`).
 */
export interface ZodIssueWire {
  /** Address of the offending value inside the parsed body. */
  path: ZodIssueWirePath;
  /** Zod's machine-readable issue code (`too_small`, `invalid_type`, ...). */
  code: string;
  /** English message Zod produced — kept for logs and dev tools, NOT for end users. */
  message: string;
  /** `invalid_type`: the expected type Zod was looking for. */
  expected?: string;
  /** `invalid_type`: what Zod actually got (`"undefined"` means "missing → required"). */
  received?: string;
  /** `too_small` / `too_big`: which value-kind the bound applies to. */
  type?: string;
  /** `too_small`: the lower bound. */
  minimum?: number;
  /** `too_big`: the upper bound. */
  maximum?: number;
  /** `too_small` / `too_big`: whether the bound is inclusive. */
  inclusive?: boolean;
  /** `invalid_string`: the sub-validator (`"email"`, `"url"`, `"uuid"`, ...). */
  validation?: string;
}

/**
 * Top-level wire shape returned for any failed safeParse. The HTTP
 * status is always 400. `code` is `"validation.failed"` by default
 * but routes can override it with a more specific semantic code
 * (e.g. `"ticket.invalid_check_in_body"`) when there is one — the
 * `issues` array is attached either way so the client can render
 * inline messages.
 */
export interface ValidationFailedBody {
  code: string;
  /** Mirrors the `code` for legacy clients that read `data.error`. */
  error: string;
  /** English copy for logs / dev tools — not for end users. */
  message: string;
  issues: ZodIssueWire[];
}

/** Minimal structural shape of a Zod issue we depend on. Avoids
 *  pulling Zod's full type into clients that only need to read the
 *  wire shape. */
export interface ZodIssueLike {
  path?: ReadonlyArray<unknown>;
  code?: unknown;
  message?: unknown;
  expected?: unknown;
  received?: unknown;
  type?: unknown;
  minimum?: unknown;
  maximum?: unknown;
  inclusive?: unknown;
  validation?: unknown;
}

/** Minimal structural shape of a `ZodError`. */
export interface ZodErrorLike {
  issues: ReadonlyArray<ZodIssueLike>;
  message: string;
}

function toPath(raw: unknown): ZodIssueWirePath {
  if (!Array.isArray(raw)) return [];
  return raw.map((seg) =>
    typeof seg === "number" ? seg : String(seg),
  );
}

function toFiniteNumber(raw: unknown): number | undefined {
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "bigint") return Number(raw);
  return undefined;
}

/** Convert a single Zod-shaped issue object into the JSON wire form
 *  that travels to the client. Drops fields the issue type doesn't
 *  carry so the body stays small. */
export function zodIssueToWire(issue: ZodIssueLike): ZodIssueWire {
  const wire: ZodIssueWire = {
    path: toPath(issue.path),
    code: typeof issue.code === "string" ? issue.code : "custom",
    message: typeof issue.message === "string" ? issue.message : "Invalid",
  };
  if (typeof issue.expected === "string") wire.expected = issue.expected;
  if (typeof issue.received === "string") wire.received = issue.received;
  if (typeof issue.type === "string") wire.type = issue.type;
  const min = toFiniteNumber(issue.minimum);
  if (min !== undefined) wire.minimum = min;
  const max = toFiniteNumber(issue.maximum);
  if (max !== undefined) wire.maximum = max;
  if (typeof issue.inclusive === "boolean") wire.inclusive = issue.inclusive;
  if (typeof issue.validation === "string") wire.validation = issue.validation;
  return wire;
}

/** Convert a `ZodError` (or anything structurally compatible) into
 *  the wire-shaped issue array. */
export function zodIssuesToWire(error: ZodErrorLike): ZodIssueWire[] {
  return error.issues.map(zodIssueToWire);
}

/** Build the full top-level body for a 400 validation-failed response. */
export function zodErrorToWire(
  error: ZodErrorLike,
  options?: { code?: string; error?: string },
): ValidationFailedBody {
  const code = options?.code ?? VALIDATION_FAILED;
  return {
    code,
    error: options?.error ?? code,
    message: error.message,
    issues: zodIssuesToWire(error),
  };
}

/** Type guard: did this error body include structured Zod issues? */
export function hasValidationIssues(
  body: unknown,
): body is { issues: ZodIssueWire[] } {
  if (!body || typeof body !== "object") return false;
  const maybe = body as { issues?: unknown };
  return Array.isArray(maybe.issues);
}

/**
 * Stable per-issue translation key. The mobile/web clients walk the
 * issues array and call `t(translationKeyFor(issue))` to render each
 * one in the user's language. The keys are designed so an issue type
 * that doesn't have a specific entry still resolves to the generic
 * `errors.validation.issues.default` copy via the i18next fallback,
 * never the raw English message.
 *
 * The mapping covers the issue codes Zod emits in practice on the
 * routes the mobile app calls today:
 *   - `invalid_type` with `received: "undefined"` → `required`
 *     (Zod's stock copy is "Required", which we want translated)
 *   - `invalid_type` (anything else) → `invalid_type`
 *   - `too_small` / `too_big` → suffixed with the bound type
 *     (`_string`, `_number`, `_array`, `_date`, `_set`) so we can
 *     render kind-appropriate copy ("Must be at least 8 characters"
 *     vs "Must be at least 1.")
 *   - `invalid_string` → suffixed with the sub-validator
 *     (`_email`, `_url`, `_uuid`, `_regex`, `_cuid`, `_datetime`)
 *   - everything else → the bare code
 */
export function translationKeyFor(issue: ZodIssueWire): string {
  const base = "errors.validation.issues";
  if (issue.code === "invalid_type") {
    if (issue.received === "undefined" || issue.received === "null") {
      return `${base}.required`;
    }
    return `${base}.invalid_type`;
  }
  if (issue.code === "too_small" || issue.code === "too_big") {
    const kind = issue.type;
    if (kind && /^[a-z]+$/.test(kind)) {
      return `${base}.${issue.code}_${kind}`;
    }
    return `${base}.${issue.code}`;
  }
  if (issue.code === "invalid_string") {
    const v = issue.validation;
    if (v && /^[a-z0-9_]+$/.test(v)) {
      return `${base}.invalid_string_${v}`;
    }
    return `${base}.invalid_string`;
  }
  return `${base}.${issue.code}`;
}

/**
 * Interpolation values to forward to i18next when rendering an
 * issue's translation. Includes only the values referenced by the
 * baseline EN/ES copy so a typo in a key doesn't crash the
 * placeholder substitution.
 */
export function interpolationFor(issue: ZodIssueWire): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (typeof issue.minimum === "number") out.minimum = issue.minimum;
  if (typeof issue.maximum === "number") out.maximum = issue.maximum;
  if (typeof issue.expected === "string") out.expected = issue.expected;
  if (typeof issue.received === "string") out.received = issue.received;
  if (typeof issue.validation === "string") out.validation = issue.validation;
  return out;
}

/** Stable string form of an issue's path: `addresses.0.zip` for
 *  `["addresses", 0, "zip"]`, `""` for the top-level. */
export function pathToString(path: ZodIssueWirePath): string {
  return path.map((seg) => String(seg)).join(".");
}
