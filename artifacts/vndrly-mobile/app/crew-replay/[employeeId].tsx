import { ModalTextInput as TextInput } from "@/components/ModalDraft";
import React, { useEffect, useMemo, useState } from "react";
import { Stack, useLocalSearchParams } from "expo-router";
import { useTranslation } from "react-i18next";
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import InPageHeader from "@/components/InPageHeader";
import MapboxNativeMap, { type NativeMapLine, type NativeMapPoint } from "@/components/MapboxNativeMap";
import { useColors } from "@/hooks/useColors";
import { apiFetch } from "@/lib/api";
import { translateApiError } from "@/lib/apiErrors";

type Ping = {
  id: number;
  latitude: number;
  longitude: number;
  recordedAt: string;
};

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

  const visiblePings = useMemo(() => pings.slice(0, scrubIndex + 1), [pings, scrubIndex]);
  const mapPoints = useMemo<NativeMapPoint[]>(
    () =>
      visiblePings.map((ping, index) => ({
        id: `ping-${ping.id}`,
        latitude: ping.latitude,
        longitude: ping.longitude,
        color: index === visiblePings.length - 1 ? "#f59e0b" : colors.primary,
        label: String(index + 1),
        title: new Date(ping.recordedAt).toLocaleString(),
      })),
    [colors.primary, visiblePings],
  );
  const mapLines = useMemo<NativeMapLine[]>(
    () =>
      pings.length >= 2
        ? [{
            id: "crew-replay-route",
            coordinates: pings.map((ping) => [ping.latitude, ping.longitude] as [number, number]),
            color: colors.primary,
            width: 3,
          }]
        : [],
    [colors.primary, pings],
  );

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <InPageHeader title={t("crewReplay.dayReplayTitle", { name: name || t("crewReplay.employeeFallback") })} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.content}>
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
              <MapboxNativeMap
                points={mapPoints}
                lines={mapLines}
                height="100%"
                styleKind="satellite"
                zoom={pings.length > 0 ? 13 : 4}
              />
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
