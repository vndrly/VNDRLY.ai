import { describe, expect, it, vi } from "vitest";
import { completeServerShutdown } from "./graceful-shutdown";

describe("server shutdown coordination", () => {
  it("does not exit after HTTP close while provider cleanup is still pending", async () => {
    let finishStreams!: () => void;
    const closeStreams = vi.fn(() => new Promise<void>((resolve) => { finishStreams = resolve; }));
    const closeServer = vi.fn((done: (error?: Error) => void) => done());
    const exit = vi.fn();
    const shutdown = completeServerShutdown({ closeServer, closeStreams, exit });
    await Promise.resolve();
    expect(closeServer).toHaveBeenCalledOnce();
    expect(closeStreams).toHaveBeenCalledOnce();
    expect(exit).not.toHaveBeenCalled();
    finishStreams();
    await shutdown;
    expect(exit).toHaveBeenCalledWith(0);
  });
});
