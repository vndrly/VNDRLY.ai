import { describe, expect, it } from "vitest";
import { assertCalendarEventAccess } from "./calendar-event-policy";
import type { SessionPayload } from "../lib/session";
const event = { recordingAllowed: false };
const owner = { type: "vendor" as const, id: 1115 };
describe("staff calendar events", () => {
  it.each(["office", "gatekeeper", "gate_supervisor", "field", "fleet"])("permits a one-off event for current company %s staff", vendorRole => {
    expect(() => assertCalendarEventAccess({ userId: 7, vendorId: 1115, vendorRole } as SessionPayload, owner, event)).not.toThrow();
  });
  it("rejects other companies and privileged meeting options", () => {
    const actor = { userId: 7, vendorId: 1115 } as SessionPayload;
    expect(() => assertCalendarEventAccess(actor, { ...owner, id: 999 }, event)).toThrow();
    expect(() => assertCalendarEventAccess(actor, owner, { recordingAllowed: true })).toThrow();
    expect(() => assertCalendarEventAccess(actor, owner, { ...event, recurrence: { frequency: "daily" } })).toThrow();
    expect(() => assertCalendarEventAccess(actor, owner, { ...event, admissionMode: "company_open" })).toThrow();
  });
});
