import * as Crypto from "expo-crypto";
import React, { useState } from "react";
import { Text, TextInput, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import TogglePillButton from "@/components/TogglePillButton";
import { useAuth } from "@/hooks/use-auth";
import { useColors } from "@/hooks/useColors";
import { apiFetch } from "@/lib/api";

type Duty = { id: string; userId: number; userName: string; startedAt: string };

export default function GateDutyCard({
  stationId,
  workHubShiftId,
  onStartShift,
  startShiftDisabled,
}: {
  stationId: string;
  workHubShiftId?: string;
  onStartShift?: () => void;
  startShiftDisabled?: boolean;
}) {
  const { t } = useTranslation();
  const colors = useColors();
  const { user } = useAuth();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const roster = useQuery({
    queryKey: ["gate-duty-roster", stationId],
    queryFn: () => apiFetch<{ roster: Duty[] }>(`/api/gate-change-over/${stationId}/roster`),
    enabled: Boolean(stationId),
    retry: false,
    refetchInterval: 15000,
  });
  const own = roster.data?.roster.find((entry) => entry.userId === user?.id);
  const run = async (work: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true); setError("");
    try { await work(); await roster.refetch(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : t("gateDuty.failed")); }
    finally { setBusy(false); }
  };
  const post = (path: string, body: Record<string, unknown>) => apiFetch(`/api/gate-change-over/${stationId}/${path}`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });

  return <View style={{ backgroundColor: colors.card, borderColor: colors.border, borderRadius: 12, borderWidth: 1, gap: 10, padding: 16 }}>
    <Text style={{ color: colors.foreground, fontSize: 17, fontWeight: "700" }}>{t("gateDuty.title")}</Text>
    {(roster.data?.roster ?? []).length === 0
      ? <View accessibilityRole="alert" style={{ backgroundColor: `${colors.destructive}18`, borderColor: colors.destructive, borderRadius: 8, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 8 }}>
          <Text accessibilityLiveRegion="polite" style={{ color: colors.destructive, fontWeight: "700" }}>{t("gateDuty.unstaffed")}</Text>
        </View>
      : roster.data?.roster.map((entry) => <Text key={entry.id} style={{ color: colors.foreground }}>{entry.userName} · {new Date(entry.startedAt).toLocaleTimeString()}</Text>)}
    {error ? <Text accessibilityRole="alert" style={{ color: colors.destructive }}>{error}</Text> : null}
    {!own ? <>
      <View style={{ flexDirection: "row", gap: 8 }}>
        {onStartShift ? <TogglePillButton solid disabled={busy || startShiftDisabled} style={{ flex: 1 }} onPress={onStartShift}>{t("changeOver.start")}</TogglePillButton> : null}
        <TogglePillButton disabled={busy} style={{ flex: 1 }} onPress={() => void run(() => post("duty/assume", { workHubShiftId, source: "manual", idempotencyKey: Crypto.randomUUID() }))}>{t("gateDuty.assume")}</TogglePillButton>
      </View>
      {workHubShiftId ? <TogglePillButton disabled={busy} onPress={() => void run(() => post("work-sessions/start", { workHubShiftId, source: "manual", idempotencyKey: Crypto.randomUUID(), locationSharingActive: false }))}>{t("gateDuty.startPaidTravel")}</TogglePillButton> : null}
    </> : <>
      <TextInput accessibilityLabel={t("gateDuty.signOffReason")} placeholder={t("gateDuty.signOffReason")} placeholderTextColor={colors.mutedForeground} value={reason} onChangeText={setReason} style={{ backgroundColor: colors.background, borderColor: colors.border, borderRadius: 18, borderWidth: 1, color: colors.foreground, paddingHorizontal: 12, paddingVertical: 10 }} />
      <TogglePillButton inactive disabled={busy || !reason.trim()} onPress={() => void run(() => post(`duty/${own.id}/end`, { reason: reason.trim(), handoffCompleted: (roster.data?.roster.length ?? 0) > 1 }))}>{t("gateDuty.signOff")}</TogglePillButton>
    </>}
  </View>;
}
