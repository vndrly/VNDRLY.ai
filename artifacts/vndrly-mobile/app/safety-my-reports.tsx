import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import React, { useCallback, useState } from "react";
import { FlatList, Text, TouchableOpacity, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useColors } from "@/hooks/useColors";
import { apiFetch } from "@/lib/api";
import InPageHeader from "@/components/InPageHeader";
import LayeredPillButton from "@/components/LayeredPillButton";

type SafetyRow = {
  id: number;
  eventNumber: string;
  title: string;
  status: string;
  eventType: string;
  createdAt: string;
};

export default function SafetyMyReportsScreen() {
  const { t } = useTranslation();
  const params = useLocalSearchParams<{ openOnly?: string }>();
  const openOnly = params.openOnly === "true";
  const [error, setError] = useState(false);
  const colors = useColors();
  const [rows, setRows] = useState<SafetyRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const res = await apiFetch<{ success?: boolean; data?: SafetyRow[] }>(`/api/safety/events?limit=50${openOnly ? "&openOnly=true&sinceDays=365" : ""}`);
      setRows(res.data ?? []);
    } catch {
      setError(true);
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [openOnly]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  return (
    <View style={{ flex: 1 }}>
      <InPageHeader title={t(openOnly ? "safety.scoreDetails.openIncidents" : "safety.myReportsTitle")} onBack={() => router.back()} />
      <View style={{ padding: 16 }}>
        <LayeredPillButton onPress={() => router.push("/safety-report")}>
          <Text style={{ color: "#ffffff" }}>{t("safety.reportTitle")}</Text>
        </LayeredPillButton>
      </View>
      <FlatList
        data={rows}
        keyExtractor={(item) => String(item.id)}
        refreshing={loading}
        onRefresh={load}
        ListEmptyComponent={<Text style={{ padding: 16, color: colors.mutedForeground }}>{t(error ? "safety.scoreDetails.unavailable" : loading ? "safety.scoreDetails.loading" : "safety.inboxEmpty")}</Text>}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={{ padding: 16, borderBottomWidth: 1, borderBottomColor: colors.border }}
            onPress={() => router.push({ pathname: "/safety-event/[id]", params: { id: String(item.id) } })}
          >
            <Text style={{ fontWeight: "600", color: colors.text }}>{item.eventNumber}</Text>
            <Text style={{ color: colors.text }}>{item.title}</Text>
            <Text style={{ color: colors.mutedForeground, marginTop: 4 }}>
              {item.status} · {item.eventType}
            </Text>
          </TouchableOpacity>
        )}
      />
    </View>
  );
}
