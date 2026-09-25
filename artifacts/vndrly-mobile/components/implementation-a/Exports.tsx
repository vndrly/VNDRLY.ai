import React, { useState } from "react";
import { Pressable, Text, View } from "react-native";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { getApiBase } from "@/lib/api";
import { getToken } from "@/lib/auth";
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
  const selected = allowedDatasets.includes(dataset) ? dataset : allowedDatasets[0];
  if (!selected) return null;
  const detail = OPTIONS[selected];
  const download = async () => {
    setBusy(true); setError("");
    try {
      const token = await getToken();
      if (!token) throw new Error("Sign in again to create this export.");
      const response = await fetch(`${getApiBase()}/api/work-hub/exports/implementation-a`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "content-type": "application/json", "x-vndrly-client": "ios" }, body: JSON.stringify({ dataset: selected, scope: { ownerOrgType: owner.type, ownerOrgId: owner.id } }) });
      if (!response.ok) throw new Error("The export could not be created.");
      const uri = `${FileSystem.cacheDirectory}vndrly-${selected}.csv`;
      await FileSystem.writeAsStringAsync(uri, await response.text());
      await Sharing.shareAsync(uri, { mimeType: "text/csv", dialogTitle: detail[0] });
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The export could not be created."); }
    finally { setBusy(false); }
  };
  return <ImplementationASurface description="Preview the company scope before creating an audited CSV.">
    <View accessibilityRole="radiogroup" style={{ gap: 8 }}>{(Object.keys(OPTIONS) as Dataset[]).filter((value) => allowedDatasets.includes(value)).map((value) => <Pressable key={value} accessibilityRole="radio" accessibilityState={{ checked: selected === value }} onPress={() => setDataset(value)} style={{ borderWidth: 1, borderColor: selected === value ? colors.primary : colors.border, borderRadius: 10, padding: 12 }}><Text style={{ color: colors.text, fontWeight: "700" }}>{OPTIONS[value][0]}</Text></Pressable>)}</View>
    <View style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: 12, gap: 4 }}><Text style={{ color: colors.text }}><Text style={{ fontWeight: "700" }}>Period: </Text>All retained authorized records</Text><Text style={{ color: colors.text }}><Text style={{ fontWeight: "700" }}>Included: </Text>{detail[1]}</Text><Text style={{ color: colors.text }}><Text style={{ fontWeight: "700" }}>Excluded: </Text>{detail[2]}</Text></View>
    <TogglePillButton color="brand" loading={busy} disabled={busy} accessibilityLabel={`Create ${detail[0]} CSV`} onPress={() => void download()}>Create audited CSV</TogglePillButton>
    {error ? <Text accessibilityRole="alert" style={{ color: colors.destructive }}>{error}</Text> : null}
  </ImplementationASurface>;
}
