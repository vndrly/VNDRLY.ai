import { expect, it } from "vitest";
import { mayTransferHandoff } from "./change-over";
it("blocks offline, changed, expired and unacknowledged handoffs", () => {
  const valid = {
    online: true,
    acknowledged: true,
    proof: "signed",
    reviewedRevision: "a",
    currentRevision: "a",
    stale: false,
  };
  expect(mayTransferHandoff(valid)).toBe(true);
  for (const patch of [
    { online: false },
    { acknowledged: false },
    { proof: "" },
    { currentRevision: "b" },
    { stale: true },
  ])
    expect(mayTransferHandoff({ ...valid, ...patch })).toBe(false);
});
