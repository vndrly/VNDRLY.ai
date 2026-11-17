import React, { useEffect, useRef, useState } from "react";
import { Alert, AppState } from "react-native";
import { useTranslation } from "react-i18next";
import { captureAuthScope, isAuthScopeCurrent } from "@/lib/auth";
import { apiFetch } from "@/lib/api";
import WorkdayStatusSwitch from "./WorkdayStatusSwitch";

export default function PickupShiftPill() {
  const { i18n } = useTranslation(), es = i18n.language?.startsWith("es");
  const [status, setStatus] = useState<{active:boolean} | null>(null), [busy, setBusy] = useState(false);
  const scope = useRef(captureAuthScope()), alive = useRef(true), lock = useRef(false), revision = useRef(0);
  const current = () => alive.current && isAuthScopeCurrent(scope.current);
  const path = "/api/native-operations/pickup-shifts";
  useEffect(() => {
    alive.current = true;
    const refresh = async () => {
      if (lock.current) return;
      const version = ++revision.current;
      try { const next = await apiFetch<{active:boolean}>(path, {}, scope.current); if (current() && version === revision.current) setStatus(next); } catch { /* Retry on focus or polling. */ }
    };
    void refresh();
    const timer = setInterval(() => { if (AppState.currentState === "active") void refresh(); }, 30000);
    const subscription = AppState.addEventListener("change", state => { if (state === "active") void refresh(); });
    return () => { alive.current = false; clearInterval(timer); subscription.remove(); };
  }, []);
  const label = "Pickup Shifts";
  async function toggle() {
    if (!current() || !status || lock.current) return;
    lock.current = true; revision.current++; setBusy(true);
    try {
      const next = await apiFetch<{active:boolean}>(path, { method:"PUT", body:JSON.stringify({active:!status.active,consent:true}) }, scope.current);
      if (current()) setStatus(next);
    } catch { if (current()) Alert.alert(label, es ? "No se pudo guardar el cambio." : "Your change could not be saved."); }
    finally { lock.current = false; if (current()) setBusy(false); }
  }
  return <WorkdayStatusSwitch accessibilityLabel={label} label={label} active={status?.active === true} disabled={busy || !status} onPress={() => void toggle()} />;
}
