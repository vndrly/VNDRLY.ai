import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { attachTestErrorMiddleware, expectStatus } from "../test-utils/route-app";
import { buildTestCookie } from "../test-utils/session";

// Task #626: when a foreman or dispatcher removes a crew member from a
// ticket (DELETE /tickets/:id/crew-roster/:employeeId), the removed
// crew member's linked user should get a single push that names the
// ticket and explains they were taken off. Without this, the worker
// keeps seeing the ticket on their list until the next refresh and may
// show up to a job they're no longer on.
//
// What we assert:
//   1. After the soft-delete (`removed_at`) succeeds, `notifyUsers` is
//      called once with the removed crew member's user id.
//   2. The push payload uses type `crew_removed`, links to `/tickets`
//      (NOT the ticket detail — the worker no longer has access), and
//      carries pushData `{ type: "crew_removed" }` so the mobile
//      listener routes them to the tickets list instead of the ticket
//      detail screen.
//   3. The dedupe key includes the removal timestamp so a future
//      re-removal (after a re-add) still fires.
//   4. Crew rows whose vendor_people row has no linked user account
//      (e.g. sub-contractors entered as people but never invited) skip
//      cleanly — no push, no error, response still 204.
//   5. When the soft-delete affects zero rows (already removed), no
//      push fires and the endpoint returns 404.


const cookieFor = (s: object) => buildTestCookie(s);

const adminCookie = cookieFor({
  userId: 1,
  role: "admin",
  vendorId: null,
  partnerId: null,
});

let selectQueue: any[] = [];
let updateReturning: any[] = [];

function makeChain(rows: any[]) {
  const chain: any = {
    from: () => chain,
    leftJoin: () => chain,
    innerJoin: () => chain,
    orderBy: () => Promise.resolve(rows),
    limit: () => Promise.resolve(rows),
  };
  chain.where = () => {
    const next: any = {
      then: (resolve: any) => Promise.resolve(rows).then(resolve),
      orderBy: () => Promise.resolve(rows),
      limit: () => Promise.resolve(rows),
      leftJoin: () => next,
      innerJoin: () => next,
    };
    return next;
  };
  return chain;
}

vi.mock("@workspace/db", () => {
  const tableTag = (name: string) =>
    new Proxy(
      { __name: name },
      { get: (_t, k: string) => ({ __table: name, __col: k }) },
    );
  const db: any = {
    select: () => {
      const head = selectQueue.shift();
      const rows = head == null ? [] : Array.isArray(head) ? head : [head];
      return makeChain(rows);
    },
    insert: () => ({
      values: () => ({
        returning: () => Promise.resolve([]),
      }),
    }),
    update: () => ({
      set: () => ({
        where: () => ({
          returning: () => Promise.resolve(updateReturning),
        }),
      }),
    }),
    delete: () => ({ where: () => Promise.resolve([]) }),
    transaction: async (fn: any) => fn(db),
  };
  return {
    db,
    pool: { query: async () => ({ rows: [] }) },
    ticketsTable: tableTag("tickets"),
    ticketCheckInsTable: tableTag("ticketCheckIns"),
    vendorPeopleTable: tableTag("vendorPeople"),
    ticketLineItemsTable: tableTag("ticketLineItems"),
    siteLocationsTable: tableTag("siteLocations"),
    vendorsTable: tableTag("vendors"),
    ticketAssignmentRatesTable: tableTag("ticketAssignmentRates"),
    ticketCrewTable: tableTag("ticketCrew"),
    // Task #51 — referenced by unread-comments.ts subqueries.
    commentReadReceiptsTable: tableTag("commentReadReceipts"),
    hotlistCommentsTable: tableTag("hotlistComments"),
    ticketNoteLogsTable: tableTag("ticketNoteLogs"),
  };
});

vi.mock("@workspace/db/format", () => ({
  formatTicketTrackingNumber: (id: number) =>
    `VNDRLY-${String(id).padStart(8, "0")}`,
}));

const notifyUsersMock = vi.fn(async () => 1);
vi.mock("./notifications", () => ({
  notifyUsers: (...args: unknown[]) =>
    (notifyUsersMock as unknown as (...a: unknown[]) => Promise<number>)(
      ...args,
    ),
}));

let app: express.Express;

const TICKET_ID = 7777;
const EMPLOYEE_ID = 555;
const VENDOR_ID = 11;
const SITE_ID = 50;

// Auth path for ensureCrewMutate(admin):
//   (1) loadTicketForAuth → ticket row joined with site_locations
//   (admin short-circuits the role checks, so no further auth selects)
// Then the DELETE handler fires the update and notifyRemovedCrewMember:
//   (2) vendor_people lookup → { userId }
//   (3) tickets joined with site_locations → { id, siteName }
const ticketAuthRow = {
  id: TICKET_ID,
  vendorId: VENDOR_ID,
  status: "in_progress",
  partnerId: 99,
  fieldEmployeeId: 1234,
};

