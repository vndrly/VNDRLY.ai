import { router, Stack } from "expo-router";
import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import InPageHeader from "@/components/InPageHeader";
import { useAuth } from "@/hooks/use-auth";
import { useColors } from "@/hooks/useColors";
import { apiFetch } from "@/lib/api";

type CatalogItem = {
  id: number;
  name: string;
  category: string | null;
  selected: boolean;
  unitPrice: string | null;
  unit: string | null;
};

export default function ServicesScreen() {
  const colors = useColors();
  const { t } = useTranslation();
  const { user } = useAuth();
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!user?.vendorId) {
        setLoading(false);
        return;
      }
      try {
        const res = await apiFetch(
          `/api/vendors/${user.vendorId}/work-types`,
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as { items: CatalogItem[] };
        if (!cancelled) {
          setItems((json.items ?? []).filter((it) => it.selected));
        }
      } catch {
        if (!cancelled) {
          setError(t("services.loadError"));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.vendorId, t]);

  const grouped = items.reduce<Record<string, CatalogItem[]>>((acc, it) => {
    const key = it.category?.trim() || t("services.uncategorized");
    if (!acc[key]) acc[key] = [];
    acc[key].push(it);
    return acc;
  }, {});

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <Stack.Screen options={{ headerShown: false }} />
      <InPageHeader title={t("services.title")} onBack={() => router.back()} />
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={[styles.help, { color: colors.mutedForeground }]}>
          {t("services.readOnlyHelp")}
        </Text>
        {loading ? (
          <ActivityIndicator color={colors.primary} />
        ) : error ? (
          <Text style={{ color: colors.destructive }}>{error}</Text>
        ) : items.length === 0 ? (
          <Text style={{ color: colors.mutedForeground }}>
            {t("services.empty")}
          </Text>
        ) : (
          Object.entries(grouped)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([category, rows]) => (
              <View key={category} style={styles.section}>
                <Text style={[styles.category, { color: colors.primary }]}>
                  {category}
                </Text>
                {rows.map((it) => (
                  <View
                    key={it.id}
                    style={[
                      styles.row,
                      { borderColor: colors.border, backgroundColor: colors.card },
                    ]}
                  >
                    <Text style={{ color: colors.foreground, flex: 1 }}>
                      {it.name}
                    </Text>
                    <Text style={{ color: colors.mutedForeground }}>
                      {it.unitPrice
                        ? `${it.unitPrice}${it.unit ? ` / ${it.unit}` : ""}`
                        : t("services.noPrice")}
                    </Text>
                  </View>
                ))}
              </View>
            ))
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, paddingBottom: 40, gap: 12 },
  help: { fontSize: 13, lineHeight: 18 },
  section: { gap: 8 },
  category: {
    fontSize: 12,
    fontFamily: "Inter_700Bold",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  row: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
});
