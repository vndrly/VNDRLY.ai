import { describe, it, expect, vi } from "vitest";
import {
  NativeDiagnosticSchema,
  requireNativeSupportGrant,
} from "./native-support";
import {
  NativePolicySchema,
  initialNativeState,
  nativeDutyContactAvailable,
  type NativeRequest,
} from "./native-operations-policy";
const now = Date.parse("2026-10-07T00:00:00Z");
const request: NativeRequest = {
  id: "r",
  kind: "photo",
  workerUserId: 2,
  vendorId: 1,
  requesterUserId: 3,
  requesterOrgType: "vendor",
  requesterOrgId: 1,
  siteId: 5,
  ticketId: 7,
  purpose: "Sensitive field evidence",
  createdAt: new Date(now).toISOString(),
  expiresAt: new Date(now + 10000).toISOString(),
  bindingVersion: 1,
  deviceId: null,
  state: "pending",
  allowLibrary: false,
  idempotencyKey: "i",
  result: null,
};
describe("native technical support and duty contacts", () => {
  it("accepts technical diagnostics and rejects raw content, tokens or unsanitized errors", () => {
    const diagnostic = {
      deviceId: "11111111-1111-4111-8111-111111111111",
      appVersion: "1.0.3",
      network: "wifi",
      batteryLevel: 0.4,
      lowPower: false,
      permissions: {
        location: "granted",
        camera: "denied",
        notifications: "granted",
      },
      pendingUploads: 1,
      syncState: "pending",
    };
    expect(NativeDiagnosticSchema.safeParse(diagnostic).success).toBe(true);
    for (const field of ["rawOCR", "audio", "token", "ticketText"])
      expect(
        NativeDiagnosticSchema.safeParse({ ...diagnostic, [field]: "private" })
          .success,
      ).toBe(false);
    expect(
      NativeDiagnosticSchema.safeParse({
        ...diagnostic,
        errorCode: "API KEY=secret",
      }).success,
    ).toBe(false);
  });
  it("work content requires a current explicitly granted worker and site with named purpose", () => {
    const policy = NativePolicySchema.parse({
      supportGrants: [
        {
          userId: 9,
          purpose: "Investigate synthetic upload",
          expiresAt: new Date(now + 60000).toISOString(),
          workerUserIds: [2],
          siteIds: [5],
        },
      ],
    });
    expect(requireNativeSupportGrant(policy, 9, request, now).purpose).toBe(
      "Investigate synthetic upload",
    );
    expect(() => requireNativeSupportGrant(policy, 8, request, now)).toThrow(
      "native.support_content_grant_required",
    );
    expect(() =>
      requireNativeSupportGrant(
        policy,
        9,
        { ...request, workerUserId: 6 },
        now,
      ),
    ).toThrow();
    expect(() =>
      requireNativeSupportGrant(policy, 9, { ...request, siteId: 8 }, now),
    ).toThrow();
    expect(() =>
      requireNativeSupportGrant(policy, 9, request, now + 61000),
    ).toThrow();
  });
  it("never assumes an off-duty contact is on call; a saved agreed interval is required", () => {
    const st = initialNativeState();
    expect(nativeDutyContactAvailable(st, now)).toBe(false);
    st.onCallWindows = [
      {
        startsAt: new Date(now - 1000).toISOString(),
        endsAt: new Date(now + 1000).toISOString(),
        consent: true,
      },
    ];
    expect(nativeDutyContactAvailable(st, now)).toBe(true);
    expect(nativeDutyContactAvailable(st, now + 1000)).toBe(false);
    st.duty.active = true;
    expect(nativeDutyContactAvailable(st, now + 1000)).toBe(true);
    st.duty.endsAt = new Date(now).toISOString();
    expect(nativeDutyContactAvailable(st, now + 1000)).toBe(false);
  });
});
