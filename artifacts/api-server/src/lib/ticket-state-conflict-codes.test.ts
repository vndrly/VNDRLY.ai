import { describe, expect, it } from "vitest";
import {
  TICKET_EN_ROUTE_INVALID_STATE,
  TICKET_NOT_ACCEPTED,
  TICKET_NOT_AWAITING_ACCEPTANCE,
  TICKET_NOT_CHECKINABLE,
  TICKET_STATE_CHANGED,
  TICKET_STATE_CONFLICT_CODES,
  isTicketStateConflictCode,
} from "@workspace/ticket-state-conflict-codes";

describe("ticket-state-conflict-codes", () => {
  it("exposes the canonical set of five state-conflict codes", () => {
    // Pin the exact membership of the named set. Adding or removing a
    // code is a contract change that must be coordinated with the web
    // and mobile mirrors (see the file header for paths), so this test
    // is intentionally strict — the failure is the prompt to update the
    // mirrors before merging.
    expect([...TICKET_STATE_CONFLICT_CODES].sort()).toEqual([
      "ticket_en_route_invalid_state",
      "ticket_not_accepted",
      "ticket_not_awaiting_acceptance",
      "ticket_not_checkinable",
      "ticket_state_changed",
    ]);
  });

  it("uses lowercase snake_case for every code", () => {
    for (const c of TICKET_STATE_CONFLICT_CODES) {
      expect(c).toMatch(/^[a-z][a-z0-9_]*$/);
    }
  });

  it("named exports match the entries in the canonical array", () => {
    const set = new Set<string>(TICKET_STATE_CONFLICT_CODES);
    expect(set.has(TICKET_NOT_ACCEPTED)).toBe(true);
    expect(set.has(TICKET_NOT_AWAITING_ACCEPTANCE)).toBe(true);
    expect(set.has(TICKET_STATE_CHANGED)).toBe(true);
    expect(set.has(TICKET_NOT_CHECKINABLE)).toBe(true);
    expect(set.has(TICKET_EN_ROUTE_INVALID_STATE)).toBe(true);
  });

  it("isTicketStateConflictCode recognizes every canonical code", () => {
    for (const c of TICKET_STATE_CONFLICT_CODES) {
      expect(isTicketStateConflictCode(c)).toBe(true);
    }
  });

  it("isTicketStateConflictCode rejects unrelated values", () => {
    expect(isTicketStateConflictCode("off_geofence")).toBe(false);
    expect(isTicketStateConflictCode("ticket.en_route_invalid_state")).toBe(
      false,
    ); // dot-notation alias is not part of the canonical set
    expect(isTicketStateConflictCode(undefined)).toBe(false);
    expect(isTicketStateConflictCode(null)).toBe(false);
    expect(isTicketStateConflictCode(42)).toBe(false);
    expect(isTicketStateConflictCode("")).toBe(false);
  });
});
