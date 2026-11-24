import React, { useEffect, useState } from "react";
import { Text, TextInput, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { useColors } from "@/hooks/useColors";
import GateSiteGateSelect from "@/components/GateSiteGateSelect";
import GateLogExportNative, { type GateLogExportFilters } from "./GateLogExportNative";
import type { GateShiftNotesGate } from "./GateShiftNotesListNative";

export default function GateShiftNotesHeaderNative({ sites, gates, siteId, gateId, gateName, filters, search, onSelect, onSearch }: {
  sites: { id: number; name: string }[];
  gates: GateShiftNotesGate[];
  siteId: number;
  gateId: string;
  gateName: string;
  filters: GateLogExportFilters | null;
  search: string;
  onSelect: (gateId: string) => void;
  onSearch: (search: string) => void;
}) {
  const { i18n } = useTranslation();
  const { primary } = useColors();
  const es = i18n.language?.startsWith("es");
  const [searchDraft, setSearchDraft] = useState(search);
  useEffect(() => { setSearchDraft(search); }, [search]);
  return <View style={{ gap: 12 }}>
    <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}><Feather name="clipboard" size={20} color={primary} /><Text accessibilityRole="header" style={{ color: "#f4f4f4", fontWeight: "700", fontSize: 18 }}>{es ? "Notas de turno" : "Shift Notes"}</Text></View>
      <View style={{ minWidth: 190, flex: 1 }}><GateSiteGateSelect sites={sites} gateOptions={gates} siteId={siteId} gate={gateId ? { id: gateId, name: gateName } : undefined} allOptionLabel={es ? "Todos" : "All"} onChange={(_siteId, nextGateId) => onSelect(nextGateId)} /></View>
      <GateLogExportNative filters={filters} disabled={!filters} reportKind="shift_notes" title={es ? "Notas de turno" : "Shift Notes"} />
    </View>
    <TextInput accessibilityLabel={es ? "Buscar notas" : "Search notes"} placeholder={es ? "Buscar notas" : "Search notes"} placeholderTextColor="#aaa" value={searchDraft} onChangeText={value => { setSearchDraft(value); onSearch(value); }} style={{ minHeight: 40, borderWidth: 1, borderColor: primary, borderRadius: 8, paddingHorizontal: 12, color: "#f4f4f4" }} />
  </View>;
}
