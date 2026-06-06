import { Feather } from "@expo/vector-icons";
import { Stack, useFocusEffect } from "expo-router";
import React, { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

import ActiveOrgIndicator from "@/components/ActiveOrgIndicator";
import InPageHeader from "@/components/InPageHeader";
import LayeredPillButton from "@/components/LayeredPillButton";
import SetCrewModal, { type CrewPreset } from "@/components/SetCrewModal";
import { useColors } from "@/hooks/useColors";
import { apiFetch } from "@/lib/api";

export default function CrewsScreen() {
  const colors = useColors();
  const { t } = useTranslation();
  const [crews, setCrews] = useState<CrewPreset[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<CrewPreset | null>(null);

  const load = useCallback(async () => {
    try {
      const rows = await apiFetch<CrewPreset[]>("/api/field/crew-presets");
      setCrews(rows ?? []);
    } catch {
      setCrews([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      void load();
    }, [load]),
  );

  function openCreate() {
    setEditing(null);
    setModalOpen(true);
  }

  function openEdit(crew: CrewPreset) {
    setEditing(crew);
    setModalOpen(true);
  }

  return (
    <View style={[styles.flex, { backgroundColor: colors.background }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <InPageHeader title={t("tabs.crews")} right={<ActiveOrgIndicator />} />

      <View style={styles.topPad}>
        <LayeredPillButton
          onPress={openCreate}
          height={44}
          style={styles.setBtn}
          testID="button-set-a-crew"
        >
          <Feather name="plus" size={16} color="#ffffff" style={styles.iconShadow} />
          <Text style={[styles.btnText, styles.textShadow]}>{t("crews.setCrew")}</Text>
        </LayeredPillButton>
        <Text style={[styles.help, { color: colors.mutedForeground }]}>{t("crews.help")}</Text>
      </View>

      {loading ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: 24 }} />
      ) : (
        <FlatList
          data={crews}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={styles.list}
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
          ListEmptyComponent={
            <Text style={[styles.empty, { color: colors.mutedForeground }]}>{t("crews.empty")}</Text>
          }
          renderItem={({ item }) => (
            <TouchableOpacity
              onPress={() => openEdit(item)}
              style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}
              testID={`crew-preset-row-${item.id}`}
            >
              <View style={styles.cardRow}>
                <Feather name="users" size={18} color={colors.primary} />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.crewName, { color: colors.foreground }]}>{item.name}</Text>
                  <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>
                    {t("crews.memberCount", { count: item.memberEmployeeIds.length })}
                  </Text>
                </View>
                <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
              </View>
            </TouchableOpacity>
          )}
        />
      )}

      <SetCrewModal
        visible={modalOpen}
        preset={editing}
        onClose={() => setModalOpen(false)}
        onSaved={() => {
          setModalOpen(false);
          void load();
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  topPad: { paddingHorizontal: 16, paddingTop: 12 },
  setBtn: { alignSelf: "stretch" },
  btnText: { color: "#ffffff", fontFamily: "Inter_600SemiBold", fontSize: 15 },
  help: { fontFamily: "Inter_400Regular", fontSize: 13, marginTop: 10, lineHeight: 18 },
  list: { padding: 16, paddingTop: 8 },
  empty: { textAlign: "center", marginTop: 32, fontFamily: "Inter_400Regular" },
  card: { borderWidth: 1, borderRadius: 12, padding: 14, marginBottom: 10 },
  cardRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  crewName: { fontFamily: "Inter_700Bold", fontSize: 15 },
  textShadow: {
    textShadowColor: "rgba(0,0,0,0.63)",
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 4,
  },
  iconShadow: {
    textShadowColor: "rgba(0,0,0,0.63)",
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 4,
  },
});
