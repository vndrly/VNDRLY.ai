import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { summarizeGpsDistance, type DistancePing } from "@workspace/map-utils";
import { loadMapboxAccessToken } from "@/lib/maps";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { RecentTrip } from "./recent-trips-card";

type CrewPoint = {
  employeeId: number; employeeName: string; ticketId: number; lifecycleState: string | null;
  latitude: number; longitude: number; siteLatitude: number | null; siteLongitude: number | null;
  siteName: string | null; recordedAt: string;
};
const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
async function read<T>(url: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal, credentials: "include" });
  if (!response.ok) throw new Error("Crew information unavailable");
  return response.json();
}

export function CrewInspector({ point, scope }: { point: CrewPoint; scope: string }) {
  const { t } = useTranslation();
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  const date = new Date(now).toISOString().slice(0, 10);
  const age = now - Date.parse(point.recordedAt);
  const canRoute = point.lifecycleState === "en_route" && point.siteLatitude != null && point.siteLongitude != null && Number.isFinite(age) && age >= -60_000 && age < 15 * 60_000;
  const track = useQuery({
    queryKey: ["crew-inspector-track", scope, point.employeeId, date],
    queryFn: ({ signal }) => read<{ pings: DistancePing[] }>(`${BASE}/api/field-employees/${point.employeeId}/day-track?date=${date}`, signal),
    staleTime: 60_000,
    refetchInterval: 60_000,
    retry: false,
  });
  const trip = useQuery({
    queryKey: ["crew-inspector-trip", scope, point.ticketId],
    queryFn: ({ signal }) => read<{ trips: RecentTrip[] }>(`${BASE}/api/map/recent-trips?limit=100`, signal),
    staleTime: 60_000,
    refetchInterval: 60_000,
    retry: false,
  });
  const route = useQuery({
    queryKey: ["crew-inspector-route", scope, point.ticketId, point.latitude, point.longitude, point.siteLatitude, point.siteLongitude],
    enabled: canRoute,
    staleTime: 60_000,
    retry: false,
    queryFn: async ({ signal }) => {
      const token = await loadMapboxAccessToken();
      if (!token) throw new Error("Route unavailable");
      const coordinates = `${point.longitude},${point.latitude};${point.siteLongitude},${point.siteLatitude}`;
      const response = await fetch(`https://api.mapbox.com/directions/v5/mapbox/driving-traffic/${coordinates}?overview=false&access_token=${encodeURIComponent(token)}`, { signal });
      if (!response.ok) throw new Error("Route unavailable");
      const body = await response.json() as { code?: string; routes?: { duration: number; distance: number }[] };
      const result = body.routes?.[0];
      if (body.code !== "Ok" || !result || !Number.isFinite(result.duration) || result.duration < 0) throw new Error("Route unavailable");
      return { minutes: Math.ceil(result.duration / 60), arrival: new Date(Date.now() + result.duration * 1000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) };
    },
  });
  const distance = track.data ? summarizeGpsDistance(track.data.pings.filter((ping) => ping.ticketId === point.ticketId)) : null;
  const dailyDistance = track.data ? summarizeGpsDistance(track.data.pings) : null;
  const current = trip.data?.trips.find((row) => row.ticketId === point.ticketId && row.employeeId === point.employeeId);
  const elapsed = (start: string | null | undefined) => {
    const duration = start ? (current?.checkOutTime ? Date.parse(current.checkOutTime) : now) - Date.parse(start) : NaN;
    return Number.isFinite(duration) && duration >= 0 ? Math.round(duration / 60_000) : null;
  };
  const run = elapsed(current?.enRouteAt);
  const onSite = elapsed(current?.checkInTime ?? current?.arrivedAt);
  const missing = t("common.notAvailable", { defaultValue: "Unavailable" });
  return <section className="border-y py-3" aria-label={point.employeeName} data-testid="crew-inspector">
    <div className="flex items-center justify-between gap-2 mb-2">
      <h2 className="text-base font-semibold">{point.employeeName}</h2>
      <Button variant="ghost" size="icon" title={t("common.refresh")} aria-label={t("common.refresh")} onClick={() => { void track.refetch(); void trip.refetch(); if (route.isEnabled) void route.refetch(); }}><RefreshCw className="h-4 w-4" /></Button>
    </div>
    <dl className="grid grid-cols-2 lg:grid-cols-4 gap-3 text-sm">
      <div><dt className="text-muted-foreground">{t("crewMap.inspector.destination")}</dt><dd>{point.siteName ?? missing}</dd></div>
      <div><dt className="text-muted-foreground">{t("crewMap.inspector.routeEta")}</dt><dd>{route.data && canRoute && now - route.dataUpdatedAt < 120_000 ? `${route.data.arrival} (${route.data.minutes} min)` : missing}</dd></div>
      <div><dt className="text-muted-foreground">{t("crewMap.inspector.runTime")}</dt><dd>{run == null ? missing : `${run} min`}</dd></div>
      <div><dt className="text-muted-foreground">{t("crewMap.inspector.siteTime")}</dt><dd>{onSite == null ? missing : `${onSite} min`}</dd></div>
      <div><dt className="text-muted-foreground">{t("crewMap.inspector.recordedDistance")}</dt><dd>{distance?.segments ? `${(distance.meters / 1609.344).toFixed(1)} mi` : missing}</dd></div>
      <div><dt className="text-muted-foreground">{t("crewMap.inspector.dailyRecordedDistance")}</dt><dd>{dailyDistance?.segments ? `${(dailyDistance.meters / 1609.344).toFixed(1)} mi` : missing}</dd></div>
      <div><dt className="text-muted-foreground">{t("crewMap.inspector.gaps")}</dt><dd>{distance?.gaps ?? missing}</dd></div>
      <div><dt className="text-muted-foreground">{t("crewMap.inspector.gpsTime")}</dt><dd>{new Date(point.recordedAt).toLocaleTimeString()}</dd></div>
    </dl>
  </section>;
}
