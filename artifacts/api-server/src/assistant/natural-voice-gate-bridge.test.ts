import { beforeEach, describe, expect, it, vi } from "vitest";
import { confirmVisitorCheckIn, confirmVisitorCheckOut, prepareVisitorCheckIn, prepareVisitorCheckOut } from "./natural-voice-write-tools";
const fetchMock = vi.fn();
beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal("fetch", fetchMock); });
const fields = {
  firstName: "Bob", lastName: "Villa", siteLocationId: 9, hostType: "vendor", hostVendorId: 22,
  vehiclePlate: "8TRK22", plateState: "TX", latitude: 30, longitude: -100, confirmed: true, idempotencyKey: "call-a",
};
describe("AskV Gate bridge", () => {
  it("keeps a server failure uncertain because it may follow a commit", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500, json: async () => ({ message: "Failure after save" }) });
    expect(JSON.parse(await confirmVisitorCheckIn(fields, { userId: 10, role: "vendor", vendorId: 22, vendorRole: "gatekeeper" }))).toMatchObject({ ok: false, status: "outcome_unknown" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("does not claim success when readback fails or identifies a different saved visit", async () => {
    const receipt = { id: 77, firstName: "Bob", lastName: "Villa", siteLocationId: 9, checkInTime: "2026-11-11T10:00:00Z" };
    for (const readback of [null, { ...receipt, siteLocationId: 10 }, { ...receipt, firstName: "Other" }, { ...receipt, vehiclePlate: "DIFFERENT" }]) {
      fetchMock.mockReset();
      fetchMock.mockResolvedValueOnce({ ok: true, json: async () => receipt }).mockResolvedValueOnce({ ok: true, json: async () => readback });
      expect(JSON.parse(await confirmVisitorCheckIn(fields, { userId: 10, role: "vendor", vendorId: 22, vendorRole: "gatekeeper" }))).toMatchObject({ ok: false, status: "outcome_unknown", visitId: 77 });
      expect(fetchMock.mock.calls.map(call => call[1].method)).toEqual(["POST", "GET"]);
    }
  });
  it("never describes inner departure as property checkout", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ id: 77, checkOutTime: null, gateMovements: [{ kind: "leave" }] }) });
    const result = JSON.parse(await confirmVisitorCheckOut({ visitId: 77, confirmed: true, idempotencyKey: "inner" }, { userId: 10, role: "vendor", vendorId: 22, vendorRole: "gatekeeper" }));
    expect(result).toMatchObject({ ok: false, status: "outcome_unknown" });
    expect(result.action).toBeUndefined();
  });
  it.each([null, [], {}, { ok: true }, { id: 0 }, { id: 77, ok: false }, { id: 77, status: "failed" }, { id: 77, canonicalApplied: false }].map(receipt => ({ receipt })))("never reports a saved visit from an invalid receipt: $receipt", async ({ receipt }) => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => receipt });
    const session = { userId: 10, role: "vendor", vendorId: 22, vendorRole: "gatekeeper" };
    for (const result of [
      JSON.parse(await confirmVisitorCheckIn(fields, session)),
      JSON.parse(await confirmVisitorCheckOut({ visitId: 77, confirmed: true, idempotencyKey: "checkout" }, session)),
    ]) {
      expect(result.ok).toBe(false);
      expect(result.action).toBeUndefined();
      expect(result.message ?? "").not.toMatch(/checked (in|out)\./);
    }
  });
  it("keeps a missing receipt uncertain and does not automatically resubmit", async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 204 });
    const result = JSON.parse(await confirmVisitorCheckIn(fields, { userId: 10, role: "vendor", vendorId: 22, vendorRole: "gatekeeper" }));
    expect(result).toMatchObject({ ok: false, status: "outcome_unknown", code: "assistant.action_outcome_unknown" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("preserves the canonical permission denial", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 403, json: async () => ({ message: "Gate access revoked", code: "gate.forbidden" }) });
    expect(JSON.parse(await confirmVisitorCheckIn(fields, { userId: 10, role: "vendor", vendorId: 22, vendorRole: "gatekeeper" }))).toMatchObject({ ok: false, error: "Gate access revoked", code: "gate.forbidden", status: 403 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("does not report checkout success for a different visit", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ id: 78 }) });
    expect(JSON.parse(await confirmVisitorCheckOut({ visitId: 77, confirmed: true, idempotencyKey: "checkout" }, { userId: 10, role: "vendor", vendorId: 22, vendorRole: "gatekeeper" }))).toMatchObject({ ok: false, status: "outcome_unknown" });
  });
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
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ id: 77, firstName: "Bob", lastName: "Villa", siteLocationId: 9, checkInTime: "2026-11-11T10:00:00Z" }) });
    const result = JSON.parse(await confirmVisitorCheckIn(fields, {
      userId: 20, role: "field_employee", vendorId: 22, vendorRole: "gate_supervisor",
      managedSubcontractor: { siteGrants: [{ siteId: 9, role: "gate_supervisor" }] },
    }));
    expect(result).toMatchObject({
      ok: true,
      action: "visitor_checked_in",
      visitId: 77,
      displayName: "Bob Villa",
      message: "Bob Villa checked in.",
      responseMode: "concise",
      refresh: ["gate", "visits"],
    });
  });
  it("returns a compact named check-out result", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ id: 77, firstName: "Bob", lastName: "Villa", siteLocationId: 9, checkInTime: "2026-11-11T10:00:00Z", checkOutTime: "2026-11-11T11:00:00Z" }) });
    const result = JSON.parse(await confirmVisitorCheckOut(
      { visitId: 77, confirmed: true, idempotencyKey: "call-b" },
      { userId: 10, role: "vendor", vendorId: 22, vendorRole: "gatekeeper" },
    ));
    expect(result).toMatchObject({
      ok: true,
      action: "visitor_checked_out",
      visitId: 77,
      displayName: "Bob Villa",
      message: "Bob Villa checked out.",
      responseMode: "concise",
      refresh: ["gate", "visits"],
    });
  });
});
