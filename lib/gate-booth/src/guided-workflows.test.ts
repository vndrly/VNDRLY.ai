import { describe, expect, it } from "vitest";
import { parseAskVGateGuidance } from "./guided-workflows";
const active = { key: "first-watch", title: "First watch", action: { title: "Assign this saved shift", href: "/work-hub/calendar?siteId=14&shiftId=actual" }, context: { siteId: 14, watchId: "a0000000-0000-0000-0000-000000000001", ticketId: 18, role: "admin" } };
const input = { companyId: 4, state: "ready", active, available: [active], control: { prompt: "Review this shift", targetId: "save-assignment" } };
describe("shared askV Gate guidance context", () => {
  it("preserves the current step and exact saved identities without accepting authority fields", () => {
    const context = parseAskVGateGuidance(input, 4)!;
    expect(context.active).toMatchObject({ key: "first-watch", action: active.action, context: { siteId: 14, watchId: active.context.watchId, ticketId: 18 } });
    expect(context.active?.context).not.toHaveProperty("role");
    expect(context.control?.targetId).toBe("save-assignment");
  });
  it("drops another company's context, invalid identities and unbuilt workflow keys", () => {
    expect(parseAskVGateGuidance(input, 5)).toBeUndefined();
    expect(parseAskVGateGuidance({ ...input, active: { ...active, key: "payroll" }, available: [] })?.active).toBeNull();
    expect(parseAskVGateGuidance({ ...input, active: { ...active, context: { siteId: -1, shiftId: "../foreign" } } })?.active?.context).toEqual({});
  });
  it.each(["https://evil.invalid/gate", "//evil.invalid/gate", "/payroll", "/gate\\outside", "/gate\noutside"])("never forwards unsafe or unsupported paths: %s", href => {
    expect(parseAskVGateGuidance({ ...input, active: { ...active, action: { title: "Go", href } } })?.active?.action).toBeNull();
  });
  it("caps the queue and excludes a form control without an active workflow", () => {
    const context = parseAskVGateGuidance({ ...input, active: null, available: Array(20).fill(active) })!;
    expect(context.available).toHaveLength(5);
    expect(context.control).toBeUndefined();
  });
});

