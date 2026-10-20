import React from "react";
import { Text, View, useWindowDimensions } from "react-native";
import { useQuery } from "@tanstack/react-query";
import {
  FleetComplianceScoreSchema,
  type FleetComplianceScore,
} from "@workspace/api-zod";

import TogglePillButton from "@/components/TogglePillButton";
import { useAuth } from "@/hooks/use-auth";
import { useColors } from "@/hooks/useColors";
import { apiFetch } from "@/lib/api";
import { useFleetCopy } from "@/lib/fleet-copy";

const categoryLabel: Record<FleetComplianceScore["categories"][number]["category"], string> = {
  vehicle: "Vehicles",
  driver_license: "Driver licenses",
  insurance: "Insurance",
  company_records: "Company records",
};

const statusColor = { green: "#15803D", amber: "#F59E0B", red: "#DC2626" } as const;

export default function FleetComplianceHelper({ onOpenRegisters }: { onOpenRegisters?: () => void }) {
  const colors = useColors();
  const copy = useFleetCopy();
  const { user, activeMembershipId } = useAuth();
  const { width } = useWindowDimensions();
  const score = useQuery({
    queryKey: ["fleet-compliance-score", user?.id, activeMembershipId],
    queryFn: async () => FleetComplianceScoreSchema.parse(await apiFetch<unknown>("/api/fleet/compliance-score")),
    enabled: !!user,
    retry: false,
  });
  const card = { borderWidth: 2, borderColor: colors.primary, backgroundColor: colors.card, borderRadius: 14, padding: 14, gap: 7 } as const;
  if (score.isLoading) return <Text style={{ color: colors.text }}>{copy("Loading compliance score…")}</Text>;
  if (score.isError || !score.data) return <View style={card} accessibilityRole="alert">
    <Text style={{ color: colors.destructive, fontWeight: "700" }}>{copy("Compliance service unavailable")}</Text>
    <Text style={{ color: colors.text }}>{copy("This is a technical outage. Dispatch, runs, and tickets remain available.")}</Text>
    <TogglePillButton color="blue" onPress={() => void score.refetch()}>{copy("Retry compliance score")}</TogglePillButton>
  </View>;
  const value = score.data;
  return <View style={{ gap: 12 }}>
    <View style={card} accessibilityLabel={copy(`VNDRLY compliance score ${value.score} out of 100`)}>
      <Text style={{ color: colors.text, fontWeight: "800", fontSize: 20 }}>{copy("VNDRLY compliance score")}</Text>
      <Text style={{ color: statusColor[value.status], fontWeight: "900", fontSize: 34 }}>● {value.score} / 100</Text>
      <Text style={{ color: colors.text }}>{copy("Advisory only. A low score never blocks VNDRLY work or tickets; Partners decide whom they hire.")}</Text>
      <Text style={{ color: colors.mutedForeground }}>{copy("Evaluated")} · {new Date(value.evaluatedAt).toLocaleString()}</Text>
    </View>
    <View style={{ flexDirection: width >= 768 ? "row" : "column", flexWrap: "wrap", gap: 10 }}>
      {value.categories.map((category) => <View key={category.category} style={{ ...card, flexGrow: 1, flexBasis: width >= 768 ? "45%" : undefined }}>
        <Text style={{ color: colors.text, fontWeight: "700" }}>{copy(categoryLabel[category.category])}</Text>
        <Text style={{ color: category.score >= 85 ? statusColor.green : category.score >= 60 ? statusColor.amber : statusColor.red, fontWeight: "800", fontSize: 22 }}>{category.score} / 100</Text>
      </View>)}
    </View>
    <View style={card}>
      <Text style={{ color: colors.text, fontWeight: "800", fontSize: 18 }}>{copy("Improvement queue")}</Text>
      {!value.deductions.length && <Text style={{ color: colors.text }}>{copy("No current score deductions.")}</Text>}
      {value.deductions.map((item, index) => <View key={item.id} accessibilityLabel={copy(`Priority ${index + 1}: ${item.reason}`)} style={{ borderTopWidth: index ? 1 : 0, borderColor: colors.border, paddingTop: index ? 10 : 0, gap: 3 }}>
        <Text style={{ color: item.urgency === "now" ? statusColor.red : item.urgency === "soon" ? statusColor.amber : colors.text, fontWeight: "700" }}>{copy(item.reason)}</Text>
        <Text style={{ color: colors.text }}>{copy("Estimated score gain")} +{item.estimatedImprovement}</Text>
        <Text style={{ color: colors.text }}>{copy(item.remediation)}</Text>
        <Text style={{ color: colors.mutedForeground }}>{copy("Responsible role")} · {copy(item.responsibleCapability)}{item.dueAt ? ` · ${copy("Due")} ${new Date(item.dueAt).toLocaleDateString()}` : ""}</Text>
      </View>)}
      {typeof value.estimatedResolvedScore === "number" && <Text style={{ color: colors.text, fontWeight: "700" }}>{copy("Estimated score after listed fixes")} · {value.estimatedResolvedScore} / 100</Text>}
    </View>
    <View style={card}>
      <Text style={{ color: colors.text, fontWeight: "800", fontSize: 18 }}>{copy("Score history")}</Text>
      {!value.history.length && <Text style={{ color: colors.mutedForeground }}>{copy("No prior score snapshots yet.")}</Text>}
      {value.history.slice(-12).map((item) => <Text key={item.at} style={{ color: colors.text }}>{new Date(item.at).toLocaleDateString()} · {item.score} / 100</Text>)}
    </View>
    <View style={card}>
      <Text style={{ color: colors.text, fontWeight: "800", fontSize: 18 }}>{copy("What Partners see")}</Text>
      <Text style={{ color: colors.text }}>{copy("Partners see the VNDRLY score, status, current reasons, ratings, rates, and work history when choosing a vendor.")}</Text>
      <Text style={{ color: colors.text }}>{copy("VNDRLY informs the decision. The Partner sets and enforces its own hiring policy.")}</Text>
    </View>
    {onOpenRegisters && <TogglePillButton color="blue" onPress={onOpenRegisters}>{copy("Open evidence and detailed registers")}</TogglePillButton>}
  </View>;
}
