import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import { useTranslation } from "react-i18next";
import {
  ActivityIndicator,
  Linking,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { WebView } from "react-native-webview";

import InPageHeader from "@/components/InPageHeader";
import { useBrand } from "@/hooks/use-brand";
import { useColors } from "@/hooks/useColors";
import { apiFetch } from "@/lib/api";
import { translateApiError } from "@/lib/apiErrors";

import {
  buildCrewMapHtml,
  type CrewMapLocation,
  type CrewMapSite,
} from "@/lib/crew-map-html";
import { SCREEN_SUBTITLE_TEXT, SCREEN_TITLE_TEXT, TEXT_SHADOW } from "@/lib/pill-doctrine";

type LiveLocation = CrewMapLocation;

type FieldSite = CrewMapSite;

function lifecycleColor(state: string | null): string {
  if (state === "en_route") return "#f59e0b";
  if (state === "on_location") return "#6366f1";
  if (state === "on_site") return "#10b981";
  return "#0ea5e9";
}

export default function ForemanCrewMapScreen() {
  const colors = useColors();
  const brand = useBrand();
  const { t } = useTranslation();
  const [locations, setLocations] = useState<LiveLocation[]>([]);
  const [sites, setSites] = useState<FieldSite[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [liveStatus, setLiveStatus] = useState<"connecting" | "live" | "paused">("connecting");
  const apiBaseRef = useRef(process.env.EXPO_PUBLIC_DOMAIN ? `https://${process.env.EXPO_PUBLIC_DOMAIN}` : "");
  const [recentTrips, setRecentTrips] = useState<
    Array<{ ticketId: number; employeeId: number; employeeName: string; siteName: string | null; lastActivityAt: string | null; onSiteMinutes: number | null; replayDate: string }>
  >([]);

  const loadRecent = useCallback(async () => {
    try {
      const json = await apiFetch<{ trips?: typeof recentTrips }>("/api/map/recent-trips?limit=100");
      setRecentTrips(json?.trips ?? []);
    } catch {
      setRecentTrips([]);
    }
  }, []);

  const load = useCallback(async () => {
    try {
      setError(null);
      const [locJson, siteRows] = await Promise.all([
        apiFetch<{ locations?: LiveLocation[] }>("/api/live-locations"),
        apiFetch<FieldSite[]>("/api/field/sites").catch(() => []),
      ]);
      setLocations(locJson?.locations ?? []);
      setSites(Array.isArray(siteRows) ? siteRows : []);
      await loadRecent();
    } catch (e) {
      setError(translateApiError(e, t));
      setLocations([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [t, loadRecent]);

  useEffect(() => {
    void load();
    const id = setInterval(() => void load(), 5 * 60_000);
    return () => clearInterval(id);
  }, [load]);

  const mapHtml = useMemo(
    () => buildCrewMapHtml(locations, sites, brand.primary, apiBaseRef.current),
    [locations, sites, brand.primary],
  );

  function onWebViewMessage(event: { nativeEvent: { data: string } }) {
    try {
      const msg = JSON.parse(event.nativeEvent.data) as {
        type: string;
        status?: string;
        location?: LiveLocation;
      };
      if (msg.type === "live") {
        setLiveStatus(msg.status === "open" ? "live" : "paused");
      }
      if (msg.type === "ping" && msg.location) {
        const incoming = msg.location;
        setLocations((prev) => {
          const idx = prev.findIndex((l) => l.employeeId === incoming.employeeId);
          if (idx === -1) return [...prev, incoming];
          const cur = prev[idx]!;
          if (new Date(cur.recordedAt).getTime() > new Date(incoming.recordedAt).getTime()) return prev;
          const next = prev.slice();
          next[idx] = { ...cur, ...incoming };
          return next;
        });
        setLiveStatus("live");
      }
    } catch {
      // ignore malformed messages
    }
  }

  function openDirections(lat: number, lng: number) {
    const url =
      Platform.OS === "ios"
        ? `https://maps.apple.com/?ll=${lat},${lng}`
        : `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
    void Linking.openURL(url);
  }

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <InPageHeader
        title={t("foremanMap.title")}
        onBack={() => router.push("/(tabs)" as never)}
        right={
          <View style={[styles.livePill, { backgroundColor: liveStatus === "live" ? "#dcfce7" : "#fef3c7" }]}>
            <Text style={{ fontSize: 11, fontWeight: "600", color: liveStatus === "live" ? "#166534" : "#92400e" }}>
              {liveStatus === "live" ? t("foremanMap.live", "Live") : t("foremanMap.connecting", "Connecting…")}
            </Text>
          </View>
        }
      />
      <ScrollView
        style={styles.flex}
        contentContainerStyle={styles.content}
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
      >
      <Text style={[styles.sub, { color: colors.mutedForeground }]}>{t("foremanMap.subtitle")}</Text>

      <View style={[styles.mapWrap, { borderColor: colors.border }]} testID="foreman-crew-map">
        {loading ? (
          <View style={styles.mapLoading}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : (
          <WebView
            originWhitelist={["*"]}
            source={{ html: mapHtml }}
            style={styles.map}
            scrollEnabled={false}
            onMessage={onWebViewMessage}
            javaScriptEnabled
            domStorageEnabled
            sharedCookiesEnabled
            thirdPartyCookiesEnabled
          />
        )}
      </View>

      {error ? (
        <Text style={[styles.error, { color: colors.destructive }]}>{error}</Text>
      ) : null}

      <Text style={[styles.section, { color: colors.foreground }]}>
        {t("foremanMap.onShiftNow", { count: locations.length })}
      </Text>
      {locations.length === 0 && !loading ? (
        <Text style={{ color: colors.mutedForeground }}>{t("foremanMap.nobodyOnClock")}</Text>
      ) : (
        locations.map((loc) => (
          <Pressable
            key={`${loc.employeeId}-${loc.ticketId}`}
            onPress={() => router.push(`/crew-replay/${loc.employeeId}`)}
            style={[styles.row, { borderColor: colors.border, backgroundColor: colors.card }]}
            testID={`foreman-map-row-${loc.employeeId}`}
          >
            <View style={[styles.dot, { backgroundColor: lifecycleColor(loc.lifecycleState) }]} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.name, { color: colors.foreground }]}>{loc.employeeName}</Text>
              <Text style={{ color: colors.mutedForeground, fontSize: 13, ...SCREEN_SUBTITLE_TEXT }}>
                #{loc.ticketId}
                {loc.siteName ? ` · ${loc.siteName}` : ""}
                {loc.lifecycleState ? ` · ${loc.lifecycleState.replace(/_/g, " ")}` : ""}
              </Text>
            </View>
            <Feather
              name="navigation"
              size={20}
              color={colors.primary}
              onPress={(e) => {
                e.stopPropagation?.();
                openDirections(loc.latitude, loc.longitude);
              }}
            />
          </Pressable>
        ))
      )}

      <Text style={[styles.section, { color: colors.foreground, marginTop: 16 }]}>
        {t("foremanMap.recentTrips", "Recent trips")} ({recentTrips.length})
      </Text>
      {recentTrips.length === 0 ? (
        <Text style={{ color: colors.mutedForeground }}>{t("foremanMap.noRecentTrips", "No recent trips yet.")}</Text>
      ) : (
        recentTrips.slice(0, 100).map((trip) => (
          <Pressable
            key={`recent-${trip.ticketId}-${trip.lastActivityAt}`}
            onPress={() => router.push(`/crew-replay/${trip.employeeId}?date=${trip.replayDate}`)}
            style={[styles.row, { borderColor: colors.border, backgroundColor: colors.card }]}
          >
            <View style={{ flex: 1 }}>
              <Text style={[styles.name, { color: colors.foreground }]}>{trip.employeeName}</Text>
              <Text style={{ color: colors.mutedForeground, fontSize: 13, ...SCREEN_SUBTITLE_TEXT }}>
                #{trip.ticketId}
                {trip.siteName ? ` · ${trip.siteName}` : ""}
                {trip.onSiteMinutes != null ? ` · ${trip.onSiteMinutes}m on site` : ""}
              </Text>
            </View>
          </Pressable>
        ))
      )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  content: { paddingHorizontal: 16, paddingBottom: 32 },
  livePill: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  sub: { fontFamily: "Inter_400Regular", fontSize: 14, marginBottom: 12, ...SCREEN_SUBTITLE_TEXT },
  mapWrap: { height: 320, borderRadius: 12, borderWidth: 1, overflow: "hidden", marginBottom: 16 },
  map: { flex: 1, backgroundColor: "#f3f4f6" },
  mapLoading: { flex: 1, alignItems: "center", justifyContent: "center" },
  section: { fontFamily: "Inter_600SemiBold", fontSize: 16, marginBottom: 8, ...SCREEN_TITLE_TEXT },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    marginBottom: 8,
  },
  dot: { width: 10, height: 10, borderRadius: 5 },
  name: { fontFamily: "Inter_600SemiBold", fontSize: 15, ...TEXT_SHADOW.content },
  error: { marginBottom: 12, fontFamily: "Inter_400Regular" },
});
