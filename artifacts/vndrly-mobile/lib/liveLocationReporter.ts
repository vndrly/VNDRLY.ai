import * as Location from "expo-location";
import * as TaskManager from "expo-task-manager";
import * as Battery from "expo-battery";
import { AppState, type AppStateStatus } from "react-native";

import { apiFetch } from "./api";
import { getDeviceId } from "./deviceId";
import { hasActiveConsentForThisDevice } from "./locationConsent";
import { getUser } from "./auth";
import { isExpoGo } from "./runtime";
import {
  isTicketsRateLimited,
  noteTicketsRateLimit,
} from "./ticketsRateLimitGate";

const POLL_TICKETS_MS = 60 * 1000;
const ACTIVE_STATES = new Set(["en_route", "on_site"]);

export const LIVE_LOCATION_TASK = "vndrly-live-location";

type ActiveTicket = { id: number; lifecycleState: string | null; fieldEmployeeId: number | null };
type FieldMe = { employeeId: number };

let pollTimer: ReturnType<typeof setInterval> | null = null;
let appStateSub: { remove: () => void } | null = null;
let started = false;
let startedAt: number | null = null;
let activeTicketIds: number[] = [];
let myEmployeeId: number | null = null;
let backgroundActive = false;
// Task #56 — timestamp of the most recent successful ping POST. The
// status surface below uses it to detect "stale_pings" — i.e. the
// reporter believes it's running but the OS hasn't actually delivered
// a location callback in long enough that the screen should warn the
// worker. Stays `null` while we're set up but haven't yet sent a
// location to the server.
let lastSuccessfulPingAt: number | null = null;

// Task #56 — listeners notified when the reporter's observable status
// might have changed (active ticket set updated, ping landed, etc.).
// The mobile UI's `LiveLocationStatusPill` subscribes via
// `subscribeLiveLocationStatus` and re-fetches `getLiveLocationStatus`
// on each notification so the active/paused indicator updates without
// the screen polling on its own.
type StatusListener = () => void;
const statusListeners = new Set<StatusListener>();

function notifyStatus() {
  for (const l of statusListeners) {
    try {
      l();
    } catch {
      // listener errors must not break peers
    }
  }
}

async function getMyEmployeeId(): Promise<number | null> {
  if (myEmployeeId != null) return myEmployeeId;
  try {
    const me = await apiFetch<FieldMe>("/api/field/me");
    myEmployeeId = me?.employeeId ?? null;
    return myEmployeeId;
  } catch {
    return null;
  }
}

async function findActiveTickets(): Promise<number[] | null> {
  try {
    const empId = await getMyEmployeeId();
    if (!empId) return [];
    // Task #686: skip the /api/tickets fetch while the per-session
    // rate limit (Task #675) is parked. Polling into the cooldown
    // would just re-trip the limit and prevent the foreground screen
    // from recovering. We return `null` to signal "unchanged" so the
    // caller leaves the previous active set in place — the next poll
    // (60s later, after the cooldown) picks the truth back up.
    if (isTicketsRateLimited()) return null;
    const tickets = await apiFetch<ActiveTicket[]>("/api/tickets");
    if (!Array.isArray(tickets)) return [];
    return tickets
      .filter((t) =>
        t.fieldEmployeeId === empId &&
        t.lifecycleState != null &&
        ACTIVE_STATES.has(t.lifecycleState),
      )
      .map((t) => t.id);
  } catch (e) {
    // Task #686: a 429 here means the server told us to back off.
    // Arm the shared cooldown so the foreground screen + the next
    // poll both park instead of immediately re-trying. Other errors
    // (network blip, 401, 5xx) still get the existing silent-skip
    // behavior — the next 60s poll will retry naturally.
    //
    // For a 429 specifically we return `null` ("unchanged") so the
    // caller preserves the previous active set instead of dropping
    // to []. Without this, a single 429 would briefly stop background
    // updates (because `refreshActiveTicket` would see [] and call
    // `stopBackgroundUpdates`) only for the next poll to start them
    // back up — wasted churn on the OS task and a gap in the live
    // location stream that the user can see. Other (non-429) errors
    // keep the historical "treat as no active tickets" behavior.
    const rlSeconds = noteTicketsRateLimit(e);
    if (rlSeconds != null) return null;
    return [];
  }
}

