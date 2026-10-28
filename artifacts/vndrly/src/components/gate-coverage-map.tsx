import { MapPin, Users, SignalZero, ClipboardList, Radio, RefreshCw, Satellite, Map as MapIcon, Maximize2, Minimize2, Scan } from "lucide-react";
import { WorkspacePanel } from "@/components/work-hub/workspace-panel";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import type { GateMapVehicle } from "@workspace/api-zod";
import { gateMapVehiclePopup } from "@/lib/gate-map-vehicle-popup";
import "./gate-dashboard.css";
import { MapboxMap } from "@/components/mapbox-map";
import { BrandedInput } from "@/components/work-hub/chrome";
import { changeOverRequest } from "@/lib/change-over-api";
import { useBrand } from "@/hooks/use-brand";
import GateSiteGateSelect from "./gate-site-gate-select";

type Coverage = {
  at: string;
  gates: { id: string; name: string; siteId: number; siteName: string; latitude?: number | null; longitude?: number | null; siteLatitude?: number | null; siteLongitude?: number | null }[];
  staff: { userId: number; name: string; assignment: string; onWatch?: boolean; onCall?: boolean; fresh: boolean; locationReason: string; location: { latitude: number; longitude: number; capturedAt: string } | null }[];
  vehicles?: GateMapVehicle[]; vehicleFeedUnavailable?: boolean; vehiclesTruncated?: boolean;
  duties: { id: string; userId?: number; stationId: string; name: string; startedAt: string; coverage: { status?: string } }[];
};

