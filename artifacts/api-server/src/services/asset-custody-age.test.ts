import { describe, expect, it } from "vitest";
import { custodyAge } from "./asset-custody-age";
import type { CustodyEvent } from "./assets";

const now = new Date("2026-10-06T12:00:00Z");
const event = (type: CustodyEvent["type"], occurredAt: string, fromHolderUserId: number | null, toHolderUserId: number | null): CustodyEvent => ({ id: occurredAt, type, occurredAt: new Date(occurredAt), fromHolderUserId, toHolderUserId });
describe("continuous equipment custody age", () => {
  it("keeps the checkout date across a transfer", () => {
    const history = [event("checkout", "2026-06-01T12:00:00Z", null, 1), event("transfer", "2026-10-01T12:00:00Z", 1, 2)];
    expect(custodyAge({ holderUserId: 2, history }, now)).toEqual({ checkedOutAt: new Date("2026-06-01T12:00:00Z"), custodyDays: 127 });
  });
  it("does not count a previous checkout after return and reissue", () => {
    const history = [event("checkout", "2026-01-01T12:00:00Z", null, 1), event("return", "2026-09-01T12:00:00Z", 1, null), event("checkout", "2026-10-05T12:00:00Z", null, 2)];
    expect(custodyAge({ holderUserId: 2, history }, now).custodyDays).toBe(1);
  });
  it("does not fabricate dates for missing or inconsistent custody history", () => {
    expect(custodyAge({ holderUserId: 2, history: [] }, now)).toEqual({ checkedOutAt: null, custodyDays: null });
    expect(custodyAge({ holderUserId: 2, history: [event("checkout", "2026-01-01T12:00:00Z", null, 1)] }, now).custodyDays).toBeNull();
  });
  it("does not count available equipment or future dates", () => {
    expect(custodyAge({ holderUserId: null, history: [] }, now).custodyDays).toBeNull();
    expect(custodyAge({ holderUserId: 1, history: [event("checkout", "2026-10-07T12:00:00Z", null, 1)] }, now).custodyDays).toBeNull();
  });
});

it("refuses an age when the custody chain contains a future or invalid transfer timestamp", () => {
  for (const date of ["2026-10-07T12:00:00Z", "invalid"])
    expect(custodyAge({ holderUserId: 2, history: [event("checkout", "2026-06-01T12:00:00Z", null, 1), event("transfer", date, 1, 2)] }, now).custodyDays).toBeNull();
});
