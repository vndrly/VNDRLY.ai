import type express from "express";

/**
 * Shared test-app helpers for route-level vitest specs.
 *
 * WHY THIS EXISTS
 * ---------------
 * Route tests build an `express()` app, mount the production router, and ship
 * requests at it with supertest. When the route handler throws — most often
 * because a fixture row is missing a field that the response Zod schema
 * requires — express turns the throw into a generic 500. Earlier per-file
 * error middlewares only surfaced `err.message`, which for a `ZodError` is a
 * useless "Invalid input" string. The actual issue list (`err.issues`) was
 * dropped on the floor and the only test signal was
 *
 *     AssertionError: expected 500 to be 200
 *
 * with no clue about which field was missing. Task #716 traced one of these
 * back to a single missing `intakeChannel` column and called for a more
 * proactive diagnostic surface.
 *
 * The helpers below give every route test the same richer surface:
 *
 *   * `attachTestErrorMiddleware(app)` installs an error handler that copies
 *     the underlying error's name, message, *and* (for ZodError) its parsed
 *     `issues` into the JSON response body. Tests that inspect the body now
 *     see the real cause; the body is also the input to `expectStatus` below.
 *   * `expectStatus(res, expected)` asserts the supertest status code and, on
 *     mismatch, throws an `Error` whose message embeds the response body. So
 *     a bad fixture surfaces as
 *
 *         Error: expected status 200 but got 500. Response body:
 *         { "name": "ZodError",
 *           "error": "Invalid input",
 *           "issues": [ { "path": ["intakeChannel"], "code": "invalid_union", ... } ] }
 *
 *     instead of the opaque `expected 500 to be 200`.
 *
 * Prefer these helpers in any new route test rather than rolling another
 * local error middleware. Existing files have been migrated to use them.
 */

interface ZodIssueLike {
  path?: ReadonlyArray<unknown>;
  code?: string;
  message?: string;
  expected?: unknown;
  received?: unknown;
}

interface ZodErrorLike {
  name?: string;
  issues?: ReadonlyArray<ZodIssueLike>;
}

function pickZodIssues(err: unknown): ZodIssueLike[] | undefined {
  if (!err || typeof err !== "object") return undefined;
  const maybe = err as ZodErrorLike;
  if (maybe.name !== "ZodError" || !Array.isArray(maybe.issues)) {
    return undefined;
  }
  // Re-shape so the body is JSON-serialisable and easy to scan in a test
  // failure message. We deliberately keep the field names short and
  // include the join'd path so a reader can spot the bad field at a glance.
  return maybe.issues.map((issue) => {
    const out: ZodIssueLike & { pathStr?: string } = {
      path: issue.path,
      code: issue.code,
      message: issue.message,
    };
    if (issue.expected !== undefined) out.expected = issue.expected;
    if (issue.received !== undefined) out.received = issue.received;
    if (Array.isArray(issue.path)) {
      out.pathStr = issue.path.map((p: unknown) => String(p)).join(".");
    }
    return out;
  });
}

export interface TestErrorMiddlewareOptions {
  /**
   * When true (the default), the middleware logs the error to `console.error`
   * with a `[test-app] unhandled route error:` prefix in addition to writing
   * the JSON body. Pass `false` to silence the log when a test is
   * intentionally exercising an error path (keeps test output tidy).
   */
  logErrors?: boolean;
}

/**
 * Install an express error-handling middleware that converts an unhandled
 * route error into a 500 JSON response carrying enough detail to diagnose the
 * underlying cause from the response body alone. Pair with `expectStatus` so
 * that a mismatched status assertion automatically prints that body.
 *
 * Call this *after* mounting the router under test so it sits at the end of
 * the middleware chain.
 */
export function attachTestErrorMiddleware(
  app: express.Express,
  opts: TestErrorMiddlewareOptions = {},
): void {
  const logErrors = opts.logErrors !== false;
  app.use(
    (
      err: unknown,
      _req: express.Request,
      res: express.Response,
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      _next: express.NextFunction,
    ) => {
      const e = err as { message?: unknown; name?: unknown; stack?: unknown };
      const body: Record<string, unknown> = {
        error: String(e?.message ?? err),
      };
      if (typeof e?.name === "string" && e.name !== "Error") {
        body.name = e.name;
      }
      const issues = pickZodIssues(err);
      if (issues) {
        body.issues = issues;
      }
      if (typeof e?.stack === "string") {
        // Trim the stack to the first few frames so the body stays readable
        // when it gets dumped into a test-failure message.
        body.stack = e.stack.split("\n").slice(0, 6).join("\n");
      }
      if (logErrors) {
        // Pass a pre-built string instead of the raw `err` object. On some
        // Node versions, `console.error(zodError)` triggers an internal
        // `util.inspect` TypeError ("Cannot read properties of undefined
        // (reading 'value')") because of how Zod attaches non-standard
        // property descriptors. That throw propagates back into express's
        // default error handler and replaces our JSON 500 with an HTML
        // page — masking the very Zod issues we are trying to surface.
        // Stringifying the body up-front keeps logging side-effect-free.
        let logSummary: string;
        try {
          logSummary = JSON.stringify(body);
        } catch {
          logSummary = String(e?.message ?? err);
        }
        // eslint-disable-next-line no-console
        console.error("[test-app] unhandled route error:", logSummary);
      }
      res.status(500).json(body);
    },
  );
}

interface SupertestLike {
  status: number;
  // Optional because some callers pass a tiny `{ status, json }` shim (see
  // locations-sse.test.ts) that doesn't carry the supertest body field.
  body?: unknown;
  // `unknown` because supertest exposes `text` as a string while the global
  // `fetch` Response (used by the SSE tests) exposes it as
  // `() => Promise<string>`. We only consume it when it actually IS a string.
  text?: unknown;
}

/**
 * Assert a supertest response has the expected HTTP status. On mismatch,
 * throws an Error whose message includes the response body so a fixture-shape
 * bug (typically a Zod parse failure) is visible in the test output without
 * having to set a breakpoint or re-run with extra logging.
 *
 * Use this in place of `expect(res.status).toBe(expected)` whenever the test
 * uses `attachTestErrorMiddleware` — the two are designed to work together.
 */
export function expectStatus(res: SupertestLike, expected: number): void {
  if (res.status === expected) return;
  let bodyStr: string;
  try {
    bodyStr = JSON.stringify(res.body, null, 2);
  } catch {
    bodyStr = String(res.body);
  }
  if (
    (!bodyStr || bodyStr === "{}" || bodyStr === "null") &&
    typeof res.text === "string"
  ) {
    bodyStr = res.text;
  }
  throw new Error(
    `expected status ${expected} but got ${res.status}. Response body:\n${bodyStr}`,
  );
}
