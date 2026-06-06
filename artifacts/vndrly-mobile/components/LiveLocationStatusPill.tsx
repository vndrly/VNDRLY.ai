import { Feather } from "@expo/vector-icons";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Alert,
  AppState,
  type AppStateStatus,
  Linking,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

import {
  getLiveLocationStatus,
  type LiveLocationStatus,
  type LiveLocationStatusReason,
  subscribeLiveLocationStatus,
} from "@/lib/liveLocationReporter";

// Task #56 — small green "Live location: active" indicator on the
// active-ticket detail screen. Only renders while pings are actually
// flowing — we intentionally hide the pill when tracking is paused
// so field workers never see a scary red error banner for transient
// GPS or permission quirks the reporter is already recovering from.

const DEFAULT_POLL_INTERVAL_MS = 30 * 1000;

export interface LiveLocationStatusPillProps {
  /** Parent gates rendering on the ticket lifecycle state. */
  enabled: boolean;
  /**
   * How often to re-fetch the reporter status while the screen is
   * focused. Defaults to 30s; the reporter also pushes updates via
   * `subscribeLiveLocationStatus` whenever a ping lands or the active
   * ticket set changes.
   */
  pollIntervalMs?: number;
  testID?: string;
  /**
   * Test seam: lets the FreshnessPill-style component test inject a
   * deterministic status without spinning up the reporter. Production
   * callers leave this undefined and the component reads from the
   * reporter directly.
   */
  statusOverride?: LiveLocationStatus | null;
  /** Test seam: skip the polling timer + AppState listener. */
  disableAutoRefresh?: boolean;
}

/**
 * Pick the most actionable reason from the reporter's list. The
 * reasons are emitted in roughly "most actionable first" order, but
 * we still re-rank here so the tap target always matches the visible
 * remediation hint. Permissions are top of the stack because they have
 * a one-tap remedy (open settings); low-power mode is informational
 * and can't be fixed via deep link.
 */
function primaryReason(
  reasons: LiveLocationStatusReason[],
): LiveLocationStatusReason | null {
  const order: LiveLocationStatusReason[] = [
    "background_permission_missing",
    "foreground_permission_missing",
    "consent_missing",
    "background_task_not_running",
    "stale_pings",
    "low_power_mode",
    "expo_go_unsupported",
  ];
  for (const candidate of order) {
    if (reasons.includes(candidate)) return candidate;
  }
  return null;
}

