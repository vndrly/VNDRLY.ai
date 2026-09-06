import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  confirmVisitorCheckIn,
  confirmVisitorCheckOut,
  draftSafetyReport,
  findActiveVisitors,
  prepareVisitorCheckIn,
  prepareVisitorCheckOut,
  setTicketLifecycle,
  closeTicketForReview,
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
      "latitude",
      "longitude",
    ]);
    expect(JSON.parse(await prepareVisitorCheckIn(fields)).ok).toBe(true);
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
