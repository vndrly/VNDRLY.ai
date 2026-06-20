import { router, useLocalSearchParams } from "expo-router";
import React, { useEffect, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useColors } from "@/hooks/useColors";
import { apiFetch } from "@/lib/api";
import InPageHeader from "@/components/InPageHeader";

export default function SafetyEventDetailScreen() {
  const { t } = useTranslation();
  const colors = useColors();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [event, setEvent] = useState<Record<string, unknown> | null>(null);

  useEffect(() => {
    void (async () => {
      const data = await apiFetch<{ data: { event: Record<string, unknown> } }>(`/api/safety/events/${id}`);
      setEvent(data?.data?.event ?? null);
    })();
  }, [id]);

  if (!event) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        <InPageHeader title={t("safety.details")} onBack={() => router.back()} />
        <Text style={{ padding: 16, color: colors.mutedForeground }}>{t("common.loading")}</Text>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <InPageHeader title={String(event.eventNumber ?? t("safety.details"))} onBack={() => router.back()} />
      <ScrollView contentContainerStyle={{ padding: 16, gap: 8 }}>
        <Text style={{ fontSize: 18, fontWeight: "600", color: colors.text }}>{String(event.title ?? "")}</Text>
        <Text style={{ color: colors.mutedForeground }}>
          {String(event.status ?? "")} · {String(event.eventType ?? "")}
        </Text>
        {event.description ? (
          <Text style={{ color: colors.text, marginTop: 8 }}>{String(event.description)}</Text>
        ) : null}
      </ScrollView>
    </View>
  );
}
