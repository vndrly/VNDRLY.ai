import React, { useEffect, useRef, useState } from "react";
import { Alert, AppState, View } from "react-native";
import { useTranslation } from "react-i18next";
import { captureAuthScope, isAuthScopeCurrent } from "@/lib/auth";
import { changeNativeOnCall, readNativeOnCall, type NativeOnCallStatus } from "@/lib/native-operations";
import WorkdayStatusSwitch from "./WorkdayStatusSwitch";

export default function OnCallPill({ shiftActive }: { shiftActive: boolean }) {
  const { i18n } = useTranslation(), es = (i18n?.language ?? "en").startsWith("es");
  const [status, setStatus] = useState<NativeOnCallStatus | null>(null), [busy, setBusy] = useState(false);
  const scope = useRef(captureAuthScope()), alive = useRef(true), lock = useRef(false), revision = useRef(0);
  const current = () => alive.current && isAuthScopeCurrent(scope.current);
  async function refresh() { if (lock.current) return; const version = ++revision.current; try { const next = await readNativeOnCall(scope.current); if (current() && version === revision.current) setStatus(next); } catch { /* Automatic refresh retries; the user-owned label never becomes a status message. */ } }
  useEffect(() => {
    alive.current = true; void refresh();
    const timer = setInterval(() => { if (AppState.currentState === "active") void refresh(); }, 30000);
    const subscription = AppState.addEventListener("change", value => { if (value === "active") void refresh(); });
    return () => { alive.current = false; clearInterval(timer); subscription.remove(); };
  }, []);
  const active = status?.onCallActive === true || status?.onCallWindows?.some(window => window.consent && Date.parse(window.startsAt) <= Date.now() && Date.parse(window.endsAt) > Date.now()) === true;
  async function toggle() {
    if (lock.current || !current() || !status) return;
    lock.current = true; revision.current++; setBusy(true);
    try { const next = await changeNativeOnCall(!active, shiftActive); if (current()) setStatus(next); }
    catch { if (current()) Alert.alert("On Call", es ? "No se pudo verificar el cambio." : "Your change could not be saved."); }
    finally { lock.current = false; if (current()) setBusy(false); }
  }
  // User-owned label: no dynamic status, helper copy, or diagnostics in this control.
  return <View style={{ flexShrink: 1, alignItems: "flex-end" }}><WorkdayStatusSwitch accessibilityLabel="On Call" active={active} disabled={busy || !status} label="On Call" onPress={() => void toggle()} /></View>;
}
