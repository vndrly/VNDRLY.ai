import React, { useEffect, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { useQuery } from "@tanstack/react-query";
import { ModalPressable as Pressable } from "@/components/ModalDraft";
import DismissibleModal from "@/components/DismissibleModal";
import { useAuth } from "@/hooks/use-auth";
import { useColors } from "@/hooks/useColors";
import { apiFetch, apiFetchRaw } from "@/lib/api";

export type GateLogExportFilters = {
  siteId: number;
  siteIds?: number[];
  stationId?: string;
  range: string;
  recordType: string;
  search?: string;
  from?: string;
  to?: string;
};
type Format = "pdf" | "excel" | "word";
type Recipient = { userId: number; name: string; role: string; scope: string };
const formats: { value: Format; label: string }[] = [{ value: "pdf", label: "PDF" }, { value: "excel", label: "Excel" }, { value: "word", label: "Word" }];

export default function GateLogExportNative({ filters, disabled, reportKind = "history", title = "Gate Log" }: { filters: GateLogExportFilters | null; disabled: boolean; reportKind?: "history" | "shift_notes"; title?: string }) {
  const { user } = useAuth();
  const { primary } = useColors();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState(false);
  const [format, setFormat] = useState<Format>("pdf");
  const [selected, setSelected] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const recipients = useQuery({
    queryKey: ["gate-log-export-recipients", user?.id, reportKind, filters],
    enabled: email && !!filters,
    retry: false,
    queryFn: () => {
      const params = new URLSearchParams({ reportKind, siteId: String(filters!.siteId), range: filters!.range, recordType: filters!.recordType });
      if (filters!.siteIds?.length) params.set("siteIds", filters!.siteIds!.join(","));
      if (filters!.stationId) params.set("stationId", filters!.stationId);
      if (filters!.search) params.set("search", filters!.search);
      if (filters!.from && filters!.to) { params.set("from", filters!.from); params.set("to", filters!.to); }
      return apiFetch<{ recipients: Recipient[] }>(`/api/gate-report/recipients?${params}`);
    },
  });
  useEffect(() => {
    if (!email || !recipients.data) return;
    const me = recipients.data.recipients.find(row => row.userId === user?.id);
    setSelected(me ? [me.userId] : []);
  }, [email, recipients.data, user?.id]);
  async function download(next: Format) {
    if (!filters || disabled || busy) return;
    setBusy(true);
    setMessage("");
    try {
      const response = await apiFetchRaw("/api/gate-report/export", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ reportKind, format: next, filters }) });
      if (!FileSystem.cacheDirectory || !(await Sharing.isAvailableAsync())) throw new Error("Sharing is unavailable");
      const extension = next === "excel" ? "xls" : next === "word" ? "doc" : "pdf";
      const uri = `${FileSystem.cacheDirectory}vndrly-gate-${reportKind}.${extension}`;
      const bytes = new Uint8Array(await response.arrayBuffer());
      let binary = "";
      for (const byte of bytes) binary += String.fromCharCode(byte);
      await FileSystem.writeAsStringAsync(uri, globalThis.btoa(binary), { encoding: FileSystem.EncodingType.Base64 });
      setOpen(false);
      await Sharing.shareAsync(uri, { dialogTitle: `Export ${title}` });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to export this report");
    } finally {
      setBusy(false);
    }
  }
  async function deliver() {
    if (!filters || !selected.length || busy) return;
    setBusy(true);
    setMessage("");
    try {
      await apiFetch("/api/gate-report/deliver", { method: "POST", body: JSON.stringify({ reportKind, format, filters, recipientUserIds: selected }) });
      setMessage("Secure report links sent.");
      setEmail(false);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to email this report");
    } finally {
      setBusy(false);
    }
  }
  const option = (label: string, onPress: () => void) => <Pressable key={label} accessibilityRole="button" onPress={onPress} disabled={busy} style={{ paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: "#3a3a3a" }}><Text style={{ color: "#ececec", fontSize: 15 }}>{label}</Text></Pressable>;
  return <View style={{ gap: 5 }}>
    <Pressable accessibilityRole="button" accessibilityLabel={`Export ${title}`} disabled={disabled || busy || !filters} onPress={() => setOpen(true)} style={{ borderWidth: 1, borderColor: primary, borderRadius: 8, minWidth: 144, minHeight: 40, paddingHorizontal: 10, flexDirection: "row", alignItems: "center", justifyContent: "space-between", opacity: disabled || busy || !filters ? 0.5 : 1 }}><Text style={{ color: "#ececec", fontSize: 14 }}>{busy ? "Exporting…" : "Export"}</Text><Feather name="chevron-down" size={16} color={primary} /></Pressable>
    {!!message && <Text accessibilityRole="alert" style={{ color: "#b3b3b3", fontSize: 12 }}>{message}</Text>}
    <DismissibleModal visible={open} onRequestClose={() => setOpen(false)}><View style={{ flex: 1, backgroundColor: "#242426", padding: 20 }}>
      <Text accessibilityRole="header" style={{ color: "#ececec", fontSize: 18, fontWeight: "700", marginBottom: 10 }}>Export {title}</Text>
      {formats.map(item => option(item.label, () => void download(item.value)))}
      {option("Email", () => { setOpen(false); setEmail(true); })}
    </View></DismissibleModal>
    <DismissibleModal visible={email} onRequestClose={() => setEmail(false)}><View style={{ flex: 1, backgroundColor: "#242426", padding: 20, gap: 10 }}>
      <Text accessibilityRole="header" style={{ color: "#ececec", fontSize: 18, fontWeight: "700" }}>Email {title}</Text>
      <Text style={{ color: "#b3b3b3", fontSize: 12 }}>Report format</Text>
      <View style={{ flexDirection: "row", gap: 12 }}>{formats.map(item => <Pressable key={item.value} accessibilityRole="radio" accessibilityState={{ selected: format === item.value }} onPress={() => setFormat(item.value)}><Text style={{ color: format === item.value ? primary : "#ececec" }}>{item.label}</Text></Pressable>)}</View>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 8 }}>
        {recipients.isPending ? <Text style={{ color: "#b3b3b3" }}>Loading recipients…</Text> : recipients.isError ? <Pressable onPress={() => void recipients.refetch()}><Text style={{ color: primary }}>Unable to load recipients. Retry</Text></Pressable> : recipients.data?.recipients.map(row => <Pressable key={row.userId} accessibilityRole="checkbox" accessibilityState={{ checked: selected.includes(row.userId) }} onPress={() => setSelected(current => current.includes(row.userId) ? current.filter(id => id !== row.userId) : [...current, row.userId])} style={{ minHeight: 44, justifyContent: "center" }}><Text style={{ color: "#ececec" }}>{selected.includes(row.userId) ? "☑" : "☐"} {row.name}{row.userId === user?.id ? " (Me)" : ""} · {row.role}</Text></Pressable>)}
      </ScrollView>
      <Pressable accessibilityRole="button" disabled={busy || !selected.length} onPress={() => void deliver()} style={{ borderWidth: 1, borderColor: primary, borderRadius: 8, padding: 10, alignSelf: "flex-start", opacity: busy || !selected.length ? 0.5 : 1 }}><Text style={{ color: "#ececec" }}>{busy ? "Sending…" : "Send secure link"}</Text></Pressable>
      {!!message && <Text accessibilityRole="alert" style={{ color: "#b3b3b3" }}>{message}</Text>}
    </View></DismissibleModal>
  </View>;
}
