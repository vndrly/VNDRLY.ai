import { useEffect, useState } from "react";
import { Link } from "wouter";
import { useTranslation } from "react-i18next";
import { z } from "zod/v4";
import { useAuth } from "@/hooks/use-auth";
const directorySchema = z.object({ monitors: z.array(z.object({ displayId: z.uuid(), monitorId: z.uuid(), displayName: z.string(), monitorName: z.string() })).max(100), truncated: z.boolean() });
const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
export default function OperationsDisplayDirectory() {
  const { user } = useAuth(); const { i18n } = useTranslation(); const es = i18n.language.startsWith("es");
  const identity = `${user?.userId}:${user?.role}:${user?.vendorId}:${user?.partnerId}:${user?.activeMembershipId}`;
  const [result, setResult] = useState<{ identity: string; data: z.infer<typeof directorySchema> | null } | null>(null);
  useEffect(() => {
    let current = true; const controller = new AbortController(); const timeout = window.setTimeout(() => controller.abort(), 15_000);
    if (user) void fetch(`${BASE}/api/implementation-a/operations-display-view`, { credentials: "include", cache: "no-store", signal: controller.signal }).then(async response => {
      if (!response.ok) throw Error("unavailable"); const data = directorySchema.parse(await response.json()); if (current) setResult({ identity, data });
    }).catch(() => { if (current) setResult({ identity, data: null }); }).finally(() => window.clearTimeout(timeout));
    return () => { current = false; controller.abort(); window.clearTimeout(timeout); };
  }, [identity]);
  const visible = result?.identity === identity ? result : null;
  return <main className="min-h-screen bg-slate-950 p-8 text-white"><h1 className="text-2xl">{es ? "Monitores guardados" : "Saved monitors"}</h1><p>{es ? "Abra un monitor autorizado en este navegador. La ubicación física en otra pantalla requiere configuración del dispositivo." : "Open an authorized monitor in this browser. Placement on another physical screen requires device setup."}</p>
    {!user || visible && !visible.data ? <p>{es ? "Pantallas no disponibles para esta cuenta." : "Displays unavailable for this account."}</p> : !visible ? <p>{es ? "Cargando…" : "Loading…"}</p> : <div className="mt-5 space-y-3">{visible.data?.monitors.map(monitor => <p key={monitor.monitorId}><Link className="underline" href={`/operations-display/${monitor.displayId}/${monitor.monitorId}`}>{monitor.displayName} · {monitor.monitorName}</Link></p>)}{!visible.data?.monitors.length && <p>{es ? "No hay monitores guardados autorizados. El registro se realiza desde el dispositivo complementario." : "No authorized saved monitors. Registration takes place on the companion device."}</p>}{visible.data?.truncated && <p>{es ? "Se muestran hasta 100 monitores." : "Showing up to 100 monitors."}</p>}</div>}
  </main>;
}
