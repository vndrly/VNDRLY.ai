import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useSearch } from "wouter";
import { ClipboardList, MapPin } from "lucide-react";
import { useTranslation } from "react-i18next";
import { evaluateGpsFence, type ShiftNote, type ShiftNotesResponse } from "@workspace/gate-booth";
import { useAuth } from "@/hooks/use-auth";
import { changeOverRequest as request } from "@/lib/change-over-api";
import ContentPaneBackLink from "./content-pane-back-link";
import { FIELD_OPS_PAGE_CLASS } from "@/lib/field-ops-content-pane";
import { BrandedInput } from "./work-hub/chrome";
import GateSiteGateSelect from "./gate-site-gate-select";
import { GateShiftNoteContent } from "./gate-shift-note-content";
import { GateReportToolbar } from "./gate-report-toolbar";
import "./gate-dashboard.css";

type Gate = { id: string; name: string; siteId: number; siteName: string; active?: boolean; latitude?: number | null; longitude?: number | null; siteLatitude?: number | null; siteLongitude?: number | null; geofenceRadiusM?: number };
const noteTime = (value: string, es: boolean) => new Intl.DateTimeFormat(es ? "es-US" : "en-US", { timeZone: "America/Chicago", dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) + " CT";
function NoteRow({ note, gate, es, renderSnapshot }: { note: ShiftNote; gate: Gate; es: boolean; renderSnapshot?: (note: ShiftNote) => ReactNode }) {
  const cache = useQueryClient(), [viewed, setViewed] = useState(Boolean(note.viewed_at));
  return <details className="gate-panel-disclosure gate-note-list-record" onToggle={event => {
    if (!event.currentTarget.open || viewed) return;
    setViewed(true);
    void request(`/${gate.id}/notes/${note.id}/viewed`, {}).then(() => cache.invalidateQueries({ queryKey: ["gate-recent-shift-notes"] })).catch(() => setViewed(false));
  }}>
    <summary><span className="min-w-0 flex-1"><strong>{noteTime(note.filed_at ?? note.created_at ?? note.acknowledged_at, es)}</strong><small>{note.outgoing_name} → {note.incoming_name}</small></span></summary>
    <div className="gate-panel-detail">
      <GateShiftNoteContent note={note} />
      {renderSnapshot && <details><summary>{es ? "Registro guardado" : "Saved shift record"}</summary><ul>{note.summary.facts.map(fact => <li key={fact.id}>{fact.text}</li>)}</ul>{renderSnapshot(note)}</details>}
      <Link className="underline" href={`/gate/shift-notes?${new URLSearchParams({ siteId: String(gate.siteId), stationId: gate.id, handoffId: note.id })}`}>{es ? "Abrir registro completo del turno" : "Open full shift record"}</Link>
    </div>
  </details>;
}
function GateNotesGroup({ gate, initialOpen, search, es, identity, linkedNote, renderSnapshot }: { gate: Gate; initialOpen: boolean; search: string; es: boolean; identity: string; linkedNote?: string | null; renderSnapshot?: (note: ShiftNote) => ReactNode }) {
  const [open, setOpen] = useState(initialOpen);
  const notes = useInfiniteQuery({
    queryKey: ["gate-shift-notes-by-gate", identity, gate.siteId, gate.id, search, 30, linkedNote],
    initialPageParam: null as { before: string; beforeId?: string } | null,
    queryFn: ({ pageParam }) => request<ShiftNotesResponse>(`/${gate.id}/notes?${new URLSearchParams({ ...(linkedNote ? { handoffId: linkedNote } : { days: "30" }), ...(search ? { search } : {}), ...(pageParam ?? {}) })}`),
    getNextPageParam: page => page.nextBefore ? { before: page.nextBefore, ...(page.nextBeforeId ? { beforeId: page.nextBeforeId } : {}) } : undefined,
    retry: false,
  });
  const rows = [...new Map((notes.data?.pages.flatMap(page => page.rows) ?? []).map(note => [note.id, note])).values()];
  return <details className="gate-panel-disclosure gate-notes-gate-group" open={open} onToggle={event => setOpen(event.currentTarget.open)}>
    <summary><MapPin aria-hidden="true" /><span className="min-w-0 flex-1">{gate.siteName} | {gate.name}</span><small>{notes.isSuccess ? `${rows.length}${notes.hasNextPage ? "+" : ""}` : ""}</small></summary>
    {open && <div className="gate-notes-gate-content">
      {notes.isPending && <p role="status">{es ? "Cargando notas…" : "Loading notes…"}</p>}
      {notes.isError && <p role="alert">{es ? "No se pudieron cargar las notas." : "Notes could not be loaded."}<button type="button" className="ml-2 underline" onClick={() => void notes.refetch()}>{es ? "Reintentar" : "Retry"}</button></p>}
      {notes.isSuccess && !rows.length && <p>{es ? "No hay notas de turno en los últimos 30 días." : "No shift notes in the last 30 days."}</p>}
      {rows.map(note => <NoteRow key={note.id} note={note} gate={gate} es={es} renderSnapshot={linkedNote ? renderSnapshot : undefined} />)}
      {notes.hasNextPage && <button type="button" className="gate-history-filter mt-2" disabled={notes.isFetchingNextPage} onClick={() => void notes.fetchNextPage()}>{es ? "Cargar más de los últimos 30 días" : "Load more from the last 30 days"}</button>}
    </div>}
  </details>;
}
export default function GateShiftNotesList({ renderSnapshot }: { renderSnapshot?: (note: ShiftNote) => ReactNode }) {
  const { user } = useAuth(), { i18n } = useTranslation();
  const es = i18n.language?.startsWith("es") ?? false, params = new URLSearchParams(useSearch());
  const linkedNote = params.get("handoffId");
  const [search, setSearch] = useState("");
  const [selectedGateId, setSelectedGateId] = useState(params.get("stationId") ?? "");
  const [gpsPosition, setGpsPosition] = useState<{ latitude: number; longitude: number } | null>(null);
  useEffect(() => {
    if (!navigator.geolocation) return;
    const watch = navigator.geolocation.watchPosition(position => setGpsPosition({ latitude: position.coords.latitude, longitude: position.coords.longitude }), () => setGpsPosition(null), { enableHighAccuracy: true, timeout: 15000, maximumAge: 10000 });
    return () => navigator.geolocation.clearWatch(watch);
  }, []);
  const identity = JSON.stringify([user?.userId, user?.activeMembershipId, user?.vendorId, user?.partnerId]);
  const discovery = useQuery({
    queryKey: ["gate-shift-notes-discovery", identity],
    queryFn: async () => {
      const { sites } = await request<{ sites: { id: number; name: string; latitude?: number | null; longitude?: number | null }[] }>("/sites?mode=history");
      const gates: Gate[] = [];
      // Bound discovery traffic; every gate still uses current server authorization.
      for (const site of sites) {
        const { stations } = await request<{ stations: { id: string; name: string; active?: boolean; latitude?: number | null; longitude?: number | null; geofenceRadiusM?: number }[] }>(`/stations?siteId=${site.id}&mode=history`);
        gates.push(...stations.filter(gate => gate.active !== false).map(gate => ({ ...gate, siteId: site.id, siteName: site.name, siteLatitude: site.latitude, siteLongitude: site.longitude })));
      }
      return gates.sort((a, b) => a.siteName.localeCompare(b.siteName) || Number(b.active !== false) - Number(a.active !== false) || a.name.localeCompare(b.name));
    },
    enabled: Boolean(user?.userId), retry: false,
  });
  const gates = discovery.data ?? [];
  const selectedGate = gates.find(gate => gate.id === selectedGateId);
  const sites = [...new Map(gates.map(gate => [gate.siteId, { id: gate.siteId, name: gate.siteName }])).values()];
  const allSiteIds = sites.map(site => site.id).join(",");
  // A selected site exports its full 30 days; All combines every displayed site.
  const filters = useMemo(() => selectedGate ? ({ siteId: selectedGate.siteId, range: "30d" as const, recordType: "all" as const })
    : allSiteIds ? ({ siteId: Number(allSiteIds.split(",")[0]), siteIds: allSiteIds.split(",").map(Number), range: "30d" as const, recordType: "all" as const }) : null,
    [selectedGate?.siteId, allSiteIds]);
  const shownGates = selectedGate ? [selectedGate] : gates;
  const initialGate = selectedGate?.id;
  const latitude = selectedGate?.latitude ?? selectedGate?.siteLatitude, longitude = selectedGate?.longitude ?? selectedGate?.siteLongitude;
  const fence = evaluateGpsFence({ gps: gpsPosition ? "locked" : "unavailable", origin: gpsPosition,
    site: latitude != null && longitude != null ? { latitude, longitude, siteRadiusMeters: selectedGate?.geofenceRadiusM ?? 500 } : null });
  const gpsStatus = fence.milesToSite == null ? "unavailable" : fence.insideFence ? "verified" : "mismatch";
  const gpsLabel = !selectedGate ? es ? "Seleccione un acceso para comparar GPS" : "Choose a gate to compare GPS" : gpsStatus === "verified" ? es ? "GPS coincide con el acceso seleccionado" : "GPS matches the selected gate" : gpsStatus === "mismatch" ? es ? "GPS fuera del acceso seleccionado" : "GPS outside the selected gate" : es ? "GPS no disponible" : "GPS unavailable";
  return <div className={`${FIELD_OPS_PAGE_CLASS} space-y-5`}>
    <div className="flex items-center gap-3"><ContentPaneBackLink href="/gate/change-over" ariaLabel={es ? "Panel" : "Dashboard"} /><ClipboardList aria-hidden="true" className="h-5 w-5 text-[var(--brand-primary)]" /><h1 className="text-2xl font-bold">{es ? "Notas de turno" : "Shift Notes"}</h1></div>
    <section className="hub-home-card gate-shift-notes-card" aria-label={es ? "Notas de turno" : "Shift Notes"}>
      <header className="gate-shift-notes-header">
        <h2 className="flex items-center gap-2"><ClipboardList aria-hidden="true" className="h-5 w-5 text-[var(--brand-primary)]" />{es ? "Notas de turno" : "Shift Notes"}</h2>
        <GateSiteGateSelect sites={sites} siteId={selectedGate?.siteId ?? 0} gate={selectedGate}
          gateOptions={gates} history allOptionLabel={es ? "Todos" : "All"} testId="select-shift-notes-location"
          gpsStatus={gpsStatus} gpsLabel={gpsLabel} onChange={(_siteId, gateId) => setSelectedGateId(gateId)} />
        <div className="gate-shift-notes-export" title={selectedGate ? `${es ? "Exportar" : "Export"}: ${selectedGate.siteName} · ${es ? "Todos los accesos · Últimos 30 días" : "All gates · Last 30 days"}` : es ? "Exportar todos los sitios · Últimos 30 días" : "Export all sites · Last 30 days"}>
          <GateReportToolbar dropdown reportKind="shift_notes" filters={filters} disabled={!filters} />
        </div>
      </header>
      <div className="gate-shift-notes-search-export">
        <BrandedInput aria-label={es ? "Buscar notas" : "Search notes"} placeholder={es ? "Buscar notas" : "Search notes"} className="gate-shift-notes-search min-w-0 flex-1" value={search} onChange={event => setSearch(event.target.value)} />

      </div>
      {discovery.isPending && <p role="status">{es ? "Cargando accesos…" : "Loading gates…"}</p>}
      {discovery.isError && <p role="alert">{es ? "No se pudieron cargar los accesos autorizados." : "Authorized gates could not be loaded."}</p>}
      {discovery.isSuccess && !gates.length && <p>{es ? "No hay accesos autorizados." : "No authorized gates."}</p>}
      {shownGates.map(gate => <GateNotesGroup key={`${identity}:${gate.id}`} gate={gate} initialOpen={gate.id === initialGate} search={search} es={es} identity={identity} linkedNote={gate.id === selectedGateId ? linkedNote : null} renderSnapshot={renderSnapshot} />)}
    </section>
  </div>;
}
