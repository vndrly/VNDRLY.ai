import { useEffect, useState } from "react";
import { Link } from "wouter";
import { useTranslation } from "react-i18next";
import { TicketRouteMap, type RoutePoint } from "@/components/ticket-route-map";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import SphereBackButton from "@/components/sphere-back-button";

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

type Ping = {
  id: number;
  ticketId: number;
  latitude: number;
  longitude: number;
  eventType: string;
  recordedAt: string;
  batteryLevel: number | null;
};

type DayTrack = {
  employee: { id: number; name: string };
  date: string;
  pings: Ping[];
};

export default function CrewReplayPage({ employeeId }: { employeeId: number }) {
  const { t } = useTranslation();
  const search = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : new URLSearchParams();
  const [date, setDate] = useState<string>(search.get("date") ?? new Date().toISOString().slice(0, 10));
  const [data, setData] = useState<DayTrack | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`${API_BASE}/api/field-employees/${employeeId}/day-track?date=${date}`, { credentials: "include" })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((j) => { if (!cancelled) { setData(j); setError(null); } })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : t("crewReplay.failed")); });
    return () => { cancelled = true; };
  }, [employeeId, date, t]);

  const points: RoutePoint[] = (data?.pings ?? []).map((p) => ({
    id: p.id,
    latitude: p.latitude,
    longitude: p.longitude,
    recordedAt: p.recordedAt,
  }));

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Link href="/crew-map" className="group inline-flex items-center gap-2 text-sm">
          <SphereBackButton size={24} /> {t("crewReplay.backToCrewMap")}
        </Link>
      </div>
      <div>
        <h1 className="text-2xl font-bold">{t("crewReplay.dayReplayTitle", { name: data?.employee.name ?? t("crewReplay.employeeFallback") })}</h1>
        <p className="text-sm text-muted-foreground">{t("crewReplay.subtitle")}</p>
      </div>
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">{t("crewReplay.date")}</CardTitle>
        </CardHeader>
        <CardContent className="flex items-center gap-3">
          <Label htmlFor="date" className="sr-only">{t("crewReplay.date")}</Label>
          <Input
            id="date"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="w-48"
            data-testid="input-replay-date"
          />
          <div className="text-sm text-muted-foreground">
            {data ? t("crewReplay.pings", { count: data.pings.length }) : ""}
          </div>
        </CardContent>
      </Card>

      {error && <div className="text-sm text-destructive">{error}</div>}

      <Card>
        <CardContent className="p-0">
          <TicketRouteMap tracking={points} height={520} showHeadings />
        </CardContent>
      </Card>

      <Card className="border-dashed" data-testid="card-replay-legend">
        <CardContent className="py-3 text-xs text-muted-foreground flex flex-wrap items-center gap-x-4 gap-y-2">
          <span className="font-medium text-foreground">{t("crewReplay.legendTitle")}</span>
          <span className="inline-flex items-center gap-1.5" data-testid="legend-heading-arrow">
            <span
              aria-hidden="true"
              style={{
                display: "inline-block",
                width: 0,
                height: 0,
                borderLeft: "6px solid transparent",
                borderRight: "6px solid transparent",
                borderBottom: "12px solid #2563eb",
                filter: "drop-shadow(0 1px 1px rgba(0,0,0,.4))",
              }}
            />
            {t("crewReplay.legendArrow")}
          </span>
          <span className="inline-flex items-center gap-1.5" data-testid="legend-heading-stationary">
            <span
              aria-hidden="true"
              style={{
                position: "relative",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                width: 18,
                height: 18,
                borderRadius: "9999px",
                border: "2px dashed rgba(37,99,235,.55)",
              }}
            >
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: "9999px",
                  background: "#2563eb",
                  border: "2px solid white",
                  boxSizing: "content-box",
                }}
              />
            </span>
            {t("crewReplay.legendStationary")}
          </span>
        </CardContent>
      </Card>
    </div>
  );
}
