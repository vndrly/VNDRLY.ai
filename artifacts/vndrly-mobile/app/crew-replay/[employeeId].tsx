import React, { useEffect, useMemo, useState } from "react";
import { Stack, useLocalSearchParams, router } from "expo-router";
import { useTranslation } from "react-i18next";
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { WebView } from "react-native-webview";

import InPageHeader from "@/components/InPageHeader";
import { useColors } from "@/hooks/useColors";
import { apiFetch } from "@/lib/api";
import { translateApiError } from "@/lib/apiErrors";

type Ping = {
  id: number;
  latitude: number;
  longitude: number;
  recordedAt: string;
};

function buildReplayHtml(pings: Ping[], scrubIndex: number): string {
  const visible = pings.slice(0, scrubIndex + 1);
  const payload = JSON.stringify({ visible, all: pings });
  return `<!DOCTYPE html><html><head>
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0"/>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<style>html,body,#map{margin:0;padding:0;height:100%;}</style></head><body><div id="map"></div>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script>
var data = ${payload};
var map = L.map('map');
L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19 }).addTo(map);
var latlngs = data.all.map(function(p){ return [p.latitude, p.longitude]; });
if (latlngs.length > 1) L.polyline(latlngs, { color: '#2563eb', weight: 3, opacity: 0.35 }).addTo(map);
data.visible.forEach(function(p, i) {
  L.circleMarker([p.latitude, p.longitude], { radius: i === data.visible.length - 1 ? 8 : 4, color: i === data.visible.length - 1 ? '#f59e0b' : '#2563eb', fillOpacity: 0.9 }).addTo(map);
});
if (latlngs.length) map.fitBounds(latlngs, { padding: [24,24] });
else map.setView([39.5,-98.35], 4);
</script></body></html>`;
}

export default function CrewReplayScreen() {
  const colors = useColors();
  const { t } = useTranslation();
  const { employeeId, date: dateParam } = useLocalSearchParams<{ employeeId: string; date?: string }>();
  const id = Number(employeeId);
  const [date, setDate] = useState(
    typeof dateParam === "string" && dateParam ? dateParam : new Date().toISOString().slice(0, 10),
  );
  const [pings, setPings] = useState<Ping[]>([]);
  const [name, setName] = useState("");
  const [scrubIndex, setScrubIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!Number.isFinite(id)) return;
    setLoading(true);
    void apiFetch<{ employee: { name: string }; pings: Ping[] }>(
      `/api/field-employees/${id}/day-track?date=${date}`,
    )
      .then((data) => {
        setName(data.employee?.name ?? "");
        setPings(data.pings ?? []);
        setScrubIndex(Math.max(0, (data.pings?.length ?? 1) - 1));
        setError(null);
      })
      .catch((e) => setError(translateApiError(e, t)))
      .finally(() => setLoading(false));
  }, [id, date, t]);

  const html = useMemo(
    () => buildReplayHtml(pings, scrubIndex),
    [pings, scrubIndex],
  );

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <InPageHeader title={t("crewReplay.dayReplayTitle", { name: name || t("crewReplay.employeeFallback") })} onBack={() => router.back()} />
      <ScrollView style={{ flex: 1, backgroundColor: "transparent" }} contentContainerStyle={styles.content}>
        <Text style={{ color: colors.mutedForeground, marginBottom: 8 }}>{t("crewReplay.subtitle")}</Text>
        <TextInput
          value={date}
          onChangeText={setDate}
          placeholder="YYYY-MM-DD"
          style={[styles.input, { borderColor: colors.border, color: colors.foreground }]}
        />
        {loading ? (
          <ActivityIndicator color={colors.primary} style={{ marginVertical: 24 }} />
        ) : error ? (
          <Text style={{ color: colors.destructive }}>{error}</Text>
        ) : (
          <>
            <Text style={{ color: colors.foreground, marginBottom: 8 }}>
              {scrubIndex + 1} / {Math.max(pings.length, 1)}
            </Text>
            <View style={[styles.mapWrap, { borderColor: colors.border }]}>
              <WebView originWhitelist={["*"]} source={{ html }} style={styles.map} scrollEnabled={false} />
            </View>
            <View style={styles.sliderRow}>
              <Text style={{ color: colors.primary }} onPress={() => setScrubIndex(0)}>
                {t("crewReplay.reset", "Reset")}
              </Text>
              <Text style={{ color: colors.primary }} onPress={() => setScrubIndex((i) => Math.max(0, i - 1))}>
                −
              </Text>
              <Text style={{ color: colors.primary }} onPress={() => setScrubIndex((i) => Math.min(pings.length - 1, i + 1))}>
                +
              </Text>
            </View>
          </>
        )}
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, paddingBottom: 32 },
  input: { borderWidth: 1, borderRadius: 8, padding: 10, marginBottom: 12 },
  mapWrap: { height: 280, borderRadius: 12, borderWidth: 1, overflow: "hidden", marginBottom: 12 },
  map: { flex: 1 },
  sliderRow: { flexDirection: "row", justifyContent: "space-around" },
});
