import { afterEach, describe, expect, it, vi } from "vitest";
import { createGateEventPoller } from "./gate-events";

afterEach(() => vi.useRealTimers());

describe("Gate event poller", () => {
  it("refreshes for a selected-site event and advances its cursor", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce({ currentSeq: 8, changed: true, gap: false }).mockResolvedValueOnce({ currentSeq: 8, changed: false, gap: false });
    const changed = vi.fn();
    const poller = createGateEventPoller(fetcher);
    await poller.pollOnce(44, changed);
    await poller.pollOnce(44, changed);
    expect(changed).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[1][0]).toContain("after=8");
    expect(fetcher.mock.calls[1][0]).toContain("siteLocationId=44");
  });

  it("forces a refresh when the server reports a reconnect gap", async () => {
    const changed = vi.fn();
    const poller = createGateEventPoller(vi.fn().mockResolvedValue({ currentSeq: 20, changed: false, gap: true }));
    await poller.pollOnce(44, changed);
    expect(changed).toHaveBeenCalledTimes(1);
  });

  it("stops scheduled polling and tolerates a failed poll for fallback refresh", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn().mockRejectedValue(new Error("offline"));
    const poller = createGateEventPoller(fetcher);
    const stop = poller.start(44, vi.fn(), 1_500);
    await vi.advanceTimersByTimeAsync(1_500);
    expect(fetcher).toHaveBeenCalled();
    stop();
    const count = fetcher.mock.calls.length;
    await vi.advanceTimersByTimeAsync(4_500);
    expect(fetcher).toHaveBeenCalledTimes(count);
  });
});
