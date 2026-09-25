import React, { useEffect, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { apiFetchRaw } from "@/lib/api";
import { captureAuthScope, isAuthScopeCurrent } from "@/lib/auth";
import { nativeUuid } from "@/lib/native-uuid";
import { useColors } from "@/hooks/useColors";
import TogglePillButton from "@/components/TogglePillButton";
import { ImplementationASurface } from "./Surface";

const OPTIONS = {
  payroll: ["Payroll hours", "Worker, employer, sponsor, site, and hours", "Pay rates, wages, and tax data"],
  "quickbooks-time": ["QuickBooks time", "Worker, employer, sponsor, site, and hours", "Pay rates, wages, and tax data"],
  assets: ["Inventory and custody", "Asset identity, holder, status, and latest condition", "Hidden incident details"],
  staffing: ["Staffing", "Assignments, attribution, site, times, and status", "Compensation and private HR data"],
  safety: ["Safety response", "Incident time, severity, response status, and acknowledgement", "Medical detail, evidence, and private notes"],
} as const;
type Dataset = keyof typeof OPTIONS;

export function ImplementationAExports({ owner, allowedDatasets }: { owner: { type: "vendor" | "partner"; id: number }; allowedDatasets: readonly Dataset[] }) {
  const colors = useColors();
  const [dataset, setDataset] = useState<Dataset>("payroll");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const ownerKey = `${owner.type}:${owner.id}`;
  const ownerKeyRef = useRef(ownerKey);
  ownerKeyRef.current = ownerKey;
  const allowedRef = useRef(allowedDatasets);
  allowedRef.current = allowedDatasets;
  const mountedRef = useRef(true);
  const requestIdRef = useRef(0);
  const controllerRef = useRef<AbortController | null>(null);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      requestIdRef.current += 1;
      controllerRef.current?.abort();
    };
  }, []);
  useEffect(() => () => { controllerRef.current?.abort(); }, [ownerKey]);
  const selected = allowedDatasets.includes(dataset) ? dataset : allowedDatasets[0];
  if (!selected) return null;
  const detail = OPTIONS[selected];
  const download = async () => {
    const authScope = captureAuthScope();
    const requestId = ++requestIdRef.current;
    const controller = new AbortController();
    controllerRef.current?.abort();
    controllerRef.current = controller;
    const assertCurrent = () => {
      if (!mountedRef.current || ownerKeyRef.current !== ownerKey || requestIdRef.current !== requestId ||
        !allowedRef.current.includes(selected) || controller.signal.aborted || !isAuthScopeCurrent(authScope))
        throw Object.assign(new Error("Request authorization changed"), { name: "AbortError" });
    };
    let uri: string | null = null;
    setBusy(true); setError("");
    try {
      assertCurrent();
      const response = await apiFetchRaw("/api/work-hub/exports/implementation-a", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ dataset: selected, scope: { ownerOrgType: owner.type, ownerOrgId: owner.id } }), signal: controller.signal }, authScope);
      assertCurrent();
      const csv = await response.text();
      assertCurrent();
      uri = `${FileSystem.cacheDirectory}vndrly-${selected}-${nativeUuid()}.csv`;
      await FileSystem.writeAsStringAsync(uri, csv);
      assertCurrent();
      await Sharing.shareAsync(uri, { mimeType: "text/csv", dialogTitle: detail[0] });
      assertCurrent();
    } catch (cause) {
      if ((cause as Error | undefined)?.name !== "AbortError" && mountedRef.current && ownerKeyRef.current === ownerKey && isAuthScopeCurrent(authScope))
        setError(cause instanceof Error ? cause.message : "The export could not be created.");
    } finally {
      if (uri) { try { await FileSystem.deleteAsync(uri, { idempotent: true }); } catch { /* best effort cache cleanup */ } }
      if (controllerRef.current === controller) controllerRef.current = null;
      if (mountedRef.current && ownerKeyRef.current === ownerKey && requestIdRef.current === requestId && isAuthScopeCurrent(authScope)) setBusy(false);
    }
  };
  return <ImplementationASurface description="Preview the company scope before creating an audited CSV.">
    <View accessibilityRole="radiogroup" style={{ gap: 8 }}>{(Object.keys(OPTIONS) as Dataset[]).filter((value) => allowedDatasets.includes(value)).map((value) => <Pressable key={value} accessibilityRole="radio" accessibilityState={{ checked: selected === value }} onPress={() => setDataset(value)} style={{ borderWidth: 1, borderColor: selected === value ? colors.primary : colors.border, borderRadius: 10, padding: 12 }}><Text style={{ color: colors.text, fontWeight: "700" }}>{OPTIONS[value][0]}</Text></Pressable>)}</View>
    <View style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: 12, gap: 4 }}><Text style={{ color: colors.text }}><Text style={{ fontWeight: "700" }}>Period: </Text>All retained authorized records</Text><Text style={{ color: colors.text }}><Text style={{ fontWeight: "700" }}>Included: </Text>{detail[1]}</Text><Text style={{ color: colors.text }}><Text style={{ fontWeight: "700" }}>Excluded: </Text>{detail[2]}</Text></View>
    <TogglePillButton color="brand" loading={busy} disabled={busy} accessibilityLabel={`Create ${detail[0]} CSV`} onPress={() => void download()}>Create audited CSV</TogglePillButton>
    {error ? <Text accessibilityRole="alert" style={{ color: colors.destructive }}>{error}</Text> : null}
  </ImplementationASurface>;
}
