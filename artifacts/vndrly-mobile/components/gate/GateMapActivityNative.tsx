import React from "react";
import { Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { useColors } from "@/hooks/useColors";
import GateDashboardActivityCard from "./GateDashboardActivityCard";

type ActivityProps = React.ComponentProps<typeof GateDashboardActivityCard>;

export default function GateMapActivityNative({ mode, status, statusTone, snapshot, historyBaseHref, recordHistoryHrefs, showAllLogLink, onExpandedChange }: {
  mode: "metrics" | "fallback";
  status: string;
  statusTone: "normal" | "error";
  snapshot: ActivityProps["snapshot"];
  historyBaseHref: string;
  recordHistoryHrefs: NonNullable<ActivityProps["recordHistoryHrefs"]>;
  showAllLogLink: boolean;
  onExpandedChange: ActivityProps["onExpandedChange"];
}) {
  const { i18n } = useTranslation();
  const { primary } = useColors();
  const es = i18n.language?.startsWith("es");
  const statusText = status ? <Text accessibilityRole={statusTone === "error" ? "alert" : "text"} style={{ color: statusTone === "error" ? "#f87171" : "#b3b3b3", fontSize: 12, marginBottom: 5 }}>{status}</Text> : null;
  if (mode === "fallback") return <View accessibilityLabel={es ? "Actividad del acceso" : "Gate activity"} style={{ backgroundColor: "#242426", borderColor: primary, borderWidth: 2, borderRadius: 14, padding: 16 }}>
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 }}><Feather name="log-in" size={20} color={primary} /><Text accessibilityRole="header" style={{ color: "#ececec", fontSize: 17, fontWeight: "700" }}>{es ? "Actividad del acceso" : "Gate activity"}</Text></View>
    {statusText}
  </View>;
  return <View>{statusText}<GateDashboardActivityCard snapshot={snapshot} historyBaseHref={historyBaseHref} recordHistoryHrefs={recordHistoryHrefs} showAllLogLink={showAllLogLink} showSubtitle={false} onExpandedChange={onExpandedChange} /></View>;
}
