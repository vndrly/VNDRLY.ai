import React, { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { useAuth } from "@/hooks/use-auth";
import { useColors } from "@/hooks/useColors";
import { apiFetch, getApiBase } from "@/lib/api";
import { getToken } from "@/lib/auth";
type Document = { id: string; documentType: "pay_statement" | "w2"; issuedAt: string; taxYear: number };
type Result = { documents: Document[]; message: string; providerConfigured: boolean };
export default function WorkHubPayrollDocuments() {
  const { user } = useAuth();
  const colors = useColors();
  const identity = `${user?.id}:${user?.activeMembershipId}`;
  const current = useRef(identity); current.current = identity;
  const [result, setResult] = useState<{ identity: string; value: Result } | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let alive = true; setError(""); setResult(null);
    if (user?.id) void apiFetch<Result>("/api/work-hub/finance/personal-documents").then(value => { if (alive) setResult({ identity, value }); }).catch(e => { if (alive) setError(e instanceof Error ? e.message : "Could not load your documents"); });
    return () => { alive = false; };
  }, [identity]);
  const open = async (doc: Document) => {
    const startedAs = identity;
    let uri: string | undefined;
    setBusy(true); setError("");
    try {
      const token = await getToken();
      if (!token || current.current !== startedAs) throw new Error("Sign in again to view your document.");
      if (!FileSystem.cacheDirectory || !(await Sharing.isAvailableAsync())) throw new Error("Document viewing is unavailable on this device.");
      uri = `${FileSystem.cacheDirectory}payroll-${doc.id}-${Date.now()}.pdf`;
      const downloaded = await FileSystem.downloadAsync(`${getApiBase()}/api/work-hub/finance/personal-documents/${encodeURIComponent(doc.id)}`, uri, { headers: { Authorization: `Bearer ${token}`, "x-vndrly-client": "ios" } });
      if (downloaded.status !== 200) throw new Error("This document is no longer available.");
      if (current.current !== startedAs) return;
      await Sharing.shareAsync(uri, { mimeType: "application/pdf", UTI: "com.adobe.pdf", dialogTitle: "View payroll document" });
    } catch (e) { if (current.current === startedAs) setError(e instanceof Error ? e.message : "Could not open document"); }
    finally { if (uri) await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => undefined); setBusy(false); }
  };
  const data = result?.identity === identity ? result.value : null;
  return <View style={{ gap: 14 }}>
    <Text style={{ color: colors.mutedForeground }}>Your personal pay statements and W-2s</Text>
    {error ? <Text accessibilityRole="alert" style={{ color: colors.destructive }}>{error}</Text> : null}
    {!data && !error ? <ActivityIndicator /> : null}
    {data ? <Text style={{ color: colors.mutedForeground }}>{data.message}</Text> : null}
    {data?.documents.map(doc => <Pressable key={doc.id} accessibilityRole="button" disabled={busy} onPress={() => void open(doc)} style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: 16 }}><Text style={{ color: colors.text }}>{doc.documentType === "w2" ? "W-2" : "Pay statement"} · {doc.taxYear}</Text><Text style={{ color: colors.mutedForeground }}>Issued {new Date(doc.issuedAt).toLocaleDateString()} · View document</Text></Pressable>)}
    {busy ? <ActivityIndicator /> : null}
  </View>;
}
