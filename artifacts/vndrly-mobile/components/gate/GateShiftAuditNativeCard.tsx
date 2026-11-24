import React from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useColors } from "@/hooks/useColors";

export type ShiftAuditAction = { id: string; actor_name: string; text: string; kind: string; created_at: string };

export default function GateShiftAuditNativeCard({ actions }: { actions: ShiftAuditAction[] }) {
  const { t } = useTranslation();
  const { primary } = useColors();
  return <View accessibilityLabel={t("changeOver.audit")} style={{ backgroundColor: "#242426", borderColor: primary, borderWidth: 2, borderRadius: 14, padding: 16, gap: 8 }}>
    <Text accessibilityRole="header" style={{ color: "#ececec", fontSize: 16, fontWeight: "700" }}>{t("changeOver.audit")}</Text>
    {actions.map(action => <Text key={action.id} style={{ color: "#ececec", fontSize: 13, lineHeight: 19 }}>{new Date(action.created_at).toLocaleString()} · {action.actor_name} · {action.kind}: {action.text}</Text>)}
  </View>;
}
