import React from "react";
import { View, Text } from "react-native";
import { useTranslation } from "react-i18next";
import { useGateOperatingContext } from "@/hooks/use-gate-operating-context";
import { useColors } from "@/hooks/useColors";
import TogglePillButton from "./TogglePillButton";
export default function GateOperatingContext() {
  const c = useGateOperatingContext(),
    { t } = useTranslation(),
    colors = useColors();
  return (
    <View style={{ gap: 8 }}>
      <Text accessibilityRole="text" style={{ color: colors.foreground }}>
        {c.isError
          ? t("gateOperating.unavailable")
          : c.operating
            ? t("gateOperating.operating", {
                site: c.operating.siteName,
                gate: c.operating.gateName,
              })
            : t("gateOperating.noWatch")}
      </Text>
      {c.operating && (
        <TogglePillButton onPress={c.myGate}>
          {t("gateOperating.myGate")}
        </TogglePillButton>
      )}
    </View>
  );
}
