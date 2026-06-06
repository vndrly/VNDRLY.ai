import { describe, expect, it } from "vitest";

import { isDuplicatePrimaryKeyError } from "./pg-sequence-resync";

describe("isDuplicatePrimaryKeyError", () => {
  it("detects drizzle-wrapped duplicate pkey errors", () => {
    expect(
      isDuplicatePrimaryKeyError({
        cause: { code: "23505", constraint: "ticket_note_logs_pkey" },
      }),
    ).toBe(true);
  });

  it("returns false for other errors", () => {
    expect(isDuplicatePrimaryKeyError(new Error("nope"))).toBe(false);
    expect(
      isDuplicatePrimaryKeyError({
        cause: { code: "23505", constraint: "ticket_note_logs_ticket_id_key" },
      }),
    ).toBe(false);
  });
});
