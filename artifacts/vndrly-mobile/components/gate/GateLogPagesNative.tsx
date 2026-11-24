import React from "react";
import { Text, View } from "react-native";
import SphereBackButton from "@/components/SphereBackButton";
import { useTranslation } from "react-i18next";

export type GateLogPages = { start: number; end: number; total: number; page: number; lastPage: number };

export default function GateLogPagesNative({ pages, onPrevious, onNext }: { pages: GateLogPages; onPrevious: () => void; onNext: () => void }) {
  const { i18n } = useTranslation();
  const es = i18n.language.startsWith("es");
  return <View accessibilityLabel={es ? "Páginas del registro de acceso" : "Gate Log pages"} style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderTopWidth: 1, borderTopColor: "#3a3a3a", paddingTop: 12 }}>
    <SphereBackButton direction="left" size={32} accessibilityLabel={es ? "Registros anteriores" : "Previous records"} disabled={pages.page <= 0} onPress={onPrevious} />
    <Text accessibilityRole="text" style={{ color: "#b3b3b3", fontSize: 14, textAlign: "center" }}>{pages.start}–{pages.end} {es ? "de" : "of"} {pages.total} {es ? "registros" : "Records"}</Text>
    <SphereBackButton direction="right" size={32} accessibilityLabel={es ? "Registros siguientes" : "Next records"} disabled={pages.page >= pages.lastPage} onPress={onNext} />
  </View>;
}
