import { Stack } from "expo-router";
import React, { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import {
  ActivityIndicator,
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
import { captureAuthScope, isAuthScopeCurrent, subscribeToken, subscribeUser } from "@/lib/auth";

type SharedPrefs = {
  pushEnabled: boolean;
  dndStartHour: number | null;
  dndEndHour: number | null;
};
type GatePrefs = SharedPrefs & {
  mode: "gate";
  scheduleEnabled: boolean;
  gateCrewEnabled: boolean;
  messagesEnabled: boolean;
  handoffsEnabled: boolean;
  tasksEnabled: boolean;
  complianceEnabled: boolean;
  alertsEnabled: boolean;
  alertsEmailEnabled: boolean;
  alertsSmsEnabled: boolean;
  alertsSmsAvailable: boolean;
};
type OfficePrefs = SharedPrefs & {
  mode?: "office";
  ticketsEnabled: boolean;
  hotlistEnabled: boolean;
  complianceEnabled: boolean;
  crewEnabled: boolean;
  systemEnabled: boolean;
  // Task #50 — comments thread fan-out. The mobile app shows a single
  // toggle per channel-group: `commentsEnabled` covers in-app + push for
  // both @mention and reply notifications, the mention-email and
  // reply-digest-email toggles cover their respective email paths.
  commentsEnabled: boolean;
  commentMentionEmailEnabled: boolean;
  commentReplyEmailEnabled: boolean;
};
type Prefs = GatePrefs | OfficePrefs;
type SwitchKey = Exclude<keyof GatePrefs | keyof OfficePrefs, "mode" | "dndStartHour" | "dndEndHour" | "alertsSmsAvailable">;
const GATE_ROWS = [
  ["scheduleEnabled", "schedule"], ["gateCrewEnabled", "gate_crew"],
  ["messagesEnabled", "messages"], ["handoffsEnabled", "handoffs"],
  ["tasksEnabled", "tasks"], ["complianceEnabled", "compliance"], ["alertsEnabled", "alerts"],
] as const;
const OFFICE_SWITCHES = [
  "ticketsEnabled", "hotlistEnabled", "complianceEnabled", "crewEnabled", "systemEnabled",
  "commentsEnabled", "commentMentionEmailEnabled", "commentReplyEmailEnabled",
] as const;
function parsePreferences(value: unknown): Prefs {
  if (!value || typeof value !== "object") throw new Error("Invalid preferences response");
  const row = value as Record<string, unknown>;
  const keys = row.mode === "gate" ? GATE_ROWS.map(([key]) => key) : OFFICE_SWITCHES;
  if ((row.mode != null && row.mode !== "gate" && row.mode !== "office") ||
    [...keys, "pushEnabled"].some((key) => typeof row[key] !== "boolean") ||
    [row.dndStartHour, row.dndEndHour].some((hour) => hour !== null &&
      (typeof hour !== "number" || !Number.isInteger(hour) || hour < 0 || hour > 23))) {
    throw new Error("Invalid preferences response");
  }
  return row.mode === "gate" ? { ...row, alertsEmailEnabled: row.alertsEmailEnabled !== false,
    alertsSmsEnabled: row.alertsSmsEnabled === true, alertsSmsAvailable: row.alertsSmsAvailable === true } as GatePrefs : value as Prefs;
}
function subscribeAuth(listener: () => void) {
  const user = subscribeUser(listener);
  const token = subscribeToken(listener);
  return () => { user(); token(); };
}
const authGeneration = () => captureAuthScope().generation;

export default function NotificationPreferencesScreen() {
  const generation = useSyncExternalStore(subscribeAuth, authGeneration);
  // Remount on account/role changes so the old account's draft is never rendered.
  return <NotificationPreferencesForm key={generation} />;
}

function NotificationPreferencesForm() {
  const scope = useRef(captureAuthScope()).current;
  const colors = useColors();
  const { t } = useTranslation();
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [retry, setRetry] = useState(0);
  const requestController = useRef<AbortController | null>(null);
  const savingRef = useRef(false);
  const smsChanged = useRef(false);
  const gateMode = prefs?.mode === "gate";
  const ROWS = useMemo<{ key: SwitchKey; label: string; desc: string }[]>(
    () => [
      ...(gateMode ? GATE_ROWS.map(([key, category]) => ({
        key, label: t(`notifications.categories.${category}`), desc: t(`notifications.gateDescriptions.${category}`),
      })) : [
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
      ] satisfies { key: SwitchKey; label: string; desc: string }[]),
      ...(gateMode ? [
        { key: "alertsEmailEnabled" as const, label: t("notifications.alertChannels.email"), desc: t("notifications.alertChannels.emailDesc") },
        { key: "alertsSmsEnabled" as const, label: t("notifications.alertChannels.sms"), desc: t("notifications.alertChannels.smsDisclosure") },
      ] : []),
      { key: "pushEnabled", label: t("notifications.rows.push"), desc: t("notifications.rows.pushDesc") },
    ],
    [t, gateMode],
  );

  useEffect(() => {
    const controller = new AbortController();
    requestController.current = controller;
    setLoadError(false);
    (async () => {
      try {
        const p = parsePreferences(await apiFetch<unknown>("/api/notifications/preferences", { signal: controller.signal }, scope));
        if (!controller.signal.aborted && isAuthScopeCurrent(scope)) setPrefs(p);
      } catch {
        if (!controller.signal.aborted && isAuthScopeCurrent(scope)) setLoadError(true);
      }
    })();
    return () => { controller.abort(); requestController.current?.abort(); };
  }, [retry, scope]);

  const update = (patch: Partial<SharedPrefs & Record<SwitchKey, boolean>>) => {
    if (!prefs || savingRef.current || !isAuthScopeCurrent(scope)) return;
    if ("alertsSmsEnabled" in patch) smsChanged.current = true;
    setPrefs({ ...prefs, ...patch });
    setSaveError(false);
  };

  const save = async () => {
    if (!prefs || savingRef.current || !isAuthScopeCurrent(scope)) return;
    const controller = new AbortController();
    requestController.current = controller;
    const valid = () => !controller.signal.aborted && isAuthScopeCurrent(scope);
    savingRef.current = true;
    setSaving(true);
    setSaveError(false);
    // Only submit the fields shown in this mode; never round-trip hidden office settings.
    const body = Object.fromEntries(ROWS.filter(({ key }) => key !== "alertsSmsEnabled" || smsChanged.current)
      .map(({ key }) => [key, (prefs as unknown as Record<SwitchKey, boolean>)[key]]));
    try {
      const next = parsePreferences(await apiFetch<unknown>("/api/notifications/preferences", {
        method: "PATCH",
        body: JSON.stringify({ ...body, dndStartHour: prefs.dndStartHour, dndEndHour: prefs.dndEndHour }),
        signal: controller.signal,
      }, scope));
      if (valid()) { setPrefs(next); smsChanged.current = false; }
    } catch {
      if (valid()) setSaveError(true);
    } finally {
      if (valid()) { savingRef.current = false; setSaving(false); }
    }
  };

  if (!prefs) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background, justifyContent: "center" }]}>
        <Stack.Screen options={{ headerShown: false }} />
        <InPageHeader title={t("notifications.preferencesTitle")} />
        {loadError ? <View style={{ padding: 16 }}>
          <Text accessibilityRole="alert" style={{ color: colors.foreground }}>{t("notifications.preferencesLoadFailed")}</Text>
          <AmberButton onPress={() => setRetry((value) => value + 1)}>{t("notifications.preferencesRetry")}</AmberButton>
        </View> : <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} />}
      </View>
    );
  }

  return (
    <View style={styles.container}>
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
                {r.key === "alertsSmsEnabled" && prefs.mode === "gate" && !prefs.alertsSmsAvailable &&
                  <Text style={[styles.rowDesc, { color: colors.mutedForeground }]}>{t("notifications.alertChannels.phoneRequired")}</Text>}
              </View>
              <Switch
                accessibilityLabel={r.label}
                accessibilityHint={r.desc}
                disabled={saving || (r.key === "alertsSmsEnabled" && prefs.mode === "gate" && !prefs.alertsSmsAvailable && !prefs.alertsSmsEnabled)}
                value={(prefs as unknown as Record<SwitchKey, boolean>)[r.key]}
                onValueChange={(v) => update({ [r.key]: v })}
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
                accessibilityLabel={t("notifications.dndStart")}
                editable={!saving}
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
                accessibilityLabel={t("notifications.dndEnd")}
                editable={!saving}
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

        {saveError && <Text accessibilityRole="alert" style={{ color: colors.foreground }}>{t("notifications.saveFailed")}</Text>}
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
