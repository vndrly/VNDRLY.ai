import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { useTranslation } from "react-i18next";
import { TicketRouteMap, type RoutePoint } from "@/components/ticket-route-map";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";
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

function downloadText(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function CrewReplayPage({ employeeId }: { employeeId: number }) {
  const { t } = useTranslation();
  const search = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : new URLSearchParams();
  const [date, setDate] = useState<string>(search.get("date") ?? new Date().toISOString().slice(0, 10));
  const [data, setData] = useState<DayTrack | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scrubIndex, setScrubIndex] = useState(0);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`${API_BASE}/api/field-employees/${employeeId}/day-track?date=${date}`, { credentials: "include" })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((j) => {
        if (!cancelled) {
          setData(j);
          setError(null);
          setScrubIndex(Math.max(0, (j.pings?.length ?? 1) - 1));
        }
      })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : t("crewReplay.failed")); });
    return () => { cancelled = true; };
  }, [employeeId, date, t]);

  const points: RoutePoint[] = useMemo(
    () =>
      (data?.pings ?? []).map((p) => ({
        id: p.id,
        latitude: p.latitude,
        longitude: p.longitude,
        recordedAt: p.recordedAt,
      })),
    [data?.pings],
  );

  const maxIndex = Math.max(0, points.length - 1);
  const visiblePoints = points.slice(0, scrubIndex + 1);
  const selectedId = points[scrubIndex]?.id ?? null;

  useEffect(() => {
    if (!playing || points.length <= 1) return;
    const id = window.setInterval(() => {
      setScrubIndex((prev) => {
        if (prev >= maxIndex) {
          setPlaying(false);
          return prev;
        }
        return prev + 1;
      });
    }, 600);
    return () => window.clearInterval(id);
  }, [playing, points.length, maxIndex]);

  function exportCsv() {
    if (!data?.pings?.length) return;
    const header = "id,ticketId,latitude,longitude,eventType,recordedAt,batteryLevel\n";
    const rows = data.pings
      .map(
        (p) =>
          `${p.id},${p.ticketId},${p.latitude},${p.longitude},${p.eventType},${p.recordedAt},${p.batteryLevel ?? ""}`,
      )
      .join("\n");
    downloadText(`crew-replay-${employeeId}-${date}.csv`, header + rows);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Link href="/crew-map" className="group inline-flex items-center gap-2 text-sm">
          <SphereBackButton size={24} /> {t("crewReplay.backToCrewMap")}
        </Link>
      </div>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">{t("crewReplay.dayReplayTitle", { name: data?.employee.name ?? t("crewReplay.employeeFallback") })}</h1>
          <p className="text-sm text-muted-foreground">{t("crewReplay.subtitle")}</p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={exportCsv} disabled={!points.length} data-testid="button-export-replay">
          {t("crewReplay.exportCsv", "Export CSV")}
        </Button>
      </div>
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">{t("crewReplay.date")}</CardTitle>
        </CardHeader>
        <CardContent className="flex items-center gap-3 flex-wrap">
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

      {points.length > 0 && (
        <Card data-testid="card-replay-scrubber">
          <CardContent className="py-4 space-y-3">
            <div className="flex items-center justify-between text-sm">
              <span>
                {t("crewReplay.scrubberLabel", "Timeline")}{" "}
                {scrubIndex + 1} / {points.length}
              </span>
              <div className="flex gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setPlaying((p) => !p)}
                  disabled={points.length <= 1}
                  data-testid="button-replay-play"
                >
                  {playing ? t("crewReplay.pause", "Pause") : t("crewReplay.play", "Play")}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => setScrubIndex(0)}
                  data-testid="button-replay-reset"
                >
                  {t("crewReplay.reset", "Reset")}
                </Button>
              </div>
            </div>
            <Slider
              value={[scrubIndex]}
              min={0}
              max={maxIndex}
              step={1}
              onValueChange={(v) => {
                setPlaying(false);
                setScrubIndex(v[0] ?? 0);
              }}
              data-testid="slider-replay-scrubber"
            />
            {points[scrubIndex]?.recordedAt && (
              <div className="text-xs text-muted-foreground">
                {new Date(String(points[scrubIndex]!.recordedAt)).toLocaleString()}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="p-0">
          <TicketRouteMap
            tracking={visiblePoints}
            height={520}
            showHeadings
            selectedTrackingId={selectedId}
            onSelectTracking={(id) => {
              const idx = points.findIndex((p) => p.id === id);
              if (idx >= 0) setScrubIndex(idx);
            }}
          />
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
                borderLeft: "5px solid transparent",
                borderRight: "5px solid transparent",
                borderBottom: "10px solid #2563eb",
              }}
            />
            {t("crewReplay.legendHeading")}
          </span>
          <span>{t("crewReplay.legendRoute")}</span>
        </CardContent>
      </Card>
    </div>
  );
}
