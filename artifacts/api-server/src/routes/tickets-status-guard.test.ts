import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

// Task #500 — meta lint (extended by Task #846 to cover PATCH/DELETE)
//
// Closes the loop on Task #494 by failing CI if anyone adds a new
// per-ticket mutation endpoint — `router.post`, `router.patch`, or
// `router.delete` against `/tickets/:id/...` (or `/tickets/:id` itself
// for PATCH) — without applying one of the recognized vendor-accept
// guards (or explicitly opting out via a `@no-accept-guard` comment
// with rationale). The full checklist lives in the comment block at
// the top of `tickets.ts` — keep these two in sync.
//
// Task #846 broadened the surface from POST-only to PATCH/DELETE
// because the original bypass surface was POST-only at the time of
// Task #500, but a future engineer adding a PATCH that touches `status`
// (or a DELETE that triggers a transition) would silently re-open the
// same class of bypass the meta lint was designed to prevent.
//
// We intentionally read the source file as text (not the compiled router)
// because the guard policy is a static-shape contract, not a runtime
// behavior. Mocking out 19 endpoints to assert each one returns 409 in the
// right state would be both fragile and far slower than a regex pass.

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const TICKETS_ROUTES_PATH = resolve(__dirname, "./tickets.ts");

// Any one of these tokens, when present in the route handler body, counts
// as a recognized vendor-accept guard. The list mirrors the checklist
// comment at the top of `tickets.ts` — if you add a new guard helper,
// extend BOTH the comment and this list.
const RECOGNIZED_GUARD_TOKENS: ReadonlyArray<string> = [
  "ensureAccepted",
  "ensureTicketMutable",
  "MUTABLE_TICKET_STATUSES",
  "PRE_ACCEPT_STATUSES",
  "REINVITE_ELIGIBLE_STATUSES",
  "CHECK_IN_ALLOWED",
  "awaiting_acceptance", // literal status used in /accept and /deny CAS
  "allowedStatus",       // local allowlist used by /en-route
  "@no-accept-guard",    // explicit, documented opt-out
];

interface RouteHandler {
  method: "post" | "patch" | "delete"; // upper-cased in messages
  path: string;        // e.g. "/tickets/:id/check-in"
  body: string;        // handler source from the route declaration to next route
  startLine: number;   // 1-based line number for the router.<verb>(...) line
}

