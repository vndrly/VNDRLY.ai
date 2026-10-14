import { useTranslation } from "react-i18next";
import React from "react";
import { View, Text } from "react-native";
import { useColors } from "@/hooks/useColors";
import TogglePillButton from "./TogglePillButton";
export default function MeetingWaitingRoom({
  requests,
  busy,
  onDecision,
}: {
  requests: {
    userId: number;
    name: string;
    requestedAt: string;
  }[];
  busy: boolean;
  onDecision: (userId: number, decision: "admit" | "decline") => void;
}) {
  const { t } = useTranslation();
  const colors = useColors();
  return (
    <View style={{ gap: 12 }}>
      <Text style={{ color: colors.text, fontSize: 20, fontWeight: "700" }}>
        {t("liveMeetings.waiting", { defaultValue: "Waiting room \u00B7 " })}
        {requests.length}
      </Text>
      {!requests.length && (
        <Text style={{ color: colors.mutedForeground }}>
          {t("liveMeetings.noRequests", {
            defaultValue: "No pending requests.",
          })}
        </Text>
      )}
      {requests.map((r) => (
        <View
          key={r.userId}
          style={{
            borderWidth: 2,
            borderColor: colors.primary,
            borderRadius: 12,
            padding: 12,
            gap: 8,
          }}
        >
          <Text style={{ color: colors.text, fontWeight: "700" }}>
            {r.name}
          </Text>
          <Text style={{ color: colors.mutedForeground }}>
            {t("liveMeetings.requested", { defaultValue: "Requested " })}
            {new Date(r.requestedAt).toLocaleTimeString()}
          </Text>
          <View style={{ flexDirection: "row", gap: 8 }}>
            <TogglePillButton
              color="brand"
              disabled={busy}
              onPress={() => onDecision(r.userId, "admit")}
            >
              {t("liveMeetings.admit", { defaultValue: "Admit" })}
            </TogglePillButton>
            <TogglePillButton
              color="brand"
              disabled={busy}
              onPress={() => onDecision(r.userId, "decline")}
            >
              {t("liveMeetings.decline", { defaultValue: "Decline" })}
            </TogglePillButton>
          </View>
        </View>
      ))}
    </View>
  );
}
