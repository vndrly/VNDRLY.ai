import React, { useState } from "react";
import { Text, TextInput, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { ChangeOverState } from "@workspace/gate-booth";
import { ModalPressable as Pressable } from "@/components/ModalDraft";
import { useAuth } from "@/hooks/use-auth";
import { useColors } from "@/hooks/useColors";
import { changeOverRequest } from "@/lib/change-over-api";

type Recovery = { stationId: string; body: { expectedShiftId: string; reason: string; acknowledged: true; targetMembershipId?: number } };

export default function GateDashboardSupervisorCard({ stationId, current, onChanged }: { stationId: string; current: ChangeOverState; onChanged: () => void }) {
  const { user } = useAuth();
  const { t } = useTranslation();
  const { primary } = useColors();
  const [reason, setReason] = useState("");
  const [target, setTarget] = useState("self");
  const [choicesOpen, setChoicesOpen] = useState(false);
  const [pending, setPending] = useState<Recovery | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const replacements = useQuery({
    queryKey: ["gate-recovery-operators", user?.id, user?.activeMembershipId, stationId],
    queryFn: () => changeOverRequest<{ operators: { userId: number; membershipId: number; name: string; companyName: string }[] }>(`/${stationId}/recovery-operators`),
    enabled: !!stationId && !!current.shift && current.supervisor,
    retry: false,
  });
  const option = (text: string, onPress: () => void, disabled = false) => <Pressable accessibilityRole="button" accessibilityLabel={text} disabled={disabled} onPress={onPress} style={{ minHeight: 38, justifyContent: "center", paddingHorizontal: 8, borderWidth: 1, borderColor: primary, borderRadius: 7, marginTop: 5, opacity: disabled ? 0.5 : 1 }}><Text style={{ color: "#ececec", fontSize: 13 }}>{text}</Text></Pressable>;
  const submit = async () => {
    if (!current.shift || busy || !reason.trim() && !pending) return;
    const command = pending ?? { stationId, body: { expectedShiftId: current.shift.id, reason: reason.trim(), acknowledged: true as const, ...(target !== "self" ? { targetMembershipId: Number(target) } : {}) } };
    setPending(command); setBusy(true); setError("");
    try {
      await changeOverRequest(`/${command.stationId}/recover`, command.body);
      setPending(null); setReason(""); setTarget("self"); onChanged();
    } catch (cause) {
      if ([400, 401, 403, 404, 409].includes((cause as { status?: number }).status ?? 0)) setPending(null);
      setError(cause instanceof Error ? cause.message : t("changeOver.failed"));
    } finally { setBusy(false); }
  };
  return <View accessibilityLabel={t("changeOver.supervisor")} style={{ minWidth: 0, padding: 16, borderColor: primary, borderWidth: 2, borderRadius: 14, backgroundColor: "#242426", gap: 8 }}>
    <View style={{ flexDirection: "row", gap: 9, alignItems: "flex-start" }}><Feather name="shield" size={20} color={primary} /><View><Text accessibilityRole="header" style={{ color: "#ececec", fontSize: 17, fontWeight: "700" }}>{t("changeOver.supervisor")}</Text><Text style={{ color: "#b3b3b3", fontSize: 12 }}>{t("changeOver.gate")}</Text></View></View>
    <Text style={{ color: "#ececec", fontSize: 13 }}>{t("changeOver.recoverExplanation")}</Text>
    <TextInput accessibilityLabel={t("changeOver.reason")} placeholder={t("changeOver.reason")} placeholderTextColor="#a3a3a3" maxLength={2000} editable={!busy && !pending} value={reason} onChangeText={setReason} style={{ color: "#ececec", borderColor: primary, borderWidth: 1, borderRadius: 7, minHeight: 40, padding: 8 }} />
    <Text style={{ color: "#ececec", fontSize: 13 }}>{t("changeOver.recoveryReplacement")}</Text>
    {option(target === "self" ? t("changeOver.recoverySelf") : replacements.data?.operators.find(person => String(person.membershipId) === target)?.name ?? t("changeOver.recoveryReplacement"), () => setChoicesOpen(value => !value), busy || !!pending)}
    {choicesOpen && <View>{option(t("changeOver.recoverySelf"), () => { setTarget("self"); setChoicesOpen(false); })}{replacements.data?.operators.filter(person => person.userId !== current.shift?.operator_id && person.userId !== user?.id).map(person => <View key={person.membershipId}>{option(`${person.name} · ${person.companyName}`, () => { setTarget(String(person.membershipId)); setChoicesOpen(false); })}</View>)}</View>}
    {replacements.isError && <Text style={{ color: "#b3b3b3" }}>{t("changeOver.recoveryRosterUnavailable")}</Text>}
    <Text style={{ color: "#b3b3b3", fontSize: 12 }}>{t("changeOver.recoveryEffect")}</Text>
    {pending && <Text style={{ color: "#b3b3b3", fontSize: 12 }}>{t("changeOver.recoveryUnconfirmed")}</Text>}
    {!!error && <Text accessibilityRole="alert" style={{ color: "#f87171", fontSize: 12 }}>{error}</Text>}
    {option(t(pending ? "changeOver.recoveryRetry" : "changeOver.recover"), () => void submit(), busy || !pending && !reason.trim())}
  </View>;
}
