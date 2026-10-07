import type { OperationsDisplayView } from "@workspace/api-zod";
import { MapboxMap } from "@/components/mapbox-map";
type ViewKind = "crew_map" | "gate_log" | "safety" | "coverage" | "meeting_room";

const labels: Record<ViewKind, string> = {
  crew_map: "Crew map", gate_log: "Gate log", safety: "Safety response",
  coverage: "Workforce coverage", meeting_room: "Meeting room",
};
const spanishLabels: Record<ViewKind, string> = { crew_map: "Mapa del personal", gate_log: "Registro de acceso", safety: "Respuesta de seguridad", coverage: "Cobertura del personal", meeting_room: "Sala de reunión" };
const statusLabels: Record<string, [string, string]> = { checked_in: ["Checked in", "Entrada registrada"], checked_out: ["Checked out", "Salida registrada"], auto_checked_out: ["Automatically checked out", "Salida automática registrada"], pending_admission: ["Admission pending", "Admisión pendiente"], en_route: ["En route", "En camino"], on_location: ["At location", "En la ubicación"], on_site: ["On site", "En el sitio"], off_site: ["Off site", "Fuera del sitio"], scheduled: ["Scheduled", "Programada"], active: ["Active", "Activa"], open: ["Open", "Abierta"], closed: ["Closed", "Cerrada"], acknowledged: ["Acknowledged", "Confirmada"] };

export default function OperationsDisplayPage({
  displayName = "Operations display", monitorName = "Monitor", view = "crew_map", privacyMode = true, data, spanish = false,
}: { displayName?: string; monitorName?: string; view?: ViewKind; privacyMode?: boolean; data?: OperationsDisplayView; spanish?: boolean }) {
  displayName = data?.displayName ?? displayName; monitorName = data?.monitorName ?? monitorName;
  view = data?.view ?? view; privacyMode = data?.privacyMode ?? privacyMode;
  const points = (data?.records ?? []).filter(row => row.latitude !== undefined && row.longitude !== undefined).map(row => ({ id: row.id, title: row.title, latitude: row.latitude!, longitude: row.longitude! }));
  return (
    <main className="min-h-screen w-screen overflow-hidden bg-slate-950 text-white" data-testid="operations-display" data-read-only="true">
      <header className="flex items-center justify-between border-b border-white/15 px-6 py-4">
        <div><p className="text-sm text-white/65">{displayName} · {monitorName}</p><h1 className="text-2xl font-semibold">{spanish ? spanishLabels[view] : labels[view]}</h1></div>
        <div className="text-right text-xs text-white/60"><p>{spanish ? "Pantalla de solo lectura" : "Read-only display"}</p>{privacyMode && <p>{spanish ? "Modo privado" : "Privacy mode"}</p>}</div>
      </header>
      <section className="grid min-h-[calc(100vh-81px)] place-items-center p-6" aria-live="polite">
        <div className="w-full space-y-5">
          {data && <p>{spanish ? "Última actualización" : "Last refresh"}: {new Date(data.receivedAt).toLocaleString()} · {spanish ? "Configuración guardada" : "Saved configuration"}: {new Date(data.configuredAt).toLocaleString()}</p>}
          {view === "crew_map" && points.length > 0 && <MapboxMap points={points} fitToData height="50vh" scrollZoom={false} />}
          {!data?.records.length && <p>{spanish ? "No hay registros autorizados para este monitor." : "No authorized records for this monitor."}</p>}
          {data?.records.map(row => <article key={row.id} className="rounded-lg border border-white/20 p-4"><h2 className="text-xl">{spanish && privacyMode ? row.title.replace(/^Visit /, "Visita ").replace(/^Ticket /, "Ticket ") : row.title}</h2><p>{statusLabels[row.status]?.[spanish ? 1 : 0] ?? row.status.replaceAll("_", " ")}</p><p>{spanish ? row.detail.replace("Recorded Gate visit", "Visita de acceso registrada").replace("Reported phone location", "Ubicación reportada por teléfono").replace("recorded present", "presencias registradas").replace("assigned", "asignadas").replace("required", "requeridas") : row.detail}</p>{row.sourceRecordedAt && <p className="text-sm text-white/65">{spanish ? "Registrado" : "Recorded"}: {new Date(row.sourceRecordedAt).toLocaleString()}</p>}</article>)}
          {data?.truncated && <p>{spanish ? "La consulta alcanzó su límite de 100 registros; pueden faltar registros anteriores de este sitio." : "The source query reached its 100-record limit; older records for this site may be omitted."}</p>}
          {view === "meeting_room" && <p className="text-sm text-white/65">{spanish ? "Cámara apagada · Micrófono apagado" : "Camera off · Microphone off"}</p>}
          <p className="text-sm text-white/65">{spanish ? "Registros guardados. La ubicación física del monitor y la reproducción en otra pantalla no se han verificado." : "Saved records. Physical monitor placement and playback on another screen have not been verified."}</p>
        </div>
      </section>
    </main>
  );
}
