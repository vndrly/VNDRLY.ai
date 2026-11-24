import React from "react";
import { Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import { useTranslation } from "react-i18next";
import type { ChangeOverSnapshot } from "@workspace/gate-booth";
import { ModalPressable as Pressable } from "@/components/ModalDraft";
import { useColors } from "@/hooks/useColors";

export default function GateMapSitePresenceCard({ snapshot, loading, sites, recordHistoryHrefs, historyBaseHref }: {
  snapshot: ChangeOverSnapshot | null;
  loading: boolean;
  sites: { siteId: number; siteName: string }[];
  recordHistoryHrefs: Record<string, string>;
  historyBaseHref: string;
}) {
  const { i18n } = useTranslation();
  const { primary } = useColors();
  const es = i18n.language?.startsWith("es");
  const c = (en: string, spanish: string) => es ? spanish : en;
  const people = [...new Map((snapshot?.outstanding ?? []).filter(row => row.kind === "employee" || row.kind === "visitor").map(row => [row.id, row])).values()];
  const openRecord = (id: string) => {
    const source = recordHistoryHrefs[id] ?? historyBaseHref;
    const params = new URLSearchParams(source.split("?")[1] ?? "");
    params.set("recordType", "on_site");
    params.set("recordId", id);
    params.set("view", "record");
    router.push(`/gate-history?${params}` as never);
  };
  return <View accessibilityLabel={c("Site Presence", "Presencia en el sitio")} style={{ backgroundColor: "#242426", borderColor: primary, borderWidth: 2, borderRadius: 14, padding: 16 }}>
    <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 9, paddingBottom: 9 }}><Feather name="map-pin" size={20} color={primary} /><View style={{ flex: 1 }}><Text accessibilityRole="header" style={{ color: "#ececec", fontSize: 17, fontWeight: "700" }}>{c("Site Presence", "Presencia en el sitio")}</Text><Text style={{ color: "#b3b3b3", fontSize: 12 }}>{c("Gate-recorded on-site presence", "Presencia registrada por el acceso")}</Text></View></View>
    {loading && !snapshot ? <Text accessibilityRole="alert" style={{ color: "#b3b3b3" }}>{c("Loading site presence…", "Cargando presencia…")}</Text> : !snapshot ? <Text accessibilityRole="alert" style={{ color: "#b3b3b3" }}>{c("Site presence records unavailable.", "Registros no disponibles.")}</Text> : <>
      <Text style={{ color: "#b3b3b3", fontSize: 12, paddingBottom: 4 }}>{new Date(snapshot.generatedAt).toLocaleString()}</Text>
      {people.map(person => <Pressable key={person.id} accessibilityRole="link" accessibilityLabel={person.name} onPress={() => openRecord(person.id)} style={{ paddingVertical: 10, borderTopColor: "#454545", borderTopWidth: 1 }}><Text style={{ color: "#ececec", fontSize: 14, fontWeight: "700" }}>{person.name}</Text><Text style={{ color: "#ececec", fontSize: 12 }}>{[person.company, sites.find(site => site.siteId === person.siteId)?.siteName ?? snapshot.linkedScope?.name ?? (sites.length === 1 ? sites[0]?.siteName : null)].filter(Boolean).join(" · ")}</Text><Text style={{ color: "#b3b3b3", fontSize: 12 }}>{c("Checked in", "Entrada")}: {new Date(person.checkIn).toLocaleString()}</Text></Pressable>)}
      {!people.length && <Text style={{ color: "#b3b3b3", fontSize: 13 }}>{c("No people are currently recorded on site.", "No hay personas registradas en el sitio.")}</Text>}
    </>}
  </View>;
}
