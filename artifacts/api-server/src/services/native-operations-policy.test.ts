import { describe, it, expect } from "vitest";
import {
  initialNativeState,
  locationEligibility,
  requestExpiry,
  responseDisposition,
  validateFreshLocation,
  type NativeRequest,
} from "./native-operations-policy";
const now = Date.parse("2026-10-08T00:00:00Z");
const request = (): NativeRequest => ({
  id: "r",
  kind: "location",
  workerUserId: 1,
  vendorId: 2,
  requesterUserId: 3,
  requesterOrgType: "vendor",
  requesterOrgId: 2,
  siteId: null,
  ticketId: 4,
  purpose: "verify arrival",
  createdAt: new Date(now).toISOString(),
  expiresAt: new Date(now + 60_000).toISOString(),
  bindingVersion: 1,
  deviceId: "phone",
  state: "pending",
  allowLibrary: false,
  idempotencyKey: "k",
  result: null,
});
describe("native operations authority", () => {
  it("keeps saved consent separate from active duty and phone connectivity", () => {
    const s = initialNativeState();
    expect(locationEligibility(s, true, now)).toBe("off_duty");
    s.duty.active = true;
    expect(locationEligibility(s, true, now)).toBe("sharing_off");
    s.consent.locationSharing = true;
    s.designatedDeviceId = "phone";
    expect(locationEligibility(s, false, now)).toBe("phone_unavailable");
    expect(locationEligibility(s, true, now)).toBeNull();
  });
  it("bounds queued photos by shift end or eight hours including unscheduled workers", () => {
    expect(requestExpiry("photo", now, null)).toBe(
      new Date(now + 8 * 3600_000).toISOString(),
    );
    expect(
      requestExpiry("photo", now, new Date(now + 30_000).toISOString()),
    ).toBe(new Date(now + 30_000).toISOString());
  });
  it("rejects old-phone location, ended duty and stale captures", () => {
    const s = initialNativeState();
    s.duty.active = true;
    s.consent.locationSharing = true;
    s.designatedDeviceId = "new";
    s.bindingVersion = 2;
    expect(() =>
      responseDisposition(request(), s, "phone", 1, now, "saved"),
    ).toThrow("native.work_phone_changed");
    s.designatedDeviceId = "phone";
    s.bindingVersion = 1;
    s.duty.active = false;
    expect(() =>
      responseDisposition(request(), s, "phone", 1, now, "saved"),
    ).toThrow("native.location_sharing_unavailable");
    expect(() =>
      validateFreshLocation(
        {
          latitude: 0,
          longitude: 0,
          accuracy: 10,
          capturedAt: new Date(now - 1000).toISOString(),
        },
        request(),
        now,
      ),
    ).toThrow();
  });
  it("finishes old phone started photo upload as late evidence after expiry without fulfilling on time", () => {
    const r = request();
    r.kind = "photo";
    r.uploadStartedAt = new Date(now).toISOString();
    r.state = "upload-in-progress";
    const s = initialNativeState();
    s.designatedDeviceId = "new";
    s.bindingVersion = 2;
    expect(responseDisposition(r, s, "phone", 1, now + 61_000, "saved")).toBe(
      "late",
    );
    r.uploadStartedAt = undefined;
    expect(() =>
      responseDisposition(r, s, "phone", 1, now + 61_000, "saved"),
    ).toThrow();
  });
});