beforeEach(async () => {
  selectQueue = [];
  updateReturning = [{ id: 9001 }];
  notifyUsersMock.mockClear();
  vi.resetModules();
  const router = (await import("./crew")).default;
  app = express();
  app.use(cookieParser());
  app.use(express.json());
  app.use("/api", router);
  attachTestErrorMiddleware(app);
});

afterEach(() => {
  vi.clearAllMocks();
});

// Wait for the fire-and-forget `void notifyRemovedCrewMember(...)` to
// flush. setImmediate ensures all microtasks (and the awaited
// notifyUsers call inside) run before we assert.
function flushAsync(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

describe("DELETE /tickets/:id/crew-roster/:employeeId — Task #626 removed-from-crew push", () => {
  it("notifies the removed crew member's linked user with a tickets-list deep link", async () => {
    selectQueue = [
      ticketAuthRow,
      [{ userId: 4242 }],
      { id: TICKET_ID, siteName: "Well Pad 12" },
    ];
    const r = await request(app)
      .delete(`/api/tickets/${TICKET_ID}/crew-roster/${EMPLOYEE_ID}`)
      .set("Cookie", adminCookie);
    expectStatus(r, 204);
    await flushAsync();
    await flushAsync();
    expect(notifyUsersMock).toHaveBeenCalledTimes(1);
    const [recipients, payload] = notifyUsersMock.mock.calls[0] as unknown as [
      number[],
      Record<string, unknown>,
    ];
    expect(recipients).toEqual([4242]);
    expect(payload.type).toBe("crew_removed");
    expect(payload.link).toBe("/tickets");
    expect(payload.pushData).toEqual({ type: "crew_removed" });
    // pushData must NOT carry ticketId — that would make the mobile
    // deep-link router open the (now inaccessible) ticket detail.
    expect((payload.pushData as Record<string, unknown>).ticketId).toBeUndefined();
    expect(typeof payload.title).toBe("string");
    expect(typeof payload.body).toBe("string");
    expect(payload.body as string).toContain("VNDRLY-00007777");
    expect(payload.body as string).toContain("Well Pad 12");
    // Dedupe key must include the removal timestamp so a future
    // re-removal after a re-add still fires.
    const dedupeKey = payload.dedupeKey as string;
    expect(dedupeKey.startsWith(`crew_removed:${TICKET_ID}:${EMPLOYEE_ID}:`)).toBe(true);
    const removedAtIso = dedupeKey.slice(`crew_removed:${TICKET_ID}:${EMPLOYEE_ID}:`.length);
    expect(Number.isFinite(Date.parse(removedAtIso))).toBe(true);
  });

  it("skips the push when the removed crew member has no linked user account", async () => {
    selectQueue = [
      ticketAuthRow,
      // vendor_people row exists but userId is null (e.g. sub-contractor
      // entered as a person but never invited)
      [{ userId: null }],
    ];
    const r = await request(app)
      .delete(`/api/tickets/${TICKET_ID}/crew-roster/${EMPLOYEE_ID}`)
      .set("Cookie", adminCookie);
    expectStatus(r, 204);
    await flushAsync();
    await flushAsync();
    expect(notifyUsersMock).not.toHaveBeenCalled();
  });

  it("returns 404 and does not notify when the crew row is already removed", async () => {
    selectQueue = [ticketAuthRow];
    updateReturning = []; // no rows updated → already removed
    const r = await request(app)
      .delete(`/api/tickets/${TICKET_ID}/crew-roster/${EMPLOYEE_ID}`)
      .set("Cookie", adminCookie);
    expect(r.status).toBe(404);
    expect(r.body.code).toBe("crew.not_on_roster");
    await flushAsync();
    expect(notifyUsersMock).not.toHaveBeenCalled();
  });

  it("excludes the site name from the body when the ticket has no site name", async () => {
    selectQueue = [
      ticketAuthRow,
      [{ userId: 4242 }],
      { id: TICKET_ID, siteName: null },
    ];
    const r = await request(app)
      .delete(`/api/tickets/${TICKET_ID}/crew-roster/${EMPLOYEE_ID}`)
      .set("Cookie", adminCookie);
    expectStatus(r, 204);
    await flushAsync();
    await flushAsync();
    expect(notifyUsersMock).toHaveBeenCalledTimes(1);
    const [, payload] = notifyUsersMock.mock.calls[0] as unknown as [
      number[],
      Record<string, unknown>,
    ];
    const body = payload.body as string;
    expect(body).toContain("VNDRLY-00007777");
    expect(body).not.toContain(" at ");
  });
});

void SITE_ID;