export function LiveLocationStatusPill({
  enabled,
  pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
  testID = "live-location-status-pill",
  statusOverride,
  disableAutoRefresh = false,
}: LiveLocationStatusPillProps) {
  const { t } = useTranslation();
  const [status, setStatus] = useState<LiveLocationStatus | null>(
    statusOverride ?? null,
  );
  // Mirror the latest async refresh result to a ref so concurrent
  // refresh calls don't race the React state setter into stale values.
  const cancelledRef = useRef(false);

  const refresh = useCallback(async () => {
    try {
      const next = await getLiveLocationStatus();
      if (!cancelledRef.current) setStatus(next);
    } catch {
      // Status helper never throws today, but defensively swallow.
    }
  }, []);

  useEffect(() => {
    if (statusOverride !== undefined) {
      setStatus(statusOverride);
      return;
    }
    cancelledRef.current = false;
    if (!enabled) {
      setStatus(null);
      return () => {
        cancelledRef.current = true;
      };
    }
    void refresh();
    if (disableAutoRefresh) {
      return () => {
        cancelledRef.current = true;
      };
    }
    // Push: reporter notifies on ping success / active ticket churn.
    const unsubscribe = subscribeLiveLocationStatus(() => {
      void refresh();
    });
    // Pull: short interval picks up OS-level changes (permission
    // toggled in Settings, low-power mode flipped) that the reporter
    // can't observe directly.
    const handle = setInterval(() => {
      void refresh();
    }, pollIntervalMs);
    // Resume: when the user returns from Settings, re-check immediately
    // so a freshly granted permission flips the pill green right away.
    const appSub = AppState.addEventListener(
      "change",
      (next: AppStateStatus) => {
        if (next === "active") void refresh();
      },
    );
    return () => {
      cancelledRef.current = true;
      unsubscribe();
      clearInterval(handle);
      appSub.remove();
    };
  }, [enabled, refresh, pollIntervalMs, disableAutoRefresh, statusOverride]);

  if (!enabled) return null;
  if (!status || !status.hasActiveTicket) return null;
  if (!status.flowing) return null;

  const isPaused = false;
  const reason = null;

  // Each reason gets a localized one-line hint that's appended after
  // the "Live location: paused" headline. Kept short so the pill
  // doesn't push the rest of the ticket card around.
  const reasonHintByReason: Record<LiveLocationStatusReason, string> = {
    foreground_permission_missing: t(
      "liveLocation.reasonForegroundPermission",
      { defaultValue: "Tap to grant location permission" },
    ),
    background_permission_missing: t(
      "liveLocation.reasonBackgroundPermission",
      { defaultValue: "Tap to allow always-on location" },
    ),
    consent_missing: t("liveLocation.reasonConsent", {
      defaultValue: "Re-enable location sharing in Settings",
    }),
    low_power_mode: t("liveLocation.reasonLowPower", {
      defaultValue: "Low Power Mode is throttling updates",
    }),
    background_task_not_running: t("liveLocation.reasonInactive", {
      defaultValue: "Tap to restart background tracking",
    }),
    stale_pings: t("liveLocation.reasonStale", {
      defaultValue: "No location update in a while — tap to fix",
    }),
    expo_go_unsupported: t("liveLocation.reasonExpoGo", {
      defaultValue: "Background tracking needs the installed app",
    }),
  };

  const headline = isPaused
    ? t("liveLocation.paused", { defaultValue: "Live location: paused" })
    : t("liveLocation.active", { defaultValue: "Live location: active" });

  const reasonHint =
    isPaused && reason ? reasonHintByReason[reason] : null;

  const onPress = async () => {
    if (!isPaused || !reason) return;
    if (reason === "low_power_mode") {
      Alert.alert(
        t("liveLocation.lowPowerTitle", { defaultValue: "Low Power Mode is on" }),
        t("liveLocation.lowPowerBody", {
          defaultValue:
            "Your phone is in Low Power Mode, which can pause background location updates. Disable Low Power Mode in Settings to keep dispatch updated.",
        }),
      );
      return;
    }
    if (reason === "expo_go_unsupported") {
      Alert.alert(
        t("liveLocation.expoGoTitle", {
          defaultValue: "Background tracking unavailable",
        }),
        t("liveLocation.expoGoBody", {
          defaultValue:
            "Background location only works in the installed VNDRLY app. Switch off Expo Go and reopen the installed build to keep dispatch updated.",
        }),
      );
      return;
    }
    if (reason === "consent_missing") {
      Alert.alert(
        t("liveLocation.consentTitle", { defaultValue: "Location sharing is off" }),
        t("liveLocation.consentBody", {
          defaultValue:
            "Re-enable location sharing from your profile to resume sending pings to dispatch.",
        }),
      );
      return;
    }
    // For permission-missing / background-task-not-running / stale,
    // the right remedy is to open the OS settings page so the user
    // can grant Always permission, disable battery optimisation, or
    // re-launch from the home screen.
    try {
      await Linking.openSettings();
    } catch {
      Alert.alert(
        t("liveLocation.openSettingsFailedTitle", {
          defaultValue: "Couldn't open Settings",
        }),
        t("liveLocation.openSettingsFailedBody", {
          defaultValue:
            "Open Settings manually and grant 'Always' location permission to VNDRLY.",
        }),
      );
    }
  };

  const palette = isPaused
    ? {
        bg: "rgba(220, 38, 38, 0.12)",
        border: "rgba(220, 38, 38, 0.4)",
        labelColor: "#dc2626",
        iconColor: "#dc2626",
        iconName: "alert-triangle" as const,
      }
    : {
        bg: "rgba(34,197,94,0.12)",
        border: "rgba(34,197,94,0.4)",
        labelColor: "#166534",
        iconColor: "#15803d",
        iconName: "navigation" as const,
      };

  // Single status-token marker (hidden) so component tests can assert
  // the current state without parsing the localized label. Mirrors
  // the FreshnessPill testing pattern.
  const statusToken = isPaused ? "paused" : "active";

  return (
    <TouchableOpacity
      onPress={isPaused ? onPress : undefined}
      disabled={!isPaused}
      accessibilityRole={isPaused ? "button" : "text"}
      accessibilityLabel={
        isPaused
          ? t("liveLocation.pausedAccessibility", {
              defaultValue: "Live location paused. Tap for instructions to resume.",
            })
          : t("liveLocation.activeAccessibility", {
              defaultValue: "Live location active and reporting.",
            })
      }
      accessibilityHint={
        isPaused
          ? t("liveLocation.pausedAccessibilityHint", {
              defaultValue: "Opens fix instructions or device settings.",
            })
          : undefined
      }
      testID={testID}
      style={[
        styles.pill,
        { backgroundColor: palette.bg, borderColor: palette.border },
      ]}
    >
      <Feather
        name={palette.iconName}
        size={14}
        color={palette.iconColor}
        style={styles.icon}
      />
      <View style={styles.textColumn}>
        <Text
          testID={`${testID}-label`}
          style={[styles.label, { color: palette.labelColor }]}
          numberOfLines={1}
          ellipsizeMode="tail"
        >
          {headline}
        </Text>
        {reasonHint ? (
          <Text
            testID={`${testID}-reason`}
            style={[styles.hint, { color: palette.labelColor }]}
            numberOfLines={2}
          >
            {reasonHint}
          </Text>
        ) : null}
      </View>
      <Text
        testID={`${testID}-status`}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={styles.srOnly}
      >
        {statusToken}
      </Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "stretch",
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    marginTop: 10,
  },
  icon: {
    marginTop: 1,
  },
  textColumn: {
    flex: 1,
    minWidth: 0,
  },
  label: {
    fontFamily: "Inter_700Bold",
    fontSize: 13,
    letterSpacing: 0.1,
  },
  hint: {
    fontFamily: "Inter_500Medium",
    fontSize: 11,
    marginTop: 2,
    opacity: 0.85,
  },
  srOnly: {
    position: "absolute",
    width: 1,
    height: 1,
    overflow: "hidden",
    opacity: 0,
  },
});

export default LiveLocationStatusPill;
