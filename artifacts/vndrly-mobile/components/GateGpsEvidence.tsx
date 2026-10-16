import React from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useColors } from "@/hooks/useColors";

/** Show recorded server evidence without treating absent legacy evidence as a match. */
export default function GateGpsEvidence({ row }: { row: Record<string, unknown> }) {
  const { t } = useTranslation();
  const colors = useColors();
  return <View style={{ gap: 4 }}>{(["checkInGpsEvidence", "checkOutGpsEvidence"] as const).map(key => {
    const value = row[key];
    if (!value || typeof value !== "object") return null;
    const evidence = value as Record<string, unknown>;
    const status = ["verified", "mismatch", "unavailable", "gate_unconfigured"].includes(String(evidence.status)) ? String(evidence.status) : "unavailable";
    return <Text key={key} testID={`gps-${key}`} style={{ color: status === "verified" ? colors.foreground : colors.primary, fontSize: 12 }}>
      {t(key === "checkInGpsEvidence" ? "gatekeeper.gpsEntry" : "gatekeeper.gpsExit")}: {t(`gatekeeper.gpsEvidence.${status}`)}{typeof evidence.gateName === "string" ? ` · ${evidence.gateName}` : ""}{typeof evidence.distanceMeters === "number" && Number.isFinite(evidence.distanceMeters) ? ` · ${evidence.distanceMeters} m` : ""}
    </Text>;
  })}</View>;
}
