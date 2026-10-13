import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { MapboxMap } from "@/components/mapbox-map";
import { BrandedInput } from "@/components/work-hub/chrome";
import { changeOverRequest } from "@/lib/change-over-api";

type Coverage = {
  at: string;
  gates: { id: string; name: string; siteName: string; latitude?: number | null; longitude?: number | null; siteLatitude?: number | null; siteLongitude?: number | null }[];
  staff: { userId: number; name: string; assignment: string; fresh: boolean; locationReason: string; location: { latitude: number; longitude: number; capturedAt: string } | null }[];
  duties: { id: string; name: string; startedAt: string; coverage: { status?: string } }[];
};

/** Read-only display of server-authorized Gate records; never infers a staff position. */
export function GateCoverageMap() {
  const { user } = useAuth();
  const [at, setAt] = useState("");
  const instant = at ? new Date(at).toISOString() : null;
  const coverage = useQuery({
    queryKey: ["gate-coverage-map", user?.userId, user?.activeMembershipId, instant],
    queryFn: () => changeOverRequest<Coverage>(`/coverage-map${instant ? `?at=${encodeURIComponent(instant)}` : ""}`),
    enabled: !!user?.vendorId,
    refetchInterval: instant ? false : 30000,
  });
  const points = [
    ...(coverage.data?.gates ?? []).flatMap(gate => {
      const latitude = gate.latitude ?? gate.siteLatitude, longitude = gate.longitude ?? gate.siteLongitude;
      return typeof latitude === "number" && typeof longitude === "number" ? [{ id: `gate:${gate.id}`, latitude, longitude, title: `${gate.siteName} · ${gate.name}` }] : [];
    }),
    ...(coverage.data?.staff ?? []).flatMap(person => person.fresh && person.location ? [{ id: `staff:${person.userId}`, latitude: person.location.latitude, longitude: person.location.longitude, title: person.name }] : []),
  ];
  if (!user?.vendorId) return null;
  return <section aria-label="Gate coverage map" className="space-y-3 rounded-xl border-2 border-[color:var(--brand-primary)] bg-white p-4">
    <h2 className="text-lg font-semibold">Gate coverage map</h2>
    <label className="block text-sm">Coverage time (leave blank for live)<BrandedInput type="datetime-local" value={at} onChange={event => setAt(event.target.value)} /></label>
    {coverage.isPending ? <p role="status">Loading authorized coverage…</p> : coverage.isError ? <p role="alert">Gate coverage is unavailable. No coverage status can be inferred.</p> : <>
      <p className="text-sm">As of {new Date(coverage.data.at).toLocaleString()}</p>
      <MapboxMap points={points} fitToData height={360} />
      <p className="text-xs text-muted-foreground">Only current, consented staff observations appear on the map. Missing or stale locations remain listed below.</p>
      <ul className="space-y-2">{coverage.data.staff.map(person => <li key={person.userId}><strong>{person.name}</strong> · {person.assignment} · {person.locationReason.replaceAll("_", " ")}{person.location && ` · ${new Date(person.location.capturedAt).toLocaleString()}`}</li>)}</ul>
      <ul className="space-y-2">{coverage.data.duties.map(duty => <li key={duty.id}>{duty.name} · {new Date(duty.startedAt).toLocaleString()} · {duty.coverage.status ?? "Coverage status not recorded"}</li>)}</ul>
      {!coverage.data.staff.length && <p>No on-duty staff records returned for this time.</p>}
    </>}
  </section>;
}