async function getBatteryLevel(): Promise<number | null> {
  try {
    const level = await Battery.getBatteryLevelAsync();
    if (typeof level !== "number" || !Number.isFinite(level) || level < 0) return null;
    return level;
  } catch {
    return null;
  }
}

async function postPing(
  latitude: number,
  longitude: number,
  heading: number | null,
  speedMps: number | null,
) {
  if (activeTicketIds.length === 0) return;
  const allowed = await hasActiveConsentForThisDevice();
  if (!allowed) {
    await stopBackgroundUpdates();
    return;
  }
  const deviceId = await getDeviceId();
  const batteryLevel = await getBatteryLevel();
  for (const ticketId of activeTicketIds) {
    try {
      await apiFetch("/api/location-pings", {
        method: "POST",
        body: JSON.stringify({
          ticketId,
          latitude,
          longitude,
          deviceId,
          batteryLevel,
          heading,
          speedMps,
        }),
      });
      // Task #56 — record a successful delivery so the foreground
      // status pill can drop the "paused / stale" warning the moment
      // the OS actually delivers a callback again. We only mark on
      // success; transient POST failures (handled by the catch below)
      // shouldn't count, otherwise a server outage would hide a real
      // OS-throttle problem.
      lastSuccessfulPingAt = Date.now();
      notifyStatus();
      return;
    } catch {
      // try next
    }
  }
}

// expo-location reports speed as -1 when unknown (cold fix, no GPS lock).
// Treat that and any non-finite value as null so the server doesn't try to
// render a "0 mph" or negative speed badge.
function normalizeSpeed(raw: number | null | undefined): number | null {
  if (raw == null) return null;
  if (!Number.isFinite(raw)) return null;
  if (raw < 0) return null;
  return raw;
}

// expo-location reports heading as -1 when the device hasn't determined it
// yet (stationary, just woke up, etc.). Treat that as unknown so the server
// can fall back to bearing-from-previous-ping.
function normalizeHeading(raw: number | null | undefined): number | null {
  if (raw == null) return null;
  if (!Number.isFinite(raw)) return null;
  if (raw < 0) return null;
  return raw % 360;
}

// Background task — runs even when app is suspended (iOS) or killed (Android,
// best effort). Receives batched location updates from the OS.
// Skipped in Expo Go: expo-task-manager isn't bundled there and calling
// defineTask at module load crashes the app on launch. Background tracking
// only runs in dev/production builds anyway.
if (!isExpoGo && !TaskManager.isTaskDefined(LIVE_LOCATION_TASK)) {
  TaskManager.defineTask(LIVE_LOCATION_TASK, async ({ data, error }) => {
    if (error) return;
    const locs: Location.LocationObject[] | undefined = (data as any)?.locations;
    if (!locs || locs.length === 0) return;
    const last = locs[locs.length - 1];
    try {
      // Reporter module state may be cold on background wakeup; refresh tickets.
      // Task #686: a `null` return means the rate-limit gate parked us
      // — keep whatever active set we already had instead of dropping
      // to []. The next OS callback will retry (and the cooldown is
      // typically <30s).
      if (activeTicketIds.length === 0) {
        const ids = await findActiveTickets();
        if (ids != null) activeTicketIds = ids;
      }
      await postPing(
        last.coords.latitude,
        last.coords.longitude,
        normalizeHeading(last.coords.heading),
        normalizeSpeed(last.coords.speed),
      );
    } catch {
      // ignore — next OS callback will retry
    }
  });
}

