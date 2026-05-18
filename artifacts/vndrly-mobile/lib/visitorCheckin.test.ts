import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SiteContext } from "./guest";

const visitorCheckInMock = vi.fn();
const requestForegroundPermissionsAsyncMock = vi.fn();
const getCurrentPositionAsyncMock = vi.fn();

vi.mock("./guest", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./guest")>();
  return {
    ...actual,
    visitorCheckIn: (...args: unknown[]) => visitorCheckInMock(...args),
  };
});

vi.mock("expo-location", () => ({
  Accuracy: { High: 4, Balanced: 3 },
  requestForegroundPermissionsAsync: (...args: unknown[]) =>
    requestForegroundPermissionsAsyncMock(...args),
  getCurrentPositionAsync: (...args: unknown[]) =>
    getCurrentPositionAsyncMock(...args),
}));

// expo-camera isn't called by the helpers under test, but importers in the
// app can pull it in transitively via expo modules. Mock it defensively so
// the suite never tries to load native bindings.
vi.mock("expo-camera", () => ({
  CameraView: () => null,
  useCameraPermissions: () => [{ granted: false }, vi.fn()],
}));

vi.mock("./api", () => ({ apiFetch: vi.fn() }));
vi.mock("./auth", () => ({
  setToken: vi.fn(),
  setUser: vi.fn(),
  getToken: vi.fn(),
}));

