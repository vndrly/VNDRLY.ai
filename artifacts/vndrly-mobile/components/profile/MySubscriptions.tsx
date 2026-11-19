import React, { useState } from "react";
import { Text, View } from "react-native";
import type { EmployeeSubscription } from "@workspace/api-zod";
import { useGateQuery } from "@/hooks/use-gate-query";
import { GateRow, useGateCopy } from "@/components/gate/GateChrome";
import { ModalPressable as Pressable } from "@/components/ModalDraft";
import { useColors } from "@/hooks/useColors";

export default function MySubscriptions() {
  const [open, setOpen] = useState(false), c = useGateCopy(), colors = useColors();
  const query = useGateQuery<{ subscriptions: EmployeeSubscription[] }>("/api/implementation-a/subscriptions/mine", open);
  const intervals = { week: c("week", "semana"), month: c("month", "mes"), quarter: c("quarter", "trimestre"), year: c("year", "año"), one_time: c("one-time", "único") };
  return <>
    <GateRow label={c("My subscriptions", "Mis suscripciones")} icon="credit-card" expanded={open} onPress={() => setOpen(!open)} />
    {open && <View style={{ paddingVertical: 4 }}>
      {query.isPending ? <Text accessibilityRole="text" style={{ color: colors.mutedForeground }}>{c("Loading subscriptions…", "Cargando suscripciones…")}</Text>
        : query.isError ? <Pressable accessibilityRole="button" onPress={() => void query.refetch()}><Text style={{ color: colors.text }}>{c("Could not load subscriptions. Tap to retry.", "No se pudieron cargar las suscripciones. Toque para reintentar.")}</Text></Pressable>
        : query.data?.subscriptions.length ? query.data.subscriptions.map(row => <View key={row.id} style={{ minHeight: 44, paddingVertical: 4, borderBottomWidth: 1, borderBottomColor: colors.border }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
            <Text numberOfLines={1} style={{ flex: 1, color: colors.text, fontWeight: "600", fontSize: 14, lineHeight: 18 }}>{row.name}</Text>
            <Text style={{ color: colors.text, fontSize: 12, lineHeight: 18 }}>{new Intl.NumberFormat(undefined, { style: "currency", currency: row.currency }).format(row.amountCents / 100)} / {intervals[row.billingInterval]}</Text>
          </View>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
            <Text numberOfLines={1} style={{ flex: 1, color: colors.mutedForeground, fontSize: 12, lineHeight: 18 }}>{[row.purpose, row.companyName].filter(Boolean).join(" · ")}</Text>
            <Text style={{ color: colors.mutedForeground, fontSize: 12, lineHeight: 18 }}>{row.status === "active" ? c("Active", "Activa") : row.status === "paused" ? c("Paused", "Pausada") : c("Cancelled", "Cancelada")}</Text>
          </View>
        </View>) : <Text style={{ color: colors.mutedForeground }}>{c("No subscriptions are assigned to you.", "No tiene suscripciones asignadas.")}</Text>}
    </View>}
  </>;
}
