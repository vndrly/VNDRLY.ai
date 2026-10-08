import React, { useEffect, useState } from "react";
import { Alert, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import TogglePillButton from "@/components/TogglePillButton";
import { useAuth } from "@/hooks/use-auth";
import { useColors } from "@/hooks/useColors";
import { nativeUuid } from "@/lib/native-uuid";
import { enqueueNativeOperation, readNativeJournal } from "@/lib/native-operation-journal-runtime";
import { captureAuthScope, isAuthScopeCurrent } from "@/lib/auth";
import type { JournalEntry } from "@/lib/native-operation-journal";
type Visitor = { firstName: string; lastName: string; company: string; purpose: string; notes: string; vehiclePlate: string; plateState: string | null };
export default function NativeGateJournal({ siteId, visitor, onRecorded }: { siteId: number | null; visitor: Visitor; onRecorded(): void }) {
  const { user } = useAuth(), { t } = useTranslation(), colors = useColors();
  const [busy, setBusy] = useState(false), [entries, setEntries] = useState<JournalEntry[]>([]);
  useEffect(() => { setEntries([]); let alive = true; const scope = captureAuthScope();
    if (user) void readNativeJournal(user).then(value => { if (alive && isAuthScopeCurrent(scope)) setEntries(value.filter(entry => entry.domain === "gate")); }).catch(() => undefined);
    return () => { alive = false; };
  }, [user?.id, user?.activeMembershipId, busy]);
  async function record(direction: "entry" | "exit", entry?: JournalEntry) {
    if (!user || !siteId || busy || (!entry && (!visitor.vehiclePlate.trim() || !visitor.firstName.trim() || !visitor.lastName.trim()))) return;
    const scope = captureAuthScope(); setBusy(true);
    try {
      const prior = entry?.payload as { plate: string; plateState?: string; siteLocationId: number } | undefined;
      await enqueueNativeOperation(user, { operationId: nativeUuid(), domain: "gate", capturedAt: new Date().toISOString(), payload: {
        siteLocationId: prior?.siteLocationId ?? siteId, direction,
        plate: prior?.plate ?? visitor.vehiclePlate.trim(), plateState: prior?.plateState ?? visitor.plateState ?? undefined,
        ...(entry ? { entryOperationId: entry.operationId } : { reportedVisitor: { firstName: visitor.firstName.trim(), lastName: visitor.lastName.trim(), company: visitor.company.trim(), purpose: visitor.purpose.trim(), notes: visitor.notes.trim() } }),
      } });
      if (isAuthScopeCurrent(scope)) { onRecorded(); Alert.alert(t("nativeJournal.title"), t("nativeJournal.gatePending")); }
    } catch { if (isAuthScopeCurrent(scope)) Alert.alert(t("nativeJournal.title"), t("nativeJournal.unavailable")); }
    finally { if (isAuthScopeCurrent(scope)) setBusy(false); }
  }
  if (!user || !siteId) return null;
  return <View style={{ gap: 10 }}>
    <Text accessibilityRole="alert" style={{ color: colors.text }}>{t("nativeJournal.gateWarning")}</Text>
    <TogglePillButton disabled={busy || !visitor.vehiclePlate.trim() || !visitor.firstName.trim() || !visitor.lastName.trim()} onPress={() => { void record("entry"); }}>{t("nativeJournal.recordEntry")}</TogglePillButton>
    {entries.filter(entry => (entry.payload as { direction?: string; siteLocationId?: number }).direction === "entry" && (entry.payload as { siteLocationId?: number }).siteLocationId === siteId && !entries.some(other => (other.payload as { entryOperationId?: string }).entryOperationId === entry.operationId)).map(entry => <TogglePillButton key={entry.operationId} disabled={busy} onPress={() => { void record("exit", entry); }}>{t("nativeJournal.recordExit", { plate: (entry.payload as { plate: string }).plate })}</TogglePillButton>)}
  </View>;
}
