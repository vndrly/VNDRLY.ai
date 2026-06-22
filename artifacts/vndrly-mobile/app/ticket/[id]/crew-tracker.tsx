import { Feather } from "@expo/vector-icons";
import { Stack, useLocalSearchParams } from "expo-router";
import InPageHeader from "@/components/InPageHeader";
import React, { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ActivityIndicator,
  AppState,
  type AppStateStatus,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

import { useColors } from "@/hooks/useColors";
import { apiFetch } from "@/lib/api";
import { SCREEN_ROOT_BACKGROUND } from "@/lib/nav-pane-tokens";
import { translateApiError } from "@/lib/apiErrors";
import { openInMaps } from "@/lib/maps";
import { ticketStatusPillStyle } from "@/lib/ticketStatusLabels";
import { PILL_CHIP_LAYOUT, PILL_TEXT } from "@/lib/pill-doctrine";

type CrewRow = {
  employeeId: number;
  userId: number | null;
  name: string;
  ackStatus: "pending" | "confirmed" | "declined";
  ackAt: string | null;
  lastPing: { latitude: number; longitude: number; recordedAt: string; batteryLevel: number | null } | null;
  distanceMeters: number | null;
  etaMinutes: number | null;
};

type TrackerResponse = {
  ticketId: number;
  site: { id: number | null; name: string | null; latitude: number | null; longitude: number | null };
  scheduledStartAt: string | null;
  crew: CrewRow[];
};

function formatAge(iso: string | null, t: (k: string, v?: Record<string, unknown>) => string): string {
  if (!iso) return t("crewTrackerMobile.noPing");
  const ms = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(ms)) return t("crewTrackerMobile.noPing");
  const min = Math.floor(ms / 60000);
  if (min < 1) return t("crewTrackerMobile.justNow");
  if (min < 60) return t("crewTrackerMobile.agoMin", { min });
  const h = Math.floor(min / 60);
  return t("crewTrackerMobile.agoHr", { h });
}

function formatDistance(m: number | null): string {
  if (m == null) return "—";
  if (m < 1609) return `${Math.round(m / 0.3048)} ft`;
  const mi = m / 1609.344;
  return `${mi < 10 ? mi.toFixed(1) : Math.round(mi)} mi`;
}

function formatEta(min: number | null, t: (k: string, v?: Record<string, unknown>) => string): string {
  if (min == null) return "—";
  if (min < 1) return t("crewTrackerMobile.etaNow");
  if (min < 60) return t("crewTrackerMobile.etaMins", { min });
  const h = Math.floor(min / 60);
  const rem = min % 60;
  if (rem === 0) return t("crewTrackerMobile.etaHrs", { h });
  return t("crewTrackerMobile.etaHrsMins", { h, min: rem });
}

