import React, { useMemo } from "react";
import { Text, View } from "react-native";
import { askVRevenueComparison, type AskVRevenueCall } from "@/lib/askv-revenue-visual";

export default function AskVRevenueChart({ calls, color }: { calls?: AskVRevenueCall[]; color: string }) {
  const comparison = useMemo(() => askVRevenueComparison(calls), [calls]);
  if (!comparison) return null;
  const money = (value: number) => new Intl.NumberFormat(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(value);
  const bars = (previous: number, current: number) => <View style={{ gap: 3, flex: 1 }}>
    <View style={{ height: 7, borderRadius: 4, backgroundColor: "#55565a" }}><View style={{ width: `${previous / Math.max(1, previous, current) * 100}%`, height: 7, borderRadius: 4, backgroundColor: "#a3a3a3" }} /></View>
    <View style={{ height: 7, borderRadius: 4, backgroundColor: "#55565a" }}><View style={{ width: `${current / Math.max(1, previous, current) * 100}%`, height: 7, borderRadius: 4, backgroundColor: color }} /></View>
  </View>;
  return <View accessibilityRole="summary" accessibilityLabel={`${comparison.title}, ${comparison.years[0]} compared with ${comparison.years[1]}`} style={{ marginTop: 10, padding: 12, borderColor: color, borderWidth: 1, borderRadius: 10, gap: 10, backgroundColor: "#242426" }} testID="askv-revenue-comparison">
    <Text style={{ color: "#eee", fontWeight: "700" }}>{comparison.title}</Text>
    <Text style={{ color: "#b3b3b3", fontSize: 12 }}>{comparison.years[0]} (complete) · {comparison.years[1]} (year to date)</Text>
    <View style={{ flexDirection: "row", gap: 10, alignItems: "center" }}><Text style={{ color: "#eee", width: 78, fontSize: 12 }}>Total</Text>{bars(comparison.totals[0], comparison.totals[1])}</View>
    <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 8 }}><Text style={{ color: "#b3b3b3", fontSize: 12 }}>{comparison.years[0]}: {money(comparison.totals[0])}</Text><Text style={{ color: "#eee", fontSize: 12 }}>{comparison.years[1]}: {money(comparison.totals[1])}</Text></View>
    {comparison.rows.map(row => <View key={row.label} style={{ gap: 3 }}>
      <Text style={{ color: "#eee", fontSize: 12 }}>{row.label}</Text>
      <View style={{ flexDirection: "row", gap: 10, alignItems: "center" }}>{bars(row.previous, row.current)}</View>
      <Text style={{ color: "#b3b3b3", fontSize: 11 }}>{comparison.years[0]} {money(row.previous)} · {comparison.years[1]} {money(row.current)}</Text>
    </View>)}
    {!comparison.rows.length && <Text style={{ color: "#b3b3b3" }}>No billed amounts in either period.</Text>}
  </View>;
}
