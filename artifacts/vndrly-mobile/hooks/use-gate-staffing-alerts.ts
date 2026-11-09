import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { AppState } from "react-native";
import type { GateStaffingAlert, GateStaffingAlertsResponse } from "@workspace/gate-booth";
import { apiFetch } from "@/lib/api";
import { captureAuthScope, getUser, isAuthScopeCurrent, subscribeToken, subscribeUser } from "@/lib/auth";

function subscribeAuth(listener: () => void) {
  const user = subscribeUser(listener), token = subscribeToken(listener);
  return () => { user(); token(); };
}
const authGeneration = () => captureAuthScope().generation;
type Snapshot = { generation: number; alerts: GateStaffingAlert[]; notificationsPaused: boolean; error: boolean; pendingId: string | null; acknowledgmentErrorId: string | null };
const empty = (generation: number): Snapshot => ({ generation, alerts: [], notificationsPaused: false, error: false, pendingId: null, acknowledgmentErrorId: null });

/** Every read and explicit acknowledgment belongs to the current signed-in company. */
export function useGateStaffingAlerts() {
  const generation = useSyncExternalStore(subscribeAuth, authGeneration);
  const [snapshot, setSnapshot] = useState(() => empty(generation));
  const snapshotRef = useRef(snapshot); snapshotRef.current = snapshot;
  const mounted = useRef(false), readSequence = useRef(0), pending = useRef<object | null>(null);
  const readController = useRef<AbortController | null>(null);
  const refresh = useCallback(async () => {
    const scope = captureAuthScope(), sequence = ++readSequence.current;
    if (scope.generation !== generation || !mounted.current) return;
    readController.current?.abort();
    const controller = new AbortController(); readController.current = controller;
    const current = () => mounted.current && isAuthScopeCurrent(scope) && readSequence.current === sequence;
    try {
      const user = await getUser();
      if (!current()) return;
      if (!user) { setSnapshot(empty(generation)); return; }
      // MidCon's indefinite hold also guards against a stale or malformed server flag.
      const membership = user.availableMemberships?.find(item => item.id === user.activeMembershipId);
      const heldCompany = membership ? membership.orgType === "vendor" && membership.orgId === 1054 : user.vendorId === 1054;
      const result = await apiFetch<GateStaffingAlertsResponse>("/api/gate-staffing-alerts", { signal: controller.signal }, scope);
      if (!current()) return;
      if (!Array.isArray(result?.alerts) || typeof result.notificationsPaused !== "boolean") throw new Error("Invalid staffing response");
      setSnapshot(previous => ({ ...previous, generation, alerts: result.alerts, notificationsPaused: heldCompany || result.notificationsPaused, error: false }));
    } catch (error) {
      if (current()) setSnapshot(previous => ({ ...previous, generation, ...([401, 403, 404].includes((error as { status?: number }).status ?? 0) ? { alerts: [] } : {}), error: true }));
    }
  }, [generation]);

  useEffect(() => {
    mounted.current = true;
    pending.current = null;
    setSnapshot(empty(generation));
    void refresh();
    const timer = setInterval(() => void refresh(), 15_000);
    const foreground = AppState.addEventListener("change", value => { if (value === "active") void refresh(); });
    return () => { mounted.current = false; readSequence.current++; readController.current?.abort(); clearInterval(timer); foreground.remove(); };
  }, [generation, refresh]);

  const acknowledge = useCallback(async (id: string) => {
    const scope = captureAuthScope(), original = snapshotRef.current;
    const alert = original.alerts.find(item => item.id === id);
    if (!mounted.current || scope.generation !== generation || original.generation !== generation || pending.current || original.notificationsPaused || !alert || alert.notificationsPaused || !alert.canAcknowledge || alert.status !== "open") return;
    const operation = {}; pending.current = operation;
    const current = () => mounted.current && pending.current === operation && isAuthScopeCurrent(scope);
    readSequence.current++; readController.current?.abort();
    setSnapshot(previous => ({ ...previous, pendingId: id, acknowledgmentErrorId: null }));
    try {
      const result = await apiFetch<{ alert: GateStaffingAlert }>(`/api/gate-staffing-alerts/${encodeURIComponent(id)}/acknowledge`, { method: "POST", body: JSON.stringify({ channel: "ios" }) }, scope);
      if (!current()) return;
      if (result.alert?.id !== id || result.alert.shiftId !== alert.shiftId || result.alert.siteId !== alert.siteId || result.alert.stationId !== alert.stationId ||
          (result.alert.status !== "resolved" && (result.alert.status !== "acknowledged" || !result.alert.acknowledgedBy || !result.alert.acknowledgedAt))) throw new Error("Acknowledgment unconfirmed");
      // A read started before this saved result cannot put the incident back into open state.
      readSequence.current++; readController.current?.abort();
      setSnapshot(previous => ({ ...previous, alerts: previous.alerts.map(item => item.id === id ? result.alert : item), acknowledgmentErrorId: null }));
    } catch (error) {
      if (!current()) return;
      setSnapshot(previous => ({ ...previous, acknowledgmentErrorId: id }));
      if ([403, 404, 409].includes((error as { status?: number }).status ?? 0)) await refresh();
    } finally {
      if (current()) {
        pending.current = null;
        setSnapshot(previous => ({ ...previous, pendingId: null }));
      }
    }
  }, [generation, refresh]);

  return { ...(snapshot.generation === generation ? snapshot : empty(generation)), generation, refresh, acknowledge };
}
