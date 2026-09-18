import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  confirmVisitorCheckIn,
  confirmVisitorCheckOut,
  draftSafetyReport,
  findActiveVisitors,
  prepareVisitorCheckIn,
  prepareVisitorCheckOut,
  resolveGateCheckInCandidate,
  searchGateHistory,
  setTicketLifecycle,
  closeTicketForReview,
  callNaturalVoiceDomainApi,
} from "./natural-voice-write-tools";
const fetchMock = vi.fn();
const gate = {
  userId: 10,
  role: "vendor",
  vendorId: 22,
  vendorRole: "gatekeeper",
};
const fields = {
  firstName: "Bob",
  lastName: "Villa",
  siteLocationId: 9,
  hostType: "vendor",
  hostVendorId: 22,
  vehiclePlate: "8TRK22",
  plateState: "TX",
  latitude: 30,
  longitude: -100,
  confirmed: true,
  idempotencyKey: "call-a",
};
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
describe("AskV canonical Gate and field operations", () => {
  it("supports the full internal Work Hub method set and marks requests as Ask V", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true }),
    });
    await callNaturalVoiceDomainApi(
      "/work-hub/calls/settings",
      "PUT",
      { available: true },
      gate,
    );
    await callNaturalVoiceDomainApi(
      "/work-hub/channels/abc",
      "DELETE",
      { operationId: "op" },
      gate,
    );
    expect(fetchMock.mock.calls.map(([, init]) => init.method)).toEqual([
      "PUT",
      "DELETE",
    ]);
    expect(fetchMock.mock.calls[0][1].headers).toMatchObject({
      "X-VNDRLY-Source": "askv",
      "X-VNDRLY-Client": "assistant",
    });
  });
  it("forwards only explicitly supplied internal request headers", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true }),
    });
    await callNaturalVoiceDomainApi(
      "/work-hub/meetings/occurrence/replay/watch/progress",
      "POST",
      { playheadMs: 1200 },
      gate,
      { "x-replay-view-session": "server-issued-token" },
    );
    expect(fetchMock.mock.calls[0][1].headers).toMatchObject({
      "x-replay-view-session": "server-issued-token",
    });
  });
  it("collects exact host and location instead of silently choosing them", async () => {
    const incomplete = JSON.parse(
      await prepareVisitorCheckIn({
        firstName: "Bob",
        lastName: "Villa",
        siteLocationId: 9,
        hostType: "vendor",
      }),
    );
    expect(incomplete.missing).toEqual([
      "hostVendorId",
      "vehiclePlate",
      "latitude",
      "longitude",
    ]);
    expect(JSON.parse(await prepareVisitorCheckIn(fields)).ok).toBe(true);
  });
  it("recovers incomplete plate input without treating it as a system failure", async () => {
    expect(
      JSON.parse(
        await prepareVisitorCheckIn({
          ...fields,
          vehiclePlate: "12",
          plateState: undefined,
        }),
      ),
    ).toMatchObject({
      ok: false,
      missing: ["vehiclePlate"],
      recovery: {
        kind: "input",
        promptField: "vehiclePlate",
        offerCamera: true,
        reportSystemFailure: false,
      },
    });
    expect(
      JSON.parse(
        await prepareVisitorCheckIn({ ...fields, plateState: undefined }),
      ),
    ).toMatchObject({
      missing: ["plateState"],
      recovery: { promptField: "plateState", offerCamera: true },
    });
  });
  it("denies non-gatekeepers before any visitor write", async () => {
    expect(
      JSON.parse(
        await confirmVisitorCheckIn(fields, { ...gate, vendorRole: "office" }),
      ).ok,
    ).toBe(false);
    expect(
      JSON.parse(
        await confirmVisitorCheckOut(
          { visitId: 44, confirmed: true, idempotencyKey: "c" },
          { userId: 11, role: "field_employee" },
        ),
      ).ok,
    ).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("passes every Gate field through canonical validation and preserves denial", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 403,
      json: async () => ({
        message: "Too far from site",
        code: "off_geofence",
      }),
    });
    const result = JSON.parse(
      await confirmVisitorCheckIn(
        { ...fields, phone: "555", platePhotoUrl: "/objects/uploads/id" },
        gate,
      ),
    );
    expect(result).toMatchObject({ ok: false, code: "off_geofence" });
    const [url, request] = fetchMock.mock.calls[0];
    expect(url).toMatch(/127\.0\.0\.1:\d+\/api\/visits\/gate\/check-in$/);
    expect(JSON.parse(request.body)).toMatchObject({
      hostVendorId: 22,
      latitude: 30,
      phone: "555",
      platePhotoUrl: "/objects/uploads/id",
    });
    expect(JSON.parse(request.body).confirmed).toBeUndefined();
    expect(request.headers.cookie).toMatch(/^vndrly_session=/);
  });
  it("reads only canonical role-scoped visits and honors explicit visit selection", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => [
        { id: 44, firstName: "Bob", lastName: "Villa" },
        { id: 45, firstName: "Bob", lastName: "Smith" },
      ],
    });
    expect(
      JSON.parse(await prepareVisitorCheckOut({ visitId: 45 }, gate)),
    ).toMatchObject({ matches: [{ id: 45 }], needsChoice: false });
    expect(
      JSON.parse(
        await findActiveVisitors({}, { userId: 11, role: "field_employee" }),
      ).error,
    ).toBeTruthy();
  });
  it("searches only the authenticated Gate history and normalizes plate clues", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => [
        { id: 61, firstName: "Jack", lastName: "Smith", company: "Grady Farms", vehiclePlate: "ABC-123", plateState: "TX", siteLocationId: 9, checkInTime: "2026-09-17T10:00:00.000Z" },
        { id: 62, firstName: "Unrelated", lastName: "Driver", company: "Other", vehiclePlate: "ZZZ999", plateState: "OK", siteLocationId: 9, checkInTime: "2026-09-17T11:00:00.000Z" },
      ],
    });
    const result = JSON.parse(await searchGateHistory({ vehiclePlate: "abc 123", siteLocationId: 9 }, gate));
    expect(result).toMatchObject({
      ok: true,
      matches: [{ id: 61, firstName: "Jack", lastName: "Smith", plateState: "TX" }],
    });
    expect(fetchMock.mock.calls[0][0]).toMatch(/\/api\/visits\?/);
  });

  it("resolves a unique historical plate while preserving an explicitly named driver", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => [
        { id: 61, firstName: "Old", lastName: "Driver", company: "Grady Farms", vehiclePlate: "ABC-123", plateState: "TX", purpose: "Delivery", siteLocationId: 9, hostType: "vendor", hostVendorId: 22, checkInTime: "2026-09-17T10:00:00.000Z" },
      ],
    });
    const result = JSON.parse(await resolveGateCheckInCandidate({
      firstName: "Jack",
      lastName: "Smith",
      vehiclePlate: "abc 123",
      siteLocationId: 9,
    }, gate));
    expect(result).toMatchObject({
      ok: true,
      confidence: "high",
      draft: {
        firstName: "Jack",
        lastName: "Smith",
        company: "Grady Farms",
        vehiclePlate: "ABC123",
        plateState: "TX",
      },
      provenance: {
        firstName: "explicit",
        lastName: "explicit",
        company: "most_recent_authorized_visit",
        plateState: "unique_authorized_plate_history",
      },
      execution: "client",
      intent: { name: "prefill_gate_visit", arguments: { mode: "check-in" } },
    });
  });

  it("asks once for plate state when the same normalized plate occurs in multiple states", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => [
        { id: 61, firstName: "Jack", lastName: "Smith", vehiclePlate: "ABC123", plateState: "TX", siteLocationId: 9 },
        { id: 62, firstName: "Jack", lastName: "Smith", vehiclePlate: "ABC123", plateState: "OK", siteLocationId: 9 },
      ],
    });
    const result = JSON.parse(await resolveGateCheckInCandidate({ vehiclePlate: "ABC123", siteLocationId: 9 }, gate));
    expect(result).toMatchObject({
      ok: false,
      confidence: "ambiguous",
      clarification: { field: "plateState" },
    });
  });

  it("denies Gate history and resolution to an unassigned non-gate account", async () => {
    const session = { userId: 11, role: "field_employee" } as never;
    expect(JSON.parse(await searchGateHistory({}, session)).error).toMatch(/Gatekeeper/i);
    expect(JSON.parse(await resolveGateCheckInCandidate({}, session)).error).toMatch(/Gatekeeper/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("delegates ticket transitions and close to existing lifecycle endpoints", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ id: 42 }) });
    await setTicketLifecycle(
      {
        ticketId: 42,
        phase: "on_site",
        latitude: 30,
        longitude: -100,
        idempotencyKey: "c",
      },
      gate,
    );
    expect(fetchMock.mock.calls[0][0]).toMatch(/\/tickets\/42\/check-in$/);
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: 42, status: "in_progress" }),
    });
    await closeTicketForReview(
      { ticketId: 42, confirmed: true, idempotencyKey: "c2" },
      gate,
    );
    expect(fetchMock.mock.calls[2][0]).toMatch(/\/tickets\/42\/check-out$/);
    expect(JSON.parse(fetchMock.mock.calls[2][1].body).workCompleted).toBe(
      false,
    );
  });
  it("uses the canonical submit workflow after work has already completed", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: 42, status: "completed" }),
    });
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: 42, status: "submitted" }),
    });
    const result = JSON.parse(
      await closeTicketForReview(
        { ticketId: 42, confirmed: true, idempotencyKey: "after-work" },
        gate,
      ),
    );
    expect(fetchMock.mock.calls[1][0]).toMatch(/\/tickets\/42\/submit$/);
    expect(result).toMatchObject({ ok: true, status: "submitted" });
  });
  it("keeps safety drafts unsubmitted", async () => {
    expect(
      JSON.parse(
        await draftSafetyReport({
          title: "Near miss",
          siteLocationId: 3,
          eventType: "near_miss",
        }),
      ),
    ).toMatchObject({ ok: true, submitted: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
