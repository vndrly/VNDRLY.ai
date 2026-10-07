import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { OperationsDisplayViewSchema, type OperationsDisplayView } from "@workspace/api-zod";
import { useAuth } from "@/hooks/use-auth";
import OperationsDisplayPage from "./operations-display";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
export default function OperationsDisplayViewer({ displayId, monitorId }: { displayId: string; monitorId: string }) {
  const { user } = useAuth();
  const { i18n } = useTranslation();
  const spanish = i18n.language.startsWith("es");
  const identity = `${user?.userId}:${user?.role}:${user?.vendorId}:${user?.partnerId}:${user?.activeMembershipId}:${displayId}:${monitorId}`;
  const [result, setResult] = useState<{ identity: string; data: OperationsDisplayView | null; error: boolean } | null>(null);
  useEffect(() => {
    let current = true, running = false;
    let controller: AbortController | null = null;
    setResult(null);
    if (!user) return () => { current = false; controller?.abort(); };
    async function refresh() {
      if (!current || running) return;
      running = true;
      controller = new AbortController();
      const timeout = window.setTimeout(() => controller?.abort(), 15_000);
      try {
        const response = await fetch(`${BASE}/api/implementation-a/operations-display-view/${encodeURIComponent(displayId)}/${encodeURIComponent(monitorId)}`, { credentials: "include", cache: "no-store", signal: controller.signal });
        if (!response.ok) throw Error("unavailable");
        const data = OperationsDisplayViewSchema.parse(await response.json());
        if (data.displayId !== displayId || data.monitorId !== monitorId) throw Error("wrong monitor");
        if (current) setResult({ identity, data, error: false });
      } catch { if (current) setResult({ identity, data: null, error: true }); }
      finally { window.clearTimeout(timeout); running = false; }
    }
    void refresh(); const timer = window.setInterval(() => { void refresh(); }, 30_000);
    return () => { current = false; controller?.abort(); window.clearInterval(timer); };
  }, [identity]);
  const visible = result?.identity === identity ? result : null;
  if (!user || visible?.error) return <main className="min-h-screen bg-slate-950 p-8 text-white"><h1>{spanish ? "Pantalla no disponible" : "Display unavailable"}</h1><p>{spanish ? "Inicie sesión en la cuenta autorizada y revise el monitor guardado." : "Sign in to the authorized account and check the saved monitor."}</p></main>;
  if (!visible?.data) return <main className="min-h-screen bg-slate-950 p-8 text-white">{spanish ? "Cargando registros autorizados…" : "Loading authorized records…"}</main>;
  return <OperationsDisplayPage data={visible.data} spanish={spanish} />;
}
