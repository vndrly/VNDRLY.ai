import { describe, expect, it, vi } from "vitest";
import { acquireGlobalRetentionLock, acquireOwnerGovernanceLock } from "./governance-locks";

describe("governance publication lock order", () => {
  it("always acquires global minimum before owner governance", async () => {
    const calls: unknown[] = [];
    const execute = vi.fn(async (query: unknown) => { calls.push(query); });
    await acquireGlobalRetentionLock({ execute } as never);
    await acquireOwnerGovernanceLock({ execute } as never, { type: "vendor", id: 41 });
    expect(calls).toHaveLength(2);
    expect(JSON.stringify(calls[0])).toContain("minimum");
    expect(JSON.stringify(calls[1])).toContain("owner");
  });
});
