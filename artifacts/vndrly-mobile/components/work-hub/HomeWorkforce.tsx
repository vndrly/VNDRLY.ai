import React from "react";
import { Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { WorkforceRosterSchema } from "@workspace/api-zod";
import { useAuth } from "@/hooks/use-auth";
import { useColors } from "@/hooks/useColors";
import { useGateCopy } from "@/components/gate/GateChrome";
import { apiFetch } from "@/lib/api";

type Gap = { assignedCount: number; requiredCount: number; state: string };
type Icon = React.ComponentProps<typeof Feather>["name"];

export default function HomeWorkforce() {
  const { user, activeMembershipId } = useAuth();
  const { primary } = useColors();
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
  const rows: { key: string; icon: Icon; label: string; value: string }[] = [
    { key: "coverage", icon: "alert-triangle", label: c("Coverage Gaps", "Brechas de cobertura"), value: gaps.data ? `${gaps.data.length} ${c("open", "abiertas")}` : missing },
    { key: "shift", icon: "user-check", label: c("On Shift Now", "En turno ahora"), value: onShift ? `${onShift.length} ${c("on shift", "en turno")}` : missing },
    { key: "call", icon: "bell", label: c("On Call", "Guardia"), value: onCall && unavailable ? `${onCall.length} ${c("on call", "de guardia")} · ${unavailable.length} ${c("unavailable", "no disponibles")}` : missing },
  ];

  return <View accessibilityLabel="Shifts" style={{ backgroundColor: "#242426", borderColor: primary, borderWidth: 2, borderRadius: 16, paddingHorizontal: 16, paddingTop: 16 }}>
    <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 8, paddingBottom: 12 }}>
      <Feather name="users" size={20} color={primary} />
      <View style={{ flex: 1 }}>
        <Text accessibilityRole="header" style={{ color: "#ececec", fontSize: 19, fontWeight: "700" }}>Shifts</Text>
        <Text style={{ color: "#a3a3a3", fontSize: 12, marginTop: 2 }}>A shift is a ticketed work product assignment.</Text>
      </View>
    </View>
    {rows.map(row => <View key={row.key} style={{ minHeight: 44, borderTopWidth: 1, borderTopColor: "#3a3a3a", flexDirection: "row", alignItems: "center", gap: 11, paddingVertical: 10 }}>
      <Feather name={row.icon} size={19} color={primary} />
      <Text style={{ color: "#ececec", fontSize: 15, fontWeight: "600", flex: 1 }}>{row.label}</Text>
      <Text style={{ color: "#b3b3b3", fontSize: 13, textAlign: "right", maxWidth: "45%" }}>{row.value}</Text>
    </View>)}
  </View>;
}