async function ensureBackgroundUpdates() {
  if (backgroundActive) return;
  if (activeTicketIds.length === 0) return;
  const allowed = await hasActiveConsentForThisDevice();
  if (!allowed) return;
  // Background location requires expo-task-manager native code, which is not
  // available in Expo Go. Foreground watcher below still keeps reporting.
  if (isExpoGo) {
    ensureForegroundWatcher();
    return;
  }

  const fg = await Location.getForegroundPermissionsAsync();
  if (fg.status !== "granted") return;
  // Background permission is required on iOS/Android for true background
  // delivery; if not granted, fall back to foreground-only updates.
  let useBackground = false;
  try {
    const bg = await Location.getBackgroundPermissionsAsync();
    useBackground = bg.status === "granted";
  } catch {
    useBackground = false;
  }

  try {
    if (useBackground) {
      const already = await Location.hasStartedLocationUpdatesAsync(LIVE_LOCATION_TASK);
      if (!already) {
        await Location.startLocationUpdatesAsync(LIVE_LOCATION_TASK, {
          accuracy: Location.Accuracy.Balanced,
          timeInterval: 3 * 60 * 1000,
          distanceInterval: 75,
          deferredUpdatesInterval: 3 * 60 * 1000,
          deferredUpdatesDistance: 75,
          showsBackgroundLocationIndicator: false,
          // Keep updates flowing while parked on site; iOS otherwise stops
          // delivering once the device is stationary and may not resume.
          pausesUpdatesAutomatically: false,
          foregroundService: {
            notificationTitle: "VNDRLY tracking active",
            notificationBody: "Sharing your location with your vendor while on shift.",
          },
          // "Other" works for both driving and stationary on-site phases;
          // AutomotiveNavigation makes iOS too aggressive about pausing.
          activityType: Location.ActivityType.Other,
        });
      }
      backgroundActive = true;
    }
  } catch {
    // If background updates can't be started (sim, missing perms), the
    // foreground watcher below still keeps things working while app is open.
  }

  // Always also keep a foreground watcher so we report even without background
  // permission while the app is open.
  ensureForegroundWatcher();
}

let foregroundSub: Location.LocationSubscription | null = null;
async function ensureForegroundWatcher() {
  if (foregroundSub) return;
  try {
    foregroundSub = await Location.watchPositionAsync(
      {
        accuracy: Location.Accuracy.Balanced,
        timeInterval: 3 * 60 * 1000,
        distanceInterval: 75,
      },
      (loc) => {
        postPing(
          loc.coords.latitude,
          loc.coords.longitude,
          normalizeHeading(loc.coords.heading),
          normalizeSpeed(loc.coords.speed),
        );
      },
    );
  } catch {
    foregroundSub = null;
  }
}

function stopForegroundWatcher() {
  if (foregroundSub) {
    foregroundSub.remove();
    foregroundSub = null;
  }
}

async function stopBackgroundUpdates() {
  stopForegroundWatcher();
  if (!backgroundActive) return;
  try {
    const running = await Location.hasStartedLocationUpdatesAsync(LIVE_LOCATION_TASK);
    if (running) await Location.stopLocationUpdatesAsync(LIVE_LOCATION_TASK);
  } catch {
    // ignore
  }
  backgroundActive = false;
}

async function refreshActiveTicket() {
  const ids = await findActiveTickets();
  // Task #686: a `null` return means the rate-limit gate parked us.
  // Hold the previous active set in place and skip the start/stop
  // dance — the next 60s poll runs after the cooldown has lifted and
  // converges naturally.
  if (ids == null) return;
  const prevCount = activeTicketIds.length;
  activeTicketIds = ids;
  if (ids.length > 0) await ensureBackgroundUpdates();
  else await stopBackgroundUpdates();
  // Task #56 — notify subscribers when the active-ticket set toggles
  // size. The pill renders (and stops rendering) based on whether at
  // least one ticket is active, so this is the moment its visibility
  // can flip. Reason changes between polls (permissions, low power,
  // stale pings) are caught by the pill's own 30s interval and its
  // AppState resume hook, so we don't need to notify on every refresh.
  if (prevCount !== ids.length) notifyStatus();
}

