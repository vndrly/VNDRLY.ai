import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { nativeOperationsRequest } from "@/lib/native-operations-client";
import { useToast } from "@/hooks/use-toast";
import WorkdayStatusSwitch from "./workday-status-switch";

type Status = { active?: boolean; onCallActive?: boolean; onCallWindows?: { startsAt: string; endsAt: string; consent: boolean }[]; canWorkerOperate?: boolean; policy?: { enabled: boolean } };
export default function OnCallControl({ identity, pickup = false }: { identity: string; pickup?: boolean }) {
  const { i18n } = useTranslation(), es = (i18n?.language ?? "en").startsWith("es");
  const [busy, setBusy] = useState(false);
  const { toast } = useToast();
  const lock = useRef(false);
  const cache = useQueryClient();
  const queryKey = [pickup ? "pickup-shift-preference" : "on-call-preference", identity] as const;
  const query = useQuery({ queryKey, queryFn: ({ signal }) => nativeOperationsRequest<Status>(pickup ? "/pickup-shifts" : "/on-call", { signal: AbortSignal.any([signal, AbortSignal.timeout(20000)]) }), retry: pickup ? 1 : 2, retryDelay: attempt => Math.min(500 * 2 ** attempt, 5000), throwOnError: false, refetchOnReconnect: "always", refetchInterval: state => !pickup && state.state.status === "error" ? 5000 : 30000 });
  const status = query.data;
  const active = pickup ? status?.active === true : status?.onCallActive === true || status?.onCallWindows?.some(window => window.consent && Date.parse(window.startsAt) <= Date.now() && Date.parse(window.endsAt) > Date.now()) === true;
  async function toggle() {
    if (lock.current || !status) return;
    lock.current = true; setBusy(true);
    try {
      await cache.cancelQueries({ queryKey, exact: true });
      const saved = await nativeOperationsRequest<Status>(pickup ? "/pickup-shifts" : "/on-call?response=preference", { method: "PUT", body: JSON.stringify({ active: !active, consent: true }) });
      cache.setQueryData<Status>(queryKey, previous => ({ ...previous, ...saved }));
      // Refresh the read-only staffing/contact surfaces after a saved declaration.
      for (const key of ["gate-staffing-contacts", "coverage-candidates", "gate-coverage-map", "gate-shift-candidates"]) {
        void cache.invalidateQueries({ queryKey: [key] });
      }
    }
    catch { toast({ variant: "destructive", title: es ? "No se pudo guardar el cambio." : "Your change could not be saved." }); }
    finally { lock.current = false; setBusy(false); }
  }
  const label = pickup ? "Pickup Shifts" : "On Call";
  return <div className="shift-card-preference">
    {/* User-owned label: never replace it with state, diagnostics, or explanatory copy. */}
    <WorkdayStatusSwitch accessibilityLabel={label} active={active} label={label} disabled={busy || !status} onClick={() => void toggle()} />
  </div>;
}
