import React, { useState } from "react";
import { Linking, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { ModalPressable as Pressable } from "@/components/ModalDraft";
import { useColors } from "@/hooks/useColors";

export type MapStaffPerson = {
  userId: number;
  name: string;
  assignment: string;
  locationReason: string;
  onShift?: boolean;
  phone?: string | null;
  email?: string | null;
  location?: { latitude: number; longitude: number; capturedAt: string } | null;
  fresh?: boolean;
  demonstration?: boolean;
};
export type MapStaffGroup = { id: "watch" | "call" | "other"; title: string; people: MapStaffPerson[] };
type StaffSort = "name" | "nearest" | "first" | "latest";

export default function GateMapStaffLocationsCard({ groups, locationError, sort, onSort, onFocus, onExpandedChange }: {
  groups: MapStaffGroup[];
  locationError: string;
  sort: StaffSort;
  onSort: (sort: StaffSort) => void;
  onFocus: (userId: number) => void;
  onExpandedChange: (group: MapStaffGroup["id"], open: boolean) => void;
}) {
  const { i18n } = useTranslation();
  const { primary } = useColors();
  const es = i18n.language?.startsWith("es");
  const c = (en: string, spanish: string) => es ? spanish : en;
  const [open, setOpen] = useState<Record<string, boolean>>({ watch: true });
  const [sortOpen, setSortOpen] = useState(false);
  const text = { color: "#ececec", fontSize: 13 };
  const muted = { color: "#b3b3b3", fontSize: 12 };
  const sortOptions: { key: StaffSort; en: string; spanish: string }[] = [
    { key: "name", en: "Name", spanish: "Nombre" },
    { key: "nearest", en: "Nearest", spanish: "Más cercano" },
    { key: "first", en: "First on call", spanish: "Primero disponible" },
    { key: "latest", en: "Latest on call", spanish: "Último disponible" },
  ];
  const count = groups.reduce((total, group) => total + group.people.length, 0);
  return <View accessibilityLabel={c("Staff locations", "Ubicaciones del personal")} style={{ backgroundColor: "#242426", borderColor: primary, borderWidth: 2, borderRadius: 14, paddingHorizontal: 14, paddingTop: 12, paddingBottom: 4 }}>
    <View style={{ flexDirection: "row", alignItems: "center", gap: 9, paddingBottom: 10 }}><Feather name="users" size={19} color={primary} /><Text accessibilityRole="header" style={{ color: "#ececec", fontSize: 17, fontWeight: "700" }}>{c("Staff locations", "Ubicaciones del personal")}</Text></View>
    {groups.map(group => <View key={group.id} style={{ borderTopColor: "#3b3b3b", borderTopWidth: 1 }}>
      <View style={{ flexDirection: "row", alignItems: "center", minHeight: 42, gap: 8 }}>
        <Pressable accessibilityRole="button" accessibilityLabel={group.title} accessibilityState={{ expanded: !!open[group.id] }} onPress={() => { const next = !open[group.id]; setOpen(value => ({ ...value, [group.id]: next })); onExpandedChange(group.id, next); }} style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 8, minHeight: 42 }}>
          <Feather name={group.id === "watch" ? "shield" : group.id === "call" ? "phone" : "users"} size={18} color={primary} /><Text style={[text, { flex: 1, fontWeight: "600" }]}>{group.title}</Text>
        </Pressable>
        {group.id === "call" && <Pressable accessibilityRole="button" accessibilityLabel={c("Sort On Call", "Ordenar disponibles")} accessibilityState={{ expanded: sortOpen }} onPress={() => setSortOpen(value => !value)} style={{ paddingVertical: 7, flexDirection: "row", alignItems: "center", gap: 4 }}><Text style={{ color: primary, fontSize: 12 }}>{sortOptions.find(option => option.key === sort)?.[es ? "spanish" : "en"]}</Text><Feather name="chevron-down" size={13} color={primary} /></Pressable>}
        <Text style={muted}>{group.people.length}</Text><Feather name={open[group.id] ? "chevron-down" : "chevron-right"} size={16} color="#aaa" />
      </View>
      {group.id === "call" && sortOpen && <View style={{ paddingLeft: 26 }}>{sortOptions.map(option => <Pressable key={option.key} accessibilityRole="button" accessibilityLabel={c(option.en, option.spanish)} onPress={() => { onSort(option.key); setSortOpen(false); }} style={{ paddingVertical: 6 }}><Text style={{ color: option.key === sort ? primary : "#ececec", fontSize: 12 }}>{c(option.en, option.spanish)}</Text></Pressable>)}</View>}
      {open[group.id] && <View style={{ paddingLeft: 26, paddingBottom: 8 }}>
        {group.id === "call" && !!locationError && <Text accessibilityRole="alert" style={muted}>{locationError}</Text>}
        {group.people.map(person => <View key={person.userId} style={{ paddingVertical: 8, borderTopColor: "#383838", borderTopWidth: 1, gap: 3 }}>
          <Pressable accessibilityRole="button" accessibilityLabel={`${c("Show location for", "Mostrar ubicación de")} ${person.name}`} disabled={!person.location || !person.fresh && !person.demonstration} onPress={() => onFocus(person.userId)} style={{ opacity: person.location && (person.fresh || person.demonstration) ? 1 : 0.7 }}><Text style={[text, { fontWeight: "700" }]}>{person.name}</Text><Text style={muted}>{person.assignment} · {person.locationReason.replaceAll("_", " ")}{group.id === "call" && person.location ? ` · ${new Date(person.location.capturedAt).toLocaleString()}` : ""}</Text></Pressable>
          {group.id === "call" && <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}><Pressable accessibilityRole="link" disabled={!person.phone} onPress={() => void Linking.openURL(`tel:${person.phone?.replace(/[^+0-9]/g, "")}`)}><Text style={person.phone ? { color: primary, fontSize: 12 } : muted}>{person.phone ?? c("No phone", "Sin teléfono")}</Text></Pressable><Pressable accessibilityRole="link" disabled={!person.email} onPress={() => void Linking.openURL(`mailto:${person.email}`)}><Text style={person.email ? { color: primary, fontSize: 12 } : muted}>{person.email ?? c("No email", "Sin correo")}</Text></Pressable></View>}
        </View>)}
        {!group.people.length && <Text style={muted}>{c("No employees", "Ningún empleado")}</Text>}
      </View>}
    </View>)}
    {!count && <Text style={[muted, { paddingBottom: 8 }]}>{c("No app-enabled employees returned.", "No se devolvieron empleados con la app.")}</Text>}
  </View>;
}