function handleAppState(state: AppStateStatus) {
  if (state === "active") {
    // Refresh ticket list on foreground; background task keeps reporting otherwise.
    refreshActiveTicket();
  }
}

export async function startLiveLocationReporter() {
  if (started) return;
  const user = await getUser();
  if (!user || user.role !== "field_employee") return;
  started = true;
  startedAt = Date.now();
  await refreshActiveTicket();
  pollTimer = setInterval(refreshActiveTicket, POLL_TICKETS_MS);
  appStateSub = AppState.addEventListener("change", handleAppState);
}

export async function stopLiveLocationReporter() {
  started = false;
  startedAt = null;
  await stopBackgroundUpdates();
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  if (appStateSub) {
    appStateSub.remove();
    appStateSub = null;
  }
  activeTicketIds = [];
  myEmployeeId = null;
  lastSuccessfulPingAt = null;
  notifyStatus();
}

// ───────────────────────────────────────────────────────────────────
// Task #56 — observable status surface for the foreground UI.
//
// The OS can throttle or stop background location delivery for many
// reasons (missing Always permission, low-power mode, killed
// foreground service, revoked consent). When that happens, dispatch
// sees a gap before the field employee notices anything is wrong on
// their side. The active-ticket screen renders a small "Live
// location: active / paused" indicator backed by `getLiveLocationStatus`
// so workers can self-recover before dispatch has to call them.
// ───────────────────────────────────────────────────────────────────

export type LiveLocationStatusReason =
  | "consent_missing"
  | "foreground_permission_missing"
  | "background_permission_missing"
  | "low_power_mode"
  | "background_task_not_running"
  | "stale_pings"
  | "expo_go_unsupported";

export type LiveLocationStatus = {
  /** True when the reporter believes there's at least one active ticket. */
  hasActiveTicket: boolean;
  /** True when pings should be flowing AND there's no known issue. */
  flowing: boolean;
  /** Ordered list of contributing problems (most actionable first). */
  reasons: LiveLocationStatusReason[];
  /** Timestamp (ms) of the last successful ping POST, or null. */
  lastPingAt: number | null;
};

/**
 * Subscribe to status-change notifications. Returns an unsubscribe fn.
 * The reporter notifies on: active-ticket-set changes, successful
 * pings landing, and stop().
 */
export function subscribeLiveLocationStatus(listener: () => void): () => void {
  statusListeners.add(listener);
  return () => {
    statusListeners.delete(listener);
  };
}

// Anything older than ~3x the configured timeInterval (3 minutes)
// counts as stale. Picked to tolerate one missed callback (GPS lock
// blip, brief app suspension) without flagging, but flag fast enough
// that a real Doze/low-power throttle surfaces inside ~10 minutes.
const STALE_PING_MS = 9 * 60 * 1000;
// Grace window after start() during which we don't claim "stale_pings"
// just because the OS hasn't delivered the first callback yet. The
// background watcher's `timeInterval` is 3 min; allow 5 to account for
// cold-fix latency.
const PING_STARTUP_GRACE_MS = 5 * 60 * 1000;

/**
 * Snapshot of the reporter's current health for the foreground UI.
 *
 * Reads platform state (location permission, low-power mode, OS task
 * registration) so callers don't need to import expo-location/expo-
 * battery directly. Pure read — never starts/stops the reporter.
 */
