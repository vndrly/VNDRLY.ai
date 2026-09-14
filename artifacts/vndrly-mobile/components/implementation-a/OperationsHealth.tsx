import React from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useColors } from "@/hooks/useColors";
import { EmptyState, ImplementationASurface } from "./Surface";

export type MobileOperationsHealth = {
  status: "healthy" | "attention_required";
  signals: {
    offlineBacklog: number;
    terminalConflicts: number;
    permissionDenials: number;
    staleLocations: number;
    failedAlerts: number;
    unhealthyDisplays: number;
    missingSafetyChain: boolean;
    transcriptionAvailable: boolean;
  };
};

export function OperationsHealth({ health, admin }: { health?: MobileOperationsHealth; admin: boolean }) {
  const { t } = useTranslation();
  const colors = useColors();
  const title = t("implementationAOperations.title");
  if (!admin) return <View accessibilityLabel={title}><ImplementationASurface description={t("implementationAOperations.description")}><EmptyState>{t("implementationAOperations.adminOnly")}</EmptyState></ImplementationASurface></View>;
  const status = health?.status === "healthy" ? t("implementationAOperations.healthy") : health ? t("implementationAOperations.attention") : t("implementationAOperations.checking");
  const signals = health ? [
    [t("implementationAOperations.offlineBacklog", { count: health.signals.offlineBacklog }), health.signals.offlineBacklog > 0],
    [t("implementationAOperations.terminalConflicts", { count: health.signals.terminalConflicts }), health.signals.terminalConflicts > 0],
    [t("implementationAOperations.permissionDenials", { count: health.signals.permissionDenials }), health.signals.permissionDenials > 0],
    [t("implementationAOperations.staleLocations", { count: health.signals.staleLocations }), health.signals.staleLocations > 0],
    [t("implementationAOperations.failedAlerts", { count: health.signals.failedAlerts }), health.signals.failedAlerts > 0],
    [t("implementationAOperations.unhealthyDisplays", { count: health.signals.unhealthyDisplays }), health.signals.unhealthyDisplays > 0],
    [t("implementationAOperations.transcription", { state: health.signals.transcriptionAvailable ? t("implementationAOperations.available") : t("implementationAOperations.unavailableState") }), !health.signals.transcriptionAvailable],
    [t("implementationAOperations.safetyChain", { state: health.signals.missingSafetyChain ? t("implementationAOperations.missing") : t("implementationAOperations.configured") }), health.signals.missingSafetyChain],
  ] as const : [];
  return <ImplementationASurface description={t("implementationAOperations.description")}>
    <Text accessibilityLiveRegion="polite" style={{ color: colors.text, fontWeight: "700", fontSize: 17 }}>{status}</Text>
    <View accessibilityLabel={t("implementationAOperations.signalList")} style={{ gap: 10 }}>
      {signals.map(([label, attention]) => <View key={label} accessible accessibilityLabel={`${attention ? "Attention" : "OK"}. ${label}`} style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: 14 }}><Text style={{ color: colors.text }}><Text style={{ fontWeight: "700" }}>{attention ? "Attention: " : "OK: "}</Text>{label}</Text></View>)}
    </View>
  </ImplementationASurface>;
}