const baseCtx: SiteContext = {
  site: {
    id: 42,
    name: "Acme HQ",
    address: "123 Main St",
    latitude: 37.7,
    longitude: -122.4,
    siteRadiusMeters: 100,
    siteCode: "ACME-HQ",
  },
  partner: { id: 7, name: "Acme Partner" },
  vendors: [
    { id: 11, name: "Bolt Vendor" },
    { id: 12, name: "Wire Vendor" },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("extractSiteCode", () => {
  let extractSiteCode: typeof import("./visitorCheckin").extractSiteCode;
  beforeEach(async () => {
    ({ extractSiteCode } = await import("./visitorCheckin"));
  });

  it("returns plain alphanumeric codes as-is", () => {
    expect(extractSiteCode("ACME-HQ_01")).toBe("ACME-HQ_01");
    expect(extractSiteCode("abc123")).toBe("abc123");
  });

  it("trims whitespace before validating", () => {
    expect(extractSiteCode("  HELLO-1  ")).toBe("HELLO-1");
  });

  it("extracts the code from a /portal/<code> URL", () => {
    expect(extractSiteCode("https://example.com/portal/ACME-HQ")).toBe(
      "ACME-HQ",
    );
  });

  it("extracts the code from a /visit/<code> URL", () => {
    expect(extractSiteCode("https://vndrly.app/visit/SITE_42")).toBe("SITE_42");
  });

  it("URL-decodes the extracted code segment", () => {
    expect(
      extractSiteCode("https://example.com/portal/ACME%20HQ"),
    ).toBe("ACME HQ");
  });

  it("prefers /portal/ over /visit/ when both appear", () => {
    expect(
      extractSiteCode("https://example.com/portal/A1/visit/B2"),
    ).toBe("A1");
  });

  it("rejects empty input", () => {
    expect(extractSiteCode("")).toBeNull();
    expect(extractSiteCode("   ")).toBeNull();
  });

  it("rejects strings with disallowed characters", () => {
    expect(extractSiteCode("hello world")).toBeNull();
    expect(extractSiteCode("foo$bar")).toBeNull();
    expect(extractSiteCode("a/b")).toBeNull();
  });

  it("returns null for URLs that don't carry a portal/visit segment", () => {
    expect(extractSiteCode("https://example.com/")).toBeNull();
    expect(extractSiteCode("https://example.com/other/ACME")).toBeNull();
  });
});

describe("buildHostOptions", () => {
  let buildHostOptions: typeof import("./visitorCheckin").buildHostOptions;
  beforeEach(async () => {
    ({ buildHostOptions } = await import("./visitorCheckin"));
  });

  it("returns an empty list when there is no site context", () => {
    expect(buildHostOptions(null)).toEqual([]);
    expect(buildHostOptions(undefined)).toEqual([]);
  });

  it("renders a partner option followed by vendor options", () => {
    const opts = buildHostOptions(baseCtx);
    expect(opts).toEqual([
      {
        key: "partner:7",
        label: "Acme Partner (Partner)",
        type: "partner",
        id: 7,
      },
      {
        key: "vendor:11",
        label: "Bolt Vendor (Vendor)",
        type: "vendor",
        id: 11,
      },
      {
        key: "vendor:12",
        label: "Wire Vendor (Vendor)",
        type: "vendor",
        id: 12,
      },
    ]);
  });

  it("omits the partner row when no partner is associated with the site", () => {
    const opts = buildHostOptions({ ...baseCtx, partner: null });
    expect(opts.map((o) => o.type)).toEqual(["vendor", "vendor"]);
  });

  it("returns an empty list when there are no hosts at all", () => {
    expect(buildHostOptions({ ...baseCtx, partner: null, vendors: [] })).toEqual(
      [],
    );
  });
});

describe("canSubmitCheckIn (host picker disabled state)", () => {
  let canSubmitCheckIn: typeof import("./visitorCheckin").canSubmitCheckIn;
  beforeEach(async () => {
    ({ canSubmitCheckIn } = await import("./visitorCheckin"));
  });

  it("is false when no host is selected", () => {
    expect(canSubmitCheckIn(null, baseCtx, false)).toBe(false);
  });

  it("is false when the site context is missing", () => {
    expect(canSubmitCheckIn("partner:7", null, false)).toBe(false);
  });

  it("is false when the selected host key is not in the option list", () => {
    expect(canSubmitCheckIn("vendor:999", baseCtx, false)).toBe(false);
  });

  it("is false while a submit is already in flight", () => {
    expect(canSubmitCheckIn("partner:7", baseCtx, true)).toBe(false);
  });

  it("is true once a valid host is selected and we are idle", () => {
    expect(canSubmitCheckIn("partner:7", baseCtx, false)).toBe(true);
    expect(canSubmitCheckIn("vendor:11", baseCtx, false)).toBe(true);
  });
});

describe("parseDurationMinutes", () => {
  let parseDurationMinutes: typeof import("./visitorCheckin").parseDurationMinutes;
  beforeEach(async () => {
    ({ parseDurationMinutes } = await import("./visitorCheckin"));
  });

  it("parses a positive integer string", () => {
    expect(parseDurationMinutes("60")).toBe(60);
  });

  it("ignores empty / non-numeric / non-positive input", () => {
    expect(parseDurationMinutes("")).toBeUndefined();
    expect(parseDurationMinutes("abc")).toBeUndefined();
    expect(parseDurationMinutes("0")).toBeUndefined();
    expect(parseDurationMinutes("-15")).toBeUndefined();
  });
});

describe("submitVisitorCheckIn", () => {
  let submitVisitorCheckIn: typeof import("./visitorCheckin").submitVisitorCheckIn;
  beforeEach(async () => {
    ({ submitVisitorCheckIn } = await import("./visitorCheckin"));
  });

  it("returns no-host when the selected key doesn't match any option", async () => {
    const result = await submitVisitorCheckIn({
      ctx: baseCtx,
      hostKey: "vendor:404",
      purpose: "",
      durationStr: "60",
    });
    expect(result).toEqual({ ok: false, reason: "no-host" });
    expect(requestForegroundPermissionsAsyncMock).not.toHaveBeenCalled();
    expect(visitorCheckInMock).not.toHaveBeenCalled();
  });

  it("returns location-denied without calling the API when the OS denies foreground location", async () => {
    requestForegroundPermissionsAsyncMock.mockResolvedValueOnce({
      status: "denied",
    });
    const result = await submitVisitorCheckIn({
      ctx: baseCtx,
      hostKey: "partner:7",
      purpose: "Inspection",
      durationStr: "60",
    });
    expect(result).toEqual({ ok: false, reason: "location-denied" });
    expect(getCurrentPositionAsyncMock).not.toHaveBeenCalled();
    expect(visitorCheckInMock).not.toHaveBeenCalled();
  });

  it("submits a partner check-in with the GPS coordinates and trimmed purpose", async () => {
    requestForegroundPermissionsAsyncMock.mockResolvedValueOnce({
      status: "granted",
    });
    getCurrentPositionAsyncMock.mockResolvedValueOnce({
      coords: { latitude: 1.23, longitude: 4.56 },
    });
    visitorCheckInMock.mockResolvedValueOnce({ id: 999 });

    const result = await submitVisitorCheckIn({
      ctx: baseCtx,
      hostKey: "partner:7",
      purpose: "  Inspection  ",
      durationStr: "45",
    });

    expect(result).toEqual({ ok: true, visitId: 999 });
    expect(visitorCheckInMock).toHaveBeenCalledTimes(1);
    expect(visitorCheckInMock).toHaveBeenCalledWith({
      siteLocationId: 42,
      hostType: "partner",
      hostPartnerId: 7,
      hostVendorId: undefined,
      purpose: "Inspection",
      expectedDurationMinutes: 45,
      latitude: 1.23,
      longitude: 4.56,
    });
  });

  it("submits a vendor check-in and omits an empty purpose / invalid duration", async () => {
    requestForegroundPermissionsAsyncMock.mockResolvedValueOnce({
      status: "granted",
    });
    getCurrentPositionAsyncMock.mockResolvedValueOnce({
      coords: { latitude: 10, longitude: 20 },
    });
    visitorCheckInMock.mockResolvedValueOnce({ id: 1 });

    await submitVisitorCheckIn({
      ctx: baseCtx,
      hostKey: "vendor:12",
      purpose: "   ",
      durationStr: "abc",
    });

    expect(visitorCheckInMock).toHaveBeenCalledWith({
      siteLocationId: 42,
      hostType: "vendor",
      hostPartnerId: undefined,
      hostVendorId: 12,
      purpose: undefined,
      expectedDurationMinutes: undefined,
      latitude: 10,
      longitude: 20,
    });
  });

  it("propagates errors thrown by the guest check-in API", async () => {
    requestForegroundPermissionsAsyncMock.mockResolvedValueOnce({
      status: "granted",
    });
    getCurrentPositionAsyncMock.mockResolvedValueOnce({
      coords: { latitude: 0, longitude: 0 },
    });
    visitorCheckInMock.mockRejectedValueOnce(new Error("Outside geofence"));

    await expect(
      submitVisitorCheckIn({
        ctx: baseCtx,
        hostKey: "partner:7",
        purpose: "",
        durationStr: "60",
      }),
    ).rejects.toThrow("Outside geofence");
  });
});
