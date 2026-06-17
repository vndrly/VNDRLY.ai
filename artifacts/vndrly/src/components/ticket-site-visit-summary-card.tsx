import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { useTranslation } from "react-i18next";
import { formatTicketTrackingNumber } from "@workspace/db/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PngPillButton as PillButton } from "@/components/png-pill-rollover";
import { TicketRouteMap } from "@/components/ticket-route-map";
import { buildGpsTimelineCsv } from "@/lib/gps-timeline-csv";
import { MapPin, Route, Clock, Users, Navigation, AlertTriangle, CheckCircle2, FileText } from "lucide-react";

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export type SiteVisitPerson = {
  key: string;
  role: "lead" | "crew";
  sessionId: number | null;
  employeeId: number;
  employeeName: string;
  checkInAt: string | null;
  checkOutAt: string | null;
  onSiteMinutes: number | null;
  travelMinutes: number | null;
  checkInLatitude: number | null;
  checkInLongitude: number | null;
  checkOutLatitude: number | null;
  checkOutLongitude: number | null;
  checkInDistanceMeters: number | null;
  insideGeofence: boolean | null;
  replayDate: string | null;
  source: string | null;
};

export type SiteVisitSummary = {
  ticketId: number;
  trackingNumber: string;
  lifecycleState: string | null;
  status: string;
  site: {
    name: string | null;
    siteCode: string | null;
    latitude: number;
    longitude: number;
    siteRadiusMeters: number;
  } | null;
  timeline: {
    enRouteAt: string | null;
    onLocationAt: string | null;
    arrivedAt: string | null;
    checkInTime: string | null;
    checkOutTime: string | null;
  };
  route: Array<{
    id: number;
    latitude: number;
    longitude: number;
    eventType: string;
    recordedAt: string;
  }>;
  people: SiteVisitPerson[];
  totals: {
    peopleCount: number;
    totalOnSiteMinutes: number;
    leadTravelMinutes: number | null;
    routePointCount: number;
    routeSpanMinutes: number | null;
  };
};

function normalizeSiteVisitSummary(
  json: Partial<SiteVisitSummary> & Record<string, unknown>,
): SiteVisitSummary {
  return {
    ticketId: typeof json.ticketId === "number" ? json.ticketId : 0,
    trackingNumber: typeof json.trackingNumber === "string" ? json.trackingNumber : "",
    lifecycleState: (json.lifecycleState as string | null) ?? null,
    status: typeof json.status === "string" ? json.status : "",
    site: json.site ?? null,
    timeline: json.timeline ?? {
      enRouteAt: null,
      onLocationAt: null,
      arrivedAt: null,
      checkInTime: null,
      checkOutTime: null,
    },
    route: Array.isArray(json.route) ? json.route : [],
    people: Array.isArray(json.people) ? json.people : [],
    totals: json.totals ?? {
      peopleCount: 0,
      totalOnSiteMinutes: 0,
      leadTravelMinutes: null,
      routePointCount: 0,
      routeSpanMinutes: null,
    },
  };
}

function fmtMinutes(min: number | null, t: (k: string, o?: Record<string, unknown>) => string): string {
  if (min == null) return "—";
  if (min < 60) return t("ticketDetail.siteVisitSummary.minutes", { min });
  const hr = Math.floor(min / 60);
  const rem = min % 60;
  return t("ticketDetail.siteVisitSummary.hoursMinutes", { hr, min: rem });
}

function fmtTime(iso: string | null, locale?: string): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString(locale);
  } catch {
    return iso;
  }
}

