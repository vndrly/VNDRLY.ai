import { CardHeading } from "@/components/ui/card-heading";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { MapPin, Plus } from "lucide-react";
import ContentPaneBackLink from "@/components/content-pane-back-link";
import { GateCoverageMap } from "@/components/gate-coverage-map";
import { MapboxMap } from "@/components/mapbox-map";
import PngPill, { PngPillButton } from "@/components/png-pill-rollover";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FIELD_OPS_PAGE_CLASS } from "@/lib/field-ops-content-pane";

type Site = { id: number; name: string };
type Gate = { id: string; siteId: number; name: string; latitude: number | null; longitude: number | null; geofenceRadiusM: number; active: boolean; version: number };
type Values = { id?: string; version?: number; siteId: number; name: string; latitude: number; longitude: number; geofenceRadiusM: number; active: boolean };
type Draft = { id?: string; version?: number; name: string; latitude: string; longitude: string; radius: string; active: boolean };
type Review = { values: Values; confirmation: string; idempotencyKey: string };

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/gate-locations${path}`, { credentials: "include", headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) }, ...init });
  if (!response.ok) throw new Error((await response.json().catch(() => null))?.code ?? "Gate locations are unavailable");
  return response.json() as Promise<T>;
}

const emptyDraft = (): Draft => ({ name: "", latitude: "", longitude: "", radius: "500", active: true });

export default function GateLocationsPage() {
  const sites = useQuery({ queryKey: ["gate-locations", "sites"], queryFn: () => request<{ sites: Site[] }>("/sites"), retry: false });
  const [siteId, setSiteId] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [review, setReview] = useState<Review | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [locating, setLocating] = useState(false);
  useEffect(() => { if (!siteId && sites.data?.sites.length) setSiteId(String(sites.data.sites[0].id)); }, [siteId, sites.data]);

  const gates = useQuery({ queryKey: ["gate-locations", siteId], queryFn: () => request<{ gates: Gate[] }>(`?siteId=${siteId}`), enabled: Boolean(siteId), retry: false });
  const selectedSite = sites.data?.sites.find((site) => String(site.id) === siteId);
  const values = useMemo<Values | null>(() => {
    if (!draft || !siteId || !draft.name.trim()) return null;
    const latitude = Number(draft.latitude), longitude = Number(draft.longitude), geofenceRadiusM = Number(draft.radius);
    if (!Number.isFinite(latitude) || Math.abs(latitude) > 90 || !Number.isFinite(longitude) || Math.abs(longitude) > 180 || !Number.isInteger(geofenceRadiusM) || geofenceRadiusM < 1 || geofenceRadiusM > 10000) return null;
    return { ...(draft.id ? { id: draft.id, version: draft.version } : {}), siteId: Number(siteId), name: draft.name.trim(), latitude, longitude, geofenceRadiusM, active: draft.active };
  }, [draft, siteId]);
  const preview = review?.values ?? values;

  function edit(gate?: Gate) {
    setMessage(""); setReview(null);
    setDraft(gate ? { id: gate.id, version: gate.version, name: gate.name, latitude: String(gate.latitude ?? ""), longitude: String(gate.longitude ?? ""), radius: String(gate.geofenceRadiusM), active: gate.active } : emptyDraft());
  }
  function useCurrentLocation() {
    setMessage("");
    if (!navigator.geolocation) { setMessage("Location is unavailable on this device. Enter the coordinates manually."); return; }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (position) => { setDraft((current) => current ? { ...current, latitude: String(position.coords.latitude), longitude: String(position.coords.longitude) } : current); setLocating(false); },
      () => { setMessage("Location permission was unavailable. Enter the coordinates manually."); setLocating(false); },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 },
    );
  }
  async function prepareReview() {
    if (!values) return;
    setBusy(true); setMessage("");
    try { const result = await request<{ values: Values; confirmation: string }>("/preview", { method: "POST", body: JSON.stringify(values) }); setReview({ ...result, idempotencyKey: crypto.randomUUID() }); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Gate location review failed"); }
    finally { setBusy(false); }
  }
  async function confirmSave() {
    if (!review) return;
    setBusy(true); setMessage("");
    try { await request<Gate>("", { method: "POST", body: JSON.stringify({ ...review.values, confirmation: review.confirmation, idempotencyKey: review.idempotencyKey }) }); await gates.refetch(); setReview(null); setDraft(null); setMessage("Gate location saved."); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Gate location could not be saved"); }
    finally { setBusy(false); }
  }

  return <div className={`${FIELD_OPS_PAGE_CLASS} space-y-5`} data-testid="gate-locations-page">
    <div className="flex items-center gap-3"><ContentPaneBackLink href="/" ariaLabel="Dashboard" testId="button-back" /><div><h1 className="text-2xl font-bold tracking-tight">Gate Locations</h1><p className="text-sm text-muted-foreground">Set gate entry points and monitor live gate coverage.</p></div></div>
    <section className="space-y-4 rounded-xl border-2 border-[color:var(--brand-primary)] bg-white p-4" aria-label="Gate location setup">
      <div className="flex flex-wrap items-end justify-between gap-3"><div className="min-w-[240px] space-y-1"><Label>Site location</Label><Select value={siteId} onValueChange={(value) => { setSiteId(value); setDraft(null); setReview(null); setMessage(""); }}><SelectTrigger aria-label="Site location"><SelectValue placeholder="Choose a site" /></SelectTrigger><SelectContent>{sites.data?.sites.map((site) => <SelectItem key={site.id} value={String(site.id)}>{site.name}</SelectItem>)}</SelectContent></Select></div><PngPillButton color="blue" disabled={!siteId || busy} onClick={() => edit()}><Plus className="h-4 w-4" /> Add Gate Location</PngPillButton></div>
      {sites.isPending && <p role="status">Loading authorized sites…</p>}
      {sites.isError && <p role="alert">Gate Locations are available to the current company administrator for assigned Gate sites.</p>}
      {siteId && gates.isPending && <p role="status">Loading gate locations…</p>}
      {gates.data && <div className="grid gap-3 md:grid-cols-2">{gates.data.gates.map((gate) => <button key={gate.id} type="button" onClick={() => edit(gate)} className="flex min-h-20 items-center justify-between gap-3 rounded-xl border-2 border-[color:var(--brand-primary)] p-3 text-left hover:bg-muted/40"><span><strong className="block">{gate.name}</strong><span className="text-xs text-muted-foreground">{gate.latitude == null || gate.longitude == null ? "Location needed" : `${gate.latitude.toFixed(5)}, ${gate.longitude.toFixed(5)} · ${gate.geofenceRadiusM} m boundary`}</span></span><PngPill color="green" rest={!gate.active}>{gate.active ? "Active" : "Inactive"}</PngPill></button>)}</div>}
      {gates.data && !gates.data.gates.length && <p>No gates have been mapped at {selectedSite?.name}. Add the first gate location.</p>}
      {draft && <div data-card-layout className="space-y-4 rounded-xl border bg-muted/20 p-4" aria-label="Gate location editor">
        <div className="flex items-center justify-between"><div><CardHeading as="h2" className="font-semibold">{draft.id ? "Edit Gate Location" : "Add Gate Location"}</CardHeading><p className="text-xs text-muted-foreground">{selectedSite?.name}</p></div><PngPillButton onClick={() => { setDraft(null); setReview(null); }}>Cancel</PngPillButton></div>
        {!review && <><div className="grid gap-3 md:grid-cols-2"><div className="space-y-1"><Label>Gate name</Label><Input aria-label="Gate name" value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></div><div className="space-y-1"><Label>Geofence radius (meters)</Label><Input aria-label="Geofence radius" type="number" min={1} max={10000} value={draft.radius} onChange={(event) => setDraft({ ...draft, radius: event.target.value })} /></div><div className="space-y-1"><Label>Latitude</Label><Input aria-label="Latitude" type="number" step="any" value={draft.latitude} onChange={(event) => setDraft({ ...draft, latitude: event.target.value })} /></div><div className="space-y-1"><Label>Longitude</Label><Input aria-label="Longitude" type="number" step="any" value={draft.longitude} onChange={(event) => setDraft({ ...draft, longitude: event.target.value })} /></div></div><div className="flex flex-wrap gap-2"><PngPillButton color="blue" disabled={locating} onClick={useCurrentLocation}><MapPin className="h-4 w-4" /> {locating ? "Locating…" : "Use My Current Location"}</PngPillButton><PngPillButton color={draft.active ? "red" : "green"} onClick={() => setDraft({ ...draft, active: !draft.active })}>{draft.active ? "Deactivate" : "Reactivate"}</PngPillButton><PngPillButton color="blue" disabled={!values || busy || locating} onClick={prepareReview}>Review Gate Location</PngPillButton></div></>}
        {preview && <div className="overflow-hidden rounded-xl border-2 border-[color:var(--brand-primary)]"><MapboxMap height={300} points={[{ id: "gate", latitude: preview.latitude, longitude: preview.longitude, label: "G", title: preview.name }]} circles={[{ id: "gate-radius", latitude: preview.latitude, longitude: preview.longitude, radiusMeters: preview.geofenceRadiusM }]} center={[preview.longitude, preview.latitude]} zoom={15} fitToData onPointDrag={review ? undefined : (_id, latitude, longitude) => setDraft((current) => current ? { ...current, latitude: String(latitude), longitude: String(longitude) } : current)} /></div>}
        {review && <div className="space-y-3"><p><strong>Confirm:</strong> {review.values.name} · {review.values.latitude.toFixed(6)}, {review.values.longitude.toFixed(6)} · {review.values.geofenceRadiusM} m · {review.values.active ? "Active" : "Inactive"}</p><div className="flex gap-2"><PngPillButton onClick={() => setReview(null)}>Back</PngPillButton><PngPillButton color="blue" disabled={busy} onClick={confirmSave}>{busy ? "Saving…" : "Confirm & Save"}</PngPillButton></div></div>}
      </div>}
      {message && <p role="status" className="text-sm">{message}</p>}
    </section>
    <GateCoverageMap />
  </div>;
}
