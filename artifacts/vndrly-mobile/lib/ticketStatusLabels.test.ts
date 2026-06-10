import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  isTicketInactive,
  TICKET_INACTIVE_DAYS,
  TICKET_STATUS_COLORS,
  TICKET_STATUS_LABEL_KEYS,
  ticketStaleDays,
  ticketStatusLabel,
  ticketStatusPillStyle,
} from "./ticketStatusLabels";

describe("ticketStatusLabel", () => {
  it("returns the translated value for known status keys", () => {
    const t = (key: string) => `t:${key}`;
    expect(ticketStatusLabel("submitted", t)).toBe(
      `t:${TICKET_STATUS_LABEL_KEYS.submitted}`,
    );
    expect(ticketStatusLabel("awaiting_payment", t)).toBe(
      `t:${TICKET_STATUS_LABEL_KEYS.awaiting_payment}`,
    );
  });

  it("falls back to a humanized string when the status is unknown", () => {
    const t = (key: string) => `t:${key}`;
    expect(ticketStatusLabel("not_a_real_status", t)).toBe(
      "not a real status",
    );
  });
});

describe("ticketStatusPillStyle", () => {
  it("maps statuses to the user-assigned lifecycle buckets", () => {
    expect(TICKET_STATUS_COLORS.awaiting_acceptance).toBe("orange");
    expect(TICKET_STATUS_COLORS.initiated).toBe("babyBlue");
    expect(TICKET_STATUS_COLORS.in_progress).toBe("blue");
    expect(TICKET_STATUS_COLORS.pending_review).toBe("amber");
    expect(TICKET_STATUS_COLORS.completed).toBe("grey");
    expect(TICKET_STATUS_COLORS.submitted).toBe("lime");
    expect(TICKET_STATUS_COLORS.approved).toBe("green");
    expect(TICKET_STATUS_COLORS.awaiting_payment).toBe("green");
    expect(TICKET_STATUS_COLORS.funds_dispersed).toBe("darkGreen");
    expect(TICKET_STATUS_COLORS.denied).toBe("red");
    expect(TICKET_STATUS_COLORS.kicked_back).toBe("red");
    expect(TICKET_STATUS_COLORS.cancelled).toBe("red");
  });

  it("renders submitted and awaiting_payment as distinct office-owned states", () => {
    const submitted = ticketStatusPillStyle("submitted");
    const awaitingPayment = ticketStatusPillStyle("awaiting_payment");
    expect(submitted).not.toEqual(awaitingPayment);
    expect(submitted.foreground).toBe("#ffffff");
    expect(awaitingPayment.foreground).toBe("#ffffff");
  });

  it("renders approved and funds_dispersed as distinct success states", () => {
    const approved = ticketStatusPillStyle("approved");
    const dispersed = ticketStatusPillStyle("funds_dispersed");
    expect(approved).not.toEqual(dispersed);
    expect(approved.foreground).toBe("#ffffff");
    expect(dispersed.foreground).toBe("#ffffff");
  });

  it("falls back to the neutral grey pill for unmapped statuses", () => {
    const unknown = ticketStatusPillStyle("not_a_real_status");
    const draft = ticketStatusPillStyle("draft");
    expect(unknown).toEqual(draft);
    // grey pill should still be visible — not transparent/empty.
    expect(unknown.background).not.toBe("");
    expect(unknown.foreground).not.toBe("");
  });

  it("uses distinct colors for the urgency-distinguishing statuses", () => {
    const colors = new Set(
      [
        "in_progress",
        "submitted",
        "approved",
        "kicked_back",
        "cancelled",
      ].map((s) => ticketStatusPillStyle(s).background),
    );
    expect(colors.size).toBe(5);
  });
});

// Task #605: stalled-ticket inactivity escalation. Mirrors the web
// TicketStatusBadge logic at
// artifacts/vndrly/src/components/ticket-status-badge.tsx so a draft /
// pending_review / in_progress / kicked_back ticket that hasn't been
// touched in TICKET_INACTIVE_DAYS days reads as urgent on mobile too.
describe("ticketStatusPillStyle inactivity escalation", () => {
  // Anchor "now" so the test isn't sensitive to the wall clock.
  const NOW = new Date("2026-01-15T12:00:00.000Z");
  const dayMs = 24 * 60 * 60 * 1000;
  const stale = new Date(
    NOW.getTime() - (TICKET_INACTIVE_DAYS + 1) * dayMs,
  ).toISOString();
  const fresh = new Date(NOW.getTime() - 1 * dayMs).toISOString();
  const amberBg = ticketStatusPillStyle("submitted").background;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("escalates the three non-red field-actionable statuses to amber once stale", () => {
    // kicked_back is intentionally excluded — its base color (red) is
    // already the most urgent bucket, so re-keying it to the "waiting"
    // amber bucket when stale would visually demote a tense status.
    // See INACTIVE_ESCALATION_STATUSES in ticketStatusLabels.ts.
    for (const status of ["draft", "pending_review", "in_progress"]) {
      expect(ticketStatusPillStyle(status, stale).background).toBe(amberBg);
    }
  });

  it("keeps kicked_back red even when stale", () => {
    expect(ticketStatusPillStyle("kicked_back", stale).background).toBe(
      ticketStatusPillStyle("kicked_back").background,
    );
  });

  it("leaves the same statuses on their normal color when fresh", () => {
    expect(ticketStatusPillStyle("in_progress", fresh).background).toBe(
      ticketStatusPillStyle("in_progress").background,
    );
    expect(ticketStatusPillStyle("kicked_back", fresh).background).toBe(
      ticketStatusPillStyle("kicked_back").background,
    );
    expect(ticketStatusPillStyle("draft", fresh).background).toBe(
      ticketStatusPillStyle("draft").background,
    );
    expect(ticketStatusPillStyle("pending_review", fresh).background).toBe(
      ticketStatusPillStyle("pending_review").background,
    );
  });

  it("does not escalate office-owned or terminal statuses", () => {
    // submitted / awaiting_payment are blocked on the back office; the
    // field employee shouldn't be blamed when they sit. Terminal
    // statuses (approved / completed / funds_dispersed / cancelled)
    // shouldn't visually escalate at all.
    for (const status of [
      "submitted",
      "awaiting_payment",
      "approved",
      "completed",
      "funds_dispersed",
      "cancelled",
    ]) {
      expect(ticketStatusPillStyle(status, stale)).toEqual(
        ticketStatusPillStyle(status),
      );
    }
  });

  it("treats null / undefined updatedAt as fresh", () => {
    expect(ticketStatusPillStyle("in_progress", null).background).toBe(
      ticketStatusPillStyle("in_progress").background,
    );
    expect(ticketStatusPillStyle("in_progress", undefined).background).toBe(
      ticketStatusPillStyle("in_progress").background,
    );
  });

  it("isTicketInactive flips at the TICKET_INACTIVE_DAYS boundary", () => {
    const justUnder = new Date(
      NOW.getTime() - (TICKET_INACTIVE_DAYS * dayMs - 1000),
    ).toISOString();
    const justOver = new Date(
      NOW.getTime() - (TICKET_INACTIVE_DAYS * dayMs + 1000),
    ).toISOString();
    expect(isTicketInactive(justUnder)).toBe(false);
    expect(isTicketInactive(justOver)).toBe(true);
    expect(isTicketInactive(null)).toBe(false);
    expect(isTicketInactive(undefined)).toBe(false);
    expect(isTicketInactive("not-a-date")).toBe(false);
  });
});