export function TicketSiteVisitSummaryCard({ ticketId }: { ticketId: number }) {
  const { t, i18n } = useTranslation();
  const [data, setData] = useState<SiteVisitSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`${API_BASE}/api/tickets/${ticketId}/site-visit-summary`, { credentials: "include" })
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((json) => {
        if (!cancelled) {
          setData(normalizeSiteVisitSummary(json as Partial<SiteVisitSummary> & Record<string, unknown>));
          setError(null);
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setData(null);
          setError(e instanceof Error ? e.message : t("ticketDetail.siteVisitSummary.failed"));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [ticketId, t]);

  const selected = useMemo(
    () => data?.people.find((p) => p.key === selectedKey) ?? null,
    [data?.people, selectedKey],
  );

  const routePoints = useMemo(
    () =>
      (data?.route ?? []).map((p) => ({
        id: p.id,
        latitude: p.latitude,
        longitude: p.longitude,
        recordedAt: p.recordedAt,
      })),
    [data?.route],
  );

  const visitPins = useMemo(() => {
    if (!data?.people.length) return [];
    return data.people
      .filter((p) => p.checkInLatitude != null && p.checkInLongitude != null)
      .map((p, idx) => ({
        key: p.key,
        latitude: p.checkInLatitude as number,
        longitude: p.checkInLongitude as number,
        label: String(idx + 1),
        title: `${p.employeeName} · ${fmtMinutes(p.onSiteMinutes, t)}`,
      }));
  }, [data?.people, t]);

  const lead = data?.people.find((p) => p.role === "lead");

  const handleGpsExport = useCallback(() => {
    if (!data?.route.length || typeof window === "undefined") return;
    const csv = buildGpsTimelineCsv(
      data.route.map((p) => ({
        latitude: p.latitude,
        longitude: p.longitude,
        recordedAt: p.recordedAt,
      })),
    );
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${formatTicketTrackingNumber(ticketId)}-gps-timeline.csv`;
    a.rel = "noopener";
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }, [data?.route, ticketId]);

  return (
    <Card data-testid="card-site-visit-summary">
      <CardHeader className="pb-2">
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
          <MapPin className="w-5 h-5" style={{ color: "var(--brand-primary, #f59e0b)" }} />
          {t("ticketDetail.siteVisitSummary.title")}
          <PillButton
            type="button"
            color="image"
            className="ml-auto h-7 px-2 text-xs"
            onClick={handleGpsExport}
            disabled={!data?.route.length}
            data-testid="button-gps-timeline-export"
            title={t("ticketDetail.gpsTimelineExportTitle")}
          >
            <FileText className="w-3.5 h-3.5 mr-1" />
            {t("ticketDetail.gpsTimelineExport")}
          </PillButton>
        </CardTitle>
        <p className="text-sm text-muted-foreground">{t("ticketDetail.siteVisitSummary.subtitle")}</p>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <div className="text-sm text-muted-foreground">{t("ticketDetail.siteVisitSummary.loading")}</div>
        ) : error ? (
          <div className="text-sm text-muted-foreground">{error}</div>
        ) : !data ? null : (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              <div className="rounded border p-2 text-sm">
                <div className="text-xs text-muted-foreground flex items-center gap-1">
                  <Users className="h-3.5 w-3.5" />
                  {t("ticketDetail.siteVisitSummary.onSiteCount")}
                </div>
                <div className="font-semibold">{data.totals.peopleCount}</div>
              </div>
              <div className="rounded border p-2 text-sm">
                <div className="text-xs text-muted-foreground flex items-center gap-1">
                  <Clock className="h-3.5 w-3.5" />
                  {t("ticketDetail.siteVisitSummary.totalOnSite")}
                </div>
                <div className="font-semibold">{fmtMinutes(data.totals.totalOnSiteMinutes, t)}</div>
              </div>
              <div className="rounded border p-2 text-sm">
                <div className="text-xs text-muted-foreground">{t("ticketDetail.siteVisitSummary.travel")}</div>
                <div className="font-semibold">{fmtMinutes(data.totals.leadTravelMinutes, t)}</div>
              </div>
              <div className="rounded border p-2 text-sm">
                <div className="text-xs text-muted-foreground">{t("ticketDetail.siteVisitSummary.routePoints")}</div>
                <div className="font-semibold">{data.totals.routePointCount}</div>
              </div>
            </div>

            <TicketRouteMap
              site={
                data.site
                  ? {
                      latitude: data.site.latitude,
                      longitude: data.site.longitude,
                      name: data.site.name ?? undefined,
                    }
                  : null
              }
              siteRadiusMeters={data.site?.siteRadiusMeters ?? null}
              checkIn={
                lead?.checkInLatitude != null && lead.checkInLongitude != null
                  ? {
                      latitude: lead.checkInLatitude,
                      longitude: lead.checkInLongitude,
                      time: lead.checkInAt ?? data.timeline.checkInTime,
                    }
                  : null
              }
              checkOut={
                lead?.checkOutLatitude != null && lead.checkOutLongitude != null
                  ? {
                      latitude: lead.checkOutLatitude,
                      longitude: lead.checkOutLongitude,
                      time: lead.checkOutAt ?? data.timeline.checkOutTime,
                    }
                  : null
              }
              tracking={routePoints}
              visitPins={visitPins}
              height={340}
            />

            <div className="rounded border overflow-hidden">
              <div className="px-3 py-2 bg-muted/40 text-xs font-semibold">
                {t("ticketDetail.siteVisitSummary.peopleOnSite")}
              </div>
              <div className="divide-y max-h-[280px] overflow-y-auto">
                {data.people.length === 0 ? (
                  <div className="p-3 text-sm text-muted-foreground">
                    {t("ticketDetail.siteVisitSummary.noPeople")}
                  </div>
                ) : (
                  data.people.map((person) => {
                    const active = selectedKey === person.key;
                    return (
                      <button
                        key={person.key}
                        type="button"
                        className={`w-full text-left p-3 text-sm hover:bg-muted/30 transition-colors ${active ? "bg-muted/50" : ""}`}
                        onClick={() => setSelectedKey(active ? null : person.key)}
                        data-testid={`site-visit-person-${person.employeeId}`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <div className="font-medium flex items-center gap-1.5">
                              {person.employeeName}
                              <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                                {person.role === "lead"
                                  ? t("ticketDetail.siteVisitSummary.lead")
                                  : t("ticketDetail.siteVisitSummary.crew")}
                              </span>
                            </div>
                            <div className="text-xs text-muted-foreground mt-0.5">
                              {fmtMinutes(person.onSiteMinutes, t)} ·{" "}
                              {person.checkInAt ? fmtTime(person.checkInAt, i18n.language) : "—"}
                              {person.checkOutAt
                                ? ` → ${fmtTime(person.checkOutAt, i18n.language)}`
                                : ` · ${t("ticketDetail.live")}`}
                            </div>
                          </div>
                          <div className="shrink-0">
                            {person.insideGeofence === true && (
                              <CheckCircle2 className="h-4 w-4 text-emerald-600" aria-label="Inside geofence" />
                            )}
                            {person.insideGeofence === false && (
                              <AlertTriangle className="h-4 w-4 text-amber-600" aria-label="Outside geofence" />
                            )}
                          </div>
                        </div>
                        {active && (
                          <div className="mt-2 pt-2 border-t text-xs space-y-1 text-muted-foreground">
                            {person.travelMinutes != null && (
                              <div>{t("ticketDetail.siteVisitSummary.travel")}: {fmtMinutes(person.travelMinutes, t)}</div>
                            )}
                            {person.checkInDistanceMeters != null && (
                              <div>
                                {t("ticketDetail.siteVisitSummary.checkInDistance", {
                                  m: person.checkInDistanceMeters,
                                })}
                              </div>
                            )}
                            <div className="flex flex-wrap gap-2 pt-1">
                              {person.replayDate && (
                                <Button asChild size="sm" variant="outline" className="h-7 text-xs">
                                  <Link href={`/crew-map/${person.employeeId}?date=${person.replayDate}`}>
                                    <Route className="h-3 w-3 mr-1" />
                                    {t("ticketDetail.siteVisitSummary.routeReplay")}
                                  </Link>
                                </Button>
                              )}
                              {person.checkInLatitude != null && person.checkInLongitude != null && (
                                <Button asChild size="sm" variant="ghost" className="h-7 text-xs">
                                  <a
                                    href={`https://www.google.com/maps/search/?api=1&query=${person.checkInLatitude},${person.checkInLongitude}`}
                                    target="_blank"
                                    rel="noreferrer"
                                  >
                                    <Navigation className="h-3 w-3 mr-1" />
                                    {t("ticketDetail.siteVisitSummary.checkInPin")}
                                  </a>
                                </Button>
                              )}
                            </div>
                          </div>
                        )}
                      </button>
                    );
                  })
                )}
              </div>
            </div>

            {data.timeline.enRouteAt && (
              <div className="text-xs text-muted-foreground grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1">
                <span>{t("ticketDetail.siteVisitSummary.enRoute")}: {fmtTime(data.timeline.enRouteAt, i18n.language)}</span>
                <span>{t("ticketDetail.siteVisitSummary.arrived")}: {fmtTime(data.timeline.arrivedAt, i18n.language)}</span>
                <span>{t("ticketDetail.siteVisitSummary.checkIn")}: {fmtTime(data.timeline.checkInTime, i18n.language)}</span>
                <span>{t("ticketDetail.siteVisitSummary.checkOut")}: {fmtTime(data.timeline.checkOutTime, i18n.language)}</span>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
