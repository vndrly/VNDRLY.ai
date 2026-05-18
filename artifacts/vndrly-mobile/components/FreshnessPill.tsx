import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { StyleSheet, Text, View } from "react-native";

// Task #678 — small "live / reconnecting / Updated Xm ago" indicator that
// sits next to the manual-refresh button on the open-tickets list and
// ticket detail screens. Mirrors the web dispatcher's LiveConnectionPill
// (Task #661 / #667 / #670): foremen can already pull-to-refresh or tap
// the header refresh button (Task #669) but had no at-a-glance signal that
// their data had drifted out of date — neither screen has true continuous
// auto-poll, so a worker who sat on a ticket for 15 minutes would see no
// indication that the on-screen state was stale.
//
// Unlike the web pill, the mobile screens don't hold a long-lived SSE
// connection — they fetch on focus, on user gesture, and (for the detail
// screen's "assignment removed" banner) on a 7s interval. So instead of
// surfacing connection status we surface *freshness*: how long ago the
// last successful load completed. We map that onto the same visual
// vocabulary as the web pill so the affordance reads the same on both
// devices:
//
//   • live          — fetched within the last "fresh window" (default 60s).
//                     Green dot, "Live".
//   • connecting    — first load is in flight (no prior successful load).
//                     Amber dot pulse, "Connecting…".
//   • reconnecting  — a fetch is in flight after a previous failure, OR the
//                     shared tickets rate-limit cooldown is active. Amber
//                     dot pulse, "Reconnecting…".
//   • stale         — last load succeeded but is older than the fresh
//                     window. Amber dot solid, "Updated Xm ago".
//
// The pill re-renders every 30s so the relative-time string stays
// accurate without the parent screen having to drive it. We
// intentionally use a non-blocking solid background and no animation
// beyond a simple pulse so the pill never competes with the toasts at
// the bottom of the screen.

export type FreshnessStatus =
  | "connecting"
  | "live"
  | "reconnecting"
  | "stale";

const FRESH_WINDOW_MS = 60 * 1000; // < this → "Live"; otherwise "Updated Xm ago"
const RERENDER_INTERVAL_MS = 30 * 1000; // tick every 30s so the relative-time string stays accurate

function formatRelative(
  ageMs: number,
  t: (key: string, opts?: Record<string, unknown>) => string,
): string {
  // Below the fresh window we render "Just now" via a different state,
  // so this function is only called for "stale" timestamps. Round so
  // the user reads "Updated 5m ago" not "Updated 5.4m ago".
  const ageSec = Math.max(0, Math.floor(ageMs / 1000));
  if (ageSec < 60) {
    // Edge case: status flipped to "stale" but the window threshold was
    // exactly hit. Show seconds rather than "0m" so the pill never reads
    // confusingly empty.
    return t("freshness.updatedSecondsAgo", {
      defaultValue: "Updated {{s}}s ago",
      s: ageSec,
    });
  }
  const ageMin = Math.floor(ageSec / 60);
  if (ageMin < 60) {
    return t("freshness.updatedMinutesAgo", {
      defaultValue: "Updated {{m}}m ago",
      m: ageMin,
    });
  }
  const ageHr = Math.floor(ageMin / 60);
  if (ageHr < 24) {
    return t("freshness.updatedHoursAgo", {
      defaultValue: "Updated {{h}}h ago",
      h: ageHr,
    });
  }
  const ageDay = Math.floor(ageHr / 24);
  return t("freshness.updatedDaysAgo", {
    defaultValue: "Updated {{d}}d ago",
    d: ageDay,
  });
}

export interface FreshnessPillProps {
  /** Timestamp (ms) of the most recent successful load, or null if none yet. */
  lastLoadedAt: number | null;
  /** True while a fetch is currently in flight (initial, manual, or auto). */
  inFlight: boolean;
  /** True when the most recent load attempt failed. */
  errored: boolean;
  /** True while the shared tickets rate-limit cooldown is active. */
  rateLimited?: boolean;
  /**
   * Window (ms) inside which the data is considered "Live" rather than
   * stale. Defaults to 60s — same as the web pill's effective live
   * window. Override for tests that don't want to wait a full minute.
   */
  freshWindowMs?: number;
  /** Re-render cadence for the relative-time string. Override for tests. */
  rerenderIntervalMs?: number;
  testID?: string;
}

