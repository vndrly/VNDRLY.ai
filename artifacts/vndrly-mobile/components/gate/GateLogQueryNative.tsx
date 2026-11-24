import React, { useEffect, useState } from "react";
import { ScrollView, Text, TextInput, View, useWindowDimensions } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { ModalPressable as Pressable } from "@/components/ModalDraft";
import DismissibleModal from "@/components/DismissibleModal";
import { useColors } from "@/hooks/useColors";

export type GateLogQuery = {
  search: string;
  range: string;
  recordType: string;
  recordTypeDisabled: boolean;
  customWindow: string | null;
};

const ranges = [
  ["current_shift", "Current shift"], ["previous_shift", "Previous shift"], ["24h", "Last 24 hours"],
  ["7d", "7 days"], ["14d", "14 days"], ["30d", "30 days"], ["90d", "90 days"], ["1y", "1 year"],
] as const;
const types = [
  ["all", "All records"], ["check_ins", "Check-ins"], ["check_outs", "Check-outs"],
  ["visitors_on_site", "Visitors on site"], ["employees_on_site", "Employees on site"],
  ["vehicles_on_site", "Vehicles on site"], ["pending", "Pending admission"], ["needs_review", "Needs review"],
  ["on_site", "On site"], ["arrivals", "Incoming arrivals"],
] as const;

export default function GateLogQueryNative({ query, onChange }: { query: GateLogQuery; onChange: (field: "search" | "range" | "recordType", value: string) => void }) {
  const { t } = useTranslation();
  const { primary } = useColors();
  const { width } = useWindowDimensions();
  const [search, setSearch] = useState(query.search);
  const [choosing, setChoosing] = useState<"range" | "recordType" | null>(null);
  useEffect(() => { setSearch(query.search); }, [query.search]);
  const options = choosing === "range" ? [...(query.customWindow ? [["custom", "Requested time window"] as const] : []), ...ranges] : types;
  const selection = choosing === "range" ? query.range : query.recordType;
  const row = width >= 900;
  const fieldStyle = { backgroundColor: "#2d2f33", borderColor: primary, borderWidth: 1, borderRadius: 8, minHeight: 40, paddingHorizontal: 11, justifyContent: "center" as const };
  const buttonLabel = (field: "range" | "recordType") => {
    const choices = field === "range" ? ranges : types;
    return choices.find(([key]) => key === query[field])?.[1] ?? (field === "range" && query.range === "custom" ? "Requested time window" : query[field]);
  };
  return <>
    <View style={{ flexDirection: row ? "row" : "column", gap: 10, alignItems: row ? "center" : "stretch" }}>
      <View style={{ ...fieldStyle, flex: row ? 1 : undefined, flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Feather name="search" size={17} color="#a3a3a3" />
        <TextInput accessibilityLabel={t("gatekeeper.historySearch")} placeholder={t("gatekeeper.historySearch")} placeholderTextColor="#a3a3a3" value={search} onChangeText={value => { setSearch(value); onChange("search", value); }} style={{ flex: 1, color: "#ececec", fontSize: 14, paddingVertical: 7 }} />
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel="History range" onPress={() => setChoosing("range")} style={{ ...fieldStyle, minWidth: row ? 170 : undefined }}><Text style={{ color: "#ececec", fontSize: 14 }}>{buttonLabel("range")} ▾</Text></Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="Record type" disabled={query.recordTypeDisabled} onPress={() => setChoosing("recordType")} style={{ ...fieldStyle, minWidth: row ? 180 : undefined, opacity: query.recordTypeDisabled ? 0.55 : 1 }}><Text style={{ color: "#ececec", fontSize: 14 }}>{buttonLabel("recordType")} ▾</Text></Pressable>
    </View>
    {!!query.customWindow && <Text style={{ color: "#b3b3b3", fontSize: 12, marginTop: 5 }}>{query.customWindow}</Text>}
    <DismissibleModal visible={choosing !== null} onRequestClose={() => setChoosing(null)}>
      <View style={{ flex: 1, backgroundColor: "#242426", padding: 20, gap: 4 }}>
        <Text accessibilityRole="header" style={{ color: "#ececec", fontSize: 18, fontWeight: "700", marginBottom: 8 }}>{choosing === "range" ? "History range" : "Record type"}</Text>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 12 }}>
          {options.map(([value, label]) => <Pressable key={value} accessibilityRole="button" accessibilityState={{ selected: selection === value }} onPress={() => { if (choosing) onChange(choosing, value); setChoosing(null); }} style={{ minHeight: 44, justifyContent: "center", borderBottomWidth: 1, borderBottomColor: "#3a3a3a" }}><Text style={{ color: selection === value ? primary : "#ececec", fontSize: 15 }}>{label}</Text></Pressable>)}
        </ScrollView>
      </View>
    </DismissibleModal>
  </>;
}
