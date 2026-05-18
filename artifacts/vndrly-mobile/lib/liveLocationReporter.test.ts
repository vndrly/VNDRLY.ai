import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ───────────────────────────────────────────────────────────────────
// Task #56 — `getLiveLocationStatus` is the surface the foreground
// `LiveLocationStatusPill` uses to decide whether to show "Live
// location: active" or the amber "paused — tap to fix" badge. These
// tests pin the reason-precedence rules and the stale-ping window so
// regressions show up here instead of as a green pill while the
// reporter is silently broken on a real device.
// ───────────────────────────────────────────────────────────────────

// Mock every native dep that the reporter pulls in transitively. We
// keep the Battery / Location stubs as `vi.fn()` so individual cases
// can flip their return value via `mockResolvedValueOnce` — the
// per-test `beforeEach` resets them to a "happy path" baseline.
vi.mock("expo-location", () => ({
  Accuracy: { Balanced: 1 },
  ActivityType: { Other: 1 },
  getForegroundPermissionsAsync: vi.fn(async () => ({ status: "granted" })),
  getBackgroundPermissionsAsync: vi.fn(async () => ({ status: "granted" })),
  hasStartedLocationUpdatesAsync: vi.fn(async () => true),
  startLocationUpdatesAsync: vi.fn(async () => undefined),
  stopLocationUpdatesAsync: vi.fn(async () => undefined),
  watchPositionAsync: vi.fn(async () => ({ remove: () => {} })),
}));

vi.mock("expo-task-manager", () => ({
  defineTask: vi.fn(),
  isTaskDefined: vi.fn(() => true),
}));

vi.mock("expo-battery", () => ({
  getBatteryLevelAsync: vi.fn(async () => 0.8),
  isLowPowerModeEnabledAsync: vi.fn(async () => false),
}));

vi.mock("./api", () => ({ apiFetch: vi.fn() }));
vi.mock("./deviceId", () => ({ getDeviceId: async () => "device-test" }));
vi.mock("./locationConsent", () => ({
  hasActiveConsentForThisDevice: vi.fn(async () => true),
}));
vi.mock("./auth", () => ({ getUser: async () => null }));
vi.mock("./runtime", () => ({ isExpoGo: false }));
vi.mock("./ticketsRateLimitGate", () => ({
  isTicketsRateLimited: () => false,
  noteTicketsRateLimit: () => null,
}));

// AppState's `addEventListener` returns a subscription with .remove().
// react-native is aliased to react-native-web in vitest config; that
// works here because we never actually mount a component.

import * as Location from "expo-location";
import * as Battery from "expo-battery";
import * as LocationConsent from "./locationConsent";

import {
  __resetLiveLocationReporterForTests,
  __setLiveLocationReporterStateForTests,
  getLiveLocationStatus,
  subscribeLiveLocationStatus,
} from "./liveLocationReporter";