export async function getLiveLocationStatus(): Promise<LiveLocationStatus> {
  const reasons: LiveLocationStatusReason[] = [];
  const hasActiveTicket = activeTicketIds.length > 0;

  if (!hasActiveTicket) {
    return {
      hasActiveTicket: false,
      flowing: false,
      reasons: [],
      lastPingAt: lastSuccessfulPingAt,
    };
  }

  // Consent gates everything — without it, the reporter intentionally
  // refuses to POST pings even if every other check passes.
  try {
    const consented = await hasActiveConsentForThisDevice();
    if (!consented) reasons.push("consent_missing");
  } catch {
    reasons.push("consent_missing");
  }

  // Expo Go doesn't bundle expo-task-manager, so background updates
  // simply can't run there. We surface this as its own reason so the
  // remediation message can explain that a development/production
  // build is required (vs. asking the user to grant a permission).
  if (isExpoGo) reasons.push("expo_go_unsupported");

  // Foreground permission is required even for the in-app watcher.
  try {
    const fg = await Location.getForegroundPermissionsAsync();
    if (fg.status !== "granted") reasons.push("foreground_permission_missing");
  } catch {
    reasons.push("foreground_permission_missing");
  }

  if (!isExpoGo) {
    // Background ("Always") permission is required for true background
    // delivery. We only flag this as missing when the foreground perm
    // is granted — otherwise the foreground reason already covers it.
    if (!reasons.includes("foreground_permission_missing")) {
      try {
        const bg = await Location.getBackgroundPermissionsAsync();
        if (bg.status !== "granted") {
          reasons.push("background_permission_missing");
        }
      } catch {
        reasons.push("background_permission_missing");
      }
    }

    // Has the OS confirmed our background task is registered? When
    // the user kills the app from the recents tray or the OS reaps
    // it under memory pressure, this flips to false even though the
    // permission grant is still in place.
    if (
      !reasons.includes("foreground_permission_missing") &&
      !reasons.includes("background_permission_missing")
    ) {
      try {
        const running = await Location.hasStartedLocationUpdatesAsync(
          LIVE_LOCATION_TASK,
        );
        if (!running) reasons.push("background_task_not_running");
      } catch {
        reasons.push("background_task_not_running");
      }
    }
  }

  // Power Saver (Android) / Low Power Mode (iOS) — both throttle
  // background callbacks aggressively. We surface this as informational
  // even when nothing else is wrong so the worker knows why their
  // location updates may have slowed.
  try {
    const lpe = await Battery.isLowPowerModeEnabledAsync();
    if (lpe) reasons.push("low_power_mode");
  } catch {
    // ignore — older Androids / unsupported platforms simply return
    // false; an exception here just means we can't tell.
  }

  // Stale pings: even with permissions and the OS task registered,
  // the OS may have stopped delivering callbacks. The reporter has
  // been "set up" long enough that we'd expect at least one ping;
  // none has landed.
  const now = Date.now();
  const aliveLongEnough =
    startedAt != null && now - startedAt > PING_STARTUP_GRACE_MS;
  if (lastSuccessfulPingAt == null) {
    if (aliveLongEnough && reasons.length === 0) {
      reasons.push("stale_pings");
    }
  } else if (now - lastSuccessfulPingAt > STALE_PING_MS) {
    if (!reasons.includes("stale_pings")) reasons.push("stale_pings");
  }

  return {
    hasActiveTicket: true,
    flowing: reasons.length === 0,
    reasons,
    lastPingAt: lastSuccessfulPingAt,
  };
}

/**
 * Test-only: reset the reporter's module state between vitest cases so
 * sequential tests don't bleed each other's `started` / `activeTicketIds`
 * / `lastSuccessfulPingAt` flags.
 */
export function __resetLiveLocationReporterForTests(): void {
  started = false;
  startedAt = null;
  activeTicketIds = [];
  myEmployeeId = null;
  backgroundActive = false;
  lastSuccessfulPingAt = null;
  statusListeners.clear();
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  if (appStateSub) {
    appStateSub.remove();
    appStateSub = null;
  }
}

/** Test-only: seed reporter state so `getLiveLocationStatus` has
 *  something to inspect without booting the full poll loop. */
export function __setLiveLocationReporterStateForTests(state: {
  activeTicketIds?: number[];
  startedAt?: number | null;
  lastSuccessfulPingAt?: number | null;
}): void {
  if (state.activeTicketIds !== undefined) activeTicketIds = state.activeTicketIds;
  if (state.startedAt !== undefined) startedAt = state.startedAt;
  if (state.lastSuccessfulPingAt !== undefined) {
    lastSuccessfulPingAt = state.lastSuccessfulPingAt;
  }
}
