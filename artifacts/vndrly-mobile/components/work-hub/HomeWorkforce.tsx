import React, { useState } from "react";
import { Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { WorkforceRosterSchema } from "@workspace/api-zod";
import { useAuth } from "@/hooks/use-auth";
import { useColors } from "@/hooks/useColors";
import { useGateCopy } from "@/components/gate/GateChrome";
import { apiFetch } from "@/lib/api";
import { ModalPressable as Pressable } from "@/components/ModalDraft";

type Gap = { id: string; shiftTitle: string; assignedCount: number; requiredCount: number; state: string };
type Icon = React.ComponentProps<typeof Feather>["name"];

export default function HomeWorkforce() {
  const { user, activeMembershipId } = useAuth();
  const { primary } = useColors();
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const c = useGateCopy();
  const identity = [user?.id, activeMembershipId, user?.vendorId, user?.partnerId];
  const headers = {
    "X-VNDRLY-Actor-User": String(user?.id ?? ""),
    "X-VNDRLY-Vendor": String(user?.vendorId ?? ""),
    "X-VNDRLY-Membership": String(activeMembershipId ?? 0),
  };
  const roster = useQuery({
    queryKey: ["work-hub", "workforce-roster", ...identity],
    queryFn: async () => {
      const result = WorkforceRosterSchema.parse(await apiFetch("/api/work-hub/workforce/roster", { headers }));
      if (result.owner.id !== user?.vendorId) throw Error("workforce.context_changed");
      return result;
    },
    enabled: !!user?.vendorId,
    retry: false,
    refetchInterval: 15000,
  });
  const gaps = useQuery({
    queryKey: ["work-hub", "workforce-gaps", ...identity],
    queryFn: async () => {
      const data = await apiFetch<{ coverage: Gap[] }>("/api/implementation-a/workforce/coverage", { headers });
      return data.coverage.filter(gap => gap.state !== "covered" && gap.assignedCount < gap.requiredCount);
    },
    enabled: !!user?.vendorId,
    retry: false,
    refetchInterval: 30000,
  });
  const staff = roster.data?.employees;
  const onShift = staff?.filter(person => person.onShift === true);
  const onCall = staff?.filter(person => person.onCall === "active");
  const unavailable = staff?.filter(person => person.onCall === "inactive");
  const missing = c("Unavailable", "No disponible");
  const rows: { key: string; icon: Icon; label: string; value: string; items: { key: string; title: string; detail: string }[]; empty: string }[] = [
    { key: "coverage", icon: "alert-triangle", label: c("Coverage Gaps", "Brechas de cobertura"), value: gaps.data ? `${gaps.data.length} ${c("open", "abiertas")}` : missing, items: (gaps.data ?? []).map(gap => ({ key: gap.id, title: gap.shiftTitle, detail: `${gap.assignedCount} / ${gap.requiredCount} ${c("assigned", "asignados")}` })), empty: gaps.isError ? missing : c("No open coverage gaps.", "No hay brechas de cobertura abiertas.") },
    { key: "shift", icon: "user-check", label: c("On Shift Now", "En turno ahora"), value: onShift ? `${onShift.length} ${c("on shift", "en turno")}` : missing, items: (onShift ?? []).map(person => ({ key: String(person.userId), title: person.name, detail: person.assignment ?? c("On shift", "En turno") })), empty: roster.isError ? missing : c("No one is on shift now.", "No hay nadie en turno ahora.") },
    { key: "call", icon: "bell", label: c("On Call", "Guardia"), value: onCall && unavailable ? `${onCall.length} ${c("on call", "de guardia")} · ${unavailable.length} ${c("unavailable", "no disponibles")}` : missing, items: [...(onCall ?? []).map(person => ({ key: `active:${person.userId}`, title: person.name, detail: c("On call", "De guardia") })), ...(unavailable ?? []).map(person => ({ key: `inactive:${person.userId}`, title: person.name, detail: c("Unavailable", "No disponible") }))], empty: roster.isError ? missing : c("No on-call records.", "No hay registros de guardia.") },
  ];

  return <View accessibilityLabel="Shifts" style={{ backgroundColor: "#242426", borderColor: primary, borderWidth: 2, borderRadius: 16, paddingHorizontal: 16, paddingTop: 16 }}>
    <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 8, paddingBottom: 12 }}>
      <Feather name="users" size={20} color={primary} />
      <View style={{ flex: 1 }}>
        <Text accessibilityRole="header" style={{ color: "#ececec", fontFamily: "Inter_700Bold", fontSize: 20, lineHeight: 24, fontWeight: "700" }}>Shifts</Text>
        <Text style={{ color: "#a3a3a3", fontSize: 12, marginTop: 2 }}>A shift is a ticketed work product assignment.</Text>
      </View>
    </View>
    {rows.map(row => <React.Fragment key={row.key}><Pressable accessibilityRole="button" accessibilityLabel={row.label} accessibilityState={{ expanded: expandedRow === row.key }} onPress={() => setExpandedRow(current => current === row.key ? null : row.key)} style={{ minHeight: 44, borderTopWidth: 1, borderTopColor: "#3a3a3a", flexDirection: "row", alignItems: "center", gap: 11, paddingVertical: 10 }}>
      <Feather name={row.icon} size={19} color={primary} />
      <Text style={{ color: "#ececec", fontSize: 15, fontWeight: "600", flex: 1 }}>{row.label}</Text>
      <Text style={{ color: "#b3b3b3", fontSize: 13, textAlign: "right", maxWidth: "45%" }}>{row.value}</Text>
      <Feather name="chevron-right" size={18} color="#a3a3a3" style={expandedRow === row.key ? { transform: [{ rotate: "90deg" }] } : undefined} />
    </Pressable>{expandedRow === row.key ? <View style={{ paddingLeft: 30, paddingBottom: 8 }}>
      {row.items.length ? row.items.map(item => <View key={item.key} style={{ borderTopWidth: 1, borderTopColor: "#3a3a3a", paddingVertical: 9 }}><Text style={{ color: "#ececec", fontSize: 14, fontWeight: "600" }}>{item.title}</Text><Text style={{ color: "#b3b3b3", fontSize: 12 }}>{item.detail}</Text></View>) : <Text style={{ color: "#b3b3b3", paddingVertical: 9 }}>{row.empty}</Text>}
    </View> : null}</React.Fragment>)}
  </View>;
}
