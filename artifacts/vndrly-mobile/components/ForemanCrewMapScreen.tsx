import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Feather } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import {
  ActivityIndicator,
  Linking,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { WebView } from "react-native-webview";

import { useBrand } from "@/hooks/use-brand";
import { useColors } from "@/hooks/useColors";
import { apiFetch } from "@/lib/api";
import { translateApiError } from "@/lib/apiErrors";

type LiveLocation = {
  employeeId: number;
  employeeName: string;
  ticketId: number;
  lifecycleState: string | null;
  siteName: string | null;
  latitude: number;
  longitude: number;
  recordedAt: string;
};

function buildMapHtml(locations: LiveLocation[], brandColor: string): string {
  const payload = JSON.stringify(locations);
  const brand = JSON.stringify(brandColor);
  return `<!DOCTYPE html>
<html><head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
<style>html,body,#map{margin:0;padding:0;height:100%;width:100%;}</style>
</head><body><div id="map"></div>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script>
  var locs = ${payload};
  var map = L.map('map', { zoomControl: true });
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OSM' }).addTo(map);
  var bounds = [];
  locs.forEach(function(loc) {
    if (typeof loc.latitude !== 'number' || typeof loc.longitude !== 'number') return;
    var m = L.circleMarker([loc.latitude, loc.longitude], { radius: 8, color: ${brand}, fillColor: ${brand}, fillOpacity: 0.85, weight: 2 });
    m.bindPopup('<b>' + (loc.employeeName || 'Crew') + '</b><br/>#' + loc.ticketId);
    m.addTo(map);
    bounds.push([loc.latitude, loc.longitude]);
  });
  if (bounds.length === 1) map.setView(bounds[0], 12);
  else if (bounds.length > 1) map.fitBounds(bounds, { padding: [24, 24] });
  else map.setView([39.5, -98.35], 4);
</script></body></html>`;
}

export default function ForemanCrewMapScreen() {
  const colors = useColors();
  const brand = useBrand();
  const { t } = useTranslation();
  const [locations, setLocations] = useState<LiveLocation[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      const json = await apiFetch<{ locations?: LiveLocation[] }>("/api/live-locations");
      setLocations(json?.locations ?? []);
    } catch (e) {
      setError(translateApiError(e, t));
      setLocations([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
    const id = setInterval(() => void load(), 30_000);
    return () => clearInterval(id);
  }, [load]);

  const mapHtml = useMemo(
    () => buildMapHtml(locations, brand.primary),
    [locations, brand.primary],
  );

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
      <Text style={[styles.title, { color: colors.foreground }]}>{t("foremanMap.title")}</Text>
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
          <View
            key={`${loc.employeeId}-${loc.ticketId}`}
            style={[styles.row, { borderColor: colors.border, backgroundColor: colors.card }]}
            testID={`foreman-map-row-${loc.employeeId}`}
          >
            <View style={{ flex: 1 }}>
              <Text style={[styles.name, { color: colors.foreground }]}>{loc.employeeName}</Text>
              <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>
                #{loc.ticketId}
                {loc.siteName ? ` · ${loc.siteName}` : ""}
              </Text>
            </View>
            <Feather
              name="navigation"
              size={20}
              color={colors.primary}
              onPress={() => openDirections(loc.latitude, loc.longitude)}
            />
          </View>
        ))
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { padding: 16, paddingBottom: 32 },
  title: { fontFamily: "Inter_700Bold", fontSize: 22, marginBottom: 4 },
  sub: { fontFamily: "Inter_400Regular", fontSize: 14, marginBottom: 12 },
  mapWrap: { height: 280, borderRadius: 12, borderWidth: 1, overflow: "hidden", marginBottom: 16 },
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
  name: { fontFamily: "Inter_600SemiBold", fontSize: 15 },
  error: { marginBottom: 12, fontFamily: "Inter_400Regular" },
});
