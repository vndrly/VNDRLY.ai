import React, { useState } from "react";
import { Alert, Text, TextInput, View } from "react-native";
import { useTranslation } from "react-i18next";
import TogglePillButton from "@/components/TogglePillButton";
import { useColors } from "@/hooks/useColors";
import { apiFetch } from "@/lib/api";
import { captureAuthScope, isAuthScopeCurrent } from "@/lib/auth";
import { nativeUuid } from "@/lib/native-uuid";

export default function NativeShiftResponse({ shiftId }: { shiftId: string }) {
  const { t } = useTranslation(), colors = useColors();
  const [reason, setReason] = useState(""), [busy, setBusy] = useState(false), [saved, setSaved] = useState<string | null>(null), [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState<{ operationId: string; response: "accepted" | "declined"; reason?: string } | null>(null);
  async function save(body: NonNullable<typeof attempt>) {
    const scope = captureAuthScope(); setBusy(true); setAttempt(body);
    try {
      const receipt = await apiFetch<{ operationId: string; shiftId: string; status: string }>(`/api/native-operations/shifts/${shiftId}/respond`, { method: "POST", body: JSON.stringify(body) }, scope);
      if (!isAuthScopeCurrent(scope)) return;
      if (receipt.operationId !== body.operationId || receipt.shiftId !== shiftId || receipt.status !== body.response) throw new Error("shift_response_unverified");
      setSaved(receipt.status); setAttempt(null); setFailed(false);
    } catch { if (isAuthScopeCurrent(scope)) setFailed(true); }
    finally { if (isAuthScopeCurrent(scope)) setBusy(false); }
  }
  function review(response: "accepted" | "declined") {
    if (response === "declined" && !reason.trim()) { setFailed(true); return; }
    const body = { operationId: nativeUuid(), response, ...(response === "declined" ? { reason: reason.trim() } : {}) };
    Alert.alert(t("nativeShiftResponse.confirm"), t(response === "accepted" ? "nativeShiftResponse.acceptReview" : "nativeShiftResponse.declineReview"), [
      { text: t("nativeOperations.cancel"), style: "cancel" },
      { text: t(response === "accepted" ? "nativeShiftResponse.accept" : "nativeShiftResponse.decline"), onPress: () => { void save(body); } },
    ]);
  }
  return <View style={{ gap: 10 }}>
    {saved ? <Text accessibilityRole="alert" style={{ color: colors.text }}>{t("nativeShiftResponse.saved", { state: t(saved === "accepted" ? "nativeShiftResponse.accepted" : "nativeShiftResponse.declined") })}</Text> : <>
      <TextInput accessibilityLabel={t("nativeShiftResponse.reason")} placeholder={t("nativeShiftResponse.reason")} value={reason} onChangeText={setReason} editable={!busy && !attempt} maxLength={500} style={{ color: colors.text, borderColor: colors.border, borderWidth: 1, padding: 10 }} />
      {attempt ? <TogglePillButton disabled={busy} onPress={() => { void save(attempt); }}>{t("nativeShiftResponse.retry")}</TogglePillButton> : <>
        <TogglePillButton disabled={busy} onPress={() => review("accepted")}>{t("nativeShiftResponse.accept")}</TogglePillButton>
        <TogglePillButton disabled={busy || !reason.trim()} onPress={() => review("declined")}>{t("nativeShiftResponse.decline")}</TogglePillButton>
      </>}
    </>}
    {failed ? <Text accessibilityRole="alert" style={{ color: colors.text }}>{t("nativeShiftResponse.failed")}</Text> : null}
  </View>;
}
