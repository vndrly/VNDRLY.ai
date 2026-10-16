import { describe, expect, it, vi } from "vitest";
import { runInNewContext } from "node:vm";
import { ACTION_LOCATION_CLIENT, isOperatorGateAction, requiresActionLocation } from "./chatgpt-action-location";

describe("ChatGPT operator Gate optional GPS", () => {
  it("keeps operator entry/checkout optional and retains other device-location requirements", () => {
    for (const name of ["confirm_visitor_check_in", "confirm_visitor_check_out"]) { expect(isOperatorGateAction(name)).toBe(true); expect(requiresActionLocation(name)).toBe(false); }
    for (const name of ["start_paid_travel", "set_ticket_lifecycle", "close_ticket_for_review"]) expect(requiresActionLocation(name)).toBe(true);
    expect(requiresActionLocation("confirm_field_trips_action", { action: "location" })).toBe(true);
    expect(isOperatorGateAction("visitor_self_check_in")).toBe(false);
  });
  it.each(["absent", "denied", "available", "unresponsive", "throws"])("submits an explicitly approved operator action when device GPS is %s", availability => {
    const form = { dataset: { location: "optional_gate", located: "" }, elements: { latitude: { value: "" }, longitude: { value: "" }, accuracyMeters: { value: "" } }, requestSubmit: vi.fn(), addEventListener: vi.fn() };
    const status = { textContent: "" };
    const navigator = availability === "absent" ? {} : { geolocation: { getCurrentPosition: (success: (value: unknown) => void, failure: () => void) => { if(availability==="throws")throw Error("device unavailable"); if(availability==="unresponsive")return; return availability === "available" ? success({ coords: { latitude: 35, longitude: -97, accuracy: 15 } }) : failure(); } } };
    const timer = vi.fn();
    runInNewContext(ACTION_LOCATION_CLIENT, { document: { querySelector: () => form, getElementById: () => status }, navigator, setTimeout: timer, clearTimeout: vi.fn() });
    const event = { preventDefault: vi.fn() };
    form.addEventListener.mock.calls[0][1].call(form, event);
    if(availability==="unresponsive")timer.mock.calls[0][0]();
    if (availability === "absent") expect(event.preventDefault).not.toHaveBeenCalled();
    else expect(form.requestSubmit).toHaveBeenCalledTimes(1);
    if (availability === "available") expect(form.elements.latitude.value).toBe(35);
    else expect(form.elements.latitude.value).toBe("");
  });
});