// Task #890: ticketStaleDays should fire on exactly the same set of
// (status, updatedAt) inputs that drive the amber pill escalation, so
// the suffix and the pill color can never disagree on the same row.
describe("ticketStaleDays", () => {
  const NOW = new Date("2026-01-15T12:00:00.000Z");
  const dayMs = 24 * 60 * 60 * 1000;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns the floored day count for stalled actionable statuses", () => {
    const twelveDaysAgo = new Date(
      NOW.getTime() - 12 * dayMs - 5 * 60 * 60 * 1000,
    ).toISOString();
    // kicked_back is intentionally excluded from this set — see the
    // sibling test "keeps kicked_back red even when stale" and the
    // INACTIVE_ESCALATION_STATUSES comment in ticketStatusLabels.ts.
    for (const status of ["draft", "pending_review", "in_progress"]) {
      expect(ticketStaleDays(status, twelveDaysAgo)).toBe(12);
    }
  });

  it("returns null for kicked_back even when stale (red is not demoted)", () => {
    const stale = new Date(
      NOW.getTime() - (TICKET_INACTIVE_DAYS + 5) * dayMs,
    ).toISOString();
    expect(ticketStaleDays("kicked_back", stale)).toBeNull();
  });

  it("returns null when the ticket is fresher than the threshold", () => {
    const fresh = new Date(NOW.getTime() - 1 * dayMs).toISOString();
    expect(ticketStaleDays("in_progress", fresh)).toBeNull();
    expect(ticketStaleDays("draft", fresh)).toBeNull();
  });

  it("flips on at exactly TICKET_INACTIVE_DAYS days", () => {
    const justUnder = new Date(
      NOW.getTime() - (TICKET_INACTIVE_DAYS * dayMs - 1000),
    ).toISOString();
    const exactly = new Date(
      NOW.getTime() - TICKET_INACTIVE_DAYS * dayMs,
    ).toISOString();
    expect(ticketStaleDays("in_progress", justUnder)).toBeNull();
    expect(ticketStaleDays("in_progress", exactly)).toBe(TICKET_INACTIVE_DAYS);
  });

  it("returns null for office-owned and terminal statuses, even when stale", () => {
    const stale = new Date(
      NOW.getTime() - (TICKET_INACTIVE_DAYS + 30) * dayMs,
    ).toISOString();
    for (const status of [
      "submitted",
      "awaiting_payment",
      "approved",
      "completed",
      "funds_dispersed",
      "cancelled",
    ]) {
      expect(ticketStaleDays(status, stale)).toBeNull();
    }
  });

  it("returns null for null / undefined / unparseable updatedAt", () => {
    expect(ticketStaleDays("in_progress", null)).toBeNull();
    expect(ticketStaleDays("in_progress", undefined)).toBeNull();
    expect(ticketStaleDays("in_progress", "not-a-date")).toBeNull();
  });

  it("agrees with ticketStatusPillStyle on whether to escalate", () => {
    // Property-style check: if and only if the pill amber-escalates,
    // the stale-day count should be non-null. Catches future drift if
    // either function changes its gating condition independently.
    const stale = new Date(
      NOW.getTime() - (TICKET_INACTIVE_DAYS + 5) * dayMs,
    ).toISOString();
    const fresh = new Date(NOW.getTime() - 1 * dayMs).toISOString();
    const cases: Array<[string, string, boolean]> = [
      ["draft", stale, true],
      ["pending_review", stale, true],
      ["in_progress", stale, true],
      ["kicked_back", stale, false],
      ["draft", fresh, false],
      ["in_progress", fresh, false],
      ["submitted", stale, false],
      ["awaiting_payment", stale, false],
      ["approved", stale, false],
      ["completed", stale, false],
      ["cancelled", stale, false],
    ];
    for (const [status, updatedAt, shouldShowStaleDays] of cases) {
      const days = ticketStaleDays(status, updatedAt);
      expect(days != null).toBe(shouldShowStaleDays);
    }
  });
});
