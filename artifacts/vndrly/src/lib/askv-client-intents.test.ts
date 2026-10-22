import { describe, expect, it, vi } from "vitest";
import { ASKV_WEB_CLIENT_INTENT_NAMES, applyAskVClientIntent, clearAskVClientDrafts, parseAskVClientIntent, readAskVSafetyDraft } from "./askv-client-intents";

describe("AskV client intents", () => {
  it("wires every structured client intent the server may emit", () => {
    expect(new Set(ASKV_WEB_CLIENT_INTENT_NAMES)).toEqual(new Set([
      "open_screen", "focus_control", "prefill_draft", "prefill_gate_visit",
      "launch_camera", "launch_maps", "launch_scanner", "start_ticket_entry",
    ]));
  });
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
    const result = applyAskVClientIntent({ name: "prefill_gate_visit", arguments: { mode: "check-in", values: {
      firstName: "Bob",
      vehiclePlate: "8TRK22",
      hostType: "vendor",
      hostVendorId: 22,
      gateStationId: "11111111-1111-4111-8111-111111111111",
      entryCategory: "routine_vendor_work",
    }, missing: ["plateState"] } });
    expect(result).toMatchObject({ ok: true });
    expect(listener).toHaveBeenCalledOnce();
    expect((listener.mock.calls[0][0] as CustomEvent).detail.values).toMatchObject({
      hostType: "vendor",
      hostVendorId: 22,
      gateStationId: "11111111-1111-4111-8111-111111111111",
      entryCategory: "routine_vendor_work",
    });
    window.removeEventListener("askv:gate-prefill", listener);
  });

  it("executes every remaining web client handoff without claiming a saved record", () => {
    const focus = document.createElement("button");
    focus.id = "message";
    document.body.appendChild(focus);
    const focusSpy = vi.spyOn(focus, "focus");
    expect(applyAskVClientIntent({ name: "focus_control", arguments: { controlId: "message" } })).toMatchObject({ ok: true });
    expect(focusSpy).toHaveBeenCalledOnce();

    const imageInput = document.createElement("input");
    imageInput.type = "file";
    imageInput.accept = "image/*";
    imageInput.dataset.askvCamera = "plate";
    document.body.appendChild(imageInput);
    const click = vi.spyOn(imageInput, "click");
    expect(applyAskVClientIntent({ name: "launch_camera", arguments: {} })).toMatchObject({ ok: true });
    expect(click).toHaveBeenCalledOnce();

    const vehicleInput = document.createElement("input");
    vehicleInput.type = "file";
    vehicleInput.accept = "image/*";
    vehicleInput.dataset.askvCamera = "vehicle";
    document.body.appendChild(vehicleInput);
    const vehicleClick = vi.spyOn(vehicleInput, "click");
    expect(applyAskVClientIntent({ name: "launch_camera", arguments: { target: "vehicle" } })).toMatchObject({ ok: true });
    expect(vehicleClick).toHaveBeenCalledOnce();

    const open = vi.spyOn(window, "open").mockReturnValue(window);
    expect(applyAskVClientIntent({ name: "launch_maps", arguments: { latitude: 35.5, longitude: -97.5 } })).toMatchObject({ ok: true });
    expect(open).toHaveBeenCalledWith(expect.stringContaining("35.5%2C-97.5"), "_blank", "noopener,noreferrer");

    expect(applyAskVClientIntent({ name: "launch_scanner", arguments: {} })).toMatchObject({ ok: true });
    expect(window.location.pathname).toBe("/work-hub/my-work");
    expect(applyAskVClientIntent({ name: "start_ticket_entry", arguments: { path: "/tickets/42?askvEntry=labor" } })).toMatchObject({ ok: true });
    expect(window.location.pathname).toBe("/tickets/42");

    expect(applyAskVClientIntent({ name: "prefill_draft", arguments: { form: "safety-report", values: { title: "Loose cable", submitted: true } } })).toMatchObject({ ok: true });
    expect(readAskVSafetyDraft()).toEqual({ title: "Loose cable" });

    clearAskVClientDrafts();
    open.mockRestore();
    focus.remove();
    imageInput.remove();
    vehicleInput.remove();
  });
});
