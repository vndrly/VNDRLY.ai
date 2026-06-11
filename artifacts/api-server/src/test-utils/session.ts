import crypto from "crypto";

/**
 * Shared session-cookie helper for API-server tests.
 *
 * WHY THIS EXISTS
 * ---------------
 * The production session decoders (e.g. `getStaffSession` in
 * `routes/visits.ts`, `getSession` in `routes/locations.ts`) require a numeric
 * `exp` claim and return 401 for any session without one. A common bug in
 * earlier per-file test helpers was to base64-encode the raw payload directly,
 * producing a session with no `exp` — every protected endpoint in the suite
 * then 401'd, which previously masked 160 failing tests across 19 files.
 *
 * Prefer importing `signTestSession` / `buildTestCookie` from this module in
 * any new test rather than rolling another local copy. The default expiry is
 * one hour from now, which is far enough in the future for any test run.
 *
 * The signing scheme (base64url-ish payload + HMAC-SHA256 over the body, joined
 * by ".") matches what the production `signSession` in `lib/sessionCookie.ts`
 * produces and what the route decoders accept.
 */

export const DEFAULT_TEST_COOKIE_NAME = "vndrly_session";

/**
 * Default HMAC secret used by the test helpers when the caller does not pass
 * one explicitly. This is intentionally a hard-coded literal — we deliberately
 * do **not** read `process.env.SESSION_SECRET` here.
 *
 * In shared dev environments the shell may set a real
 * `SESSION_SECRET` that does not match what tests rely on. If this helper
 * silently honored that env var, route tests that mock
 * `lib/session.SESSION_SECRET` to `"test-secret"` would sign cookies with the
 * wrong key and fail with 401 in a way that is hard to diagnose. Forcing the
 * default to the literal `"test-secret"` (matching the value `test/setup.ts`
 * pins on `process.env.SESSION_SECRET`) makes the failure mode explicit:
 * either the test mocks the route's `SESSION_SECRET` to `"test-secret"` and
 * everything lines up, or it passes its own `secret` to `signTestSession` /
 * `buildTestCookie` to match a custom mock.
 */
export const DEFAULT_TEST_SESSION_SECRET = "test-secret";

export interface SignTestSessionOptions {
  /**
   * HMAC secret used to sign the cookie. Defaults to the literal
   * `"test-secret"` (`DEFAULT_TEST_SESSION_SECRET`). The default intentionally
   * ignores `process.env.SESSION_SECRET` so that a polluted shell environment
   * cannot silently mis-sign test cookies — see the doc comment on
   * `DEFAULT_TEST_SESSION_SECRET` for context.
   */
  secret?: string;
  /**
   * Override the `exp` (epoch seconds) added to the payload. Takes precedence
   * over any `exp` already on `payload`. If neither is provided, the helper
   * auto-injects `Math.floor(Date.now() / 1000) + 3600`. Pass an explicit
   * value (e.g. a past timestamp) when a test needs an intentionally expired
   * session.
   */
  exp?: number;
}

/**
 * Sign a test session payload, automatically injecting an `exp` claim so the
 * production decoders accept it. Returns the raw `<body>.<sig>` string (no
 * cookie name prefix). Use `buildTestCookie` if you also want the
 * `name=value` cookie header.
 *
 * Resolution order for the `exp` claim is: `opts.exp` > `payload.exp` (if
 * the caller already put one on the payload) > the default 1-hour future
 * expiry.
 */
export function signTestSession(
  payload: object,
  opts: SignTestSessionOptions = {},
): string {
  const secret = opts.secret ?? DEFAULT_TEST_SESSION_SECRET;
  const payloadExp = (payload as { exp?: unknown }).exp;
  const exp =
    opts.exp ??
    (typeof payloadExp === "number"
      ? payloadExp
      : Math.floor(Date.now() / 1000) + 3600);
  const body = Buffer.from(
    JSON.stringify({ ...payload, exp }),
    "utf-8",
  ).toString("base64");
  const sig = crypto.createHmac("sha256", secret).update(body).digest("hex");
  return `${body}.${sig}`;
}

/**
 * Build a complete `Cookie:` header value (`name=<signed>`) for a test
 * session. Use this when you want a drop-in `Cookie` header to send with
 * supertest.
 */
export function buildTestCookie(
  payload: object,
  opts: SignTestSessionOptions & { cookieName?: string } = {},
): string {
  const name = opts.cookieName ?? DEFAULT_TEST_COOKIE_NAME;
  return `${name}=${signTestSession(payload, opts)}`;
}