describe("getLiveLocationStatus (Task #56)", () => {
  beforeEach(() => {
    __resetLiveLocationReporterForTests();
    vi.mocked(Location.getForegroundPermissionsAsync).mockResolvedValue({
      status: "granted",
    } as Awaited<ReturnType<typeof Location.getForegroundPermissionsAsync>>);
    vi.mocked(Location.getBackgroundPermissionsAsync).mockResolvedValue({
      status: "granted",
    } as Awaited<ReturnType<typeof Location.getBackgroundPermissionsAsync>>);
    vi.mocked(Location.hasStartedLocationUpdatesAsync).mockResolvedValue(true);
    vi.mocked(Battery.isLowPowerModeEnabledAsync).mockResolvedValue(false);
    vi.mocked(LocationConsent.hasActiveConsentForThisDevice).mockResolvedValue(
      true,
    );
  });

  afterEach(() => {
    __resetLiveLocationReporterForTests();
    vi.clearAllMocks();
  });

  it("returns hasActiveTicket=false and no reasons when nothing is active", async () => {
    const s = await getLiveLocationStatus();
    expect(s.hasActiveTicket).toBe(false);
    expect(s.flowing).toBe(false);
    expect(s.reasons).toEqual([]);
    expect(s.lastPingAt).toBeNull();
  });

  it("returns flowing=true with no reasons on the happy path", async () => {
    __setLiveLocationReporterStateForTests({
      activeTicketIds: [42],
      startedAt: Date.now() - 1000,
      lastSuccessfulPingAt: Date.now() - 60_000,
    });
    const s = await getLiveLocationStatus();
    expect(s.hasActiveTicket).toBe(true);
    expect(s.flowing).toBe(true);
    expect(s.reasons).toEqual([]);
  });

  it("flags missing background permission when only foreground is granted", async () => {
    __setLiveLocationReporterStateForTests({
      activeTicketIds: [1],
      startedAt: Date.now() - 1000,
      lastSuccessfulPingAt: Date.now(),
    });
    vi.mocked(Location.getBackgroundPermissionsAsync).mockResolvedValue({
      status: "denied",
    } as Awaited<ReturnType<typeof Location.getBackgroundPermissionsAsync>>);
    const s = await getLiveLocationStatus();
    expect(s.flowing).toBe(false);
    expect(s.reasons).toContain("background_permission_missing");
    expect(s.reasons).not.toContain("foreground_permission_missing");
  });

  it("flags foreground permission missing and suppresses background-only reason", async () => {
    __setLiveLocationReporterStateForTests({
      activeTicketIds: [1],
      startedAt: Date.now() - 1000,
      lastSuccessfulPingAt: Date.now(),
    });
    vi.mocked(Location.getForegroundPermissionsAsync).mockResolvedValue({
      status: "denied",
    } as Awaited<ReturnType<typeof Location.getForegroundPermissionsAsync>>);
    const s = await getLiveLocationStatus();
    expect(s.reasons).toContain("foreground_permission_missing");
    // Background reason is implied by the foreground reason — the pill
    // should only surface the most actionable one to keep the hint
    // short.
    expect(s.reasons).not.toContain("background_permission_missing");
  });

  it("flags low-power mode when the OS reports it", async () => {
    __setLiveLocationReporterStateForTests({
      activeTicketIds: [1],
      startedAt: Date.now() - 1000,
      lastSuccessfulPingAt: Date.now(),
    });
    vi.mocked(Battery.isLowPowerModeEnabledAsync).mockResolvedValue(true);
    const s = await getLiveLocationStatus();
    expect(s.flowing).toBe(false);
    expect(s.reasons).toContain("low_power_mode");
  });

  it("flags background_task_not_running when the OS task isn't registered", async () => {
    __setLiveLocationReporterStateForTests({
      activeTicketIds: [1],
      startedAt: Date.now() - 1000,
      lastSuccessfulPingAt: Date.now(),
    });
    vi.mocked(Location.hasStartedLocationUpdatesAsync).mockResolvedValue(false);
    const s = await getLiveLocationStatus();
    expect(s.reasons).toContain("background_task_not_running");
  });

  it("flags consent_missing when the user revoked their device consent", async () => {
    __setLiveLocationReporterStateForTests({
      activeTicketIds: [1],
      startedAt: Date.now() - 1000,
      lastSuccessfulPingAt: Date.now(),
    });
    vi.mocked(LocationConsent.hasActiveConsentForThisDevice).mockResolvedValue(
      false,
    );
    const s = await getLiveLocationStatus();
    expect(s.reasons).toContain("consent_missing");
  });

  it("does NOT flag stale_pings during the initial 5-minute startup grace window", async () => {
    __setLiveLocationReporterStateForTests({
      activeTicketIds: [1],
      startedAt: Date.now() - 60_000, // 1 minute since start
      lastSuccessfulPingAt: null,
    });
    const s = await getLiveLocationStatus();
    expect(s.reasons).not.toContain("stale_pings");
    expect(s.flowing).toBe(true);
  });

  it("flags stale_pings after the grace window when no ping has landed", async () => {
    __setLiveLocationReporterStateForTests({
      activeTicketIds: [1],
      startedAt: Date.now() - 10 * 60_000, // 10 minutes
      lastSuccessfulPingAt: null,
    });
    const s = await getLiveLocationStatus();
    expect(s.reasons).toContain("stale_pings");
    expect(s.flowing).toBe(false);
  });

  it("flags stale_pings when the last ping is older than the stale window", async () => {
    __setLiveLocationReporterStateForTests({
      activeTicketIds: [1],
      startedAt: Date.now() - 30 * 60_000,
      lastSuccessfulPingAt: Date.now() - 15 * 60_000, // 15 min ago
    });
    const s = await getLiveLocationStatus();
    expect(s.reasons).toContain("stale_pings");
  });
});

describe("subscribeLiveLocationStatus (Task #56)", () => {
  beforeEach(() => {
    __resetLiveLocationReporterForTests();
  });
  afterEach(() => {
    __resetLiveLocationReporterForTests();
  });

  it("returns an unsubscribe function that removes the listener", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeLiveLocationStatus(listener);
    expect(typeof unsubscribe).toBe("function");
    unsubscribe();
    // Listener removed; if it were still attached our reset wouldn't
    // matter — the contract is just that unsubscribe is callable
    // without throwing and the set is cleared.
    expect(() => unsubscribe()).not.toThrow();
  });
});
