import { describe, expect, it, vi } from "vitest";
import { authorizedEventWriter } from "./authorized-event-writer";

describe("authorized event writer", () => {
  it("rechecks permission before every event and closes after revocation", async () => {
    const allowed = vi
      .fn()
      .mockResolvedValueOnce(true)
      .mockResolvedValue(false);
    const write = vi.fn();
    const close = vi.fn();
    const send = authorizedEventWriter(allowed, write, close);
    await send("first");
    await send("revoked");
    await send("later");
    expect(write.mock.calls).toEqual([["first"]]);
    expect(close).toHaveBeenCalledTimes(1);
  });
  it("fails closed on verification errors and preserves event ordering", async () => {
    const write = vi.fn();
    const close = vi.fn();
    const allowed = vi
      .fn()
      .mockResolvedValueOnce(true)
      .mockRejectedValueOnce(new Error("unavailable"));
    const send = authorizedEventWriter(allowed, write, close);
    await Promise.all([send("first"), send("second"), send("third")]);
    expect(write.mock.calls).toEqual([["first"]]);
    expect(close).toHaveBeenCalledTimes(1);
  });
});
