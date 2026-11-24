import React from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";

export type GateConfirmedVisit = { id: string; name: string; location: string | null; destination: string | null };

export default function GateMapConfirmedLocationsCard({ visits }: { visits: GateConfirmedVisit[] }) {
  const { i18n } = useTranslation();
  const es = i18n.language?.startsWith("es");
  return <View accessibilityLabel={es ? "Ubicación confirmada en acceso" : "Gate-confirmed locations"} style={{ gap: 8 }}>
    <Text style={{ color: "#ececec", fontSize: 14, fontWeight: "700" }}>{es ? "Ubicación confirmada en acceso · no es GPS en vivo" : "Gate-confirmed locations · not live GPS"}</Text>
    {visits.map(visit => <View key={visit.id} style={{ borderWidth: 1, borderColor: "#5a5a5a", borderRadius: 4, padding: 8 }}>
      <Text style={{ color: "#ececec", fontSize: 14, fontWeight: "700" }}>{visit.name}</Text>
      <Text style={{ color: "#d0d0d0", fontSize: 13 }}>{es ? "Última ubicación confirmada" : "Last confirmed location"}: {visit.location}</Text>
      <Text style={{ color: "#d0d0d0", fontSize: 13 }}>{es ? "Destino previsto" : "Intended destination"}: {visit.destination ?? (es ? "Sin destino pendiente" : "No pending destination")}</Text>
    </View>)}
  </View>;
}
