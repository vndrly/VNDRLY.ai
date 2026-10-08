import { describe, expect, it } from "vitest";
import { arrivalMayBeAutomatic, maySupplyFreshLocation, nativeRequestRoute, requestIsActionable, type NativeOperationsStatus } from "./native-operations-policy";
const status: NativeOperationsStatus = { policy: { enabled: true, automaticArrival: true }, duty: { active: true }, consent: { locationSharing: true, automaticArrival: true }, designatedDeviceId: "phone", bindingVersion: 1, requests: [] };
describe("native operations authority", () => {
  it("requires active duty, consent, enabled company policy and designated phone independently", () => {
    expect(maySupplyFreshLocation(status, "phone")).toBe(true);
    expect(maySupplyFreshLocation(status, "viewer")).toBe(false);
    expect(maySupplyFreshLocation({ ...status, duty: { active: false } }, "phone")).toBe(false);
    expect(maySupplyFreshLocation({ ...status, consent: { locationSharing: false } }, "phone")).toBe(false);
    expect(maySupplyFreshLocation({ ...status, policy: { enabled: false } }, "phone")).toBe(false);
  });
  it("does not infer automatic arrival from company preference alone", () => {
    expect(arrivalMayBeAutomatic(status)).toBe(true);
    expect(arrivalMayBeAutomatic({ ...status, consent: { locationSharing: true } })).toBe(false);
  });
  it("rejects expired, terminal and malformed expiry requests", () => {
    const request = { id: "x", kind: "photo" as const, state: "pending", ticketId: 1, purpose: "test", expiresAt: new Date(2000).toISOString() };
    expect(requestIsActionable(request, 1000)).toBe(true);
    expect(requestIsActionable(request, 2000)).toBe(false);
    expect(requestIsActionable({ ...request, state: "saved" }, 1000)).toBe(false);
    expect(requestIsActionable({ ...request, expiresAt: "bad" }, 1000)).toBe(false);
  });
  it("binds notification navigation to opaque exact request IDs", () => {
    expect(nativeRequestRoute("../../ticket/5")).toBe(null);
    expect(nativeRequestRoute("1b5f6fa0-f191-427a-aee8-11541a44c4e3")).toBe("/work-hub/native-operations?requestId=1b5f6fa0-f191-427a-aee8-11541a44c4e3");
  });
});
