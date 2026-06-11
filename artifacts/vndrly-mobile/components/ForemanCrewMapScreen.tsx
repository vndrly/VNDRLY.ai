import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Feather } from "@expo/vector-icons";
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
import { router } from "expo-router";
import { WebView } from "react-native-webview";

import { useBrand } from "@/hooks/use-brand";
import { useColors } from "@/hooks/useColors";
import { apiFetch } from "@/lib/api";
import { translateApiError } from "@/lib/apiErrors";

type LiveLocation = {
  employeeId: number;
  employeeName: string;
  ticketId: number;
  vendorId?: number;
  lifecycleState: string | null;
  siteName: string | null;
  siteCode?: string | null;
  siteLatitude: number | null;
  siteLongitude: number | null;
  latitude: number;
  longitude: number;
  batteryLevel: number | null;
  heading: number | null;
  speedMps: number | null;
  recordedAt: string;
};

type FieldSite = { id: number; name: string; latitude?: number | null; longitude?: number | null; siteRadiusMeters?: number | null };

function lifecycleColor(state: string | null): string {
  if (state === "en_route") return "#f59e0b";
  if (state === "on_location") return "#6366f1";
  if (state === "on_site") return "#10b981";
  return "#0ea5e9";
}

function buildMapHtml(
  locations: LiveLocation[],
  sites: FieldSite[],
  brandColor: string,
  apiBase: string,
): string {
  const payload = JSON.stringify({ locations, sites, brandColor, apiBase });
  return `<!DOCTYPE html>
<html><head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
<style>
  html,body,#map{margin:0;padding:0;height:100%;width:100%;}
  .lifecycle-flash-pin-ring{position:absolute;inset:-6px;border-radius:50%;border:2px solid #f59e0b;animation:vndrly-flash 1.2s ease-out infinite;}
  @keyframes vndrly-flash{0%{opacity:1;transform:scale(.85);}100%{opacity:0;transform:scale(1.35);}}
</style>
</head><body><div id="map"></div>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script>
  var cfg = ${payload};
  var map = L.map('map', { zoomControl: true });
  L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19 }).addTo(map);
  var bounds = [];
  (cfg.sites || []).forEach(function(site) {
    if (typeof site.latitude !== 'number' || typeof site.longitude !== 'number') return;
    var radius = site.siteRadiusMeters && site.siteRadiusMeters > 0 ? site.siteRadiusMeters : 402;
    L.circle([site.latitude, site.longitude], { radius: radius, color: '#2563eb', weight: 1, fillOpacity: 0.06 }).addTo(map);
    bounds.push([site.latitude, site.longitude]);
  });
  function carSvg(color, heading) {
    var rot = heading != null ? heading : 0;
    return '<div style="position:relative;width:36px;height:50px;transform:translate(-18px,-25px)">' +
      '<div style="transform:rotate(' + rot + 'deg);transform-origin:50% 50%">' +
      '<svg viewBox="-20 -28 40 56" width="36" height="50"><rect x="-10" y="-22" width="20" height="44" rx="6" fill="' + color + '" stroke="white" stroke-width="1.5"/></svg></div></div>';
  }
  (cfg.locations || []).forEach(function(loc) {
    if (typeof loc.latitude !== 'number' || typeof loc.longitude !== 'number') return;
    var color = loc.lifecycleState === 'en_route' ? '#f59e0b' : loc.lifecycleState === 'on_site' ? '#10b981' : loc.lifecycleState === 'on_location' ? '#6366f1' : cfg.brandColor;
    var icon = L.divIcon({ html: carSvg(color, loc.heading), className: '', iconSize: [36,50], iconAnchor: [18,25] });
    var m = L.marker([loc.latitude, loc.longitude], { icon: icon });
    var popup = '<b>' + (loc.employeeName || 'Crew') + '</b><br/>#' + loc.ticketId;
    if (loc.siteName) popup += '<br/>' + loc.siteName;
    m.bindPopup(popup);
    m.addTo(map);
    bounds.push([loc.latitude, loc.longitude]);
    if (loc.lifecycleState === 'en_route' && loc.siteLatitude != null && loc.siteLongitude != null) {
      L.polyline([[loc.latitude, loc.longitude],[loc.siteLatitude, loc.siteLongitude]], { color: '#f59e0b', dashArray: '6 4', weight: 2 }).addTo(map);
    }
  });
  if (bounds.length === 1) map.setView(bounds[0], 13);
  else if (bounds.length > 1) map.fitBounds(bounds, { padding: [28, 28] });
  else map.setView([39.5, -98.35], 4);

  try {
    var es = new EventSource(cfg.apiBase + '/api/live-locations/events', { withCredentials: true });
    es.addEventListener('location.ping', function(ev) {
      try {
        var parsed = JSON.parse(ev.data);
        if (!parsed.location) return;
        window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'ping', location: parsed.location }));
      } catch (e) {}
    });
    es.onopen = function() {
      window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'live', status: 'open' }));
    };
    es.onerror = function() {
      window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'live', status: 'error' }));
    };
  } catch (e) {}
</script></body></html>`;
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
    () => buildMapHtml(locations, sites, brand.primary, apiBaseRef.current),
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
    <ScrollView
      style={[styles.root, { backgroundColor: colors.background }]}
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
      <View style={styles.titleRow}>
        <Text style={[styles.title, { color: colors.foreground }]}>{t("foremanMap.title")}</Text>
        <View style={[styles.livePill, { backgroundColor: liveStatus === "live" ? "#dcfce7" : "#fef3c7" }]}>
          <Text style={{ fontSize: 11, fontWeight: "600", color: liveStatus === "live" ? "#166534" : "#92400e" }}>
            {liveStatus === "live" ? t("foremanMap.live", "Live") : t("foremanMap.connecting", "Connecting…")}
          </Text>
        </View>
      </View>
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
              <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>
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
              <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>
                #{trip.ticketId}
                {trip.siteName ? ` · ${trip.siteName}` : ""}
                {trip.onSiteMinutes != null ? ` · ${trip.onSiteMinutes}m on site` : ""}
              </Text>
            </View>
          </Pressable>
        ))
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { padding: 16, paddingBottom: 32 },
  titleRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  title: { fontFamily: "Inter_700Bold", fontSize: 22, marginBottom: 4, flex: 1 },
  livePill: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  sub: { fontFamily: "Inter_400Regular", fontSize: 14, marginBottom: 12 },
  mapWrap: { height: 320, borderRadius: 12, borderWidth: 1, overflow: "hidden", marginBottom: 16 },
  map: { flex: 1, backgroundColor: "#f3f4f6" },
  mapLoading: { flex: 1, alignItems: "center", justifyContent: "center" },
  section: { fontFamily: "Inter_600SemiBold", fontSize: 16, marginBottom: 8 },
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
  name: { fontFamily: "Inter_600SemiBold", fontSize: 15 },
  error: { marginBottom: 12, fontFamily: "Inter_400Regular" },
});
