import React, { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { router } from "expo-router";
import { useTranslation } from "react-i18next";
import TogglePillButton from "@/components/TogglePillButton";
import { useAuth } from "@/hooks/use-auth";
import { useColors } from "@/hooks/useColors";
import { captureAuthScope, isAuthScopeCurrent } from "@/lib/auth";
import { readNativeJournal, synchronizeNativeJournal } from "@/lib/native-operation-journal-runtime";
import type { JournalEntry } from "@/lib/native-operation-journal";
export default function NativeJournal() {
  const { user } = useAuth(), { t } = useTranslation(), colors = useColors();
  const [entries, setEntries] = useState<JournalEntry[]>([]), [busy, setBusy] = useState(false), [error, setError] = useState(false);
  useEffect(() => {
    setEntries([]); let alive = true; const scope = captureAuthScope();
    const refresh = async () => { if (!user) return; try { const values = await readNativeJournal(user); if (alive && isAuthScopeCurrent(scope)) setEntries(values); } catch { if (alive && isAuthScopeCurrent(scope)) setError(true); } };
    void refresh(); const timer = setInterval(() => { void refresh(); }, 10_000);
    return () => { alive = false; clearInterval(timer); };
  }, [user?.id, user?.activeMembershipId]);
  if (!entries.length && !error) return null;
  async function sync() {
    if (!user || busy) return; const scope = captureAuthScope(); setBusy(true);
    try { const values = await synchronizeNativeJournal(user); if (isAuthScopeCurrent(scope)) { setEntries(values); setError(false); } }
    catch { if (isAuthScopeCurrent(scope)) setError(true); }
    finally { if (isAuthScopeCurrent(scope)) setBusy(false); }
  }
  return <View style={{ gap: 10, borderColor: colors.border, borderWidth: 1, padding: 16, borderRadius: 14 }}>
    <Text accessibilityRole="header" style={{ color: colors.text, fontWeight: "700" }}>{t("nativeJournal.title")}</Text>
    <Text style={{ color: colors.text }}>{t("nativeJournal.pending")}</Text>
    {error ? <Text accessibilityRole="alert" style={{ color: colors.text }}>{t("nativeJournal.unavailable")}</Text> : null}
    {entries.map(entry => <View key={entry.operationId} style={{ gap: 6 }}>
      <Text style={{ color: colors.text }}>{entry.domain} · {entry.state} · {new Date(entry.capturedAt).toLocaleString()}</Text>
      {entry.state === "conflict" || entry.state === "revoked" ? <Text accessibilityRole="alert" style={{ color: colors.text }}>{t(entry.state === "conflict" ? "nativeJournal.conflict" : "nativeJournal.revoked")}</Text> : null}
      <TogglePillButton disabled={busy} onPress={() => router.push((entry.domain === "gate" ? "/(tabs)/gate" : "/work-hub/files-notes") as never)}>{t("nativeJournal.open")}</TogglePillButton>
    </View>)}
    <TogglePillButton disabled={busy} onPress={() => { void sync(); }}>{t("nativeJournal.sync")}</TogglePillButton>
  </View>;
}
