import React, { useState } from "react";
import { Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import { useTranslation } from "react-i18next";
import type { ChangeOverSnapshot } from "@workspace/gate-booth";
import { ModalPressable as Pressable } from "@/components/ModalDraft";
import { useColors } from "@/hooks/useColors";

type Metric = "onSiteVisitorRecords" | "onSiteEmployeeRecords" | "onSiteVehicles" | "outstanding";
type RecordRow = ChangeOverSnapshot["outstanding"][number] & { checkOut?: string | null };

const rows: { key: Metric; icon: React.ComponentProps<typeof Feather>["name"]; recordType: string }[] = [
  { key: "onSiteVisitorRecords", icon: "users", recordType: "visitors_on_site" },
  { key: "onSiteEmployeeRecords", icon: "user-check", recordType: "employees_on_site" },
  { key: "onSiteVehicles", icon: "truck", recordType: "vehicles_on_site" },
  { key: "outstanding", icon: "clipboard", recordType: "on_site" },
];

export default function GateDashboardOnSiteCard({ snapshot, historyBaseHref, allGates = false, onExpandedChange }: {
  snapshot: ChangeOverSnapshot | null;
  historyBaseHref: string;
  allGates?: boolean;
  onExpandedChange?: (key: Metric) => void;
}) {
  const { t, i18n } = useTranslation();
  const { primary } = useColors();
  const es = (i18n.language ?? "en").startsWith("es");
  const c = (en: string, spanish: string) => es ? spanish : en;
  const [expanded, setExpanded] = useState<Metric | null>(null);
  const records = new Map<string, RecordRow>([...(snapshot?.records ?? []), ...(snapshot?.outstanding ?? [])].map(row => [row.id, row]));
  const subtitle = allGates
    ? c("Recorded presence across all gates", "Presencia registrada en todos los accesos")
    : snapshot?.linkedScope?.name
      ? `${snapshot.linkedScope.name} · ${c("Shared linked-gate presence", "Presencia compartida de accesos vinculados")}`
      : c("Recorded presence across this site", "Presencia registrada en este sitio");
  const openLog = (recordType: string, record?: RecordRow) => {
    const params = new URLSearchParams(historyBaseHref.split("?")[1] ?? "");
    if (record?.siteId) params.set("siteId", String(record.siteId));
    if (record) params.delete("stationId");
    params.set("recordType", recordType);
    if (record) {
      params.set("recordId", record.id.replace(/^checkin:/, "employee:"));
      params.set("view", "record");
    }
    router.push(`/gate-history?${params}` as never);
  };

  return <View accessibilityLabel={c("On site", "En el sitio")} style={{ backgroundColor: "#242426", borderColor: primary, borderWidth: 2, borderRadius: 14, paddingHorizontal: 16, paddingTop: 16 }}>
    <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 8, paddingBottom: 8 }}>
      <Feather name="users" size={20} color={primary} />
      <View style={{ flex: 1 }}>
        <Text accessibilityRole="header" style={{ color: "#ececec", fontSize: 17, fontWeight: "700" }}>{c("On site", "En el sitio")}</Text>
        <Text style={{ color: "#b3b3b3", fontSize: 12, marginTop: 2 }}>{subtitle}</Text>
      </View>
    </View>
    {rows.map(({ key, icon, recordType }) => {
      const open = expanded === key;
      const value = key === "outstanding" ? snapshot?.outstanding.length : snapshot?.metrics[key];
      const ids = key === "outstanding" ? undefined : snapshot?.metricRecordIds?.[key];
      const matching: RecordRow[] = key === "outstanding" ? snapshot?.outstanding ?? []
        : ids ? ids.map(id => records.get(id)).filter((record): record is RecordRow => Boolean(record))
          : (snapshot?.outstanding ?? []).filter(record => key === "onSiteVisitorRecords" ? record.kind === "visitor" : key === "onSiteEmployeeRecords" ? record.kind === "employee" : false);
      return <View key={key}>
        <Pressable accessibilityRole="button" accessibilityLabel={t(`changeOver.${key}`)} accessibilityState={{ expanded: open }} onPress={() => { setExpanded(open ? null : key); onExpandedChange?.(key); }} style={{ minHeight: 44, borderTopWidth: 1, borderTopColor: "#3a3a3a", flexDirection: "row", alignItems: "center", gap: 11 }}>
          <Feather name={icon} size={19} color={primary} />
          <Text style={{ color: "#ececec", fontSize: 14, fontWeight: "600", flex: 1 }}>{t(`changeOver.${key}`)}</Text>
          <Text style={{ color: "#b3b3b3", fontSize: 12 }}>{value ?? (key === "outstanding" ? "—" : c("Unavailable", "No disponible"))}</Text>
          <Feather name="chevron-right" size={18} color="#a3a3a3" style={open ? { transform: [{ rotate: "90deg" }] } : undefined} />
        </Pressable>
        {open && <View style={{ paddingLeft: 30, paddingBottom: 12 }}>
          {matching.map(record => {
            const departed = record.checkOut && Date.parse(record.checkOut) <= Date.parse(snapshot?.generatedAt ?? "");
            const pending = snapshot?.metricRecordIds?.pendingAdmission?.includes(record.id);
            const status = pending ? c("Awaiting Admission", "Esperando admisión") : departed ? c("Departed", "Salió") : c("On Site", "En el sitio");
            const company = record.company?.replace(/\s*\(fictional\)/gi, "").trim();
            const plate = record.plate?.trim().replace(/\s*[:•·]\s*/, ".");
            const description = [[company, plate].filter(Boolean).join(" "), status].filter(Boolean).join(" · ");
            return <Pressable key={record.id} accessibilityRole="link" onPress={() => openLog(recordType, record)} style={{ paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: "#3a3a3a" }}>
              <Text style={{ color: "#ececec", fontSize: 13, fontWeight: "700" }}>{record.name || record.id}</Text>
              <Text style={{ color: "#b3b3b3", fontSize: 11 }}>{description}</Text>
            </Pressable>;
          })}
          {!matching.length && <Text style={{ color: "#b3b3b3", fontSize: 13, paddingVertical: 8 }}>{snapshot && value === 0 ? t("changeOver.none") : c("Site records unavailable.", "Registros del sitio no disponibles.")}</Text>}
          <Pressable accessibilityRole="link" onPress={() => openLog(recordType)} style={{ paddingVertical: 8 }}><Text style={{ color: primary, fontSize: 13, fontWeight: "600" }}>{c("Open Gate Log", "Abrir registro de acceso")} ›</Text></Pressable>
        </View>}
      </View>;
    })}
  </View>;
}
