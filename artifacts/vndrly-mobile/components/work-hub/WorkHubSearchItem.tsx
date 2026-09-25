import React, { useEffect, useState } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { useColors } from "@/hooks/useColors";
import { apiFetch } from "@/lib/api";
import { workHubItemDestination } from "@workspace/api-client-react/work-hub-destinations";
import { useTranslation } from "react-i18next";

type Item = { id: string; subjectType: string; title: string; body?: unknown; status?: string; updatedAt?: string };

export function WorkHubSearchItem({ subjectType, itemId }: { subjectType: string; itemId: string }) {
  const { t } = useTranslation();
  const colors = useColors();
  const [item, setItem] = useState<Item | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    setLoading(true);
    setItem(null);
    setError("");
    const destination = workHubItemDestination(subjectType, itemId);
    if (!destination) { setError(t("workHubSearch.itemUnavailable")); setLoading(false); return; }
    apiFetch<Item>(`/api${destination.readPath}`)
      .then(value => { if (active) setItem(value); })
      .catch(() => { if (active) setError(t("workHubSearch.itemUnavailable")); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [subjectType, itemId, t]);
  return <View style={{ gap: 12, borderWidth: 2, borderColor: colors.primary, borderRadius: 16, padding: 16, backgroundColor: colors.card }}>
    {loading ? <ActivityIndicator color={colors.primary} /> : null}
    {error ? <Text accessibilityRole="alert" style={{ color: colors.destructive }}>{error}</Text> : null}
    {item ? <>
      <Text style={{ color: colors.primary, textTransform: "uppercase", fontWeight: "700" }}>{t(`workHubSearch.types.${item.subjectType}`, { defaultValue: t("workHubSearch.records") })}</Text>
      <Text style={{ color: colors.text, fontSize: 20, fontWeight: "700" }}>{item.title}</Text>
      {item.body ? <Text style={{ color: colors.text }}>{typeof item.body === "string" ? item.body : JSON.stringify(item.body)}</Text> : null}
      {item.status ? <Text style={{ color: colors.mutedForeground }}>{t(`workHubSearch.statuses.${item.status}`, { defaultValue: t("workHubSearch.unknownStatus") })}</Text> : null}
    </> : null}
  </View>;
}
