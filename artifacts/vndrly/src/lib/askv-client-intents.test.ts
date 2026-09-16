import { describe, expect, it, vi } from "vitest";
import { applyAskVClientIntent, parseAskVClientIntent } from "./askv-client-intents";

describe("AskV client intents", () => {
  it("parses client tool output and does not treat it as a server mutation", () => {
    expect(parseAskVClientIntent(JSON.stringify({
      ok: true,
      execution: "client",
      intent: { name: "open_screen", arguments: { screen: "tickets" } },
    }))).toEqual({
      name: "open_screen",
      arguments: { screen: "tickets" },
    });
    expect(parseAskVClientIntent(JSON.stringify({ ok: true, visitId: 1 }))).toBeNull();
  });

  it("navigates for open_screen without claiming the server did it", () => {
    const push = vi.spyOn(window.history, "pushState");
    applyAskVClientIntent({ name: "open_screen", arguments: { screen: "gatekeeper", path: "/gatekeeper" } });
    expect(push).toHaveBeenCalledWith({}, "", "/gatekeeper");
    push.mockRestore();
  });

  it("dispatches Gate prefill facts to the visible Gate form", () => {
    const listener = vi.fn();
    window.addEventListener("askv:gate-prefill", listener);
    const result = applyAskVClientIntent({ name: "prefill_gate_visit", arguments: { mode: "check-in", values: { firstName: "Bob", vehiclePlate: "8TRK22" }, missing: ["plateState"] } });
    expect(result).toMatchObject({ ok: true });
    expect(listener).toHaveBeenCalledOnce();
    window.removeEventListener("askv:gate-prefill", listener);
  });
});