/** Read-only display of server-authorized Gate records; never infers a staff position. */
export function GateCoverageMap({ showGateSelector = false }: { showGateSelector?: boolean }) {
  const { user } = useAuth();
  const brand = useBrand();
  const { i18n } = useTranslation();
  const es = i18n.language?.startsWith("es");
  const c = es ? { live: "En vivo", paused: "Sin conexión en vivo", refresh: "Actualizar", satellite: "Satélite", street: "Calles", fit: "Ver toda la cobertura", expand: "Ampliar mapa", close: "Reducir mapa", all: "Todos", staffed: "Con personal", unstaffed: "Sin turno registrado", gates: "Accesos", staff: "Personal con ubicación actual", missing: "Ubicación pendiente o antigua", details: "Detalles del acceso", select: "Seleccione un acceso en el mapa", noDuty: "No hay turno registrado", noPoints: "No hay ubicaciones disponibles para este filtro" } : { live: "Live", paused: "Not live", refresh: "Refresh", satellite: "Satellite", street: "Street", fit: "Fit to coverage", expand: "Expand map", close: "Collapse map", all: "All", staffed: "Staffed", unstaffed: "No recorded duty", gates: "Gates", staff: "Current staff locations", missing: "Missing or stale locations", details: "Gate details", select: "Select a gate on the map", noDuty: "No duty recorded", noPoints: "No mapped locations for this filter" };
  const [styleKind, setStyleKind] = useState<"satellite" | "street">("satellite");
  const [selectedGate, setSelectedGate] = useState<string | null>(null);
  const [focusedGateId, setFocusedGateId] = useState<string | null>(null);
  const [focusedStaffId, setFocusedStaffId] = useState<number | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [fitRevision, setFitRevision] = useState(0);
  useEffect(() => {
    if (!expanded) return;
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") setExpanded(false); };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [expanded]);
  const [at, setAt] = useState("");
  const instant = at ? new Date(at).toISOString() : null;
  const coverage = useQuery({
    queryKey: ["gate-coverage-map", user?.userId, user?.activeMembershipId, instant],
    queryFn: () => changeOverRequest<Coverage>(`/coverage-map${instant ? `?at=${encodeURIComponent(instant)}` : ""}`),
    enabled: !!user?.vendorId,
    refetchInterval: instant ? false : 30000,
  });
  const gates = coverage.data?.gates ?? [];
  const sites = [...new Map(gates.map(gate => [gate.siteId, { id: gate.siteId, name: gate.siteName }])).values()];
  const focusedGate = gates.find(gate => gate.id === focusedGateId);
  const duties = coverage.data?.duties ?? [];
  const staff = [...(coverage.data?.staff ?? [])].sort((a,b) => a.name.localeCompare(b.name, es ? "es" : "en", { sensitivity: "base" }) || a.userId-b.userId);
  const onWatch = (person: Coverage["staff"][number]) => person.onWatch || duties.some(duty => duty.userId === person.userId);
  const groups = [
    { id: "watch", title: es ? "De guardia" : "On Watch", people: staff.filter(onWatch) },
    { id: "call", title: es ? "Disponible" : "On Call", people: staff.filter(person => !onWatch(person) && person.onCall) },
    { id: "other", title: es ? "Todos los demás" : "Everyone else", people: staff.filter(person => !onWatch(person) && !person.onCall) },
  ];
  const focusStaff = (person: Coverage["staff"][number]) => {
    if (!person.fresh || !person.location) return;
    setSelectedGate(null); setFocusedGateId(null); setFocusedStaffId(person.userId);
  };
  const shownGates = gates;
  const selected = shownGates.find(gate => gate.id === selectedGate);
  const points = [
    ...shownGates.flatMap(gate => {
      const latitude = gate.latitude ?? gate.siteLatitude, longitude = gate.longitude ?? gate.siteLongitude;
      const staffed = duties.some(duty => duty.stationId === gate.id);
      return typeof latitude === "number" && typeof longitude === "number" ? [{ id: `gate:${gate.id}`, latitude, longitude, title: `${gate.siteName} · ${gate.name} · ${staffed ? c.staffed : c.unstaffed}`, label: "G", color: brand.primary, onClick: () => { setSelectedGate(gate.id); setFocusedGateId(gate.id); setFocusedStaffId(null); } }] : [];
    }),
    ...(coverage.data?.staff ?? []).flatMap(person => person.fresh && person.location ? [{ id: `staff:${person.userId}`, latitude: person.location.latitude, longitude: person.location.longitude, title: person.name, label: "●", color: person.onWatch ? "#22c55e" : brand.primary, onClick: () => focusStaff(person) }] : []),
  ];
  const vehiclePoints = (coverage.data?.vehicles ?? []).map(vehicle => ({ id: `vehicle:${vehicle.runId}`, latitude: vehicle.latitude, longitude: vehicle.longitude,
    title: `${vehicle.vehicleLabel || "Vehicle"} · ${vehicle.driverName || vehicle.title}`, label: "T", color: brand.primary,
    popupHtml: gateMapVehiclePopup(vehicle, es), popupOnHover: true, popupClassName: "gate-map-vehicle-popup" }));
  const allPoints = [...points, ...vehiclePoints];
  const selectedPointId = focusedStaffId != null ? `staff:${focusedStaffId}` : selected ? `gate:${selected.id}` : null;
  const focusedPoint = allPoints.find(point => point.id === (focusedStaffId != null ? `staff:${focusedStaffId}` : `gate:${focusedGateId}`));
  if (!user?.vendorId) return null;
  return <section aria-label="Gate coverage map" data-gate-workspace-panel className="space-y-3 rounded-xl border-2 border-[color:var(--brand-primary)] bg-white p-4">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 className="flex items-center gap-2 text-lg font-semibold"><MapPin aria-hidden="true" className="h-5 w-5 text-[var(--brand-primary)]" />{es ? "Mapa de cobertura del acceso" : "Gate coverage map"}</h2>
      <div className="flex items-center gap-2">
        <span className="gate-history-filter gate-map-live" data-live={!instant && coverage.isSuccess && coverage.fetchStatus !== "paused"} role="status"><Radio aria-hidden="true" />{!instant && coverage.isSuccess && coverage.fetchStatus !== "paused" ? c.live : c.paused}</span>
        <button type="button" className="gate-history-filter gate-map-control" disabled={coverage.isFetching} onClick={() => void coverage.refetch()}><RefreshCw aria-hidden="true" />{c.refresh}</button>
      </div>
    </div>
    {showGateSelector && coverage.isSuccess && <GateSiteGateSelect sites={sites} siteId={focusedGate?.siteId ?? 0}
      gate={focusedGate} gateOptions={gates} showGps={false} allOptionLabel={c.all} testId="select-gate-map-location"
      onChange={(_siteId, gateId) => { setFocusedGateId(gateId || null); setSelectedGate(gateId || null); setFocusedStaffId(null); }} />}
    <label className="block text-sm">Coverage time (leave blank for live)<BrandedInput type="datetime-local" value={at} onChange={event => setAt(event.target.value)} /></label>
    {coverage.isPending ? <p role="status">Loading authorized coverage…</p> : coverage.isError ? <p role="alert">Gate coverage is unavailable. No coverage status can be inferred.</p> : <>
      <p className="text-sm">As of {new Date(coverage.data.at).toLocaleString()}</p>
      <div className={expanded ? "fixed inset-0 z-50 flex flex-col gap-3 bg-background p-4" : "space-y-3"}>
        <div className="gate-map-controls" role="group" aria-label="Map controls">
          <div className="gate-map-control-group" role="group" aria-label="Map style">
            <button type="button" className="gate-history-filter gate-map-control" aria-pressed={styleKind === "satellite"} onClick={() => setStyleKind("satellite")}><Satellite aria-hidden="true" />{c.satellite}</button>
            <button type="button" className="gate-history-filter gate-map-control" aria-pressed={styleKind === "street"} onClick={() => setStyleKind("street")}><MapIcon aria-hidden="true" />{c.street}</button>
          </div>
          <div className="gate-map-control-group gate-map-view-controls" role="group" aria-label="Map view">
            <button type="button" className="gate-history-filter gate-map-control" aria-pressed={expanded} onClick={() => setExpanded(value => !value)}>{expanded ? <Minimize2 aria-hidden="true" /> : <Maximize2 aria-hidden="true" />}{expanded ? c.close : c.expand}</button>
            <button type="button" className="gate-history-filter gate-map-control" onClick={() => { setFocusedGateId(null); setSelectedGate(null); setFocusedStaffId(null); setFitRevision(value => value + 1); }}><Scan aria-hidden="true" />{es ? "Ajustar" : "Fit"}</button>
          </div>
        </div>
        <div className="overflow-hidden rounded-xl border-2 border-[color:var(--brand-primary)]" style={expanded ? { flex: 1, minHeight: 0 } : undefined}>
          <MapboxMap key={`${fitRevision}:${expanded}`} points={allPoints} selectedPointId={selectedPointId} panToSelectedPoint styleKind={styleKind}
            center={focusedPoint ? [focusedPoint.longitude, focusedPoint.latitude] : undefined} zoom={focusedPoint ? 16 : 14} fitToData={!focusedPoint} height={expanded ? "100%" : 420} />
        </div>
        {!allPoints.length && <p role="status">{c.noPoints}</p>}
        <div className="gate-map-facts">
          <div className="gate-map-fact"><MapPin aria-hidden="true" /><span>{c.gates}</span><strong>{shownGates.length}</strong></div>
          <div className="gate-map-fact"><Users aria-hidden="true" /><span>{c.staff}</span><strong>{coverage.data.staff.filter(person => person.fresh && person.location).length}</strong></div>
          <div className="gate-map-fact"><SignalZero aria-hidden="true" /><span>{c.missing}</span><strong>{coverage.data.staff.filter(person => !person.fresh || !person.location).length}</strong></div>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">Only current, shared app locations appear on the map. Employees without a current location remain listed below.</p>
      {coverage.data.vehicleFeedUnavailable && <p role="status" className="text-xs text-amber-500">{es ? "No se pudieron cargar algunas ubicaciones de vehículos." : "Some tracked vehicle locations could not be loaded."}</p>}
      {coverage.data.vehiclesTruncated && <p className="text-xs text-muted-foreground">{es ? "Se muestran los primeros vehículos entrantes disponibles." : "Showing the first available tracked inbound vehicles."}</p>}
      <div className="gate-map-rosters">
        <WorkspacePanel title={es ? "Ubicaciones del personal" : "Staff locations"} subtitle={es ? "Observaciones de ubicación registradas" : "Recorded location observations"} icon={Users}>
          {groups.map(group => <details key={group.id} className="gate-panel-disclosure gate-map-staff-group" open={group.id === "watch" ? true : undefined}>
            <summary>{group.title}<small>{group.people.length}</small></summary>
            <ul>{group.people.map(person => <li key={person.userId}><button type="button" className="gate-map-staff-link" disabled={!person.fresh || !person.location}
              title={person.fresh && person.location ? es ? "Ver ubicación en el mapa" : "Show location on map" : es ? "No hay ubicación compartida actual" : "No current shared location"}
              onClick={() => focusStaff(person)}><strong>{person.name}</strong><span>{person.assignment} · {person.locationReason.replaceAll("_", " ")}{person.location && ` · ${new Date(person.location.capturedAt).toLocaleString()}`}</span></button></li>)}</ul>
            {!group.people.length && <p className="pb-3 text-xs text-muted-foreground">{es ? "Ningún empleado" : "No employees"}</p>}
          </details>)}
          {!staff.length && <p className="pb-3 text-sm text-muted-foreground">{es ? "No se devolvieron empleados con la app." : "No app-enabled employees returned."}</p>}
        </WorkspacePanel>
        <WorkspacePanel title={es ? "Guardias registradas" : "Recorded watches"} subtitle={es ? "Personal asignado y estado de cobertura" : "Assigned staff and coverage status"} icon={ClipboardList}>
          <ul>{coverage.data.duties.map(duty => <li key={duty.id}><strong>{duty.name}</strong><span className="text-muted-foreground">{new Date(duty.startedAt).toLocaleString()} · {duty.coverage.status ?? "Coverage status not recorded"}</span></li>)}</ul>
          {!coverage.data.duties.length && <p className="pb-3 text-sm text-muted-foreground">{c.noDuty}</p>}
        </WorkspacePanel>
      </div>
    </>}
  </section>;
}
