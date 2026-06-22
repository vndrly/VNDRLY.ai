import { Stack } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";

import AmberButton from "@/components/AmberButton";
import InPageHeader from "@/components/InPageHeader";
import { useColors } from "@/hooks/useColors";
import { apiFetch } from "@/lib/api";
import { SCREEN_ROOT_BACKGROUND } from "@/lib/nav-pane-tokens";

type Prefs = {
  ticketsEnabled: boolean;
  hotlistEnabled: boolean;
  complianceEnabled: boolean;
  crewEnabled: boolean;
  systemEnabled: boolean;
  pushEnabled: boolean;
  dndStartHour: number | null;
  dndEndHour: number | null;
  // Task #50 — comments thread fan-out. The mobile app shows a single
  // toggle per channel-group: `commentsEnabled` covers in-app + push for
  // both @mention and reply notifications, the mention-email and
  // reply-digest-email toggles cover their respective email paths.
  commentsEnabled: boolean;
  commentMentionEmailEnabled: boolean;
  commentReplyEmailEnabled: boolean;
};

export default function NotificationPreferencesScreen() {
  const colors = useColors();
  const { t } = useTranslation();
  const ROWS = useMemo<{ key: keyof Prefs; label: string; desc: string }[]>(
    () => [
      { key: "ticketsEnabled", label: t("notifications.rows.tickets"), desc: t("notifications.rows.ticketsDesc") },
      { key: "hotlistEnabled", label: t("notifications.rows.hotlist"), desc: t("notifications.rows.hotlistDesc") },
      { key: "complianceEnabled", label: t("notifications.rows.compliance"), desc: t("notifications.rows.complianceDesc") },
      { key: "crewEnabled", label: t("notifications.rows.crew"), desc: t("notifications.rows.crewDesc") },
      { key: "systemEnabled", label: t("notifications.rows.system"), desc: t("notifications.rows.systemDesc") },
      // Task #50 — comments fan-out toggles. Three rows because the
      // user wants independent control over (a) in-app/push for the
      // category, (b) instant @mention emails, and (c) the every-few-
      // minutes reply digest email.
      { key: "commentsEnabled", label: t("notifications.rows.comments"), desc: t("notifications.rows.commentsDesc") },
      { key: "commentMentionEmailEnabled", label: t("notifications.rows.commentMentionEmail"), desc: t("notifications.rows.commentMentionEmailDesc") },
      { key: "commentReplyEmailEnabled", label: t("notifications.rows.commentReplyEmail"), desc: t("notifications.rows.commentReplyEmailDesc") },
      { key: "pushEnabled", label: t("notifications.rows.push"), desc: t("notifications.rows.pushDesc") },
    ],
    [t],
  );
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const p = await apiFetch<Prefs>("/api/notifications/preferences");
        setPrefs(p);
      } catch (e) {
        Alert.alert(t("common.error"), t("notifications.loadFailed"));
      }
    })();
  }, []);

  const update = (patch: Partial<Prefs>) => {
    if (!prefs) return;
    setPrefs({ ...prefs, ...patch });
  };

  const save = async () => {
    if (!prefs) return;
    setSaving(true);
    try {
      const next = await apiFetch<Prefs>("/api/notifications/preferences", {
        method: "PATCH",
        body: JSON.stringify(prefs),
      });
      setPrefs(next);
    } catch (e) {
      Alert.alert(t("common.error"), t("notifications.saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  if (!prefs) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background, justifyContent: "center" }]}>
        <Stack.Screen options={{ headerShown: false }} />
        <InPageHeader title={t("notifications.preferencesTitle")} />
        <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} />
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: SCREEN_ROOT_BACKGROUND }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <InPageHeader title={t("notifications.preferencesTitle")} />

      <ScrollView contentContainerStyle={{ padding: 16 }}>
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          {ROWS.map((r, idx) => (
            <View
              key={r.key}
              style={[
                styles.row,
                idx < ROWS.length - 1 ? { borderBottomColor: colors.border, borderBottomWidth: 1 } : null,
              ]}
            >
              <View style={{ flex: 1, paddingRight: 12 }}>
                <Text style={[styles.rowLabel, { color: colors.foreground }]}>{r.label}</Text>
                <Text style={[styles.rowDesc, { color: colors.mutedForeground }]}>{r.desc}</Text>
              </View>
              <Switch
                value={prefs[r.key] as boolean}
                onValueChange={(v) => update({ [r.key]: v } as Partial<Prefs>)}
              />
            </View>
          ))}
        </View>

        <Text style={[styles.sectionTitle, { color: colors.foreground }]}>{t("notifications.dnd")}</Text>
        <Text style={[styles.sectionDesc, { color: colors.mutedForeground }]}>
          {t("notifications.dndDesc")}
        </Text>
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border, padding: 14 }]}>
          <View style={{ flexDirection: "row", gap: 12 }}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.rowDesc, { color: colors.mutedForeground }]}>{t("notifications.dndStart")}</Text>
              <TextInput
                value={prefs.dndStartHour == null ? "" : String(prefs.dndStartHour)}
                onChangeText={(v) =>
                  update({ dndStartHour: v === "" ? null : Math.max(0, Math.min(23, parseInt(v) || 0)) })
                }
                keyboardType="number-pad"
                style={[styles.input, { color: colors.foreground, borderColor: colors.border }]}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.rowDesc, { color: colors.mutedForeground }]}>{t("notifications.dndEnd")}</Text>
              <TextInput
                value={prefs.dndEndHour == null ? "" : String(prefs.dndEndHour)}
                onChangeText={(v) =>
                  update({ dndEndHour: v === "" ? null : Math.max(0, Math.min(23, parseInt(v) || 0)) })
                }
                keyboardType="number-pad"
                style={[styles.input, { color: colors.foreground, borderColor: colors.border }]}
              />
            </View>
          </View>
        </View>

        <AmberButton
          onPress={save}
          disabled={saving}
          loading={saving}
          height={48}
          style={styles.saveBtn}
          textStyle={styles.saveText}
        >
          {t("notifications.save")}
        </AmberButton>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  card: { borderWidth: 1, borderRadius: 12, marginBottom: 16 },
  row: { flexDirection: "row", alignItems: "center", padding: 14 },
  rowLabel: { fontFamily: "Inter_600SemiBold", fontSize: 14 },
  rowDesc: { fontFamily: "Inter_400Regular", fontSize: 12, marginTop: 2 },
  sectionTitle: { fontFamily: "Inter_600SemiBold", fontSize: 14, marginBottom: 4, marginTop: 4 },
  sectionDesc: { fontFamily: "Inter_400Regular", fontSize: 12, marginBottom: 8 },
  input: { borderWidth: 1, borderRadius: 8, padding: 10, marginTop: 4, fontFamily: "Inter_400Regular" },
  saveBtn: { padding: 14, borderRadius: 12, alignItems: "center", marginTop: 8 },
  saveText: { fontFamily: "Inter_600SemiBold", fontSize: 14 },
});
