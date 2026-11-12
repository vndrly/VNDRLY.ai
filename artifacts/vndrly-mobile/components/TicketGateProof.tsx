import React from "react";
import { View, Text } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/hooks/use-auth";
import { useColors } from "@/hooks/useColors";
import { apiFetch } from "@/lib/api";
import AuthedImage from "./AuthedImage";
import type { TicketGateProof as Proof } from "@workspace/gate-booth";
export default function TicketGateProof({ ticketId }: { ticketId: number }) {
  const { user, activeMembershipId } = useAuth(),
    { t } = useTranslation(),
    c = useColors();
  const q = useQuery({
    queryKey: ["ticket-gate-proof", user?.id, activeMembershipId, ticketId],
    queryFn: () => apiFetch<Proof>("/api/tickets/" + ticketId + "/gate-proof"),
    retry: false,
  });
  return (
    <View
      style={{ gap: 10, padding: 12, borderWidth: 1, borderColor: c.primary }}
    >
      <Text style={{ color: c.foreground, fontWeight: "700" }}>
        {t("gateProof.title")}
      </Text>
      <Text style={{ color: c.foreground }}>
        {q.isError
          ? t("gateProof.unavailable")
          : q.isLoading
            ? t("common.loading")
            : !q.data?.visits.length
              ? t("gateProof.missing")
              : ""}
      </Text>
      {q.data?.visits.map((v) => (
        <View key={v.id} style={{ gap: 8 }}>
          <Text style={{ color: c.foreground }}>
            {v.siteName} / {v.gateName ?? t("gateProof.notRecorded")}
          </Text>
          <Text style={{ color: c.foreground }}>
            {t("gateProof.entry")}:{" "}
            {v.admissionStatus === "pending"
              ? t("gateProof.notRecorded")
              : new Date(v.checkInTime).toLocaleString()}{" "}
            · {t("gateProof.exit")}:{" "}
            {v.checkOutTime
              ? new Date(v.checkOutTime).toLocaleString()
              : t("gateProof.notRecorded")}
          </Text>
          {v.capture?.images.map((image) => (
            <AuthedImage
              key={image.objectPath}
              uri={"/api/storage" + image.originalPath}
              accessibilityLabel={t("gateProof.original")}
              style={{ height: 180, width: "100%" }}
              resizeMode="contain"
            />
          ))}
        </View>
      ))}
    </View>
  );
}
