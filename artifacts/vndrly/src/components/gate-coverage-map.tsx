import { MapPin, Users, SignalZero, ClipboardList } from "lucide-react";
import { WorkspacePanel } from "@/components/work-hub/workspace-panel";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { MapboxMap } from "@/components/mapbox-map";
import { BrandedInput } from "@/components/work-hub/chrome";
import { changeOverRequest } from "@/lib/change-over-api";
import PngPill, { PngPillButton } from "@/components/png-pill-rollover";
import { useBrand } from "@/hooks/use-brand";

type Coverage = {
  at: string;
  gates: { id: string; name: string; siteName: string; latitude?: number | null; longitude?: number | null; siteLatitude?: number | null; siteLongitude?: number | null }[];
  staff: { userId: number; name: string; assignment: string; fresh: boolean; locationReason: string; location: { latitude: number; longitude: number; capturedAt: string } | null }[];
  duties: { id: string; stationId: string; name: string; startedAt: string; coverage: { status?: string } }[];
};

/** Read-only display of server-authorized Gate records; never infers a staff position. */
export function GateCoverageMap() {
  const { user } = useAuth();
  const brand = useBrand();
  const { i18n } = useTranslation();
  const es = i18n.language?.startsWith("es");
  const c = es ? { live: "En vivo", paused: "Sin conexión en vivo", refresh: "Actualizar", satellite: "Satélite", street: "Calles", fit: "Ver toda la cobertura", expand: "Ampliar mapa", close: "Reducir mapa", all: "Todos", staffed: "Con personal", unstaffed: "Sin turno registrado", gates: "Accesos", staff: "Personal con ubicación actual", missing: "Ubicación pendiente o antigua", details: "Detalles del acceso", select: "Seleccione un acceso en el mapa", noDuty: "No hay turno registrado", noPoints: "No hay ubicaciones disponibles para este filtro" } : { live: "Live", paused: "Not live", refresh: "Refresh", satellite: "Satellite", street: "Street", fit: "Fit to coverage", expand: "Expand map", close: "Collapse map", all: "All", staffed: "Staffed", unstaffed: "No recorded duty", gates: "Gates", staff: "Current staff locations", missing: "Missing or stale locations", details: "Gate details", select: "Select a gate on the map", noDuty: "No duty recorded", noPoints: "No mapped locations for this filter" };
  const [styleKind, setStyleKind] = useState<"satellite" | "street">("satellite");
  const [filter, setFilter] = useState<"all" | "staffed" | "unstaffed">("all");
  const [selectedGate, setSelectedGate] = useState<string | null>(null);
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
  const duties = coverage.data?.duties ?? [];
  const shownGates = gates.filter(gate => filter === "all" || (filter === "staffed") === duties.some(duty => duty.stationId === gate.id));
  const selected = shownGates.find(gate => gate.id === selectedGate);
  const points = [
    ...shownGates.flatMap(gate => {
      const latitude = gate.latitude ?? gate.siteLatitude, longitude = gate.longitude ?? gate.siteLongitude;
      const staffed = duties.some(duty => duty.stationId === gate.id);
      return typeof latitude === "number" && typeof longitude === "number" ? [{ id: `gate:${gate.id}`, latitude, longitude, title: `${gate.siteName} · ${gate.name} · ${staffed ? c.staffed : c.unstaffed}`, label: "G", color: brand.primary, onClick: () => setSelectedGate(gate.id) }] : [];
    }),
    ...(coverage.data?.staff ?? []).flatMap(person => filter === "all" && person.fresh && person.location ? [{ id: `staff:${person.userId}`, latitude: person.location.latitude, longitude: person.location.longitude, title: person.name, label: "●" }] : []),
  ];
  if (!user?.vendorId) return null;
  return <section aria-label="Gate coverage map" data-gate-workspace-panel className="space-y-3 rounded-xl border-2 border-[color:var(--brand-primary)] bg-white p-4">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 className="flex items-center gap-2 text-lg font-semibold"><MapPin aria-hidden="true" className="h-5 w-5 text-[var(--brand-primary)]" />{es ? "Mapa de cobertura del acceso" : "Gate coverage map"}</h2>
      <div className="flex items-center gap-2">
        <PngPill color="green" rest={!!instant || !coverage.isSuccess || coverage.isFetching || coverage.fetchStatus === "paused"}>{!instant && coverage.isSuccess && !coverage.isFetching && coverage.fetchStatus !== "paused" ? c.live : c.paused}</PngPill>
        <PngPillButton disabled={coverage.isFetching} onClick={() => void coverage.refetch()}>{c.refresh}</PngPillButton>
      </div>
    </div>
    <label className="block text-sm">Coverage time (leave blank for live)<BrandedInput type="datetime-local" value={at} onChange={event => setAt(event.target.value)} /></label>
    {coverage.isPending ? <p role="status">Loading authorized coverage…</p> : coverage.isError ? <p role="alert">Gate coverage is unavailable. No coverage status can be inferred.</p> : <>
      <p className="text-sm">As of {new Date(coverage.data.at).toLocaleString()}</p>
      <div className={expanded ? "fixed inset-0 z-50 flex flex-col gap-3 bg-background p-4" : "space-y-3"}>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Map controls">
          <PngPillButton aria-pressed={styleKind === "satellite"} onClick={() => setStyleKind("satellite")}>{c.satellite}</PngPillButton>
          <PngPillButton aria-pressed={styleKind === "street"} onClick={() => setStyleKind("street")}>{c.street}</PngPillButton>
          <PngPillButton onClick={() => setFitRevision(value => value + 1)}>{c.fit}</PngPillButton>
          <PngPillButton aria-pressed={expanded} onClick={() => setExpanded(value => !value)}>{expanded ? c.close : c.expand}</PngPillButton>
        </div>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Gate coverage filters">
          {(["all", "staffed", "unstaffed"] as const).map(value => <PngPillButton key={value} aria-pressed={filter === value} onClick={() => { setFilter(value); setSelectedGate(null); }}>{c[value]}</PngPillButton>)}
        </div>
        <div className="overflow-hidden rounded-xl border-2 border-[color:var(--brand-primary)]" style={expanded ? { flex: 1, minHeight: 0 } : undefined}>
          <MapboxMap key={`${fitRevision}:${expanded}`} points={points} selectedPointId={selected ? `gate:${selected.id}` : null} styleKind={styleKind} fitToData height={expanded ? "100%" : 420} />
        </div>
        {!points.length && <p role="status">{c.noPoints}</p>}
        <div className="gate-map-facts">
          <div className="gate-map-fact"><MapPin aria-hidden="true" /><span>{c.gates}</span><strong>{shownGates.length}</strong></div>
          <div className="gate-map-fact"><Users aria-hidden="true" /><span>{c.staff}</span><strong>{coverage.data.staff.filter(person => person.fresh && person.location).length}</strong></div>
          <div className="gate-map-fact"><SignalZero aria-hidden="true" /><span>{c.missing}</span><strong>{coverage.data.staff.filter(person => !person.fresh || !person.location).length}</strong></div>
        </div>
        <div className="rounded-xl border-2 border-[color:var(--brand-primary)] p-3" aria-label={c.details}>
          {selected ? <><strong>{selected.siteName} · {selected.name}</strong>{duties.filter(duty => duty.stationId === selected.id).map(duty => <p key={duty.id}>{duty.name} · {duty.coverage.status ?? "Coverage status not recorded"}</p>)}{!duties.some(duty => duty.stationId === selected.id) && <p>{c.noDuty}</p>}</> : <p>{c.select}</p>}
        </div>
      </div>
      <p className="text-xs text-muted-foreground">Only current, consented staff observations appear on the map. Missing or stale locations remain listed below.</p>
      <div className="gate-map-rosters">
        <WorkspacePanel title={es ? "Ubicaciones del personal" : "Staff locations"} subtitle={es ? "Observaciones de ubicación registradas" : "Recorded location observations"} icon={Users}>
          <ul>{coverage.data.staff.map(person => <li key={person.userId}><strong>{person.name}</strong><span className="text-muted-foreground">{person.assignment} · {person.locationReason.replaceAll("_", " ")}{person.location && ` · ${new Date(person.location.capturedAt).toLocaleString()}`}</span></li>)}</ul>
          {!coverage.data.staff.length && <p className="pb-3 text-sm text-muted-foreground">{es ? "No hay registros de personal de turno para esta hora." : "No on-duty staff records returned for this time."}</p>}
        </WorkspacePanel>
        <WorkspacePanel title={es ? "Guardias registradas" : "Recorded watches"} subtitle={es ? "Personal asignado y estado de cobertura" : "Assigned staff and coverage status"} icon={ClipboardList}>
          <ul>{coverage.data.duties.map(duty => <li key={duty.id}><strong>{duty.name}</strong><span className="text-muted-foreground">{new Date(duty.startedAt).toLocaleString()} · {duty.coverage.status ?? "Coverage status not recorded"}</span></li>)}</ul>
          {!coverage.data.duties.length && <p className="pb-3 text-sm text-muted-foreground">{c.noDuty}</p>}
        </WorkspacePanel>
      </div>
    </>}
  </section>;
}
