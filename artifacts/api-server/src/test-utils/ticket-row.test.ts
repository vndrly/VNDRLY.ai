import { describe, expect, it } from "vitest";
import { GetTicketResponse } from "@workspace/api-zod";
import { makeTicketRow } from "./ticket-row";

// Task #769 — drift guard for the shared `ticketSelect` fixture factory.
//
// The factory is the single source of truth for the row shape that route
// tests feed into the chained-mock DB. The drift-prone bug pattern is:
// `ticketSelect` in routes/tickets.ts grows a column → `GetTicketResponse`
// in lib/api-zod adds a matching required field → every hand-rolled
// `ticketRow` literal in the route test suite silently goes stale and
// the route 500s on `Zod.parse(...)`. Task #716 made the failure mode
// observable; this task prevents it at source by centralising the
// fixture and enforcing schema-completeness right here.
//
// If a future codegen run adds a required field to `GetTicketResponse`
// without a matching default in `makeTicketRow`, this single test fails
// with a precise "missing X" issue list — instead of every consumer
// route test going red with the opaque "expected 500 to be 200".
describe("makeTicketRow", () => {
  it("produces a row that satisfies GetTicketResponse end-to-end", () => {
    const row = makeTicketRow({
      // The factory leaves the route-computed fields off the SQL row by
      // design (the handler adds them after the parse) — re-attach them
      // here with sensible defaults so this test exercises the full
      // response shape exactly the way the routes do.
      viewerCanDisperseFunds: false,
      viewerCanReverseDispersal: false,
      phoneIntakeCallerName: null,
    });
    const parsed = GetTicketResponse.safeParse(row);
    expect(
      parsed.success,
      parsed.success
        ? ""
        : "GetTicketResponse rejected makeTicketRow() output — add a default " +
            "in artifacts/api-server/src/test-utils/ticket-row.ts for the " +
            "missing field(s):\n" +
            JSON.stringify(parsed.error.issues, null, 2),
    ).toBe(true);
  });

  it("applies overrides on top of the schema-complete defaults", () => {
    const row = makeTicketRow({ id: 999, status: "in_progress" });
    expect(row.id).toBe(999);
    expect(row.status).toBe("in_progress");
    // Spot-check that an unrelated default field is still present so a
    // caller that overrides one column doesn't accidentally lose the
    // rest of the projection.
    expect(row).toHaveProperty("siteName", "S");
  });

  it("accepts arbitrary extra columns alongside the typed defaults", () => {
    // Several tests need to ferry an extra `partnerId` (or similar
    // adjacent ownership column) through the mock so the route's
    // ensureFieldOwnership lookup resolves. The helper must not strip
    // unknown keys.
    const row = makeTicketRow({ partnerId: 5 });
    expect(row.partnerId).toBe(5);
  });
});
