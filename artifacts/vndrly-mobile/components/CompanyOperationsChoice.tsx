import React, { useEffect, useState } from "react";
import { View, Text } from "react-native";
import TogglePillButton from "./TogglePillButton";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/hooks/use-auth";
import { useColors } from "@/hooks/useColors";

export type CompanyOperations = { vendorId: number; categories: ("field" | "fleet" | "gate")[]; canManage: boolean };
export default function CompanyOperationsChoice() {
  const { user, activeMembershipId } = useAuth();
  const colors = useColors();
  const [current, setCurrent] = useState<CompanyOperations | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let alive = true;
    setCurrent(null);
    if (user?.vendorId) void apiFetch<CompanyOperations>("/api/company-operations").then(value => { if (alive && value.vendorId === user.vendorId) setCurrent(value); }).catch(cause => { if (alive) setError(cause.message); });
    return () => { alive = false; };
  }, [user?.vendorId, activeMembershipId]);
  if (!user?.vendorId) return null;
  if (!current) return <Text style={{ color: colors.foreground, padding: 16 }}>{error || "Loading company operations…"}</Text>;
  if (!current.canManage) return <Text style={{ color: colors.foreground, padding: 16 }}>Ask your company administrator to change its operations categories.</Text>;
  return <View style={{ gap: 10, padding: 16 }}>
    <Text style={{ color: colors.foreground, fontWeight: "700" }}>Company operations</Text>
    <Text style={{ color: colors.mutedForeground }}>Choose the workspaces for your company. Employees keep their individual permissions.</Text>
    {([ ["field", "Field Ops"], ["fleet", "Fleet Ops"], ["gate", "Gate Ops"] ] as const).map(([category, label]) => <TogglePillButton key={category} color="brand" solid={current.categories.includes(category)} accessibilityState={{ selected: current.categories.includes(category) }} disabled={busy} onPress={async () => {
      if (current.categories.length === 1 && current.categories.includes(category)) { setError("Choose another category before turning off the last one."); return; }
      setBusy(true); setError("");
      try { setCurrent(await apiFetch<CompanyOperations>("/api/company-operations", { method: "PATCH", body: JSON.stringify({ categories: current.categories.includes(category) ? current.categories.filter(value => value !== category) : [...current.categories, category] }) })); }
      catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to save company category."); }
      finally { setBusy(false); }
    }}>{current.categories.includes(category) ? `${label} · Selected` : label}</TogglePillButton>)}
    {error ? <Text style={{ color: colors.destructive }}>{error}</Text> : null}
  </View>;
}
