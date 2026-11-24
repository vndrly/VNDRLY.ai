import React, { useState } from "react";
import { Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import { useTranslation } from "react-i18next";
import type { ChangeOverSnapshot } from "@workspace/gate-booth";
import { ModalPressable as Pressable } from "@/components/ModalDraft";
import { useColors } from "@/hooks/useColors";

type Metric = "checkIns" | "checkOuts" | "pendingAdmission" | "exceptions";
type RecordRow = ChangeOverSnapshot["outstanding"][number] & { checkOut?: string | null };

const rows: { key: Metric; icon: React.ComponentProps<typeof Feather>["name"]; recordType: string }[] = [
  { key: "checkIns", icon: "log-in", recordType: "check_ins" },
  { key: "checkOuts", icon: "log-out", recordType: "check_outs" },
  { key: "pendingAdmission", icon: "clock", recordType: "pending" },
  { key: "exceptions", icon: "alert-triangle", recordType: "needs_review" },
];

export default function GateDashboardActivityCard({ snapshot, historyBaseHref, activityWindow, scopeLabel, showSubtitle = true, showAllLogLink = true, contentOnly = false, recordHistoryHrefs, onExpandedChange }: {
  snapshot: ChangeOverSnapshot | null;
  historyBaseHref: string;
  activityWindow?: "24h";
  scopeLabel?: string;
  showSubtitle?: boolean;
  showAllLogLink?: boolean;
  contentOnly?: boolean;
  recordHistoryHrefs?: Record<string, string>;
  onExpandedChange?: (key: Metric) => void;
}) {
  const { t, i18n } = useTranslation();
  const { primary } = useColors();
  const es = (i18n.language ?? "en").startsWith("es");
  const c = (en: string, spanish: string) => es ? spanish : en;
  const [expanded, setExpanded] = useState<Metric | null>(null);
  const records = new Map<string, RecordRow>([...(snapshot?.records ?? []), ...(snapshot?.outstanding ?? [])].map(row => [row.id, row]));
  const openLog = (recordType: string, record?: RecordRow) => {
    const params = new URLSearchParams((record && recordHistoryHrefs?.[record.id] || historyBaseHref).split("?")[1] ?? "");
    if (record?.siteId) params.set("siteId", String(record.siteId));
    if (record && !recordHistoryHrefs?.[record.id]) params.delete("stationId");
    params.set("recordType", recordType);
    if (record) {
      params.set("recordId", record.id.replace(/^checkin:/, "employee:"));
      params.set("view", "record");
    }
    router.push(`/gate-history?${params}` as never);
  };
  const subtitle = snapshot
    ? `${scopeLabel || snapshot.linkedScope?.name ? `${scopeLabel ?? snapshot.linkedScope?.name} · ` : ""}${activityWindow === "24h" ? `${c("Last 24 hours", "Últimas 24 horas")} · ` : ""}${t("changeOver.asOf")} ${new Date(snapshot.generatedAt).toLocaleString()}`
    : c("Site records unavailable.", "Registros del sitio no disponibles.");

  return <View accessibilityLabel={c("Gate activity", "Actividad del acceso")} style={contentOnly ? undefined : { backgroundColor: "#242426", borderColor: primary, borderWidth: 2, borderRadius: 14, paddingHorizontal: 16, paddingTop: 16 }}>
    {!contentOnly && <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 8, paddingBottom: 8 }}>
      <Feather name="log-in" size={20} color={primary} />
      <View style={{ flex: 1 }}>
        <Text accessibilityRole="header" style={{ color: "#ececec", fontSize: 17, fontWeight: "700" }}>{c("Gate activity", "Actividad del acceso")}</Text>
        {showSubtitle && <Text style={{ color: "#b3b3b3", fontSize: 12, marginTop: 2 }}>{subtitle}</Text>}
      </View>
    </View>}
    {rows.map(({ key, icon, recordType }) => {
      const open = expanded === key;
      const value = key === "exceptions" ? snapshot?.exceptions.length : snapshot?.metrics[key];
      const matching = key === "exceptions"
        ? snapshot?.exceptions.map(item => ({ record: records.get(item.sourceId) ?? { id: item.sourceId, name: item.sourceId, kind: "visitor", company: null, plate: null, checkIn: "", notes: null }, detail: item.text })) ?? []
        : (snapshot?.metricRecordIds?.[key] ?? []).map(id => records.get(id)).filter((record): record is RecordRow => Boolean(record)).map(record => ({ record, detail: undefined }));
      return <View key={key}>
        <Pressable accessibilityRole="button" accessibilityLabel={t(`changeOver.${key}`)} accessibilityState={{ expanded: open }} onPress={() => { setExpanded(open ? null : key); onExpandedChange?.(key); }} style={{ minHeight: 44, borderTopWidth: 1, borderTopColor: "#3a3a3a", flexDirection: "row", alignItems: "center", gap: 11 }}>
          <Feather name={icon} size={19} color={primary} />
          <Text style={{ color: "#ececec", fontSize: 14, fontWeight: "600", flex: 1 }}>{t(`changeOver.${key}`)}</Text>
          <Text style={{ color: "#b3b3b3", fontSize: 12 }}>{value ?? (key === "exceptions" ? "—" : c("Unavailable", "No disponible"))}</Text>
          <Feather name="chevron-right" size={18} color="#a3a3a3" style={open ? { transform: [{ rotate: "90deg" }] } : undefined} />
        </Pressable>
        {open && <View style={{ paddingLeft: 30, paddingBottom: 12 }}>
          {matching.map(({ record, detail }, index) => {
            const pending = recordType === "pending" || snapshot?.metricRecordIds?.pendingAdmission?.includes(record.id);
            const departed = record.checkOut && Date.parse(record.checkOut) <= Date.parse(snapshot?.generatedAt ?? "");
            const status = pending ? c("Awaiting Admission", "Esperando admisión") : departed ? c("Departed", "Salió") : c("On Site", "En el sitio");
            const company = record.company?.replace(/\s*\(fictional\)/gi, "").trim();
            const plate = record.plate?.trim().replace(/\s*[:•·]\s*/, ".");
            const description = detail ?? [[company, plate].filter(Boolean).join(" "), status].filter(Boolean).join(" · ");
            return <Pressable key={`${record.id}:${index}`} accessibilityRole="link" onPress={() => openLog(recordType, record)} style={{ paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: "#3a3a3a" }}>
              <Text style={{ color: "#ececec", fontSize: 13, fontWeight: "700" }}>{record.name || record.id}</Text>
              <Text style={{ color: "#b3b3b3", fontSize: 11 }}>{description}</Text>
            </Pressable>;
          })}
          {!matching.length && <Text style={{ color: "#b3b3b3", fontSize: 13, paddingVertical: 8 }}>{snapshot && value === 0 ? t("changeOver.none") : c("Site records unavailable.", "Registros del sitio no disponibles.")}</Text>}
          {showAllLogLink && <Pressable accessibilityRole="link" onPress={() => openLog(recordType)} style={{ paddingVertical: 8 }}><Text style={{ color: primary, fontSize: 13, fontWeight: "600" }}>{c("Open Gate Log", "Abrir registro de acceso")} ›</Text></Pressable>}
        </View>}
      </View>;
    })}
  </View>;
}
