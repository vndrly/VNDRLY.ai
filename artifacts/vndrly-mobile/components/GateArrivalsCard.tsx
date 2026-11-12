import React, { useEffect, useState } from "react";
import { View, Text } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { GateArrival } from "@workspace/api-zod";
import { useAuth } from "@/hooks/use-auth";
import { useColors } from "@/hooks/useColors";
import { gateArrivalsApi } from "@/lib/gate-arrivals-api";
import TogglePillButton from "./TogglePillButton";
export default function GateArrivalsCard({
  siteId,
  onReview,
}: {
  siteId: number | null;
  onReview: (arrival: GateArrival) => void;
}) {
  const { user, activeMembershipId } = useAuth(),
    { t } = useTranslation(),
    colors = useColors();
  const [page, setPage] = useState(0);
  useEffect(() => setPage(0), [siteId, activeMembershipId]);
  const q = useQuery({
    queryKey: ["gate-arrivals", user?.id, activeMembershipId, siteId],
    queryFn: () => gateArrivalsApi.list(siteId!),
    enabled: !!siteId,
    refetchInterval: 15000,
    retry: false,
  });
  const rows = q.data?.arrivals ?? [],
    last = Math.max(0, Math.ceil(rows.length / 25) - 1),
    current = Math.min(page, last);
  return (
    <View
      style={{
        gap: 10,
        padding: 12,
        borderWidth: 1,
        borderColor: colors.primary,
      }}
    >
      <Text style={{ color: colors.foreground, fontWeight: "700" }}>
        {t("gateArrivalReview.title")}
      </Text>
      {q.isError ? (
        <Text accessibilityRole="alert" style={{ color: colors.foreground }}>
          {t("gateArrivalReview.failed")}
        </Text>
      ) : q.isLoading ? (
        <Text style={{ color: colors.foreground }}>{t("common.loading")}</Text>
      ) : rows.length === 0 ? (
        <Text style={{ color: colors.foreground }}>
          {t("gateArrivalReview.empty")}
        </Text>
      ) : (
        rows.slice(current * 25, (current + 1) * 25).map((row) => (
          <View key={row.id} style={{ gap: 5 }}>
            <Text style={{ color: colors.foreground }}>
              {row.driverName} · {row.companyName} · {row.vehicleLabel}
            </Text>
            <Text style={{ color: colors.foreground }}>
              {row.destinationName} · #{row.ticketNumber}
            </Text>
            <TogglePillButton onPress={() => onReview(row)}>
              {t("gateArrivalReview.review")}
            </TogglePillButton>
          </View>
        ))
      )}
      {rows.length > 25 && (
        <View style={{ flexDirection: "row", gap: 10 }}>
          <TogglePillButton
            disabled={current === 0}
            onPress={() => setPage(current - 1)}
          >
            {t("common.previous", { defaultValue: "Previous" })}
          </TogglePillButton>
          <Text style={{ color: colors.foreground }}>
            {current * 25 + 1}-{Math.min((current + 1) * 25, rows.length)} /{" "}
            {rows.length}
          </Text>
          <TogglePillButton
            disabled={current === last}
            onPress={() => setPage(current + 1)}
          >
            {t("common.next", { defaultValue: "Next" })}
          </TogglePillButton>
        </View>
      )}
      {q.data?.truncated && (
        <Text style={{ color: colors.foreground }}>
          {t("gateArrivalReview.truncated")}
        </Text>
      )}
    </View>
  );
}