export default function CrewTrackerScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const colors = useColors();
  const { t } = useTranslation();
  const [data, setData] = useState<TrackerResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await apiFetch<TrackerResponse>(`/api/tickets/${id}/crew-tracker`);
      setData(r);
      setError(null);
    } catch (e) {
      setError(translateApiError(e, t));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [id, t]);

  // Task #892: gate the 30s poll on AppState so we don't burn battery /
  // cellular while the app is backgrounded (lock screen, app switcher,
  // another app foregrounded). Mirrors the pattern from Task #621 on
  // the ticket detail screen: the current foreground state is mirrored
  // into React state so the polling effect re-runs on every transition
  // and tears down / re-arms the interval accordingly. Initial value
  // reads `AppState.currentState` so a tracker opened while the app is
  // already backgrounded doesn't immediately start polling.
  const [appForegrounded, setAppForegrounded] = useState(
    () => AppState.currentState === "active",
  );
  useEffect(() => {
    const sub = AppState.addEventListener("change", (next: AppStateStatus) => {
      setAppForegrounded(next === "active");
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    if (!appForegrounded) return undefined;
    void load();
    const intv = setInterval(() => void load(), 30000);
    return () => clearInterval(intv);
  }, [load, appForegrounded]);

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: SCREEN_ROOT_BACKGROUND }}>
        <Stack.Screen options={{ headerShown: false }} />
        <InPageHeader title={t("crewTrackerMobile.title")} />
        <View style={[styles.center, { backgroundColor: colors.background }]}>
          <ActivityIndicator color={colors.primary} />
        </View>
      </View>
    );
  }

  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={{ padding: 16 }}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => {
            setRefreshing(true);
            void load();
          }}
          tintColor={colors.primary}
        />
      }
      stickyHeaderIndices={[0]}
    >
      <View>
        <Stack.Screen options={{ headerShown: false }} />
        <InPageHeader title={t("crewTrackerMobile.title")} />
      </View>
      {error ? (
        <View style={[styles.errBox, { borderColor: colors.destructive }]}>
          <Text style={{ color: colors.destructive }}>{error}</Text>
        </View>
      ) : null}
      {data?.site?.name ? (
        <Text style={[styles.subhead, { color: colors.mutedForeground }]}>
          {data.site.name}
        </Text>
      ) : null}
      {(data?.crew ?? []).length === 0 ? (
        <Text style={[styles.empty, { color: colors.mutedForeground }]}>
          {t("crewTrackerMobile.noCrew")}
        </Text>
      ) : null}
      {data?.crew?.map((m) => {
        const pill = ticketStatusPillStyle(m.ackStatus);
        const canDirections =
          m.lastPing != null && data.site.latitude != null && data.site.longitude != null;
        return (
          <View
            key={m.employeeId}
            style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}
          >
            <View style={styles.row}>
              <Text style={[styles.name, { color: colors.foreground }]}>{m.name || `#${m.employeeId}`}</Text>
              <View style={[styles.pill, { backgroundColor: pill.background }]}>
                <Text style={[styles.pillText, { color: pill.foreground }]}>
                  {t(
                    m.ackStatus === "confirmed"
                      ? "crewTrackerMobile.ackConfirmed"
                      : m.ackStatus === "declined"
                        ? "crewTrackerMobile.ackDeclined"
                        : "crewTrackerMobile.ackPending",
                  )}
                </Text>
              </View>
            </View>
            <View style={styles.metaRow}>
              <Feather name="clock" size={14} color={colors.mutedForeground} />
              <Text style={[styles.meta, { color: colors.mutedForeground }]}>
                {formatAge(m.lastPing?.recordedAt ?? null, t)}
              </Text>
            </View>
            <View style={styles.metaRow}>
              <Feather name="map-pin" size={14} color={colors.mutedForeground} />
              <Text style={[styles.meta, { color: colors.mutedForeground }]}>
                {t("crewTrackerMobile.distance", { d: formatDistance(m.distanceMeters) })}
                {"  ·  "}
                {t("crewTrackerMobile.eta", { eta: formatEta(m.etaMinutes, t) })}
              </Text>
            </View>
            {canDirections ? (
              <TouchableOpacity
                onPress={() =>
                  openInMaps(data.site.latitude!, data.site.longitude!, data.site.name ?? undefined)
                }
                style={[styles.dirBtn, { backgroundColor: colors.primary }]}
                accessibilityRole="button"
              >
                <Feather name="navigation" size={14} color={colors.primaryForeground} />
                <Text style={[styles.dirText, { color: colors.primaryForeground }]}>
                  {t("crewTrackerMobile.directions")}
                </Text>
              </TouchableOpacity>
            ) : null}
          </View>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  subhead: { fontFamily: "Inter_500Medium", fontSize: 13, marginBottom: 12 },
  empty: { textAlign: "center", marginTop: 40 },
  errBox: { borderWidth: 1, borderRadius: 10, padding: 12, marginBottom: 12 },
  card: { borderWidth: 1, borderRadius: 12, padding: 14, marginBottom: 12 },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 6 },
  name: { fontFamily: "Inter_600SemiBold", fontSize: 15 },
  pill: { ...PILL_CHIP_LAYOUT },
  pillText: { ...PILL_TEXT },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 4 },
  meta: { fontFamily: "Inter_400Regular", fontSize: 13, flex: 1 },
  dirBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 10,
    borderRadius: 10,
    marginTop: 12,
  },
  dirText: { fontFamily: "Inter_500Medium", fontSize: 14 },
});
