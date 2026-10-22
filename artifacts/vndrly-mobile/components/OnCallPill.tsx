import React, { useEffect, useRef, useState } from "react";
import { AppState, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { captureAuthScope, isAuthScopeCurrent } from "@/lib/auth";
import { changeNativeOnCall, readNativeOperations } from "@/lib/native-operations";
import type { NativeOperationsStatus } from "@/lib/native-operations-policy";
import WorkdayStatusSwitch from "./WorkdayStatusSwitch";

export default function OnCallPill({ shiftActive }: { shiftActive: boolean }) {
  const { i18n } = useTranslation(), es = (i18n?.language ?? "en").startsWith("es");
  const [status, setStatus] = useState<NativeOperationsStatus | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const scope = useRef(captureAuthScope()), alive = useRef(true), lock = useRef(false), revision = useRef(0);
  const current = () => alive.current && isAuthScopeCurrent(scope.current);
  async function refresh() { if (lock.current) return; const version = ++revision.current; try { const next = await readNativeOperations(scope.current); if (current() && version === revision.current) { setStatus(next); setError(""); } } catch { if (current() && version === revision.current) setError(es ? "Guardia no disponible" : "On-call unavailable"); } }
  useEffect(() => {
    alive.current = true; void refresh();
    const timer = setInterval(() => { if (AppState.currentState === "active") void refresh(); }, 30000);
    const subscription = AppState.addEventListener("change", value => { if (value === "active") void refresh(); });
    return () => { alive.current = false; clearInterval(timer); subscription.remove(); };
  }, []);
  const active = status?.onCallActive === true || status?.onCallWindows?.some(window => window.consent && Date.parse(window.startsAt) <= Date.now() && Date.parse(window.endsAt) > Date.now()) === true;
  async function toggle() {
    if (lock.current || !current() || !status) return;
    lock.current = true; revision.current++; setBusy(true); setError("");
    try { const next = await changeNativeOnCall(!active, shiftActive || status.duty?.active === true); if (current()) setStatus(next); }
    catch { if (current()) setError(es ? "No se pudo verificar el cambio." : "On-call change not verified."); }
    finally { lock.current = false; if (current()) setBusy(false); }
  }
  return <View style={{ flexShrink: 1, alignItems: "flex-end", gap: 4 }}><WorkdayStatusSwitch accessibilityLabel={es ? "Guardia" : "On Call"} active={active} disabled={busy || !status || !status.policy.enabled} label={active ? (es ? "De guardia" : "On Call") : (es ? "Sin guardia" : "Not on Call")} onPress={() => void toggle()} />{error ? <Text accessibilityRole="alert" style={{ color: "#e2e8f0", fontSize: 11 }}>{error}</Text> : null}</View>;
}