function loadRouteHandlers(): RouteHandler[] {
  const source = readFileSync(TICKETS_ROUTES_PATH, "utf8");
  const lines = source.split("\n");

  // Match per-ticket mutation declarations. We only care about the
  // per-ticket mutation surface; collection routes like `/tickets` and
  // `/tickets/direct-award` are handled separately and are out of scope
  // for the vendor-accept handshake.
  //
  // Task #846 broadened this from POST-only to also cover PATCH and
  // DELETE because a future engineer adding a PATCH that flips `status`
  // (or a DELETE that triggers a status transition) would otherwise
  // silently bypass the Task #494 invite handshake. PUT is intentionally
  // omitted: the codebase consistently uses PATCH for partial updates,
  // so flagging PUT here would only produce false positives if the
  // convention changed.
  //
  // The path group allows zero or more `/segment` parts so that:
  //   • `PATCH /tickets/:id`               (the bare id form) matches,
  //   • `POST  /tickets/:id/check-in`      (one action segment) matches,
  //   • `DELETE /tickets/:id/note-logs/:noteId` (action + sub-id) matches.
  // The character class includes `:` so router params like `:noteId` are
  // captured. The trailing `-` is positional (literal hyphen, not a
  // range start).
  const ROUTE_RE =
    /^router\.(post|patch|delete)\("(\/tickets\/:id(?:\/[A-Za-z0-9_:-]+)*)"/;
  const ROUTE_BOUNDARY_RE = /^router\.(post|patch|put|delete|get)\(/;

  // A line is "comment-y" if it's a `//` comment or a blank line. We use
  // this both to walk backwards from a route declaration to gather any
  // documentation comments that belong to it (e.g. a `@no-accept-guard`
  // tag the engineer placed immediately above `router.post(...)`) and to
  // walk backwards from the next route declaration so trailing comment
  // blocks get attributed to the following route, not the preceding one.
  const isCommentish = (s: string | undefined): boolean => {
    if (s == null) return false;
    const t = s.trim();
    return t === "" || t.startsWith("//");
  };

  const handlers: RouteHandler[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const m = ROUTE_RE.exec(lines[i] ?? "");
    if (!m) continue;

    // Walk backwards over the contiguous block of comments / blanks
    // directly above this route — that's where `@no-accept-guard` tags
    // and explanatory rationale live.
    let bodyStart = i;
    while (bodyStart > 0 && isCommentish(lines[bodyStart - 1])) {
      bodyStart -= 1;
    }

    // Walk forward until the next router.* declaration so the body we
    // hand to the assertion is just this one route's handler.
    let bodyEnd = lines.length;
    for (let j = i + 1; j < lines.length; j += 1) {
      if (ROUTE_BOUNDARY_RE.test(lines[j] ?? "")) {
        bodyEnd = j;
        break;
      }
    }
    // Trim trailing comments / blanks so they get attributed to the
    // FOLLOWING route's preceding-comment walk, not to us. Without this,
    // a `@no-accept-guard` tag intended for the next route would be
    // double-counted as part of this one and silently mask a missing
    // guard.
    while (bodyEnd > i + 1 && isCommentish(lines[bodyEnd - 1])) {
      bodyEnd -= 1;
    }

    handlers.push({
      method: m[1] as RouteHandler["method"],
      path: m[2]!,
      body: lines.slice(bodyStart, bodyEnd).join("\n"),
      startLine: i + 1,
    });
  }
  return handlers;
}

describe("Task #500/#846 — every per-ticket mutation route has a vendor-accept guard", () => {
  const handlers = loadRouteHandlers();

  // Sanity check: if this fails the regex broke or the file was renamed,
  // not the policy itself. Either way the rest of the suite is meaningless
  // without at least the routes we know exist today.
  it("discovers the known per-ticket mutation routes (POST + PATCH + DELETE)", () => {
    const paths = handlers.map((h) => h.path).sort();
    // Spot-check a handful of well-known POST endpoints — we don't pin
    // the full list because adding new routes is fine, what matters is
    // that each one carries a guard.
    expect(paths).toContain("/tickets/:id/check-in");
    expect(paths).toContain("/tickets/:id/check-out");
    expect(paths).toContain("/tickets/:id/accept");
    expect(paths).toContain("/tickets/:id/deny");
    expect(paths).toContain("/tickets/:id/cancel");
    // Task #846: PATCH and DELETE coverage. These are the three routes
    // that existed when the surface was broadened — if any one of them
    // disappears from discovery the regex change has regressed.
    const patchPaths = handlers.filter((h) => h.method === "patch").map((h) => h.path);
    const deletePaths = handlers.filter((h) => h.method === "delete").map((h) => h.path);
    expect(patchPaths).toContain("/tickets/:id");
    expect(deletePaths).toContain("/tickets/:id/note-logs/:noteId");
    expect(deletePaths).toContain("/tickets/:id/line-items/:lineItemId");
    // 16 POST + 1 PATCH + 2 DELETE = 19 today. Use >= so adding routes
    // is non-breaking; the per-route guard assertion below is what
    // enforces the actual policy.
    expect(handlers.length).toBeGreaterThanOrEqual(17);
  });

  it.each(
    loadRouteHandlers().map(
      (h) => [`${h.method.toUpperCase()} ${h.path}`, h] as const,
    ),
  )(
    "%s references a recognized status guard or @no-accept-guard opt-out",
    (_label, handler) => {
      const matched = RECOGNIZED_GUARD_TOKENS.filter((tok) =>
        handler.body.includes(tok),
      );
      // The assertion message intentionally points the future engineer at
      // the canonical checklist instead of just dumping the token list,
      // since the checklist explains WHY each guard exists.
      expect(
        matched,
        [
          `Route ${handler.method.toUpperCase()} ${handler.path} (declared at tickets.ts:${handler.startLine})`,
          "does not reference any recognized vendor-accept guard.",
          "",
          "Recognized guards: " + RECOGNIZED_GUARD_TOKENS.join(", "),
          "",
          "If this route is genuinely safe without one (admin-only, post-accept",
          "status, etc., or — for PATCH/DELETE — a body schema that cannot",
          "transition `status`) add a `@no-accept-guard` comment immediately",
          "above the router.<verb>(...) line that explains why. See the Task",
          "#500 checklist at the top of artifacts/api-server/src/routes/tickets.ts.",
        ].join("\n"),
      ).not.toEqual([]);
    },
  );
});

describe("Task #500 — recognized guards stay aligned with the checklist", () => {
  // If someone deletes PRE_ACCEPT_STATUSES (or renames it) the guard
  // policy collapses silently — every endpoint that relied on it would
  // still pass the regex above (no token = no match = test would fail
  // there) but in practice we want a louder, more direct error. This
  // assertion gives us that.
  it("PRE_ACCEPT_STATUSES still contains the canonical pre-accept states", () => {
    const source = readFileSync(TICKETS_ROUTES_PATH, "utf8");
    expect(source).toMatch(/const PRE_ACCEPT_STATUSES[^=]*=\s*new Set\(\[/);
    // The two states a vendor must not be able to bypass.
    expect(source).toMatch(/"awaiting_acceptance"/);
    expect(source).toMatch(/"denied"/);
  });

  it("ensureAccepted helper is still defined", () => {
    const source = readFileSync(TICKETS_ROUTES_PATH, "utf8");
    expect(source).toMatch(/async function ensureAccepted\(/);
  });
});
