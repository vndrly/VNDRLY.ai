import React, { useState } from "react";
import { Text, TouchableOpacity, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useBrand } from "@/hooks/use-brand";
import { useColors } from "@/hooks/useColors";

export default function TicketWorkSection({ title, initiallyOpen = false, children }: React.PropsWithChildren<{ title: string; initiallyOpen?: boolean }>) {
  const [open, setOpen] = useState(initiallyOpen);
  const brand = useBrand();
  const colors = useColors();
  return <View style={{ borderWidth: 2, borderColor: brand.primary, borderRadius: 14, backgroundColor: colors.card, marginBottom: 12 }}>
    <TouchableOpacity accessibilityRole="button" accessibilityState={{ expanded: open }} onPress={() => setOpen(value => !value)} style={{ padding: 14, flexDirection: "row", alignItems: "center", gap: 8 }}>
      <Text style={{ flex: 1, color: colors.foreground, fontFamily: "Inter_600SemiBold", fontSize: 15 }}>{title}</Text>
      <Feather name={open ? "chevron-up" : "chevron-down"} color={brand.primary} size={18} />
    </TouchableOpacity>
    <View style={{ display: open ? "flex" : "none", paddingHorizontal: 12, paddingBottom: 12 }}>{children}</View>
  </View>;
}
