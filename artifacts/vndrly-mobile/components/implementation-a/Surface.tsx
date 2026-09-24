import React from "react";
import { Text, View } from "react-native";
import { useColors } from "@/hooks/useColors";

export function ImplementationASurface({ description, children }: { description: string; children: React.ReactNode }) {
  const colors = useColors();
  return <View style={{ borderWidth: 2, borderColor: colors.primary, borderRadius: 14, padding: 16, gap: 12, backgroundColor: colors.card }}>
    <Text style={{ color: colors.mutedForeground }}>{description}</Text>
    {children}
  </View>;
}

export function EmptyState({ children }: { children: React.ReactNode }) {
  const colors = useColors();
  return <Text accessibilityLiveRegion="polite" style={{ color: colors.mutedForeground, textAlign: "center", padding: 20 }}>{children}</Text>;
}

export function RecordCard({ title, detail, extra }: { title: string; detail: string; extra?: string }) {
  const colors = useColors();
  return <View style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: 14, gap: 4 }}>
    <Text style={{ color: colors.text, fontWeight: "700", fontSize: 16 }}>{title}</Text>
    <Text style={{ color: colors.mutedForeground }}>{detail}</Text>
    {extra ? <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>{extra}</Text> : null}
  </View>;
}
