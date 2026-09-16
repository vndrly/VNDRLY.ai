import { beforeEach, describe, expect, it, vi } from "vitest";
import { confirmVisitorCheckIn, prepareVisitorCheckIn, prepareVisitorCheckOut } from "./natural-voice-write-tools";
const fetchMock = vi.fn();
beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal("fetch", fetchMock); });
const fields = {
  firstName: "Bob", lastName: "Villa", siteLocationId: 9, hostType: "vendor", hostVendorId: 22,
  vehiclePlate: "8TRK22", plateState: "TX", latitude: 30, longitude: -100, confirmed: true, idempotencyKey: "call-a",
};
describe("AskV Gate bridge", () => {
  it("returns client form intents for check-in and check-out preparation", async () => {
    expect(JSON.parse(await prepareVisitorCheckIn(fields))).toMatchObject({
      execution: "client", intent: { name: "prefill_gate_visit", arguments: { mode: "check-in", values: { firstName: "Bob", vehiclePlate: "8TRK22" } } },
    });
    fetchMock.mockResolvedValue({ ok: true, json: async () => [{ id: 45, firstName: "Bob", lastName: "Villa" }] });
    expect(JSON.parse(await prepareVisitorCheckOut({ visitId: 45 }, { userId: 10, role: "vendor", vendorId: 22, vendorRole: "gatekeeper" }))).toMatchObject({
      execution: "client", intent: { name: "prefill_gate_visit", arguments: { mode: "check-out", matches: [{ id: 45 }] } },
    });
  });
  it("allows a managed-subcontractor gate supervisor to submit through the canonical Gate API", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ id: 77 }) });
    const result = JSON.parse(await confirmVisitorCheckIn(fields, {
      userId: 20, role: "field_employee", vendorId: 22, vendorRole: "gate_supervisor",
      managedSubcontractor: { siteGrants: [{ siteId: 9, role: "gate_supervisor" }] },
    }));
    expect(result).toMatchObject({ ok: true, visitId: 77 });
  });
});