export function FreshnessPill({
  lastLoadedAt,
  inFlight,
  errored,
  rateLimited = false,
  freshWindowMs = FRESH_WINDOW_MS,
  rerenderIntervalMs = RERENDER_INTERVAL_MS,
  testID = "freshness-pill",
}: FreshnessPillProps) {
  const { t } = useTranslation();

  // Drive a periodic re-render so the "Updated Xm ago" string stays
  // accurate without the parent having to reschedule. We tick on a
  // fixed cadence rather than computing the next-flip moment so a
  // single timer covers every state — simpler, and the cadence is
  // already coarser than the visible string changes.
  const [, setTick] = useState(0);
  useEffect(() => {
    const handle = setInterval(() => {
      setTick((n) => (n + 1) % 1_000_000);
    }, rerenderIntervalMs);
    return () => clearInterval(handle);
  }, [rerenderIntervalMs]);

  const now = Date.now();
  const ageMs =
    typeof lastLoadedAt === "number" ? Math.max(0, now - lastLoadedAt) : null;

  let status: FreshnessStatus;
  if (inFlight && lastLoadedAt == null) {
    status = "connecting";
  } else if (rateLimited || (inFlight && errored) || (errored && lastLoadedAt == null)) {
    // We treat in-flight-after-an-error as "reconnecting" so the pill
    // pulses while we're trying to recover. Bare `errored` (without a
    // previous successful load) also lands in reconnecting since
    // there's no freshness time we could honestly show.
    status = "reconnecting";
  } else if (errored) {
    // Errored but we still have a previous successful load to fall
    // back on — show its age so the worker knows what they're looking
    // at is stale.
    status = "stale";
  } else if (ageMs == null) {
    status = "connecting";
  } else if (ageMs <= freshWindowMs) {
    status = "live";
  } else {
    status = "stale";
  }

  // Color tokens chosen for clarity on both light and dark themes.
  // Amber was deliberately removed — VNDRLY's mobile app must never
  // render amber unless amber is the brand color the admin chose.
  // - live      → green   (emerald, matches the web pill's "live")
  // - connecting/reconnecting → grey pulse (transient, neutral)
  // - stale     → red solid (semantic warning that data is old)
  const dotPalette: Record<FreshnessStatus, { color: string; pulse: boolean }> = {
    live: { color: "#22c55e", pulse: false },
    connecting: { color: "#9ca3af", pulse: true },
    reconnecting: { color: "#9ca3af", pulse: true },
    stale: { color: "#dc2626", pulse: false },
  };

  const labelByStatus: Record<FreshnessStatus, string> = {
    live: t("freshness.live", { defaultValue: "Live" }),
    connecting: t("freshness.connecting", { defaultValue: "Connecting…" }),
    reconnecting: t("freshness.reconnecting", {
      defaultValue: "Reconnecting…",
    }),
    stale: ageMs != null ? formatRelative(ageMs, t) : t("freshness.stale", {
      defaultValue: "Stale",
    }),
  };

  // Pill chrome (bg, border, label) tracks the dot's semantic color so the
  // whole component reads consistently and never shows amber unless that
  // is the brand color the admin chose.
  const pillBgByStatus: Record<FreshnessStatus, string> = {
    live: "rgba(34, 197, 94, 0.12)",
    connecting: "rgba(156, 163, 175, 0.14)",
    reconnecting: "rgba(156, 163, 175, 0.14)",
    stale: "rgba(220, 38, 38, 0.14)",
  };
  const pillBorderByStatus: Record<FreshnessStatus, string> = {
    live: "rgba(34, 197, 94, 0.4)",
    connecting: "rgba(156, 163, 175, 0.4)",
    reconnecting: "rgba(156, 163, 175, 0.4)",
    stale: "rgba(220, 38, 38, 0.4)",
  };
  const labelColorByStatus: Record<FreshnessStatus, string> = {
    live: "#86efac",
    connecting: "#d1d5db",
    reconnecting: "#d1d5db",
    stale: "#fca5a5",
  };
  const pillBg = pillBgByStatus[status];
  const pillBorder = pillBorderByStatus[status];
  const labelColor = labelColorByStatus[status];

  // The dot uses a tiny pulse via opacity (we avoid Animated to keep
  // the component stateless beyond the tick timer). On the static
  // states the dot is solid; on connecting/reconnecting we render a
  // second concentric ring with reduced opacity so peripheral vision
  // catches the activity even without animation.
  const dot = dotPalette[status];

  return (
    <View
      accessibilityRole="text"
      accessibilityLabel={labelByStatus[status]}
      accessibilityLiveRegion="polite"
      testID={testID}
      // data-* equivalents for tests that key off status
      // (React Native ignores data-* on iOS/Android, but RNW + testID
      // give us coverage on web/test renderers).
      style={[
        styles.pill,
        { backgroundColor: pillBg, borderColor: pillBorder },
      ]}
    >
      <View style={styles.dotWrap}>
        {dot.pulse ? (
          <View
            style={[
              styles.dotRing,
              { borderColor: dot.color },
            ]}
            pointerEvents="none"
          />
        ) : null}
        <View
          testID={`${testID}-dot`}
          style={[styles.dot, { backgroundColor: dot.color }]}
        />
      </View>
      <Text
        testID={`${testID}-label`}
        style={[styles.label, { color: labelColor }]}
        numberOfLines={1}
        ellipsizeMode="tail"
      >
        {labelByStatus[status]}
      </Text>
      {/* Hidden status marker so tests can assert on the current
          state without parsing the visible label (which is localized
          and varies by elapsed time). */}
      <Text
        testID={`${testID}-status`}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={styles.srOnly}
      >
        {status}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    minWidth: 96,
    justifyContent: "center",
  },
  dotWrap: {
    width: 10,
    height: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  dotRing: {
    position: "absolute",
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 1.5,
    opacity: 0.5,
  },
  label: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 11,
    letterSpacing: 0.2,
  },
  srOnly: {
    position: "absolute",
    width: 1,
    height: 1,
    overflow: "hidden",
    opacity: 0,
  },
});

export default FreshnessPill;
