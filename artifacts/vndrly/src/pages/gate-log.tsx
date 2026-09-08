import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { useTranslation } from "react-i18next";
import {
  AlertTriangle,
  BarChart3,
  ClipboardList,
  Clock,
  Lightbulb,
  Loader2,
  Search,
  Shield,
  Users,
} from "lucide-react";
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import SphereBackButton from "@/components/sphere-back-button";
import { LiveConnectionPill } from "@/components/live-connection-pill";
import { VerticalPillBarShape } from "@/components/vertical-pill-bar-shape";
import { Card, CardContent, CardHeader, CardTitle, CARD_ICON_CLASS, CARD_ICON_ROW_CLASS, CARD_INNER_TILE_CLASS, CARD_MINI_CONTENT_CLASS } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { useBrand } from "@/hooks/use-brand";
import { useGateLiveMonitor } from "@/hooks/use-gate-live-monitor";
import {
  ANALYTICS_BAR_SIZE,
  ANALYTICS_VERTICAL_CHART_HEIGHT,
  analyticsHorizontalChartHeight,
} from "@/lib/analytics-bar-chart";
import { filterGateHistory } from "@/lib/gate-history";
import { formatPlateForDisplay } from "@/lib/plate-display";
import { buildGateOpsAnalytics, buildGateStaffHours, dwellMinutes } from "@/lib/gate-ops-analytics";
import { visitsApi } from "@/lib/visits-api";
import GateReport from "@/components/gate-report";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const OPS_KEY = ["gate-ops"] as const;

function evidenceUrl(path: string): string {
  return path.startsWith("/objects/") ? `${BASE}/api/storage${path}` : path;
}

function fmt(ts: string | null): string {
  if (!ts) return "—";
  return new Date(ts).toLocaleString();
}

function hourLabel(hour: number): string {
  return `${String(hour).padStart(2, "0")}:00`;
}

export default function GateLogPage() {
  const { t } = useTranslation();
  return (
    <div className="p-6 max-w-6xl mx-auto">
      <h1 className="text-2xl font-semibold mb-4">{t("gateLog.title")}</h1>
      <Tabs defaultValue="operations">
        <TabsList className="print:hidden">
          <TabsTrigger value="operations">{t("gateLog.operationsTab", { defaultValue: "Operations" })}</TabsTrigger>
          <TabsTrigger value="reports">{t("nav.reports")}</TabsTrigger>
        </TabsList>
        <TabsContent value="operations"><GateOperations /></TabsContent>
        <TabsContent value="reports"><GateReport /></TabsContent>
      </Tabs>
    </div>
  );
}

function GateOperations() {
  const { t } = useTranslation();
  const brand = useBrand();
  const iconStyle = { color: brand.isOrgBranded ? brand.primary : "#f59e0b" };
  const [query, setQuery] = useState("");
  const displayPlate = (state: string | null | undefined, plate: string | null | undefined) =>
    formatPlateForDisplay(state, plate, t("gatekeeper.plateStateUnconfirmed"));

  const ops = useQuery({
    queryKey: [...OPS_KEY],
    queryFn: () => visitsApi.gateOps(),
    refetchInterval: 30_000,
    retry: false,
  });
  const now = useMemo(() => new Date(), [ops.dataUpdatedAt]);

  const visits = ops.data?.visits ?? [];
  const live = useGateLiveMonitor({
    enabled: ops.isSuccess,
    siteLocationId: null,
    visits,
    queryKey: OPS_KEY,
  });

  const analytics = useMemo(() => buildGateOpsAnalytics(visits, now), [now, visits]);
  const staffRows = useMemo(
    () =>
      buildGateStaffHours({
        staff: ops.data?.staff ?? [],
        visits: ops.data?.recordedVisits ?? [],
        checkIns: ops.data?.checkIns ?? [],
        now,
      }).sort(
        (a, b) =>
          b.hoursWorked - a.hoursWorked ||
          b.visitsProcessed - a.visitsProcessed ||
          a.name.localeCompare(b.name),
      ),
    [now, ops.data],
  );

  const onSite = visits.filter((visit) => !visit.checkOutTime && visit.admissionStatus !== "pending");
  const history = useMemo(() => filterGateHistory(visits, query), [query, visits]);
  const liveFiltered = useMemo(() => filterGateHistory(onSite, query), [onSite, query]);

  const hourChart = analytics.visitsByHour.map((row) => ({
    ...row,
    label: hourLabel(row.hour),
  }));

  if (ops.isLoading) {
    return (
      <div className="p-6 max-w-6xl mx-auto space-y-4" data-testid="gate-log-page">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  if (ops.isError) {
    return (
      <div className="p-6 max-w-6xl mx-auto" data-testid="gate-log-page">
        <p className="text-sm text-destructive">{t("gateLog.loadFailed")}</p>
      </div>
    );
  }

  if (ops.data && !ops.data.enabled) {
    return (
      <div className="p-6 max-w-6xl mx-auto space-y-3" data-testid="gate-log-page">
        <h1 className="text-2xl font-semibold">{t("gateLog.title")}</h1>
        <p className="text-sm text-muted-foreground">{t("gateLog.notEnabled")}</p>
      </div>
    );
  }

  const statCards = [
    { key: "on-site", label: t("gateLog.onSiteNow"), value: analytics.onSiteNow, icon: Shield },
    { key: "overdue", label: t("gateLog.overdueNow"), value: analytics.overdueNow, icon: AlertTriangle },
    { key: "dwell", label: t("gateLog.avgDwell"), value: `${analytics.avgDwellMinutes}m`, icon: Clock },
    { key: "plates", label: t("gateLog.uniquePlates"), value: analytics.uniquePlates, icon: ClipboardList },
    { key: "auto", label: t("gateLog.autoCheckedOut"), value: analytics.autoCheckedOut, icon: Users },
    { key: "visitors", label: t("gateLog.uniqueVisitors"), value: analytics.uniqueVisitors, icon: BarChart3 },
  ];

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6" data-testid="gate-log-page">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => {
              if (typeof window !== "undefined" && window.history.length > 1) {
                window.history.back();
              }
            }}
            className="group inline-flex items-center"
            aria-label={t("common.back")}
            data-testid="button-back"
          >
            <SphereBackButton size={40} />
          </button>
          <div>
            <h1 className="text-2xl font-semibold">{t("gateLog.title")}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{t("gateLog.subtitle")}</p>
          </div>
        </div>
        <LiveConnectionPill status={live.liveStatus} compact onRefresh={() => void ops.refetch()} />
      </div>

      {live.flash && (
        <div
          className="flex items-center gap-4 rounded-xl border-2 border-amber-500 bg-amber-50 p-4 text-foreground shadow-md dark:bg-amber-100/80"
          data-testid="gate-log-live-flash"
          role="status"
        >
          {live.flash.platePhotoUrl ? (
            <img src={evidenceUrl(live.flash.platePhotoUrl)} alt="" className="h-16 w-24 shrink-0 rounded-md object-cover" />
          ) : (
            <Shield className="h-10 w-10 shrink-0" style={iconStyle} />
          )}
          <div className="min-w-0 flex-1">
            <p className="text-lg font-bold leading-tight">
              {live.flash.kind === "checked_in"
                ? t("gatekeeper.liveCheckedIn", { name: `${live.flash.firstName} ${live.flash.lastName}`.trim() })
                : t("gatekeeper.liveCheckedOut", { name: `${live.flash.firstName} ${live.flash.lastName}`.trim() })}
            </p>
            <p className="mt-1 truncate text-sm text-muted-foreground">
              {[live.flash.company, displayPlate(live.flash.plateState, live.flash.vehiclePlate), live.flash.siteName].filter(Boolean).join(" · ")}
            </p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {statCards.map((stat) => (
          <Card key={stat.key} data-testid={`gate-log-stat-${stat.key}`}>
            <CardContent className={CARD_MINI_CONTENT_CLASS}>
              <div className={CARD_ICON_ROW_CLASS}>
                <stat.icon className={CARD_ICON_CLASS} style={iconStyle} />
                <span className="text-xs text-gray-700 font-medium">{stat.label}</span>
              </div>
              <p className="text-lg font-bold mt-auto text-center">{stat.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card data-testid="gate-log-on-site">
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Shield className={CARD_ICON_CLASS} style={iconStyle} />
            {t("gateLog.liveTitle")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {liveFiltered.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("gateLog.liveEmpty")}</p>
          ) : (
            liveFiltered.map((visit) => (
              <Link
                key={visit.id}
                href={`/visits/${visit.id}`}
                className={`${CARD_INNER_TILE_CLASS} block ${live.flash?.visitId === visit.id ? "ring-2 ring-amber-500" : ""}`}
                data-testid="gate-log-live-row"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold text-foreground">
                      {visit.firstName} {visit.lastName}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {[visit.company, displayPlate(visit.plateState, visit.vehiclePlate), visit.siteName].filter(Boolean).join(" · ")}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {t("gateLog.dwellSoFar", { minutes: dwellMinutes(visit, now) })}
                    </p>
                  </div>
                  <span className="shrink-0 text-xs font-semibold text-muted-foreground">
                    {fmt(visit.checkInTime)}
                  </span>
                </div>
              </Link>
            ))
          )}
        </CardContent>
      </Card>

      <div className="relative max-w-xl">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t("gateLog.searchPlaceholder")}
          aria-label={t("gateLog.searchPlaceholder")}
          className="pl-9"
          data-testid="gate-log-search"
        />
      </div>

      <Card data-testid="gate-log-history">
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <ClipboardList className={CARD_ICON_CLASS} style={iconStyle} />
            {t("gateLog.historyTitle")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {ops.isFetching && visits.length === 0 ? (
            <Loader2 className="animate-spin text-muted-foreground" />
          ) : history.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {query.trim() ? t("gateLog.historyNoMatch") : t("gateLog.historyEmpty")}
            </p>
          ) : (
            history.map((visit) => (
              <Link
                key={visit.id}
                href={`/visits/${visit.id}`}
                className={`${CARD_INNER_TILE_CLASS} block`}
                data-testid="gate-log-history-row"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold text-foreground">
                      {visit.firstName} {visit.lastName}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {[visit.company, displayPlate(visit.plateState, visit.vehiclePlate), visit.siteName].filter(Boolean).join(" · ")}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {fmt(visit.checkInTime)}
                      {visit.checkOutTime ? ` → ${fmt(visit.checkOutTime)}` : ""}
                    </p>
                  </div>
                  <span className="shrink-0 text-xs font-semibold text-muted-foreground">
                    {visit.checkOutTime ? t("gatekeeper.historyCheckedOut") : t("gatekeeper.historyOnSite")}
                  </span>
                </div>
              </Link>
            ))
          )}
        </CardContent>
      </Card>

      <Card data-testid="gate-log-staff">
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Users className={CARD_ICON_CLASS} style={iconStyle} />
            {t("gateLog.staffTitle")}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {staffRows.length === 0 ? (
            <p className="text-sm text-muted-foreground p-6">{t("gateLog.staffEmpty")}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("gateLog.staffName")}</TableHead>
                  <TableHead>{t("gateLog.staffVendor")}</TableHead>
                  <TableHead className="text-center">{t("gateLog.daysWorked")}</TableHead>
                  <TableHead className="text-center">{t("gateLog.hoursClocked")}</TableHead>
                  <TableHead className="text-center">{t("gateLog.visitsProcessed")}</TableHead>
                  <TableHead className="text-right">{t("gateLog.lastSeen")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {staffRows.map((row) => (
                  <TableRow key={row.employeeId} data-testid="gate-log-staff-row">
                    <TableCell className="font-medium">{row.name}</TableCell>
                    <TableCell>{row.vendorName ?? "—"}</TableCell>
                    <TableCell className="text-center">{row.daysWorked}</TableCell>
                    <TableCell className="text-center">{row.hoursClocked}</TableCell>
                    <TableCell className="text-center">{row.visitsProcessed}</TableCell>
                    <TableCell className="text-right text-xs">{fmt(row.lastSeenAt)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <div className="grid md:grid-cols-2 gap-6">
        <Card data-testid="gate-log-visits-by-day">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <BarChart3 className={CARD_ICON_CLASS} style={iconStyle} />
              {t("gateLog.visitsByDay")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {analytics.visitsByDay.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">{t("gateLog.noChartData")}</p>
            ) : (
              <ResponsiveContainer width="100%" height={ANALYTICS_VERTICAL_CHART_HEIGHT}>
                <BarChart data={analytics.visitsByDay}>
                  <XAxis dataKey="day" tick={{ fontSize: 11 }} />
                  <YAxis allowDecimals={false} />
                  <Tooltip cursor={{ fill: "#ccc", fillOpacity: 0.5 }} />
                  <Bar dataKey="checkIns" barSize={ANALYTICS_BAR_SIZE} name={t("gateLog.checkIns")} shape={(p: object) => <VerticalPillBarShape {...p} flatBottom />} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card data-testid="gate-log-visits-by-hour">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Clock className={CARD_ICON_CLASS} style={iconStyle} />
              {t("gateLog.peakHour")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {hourChart.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">{t("gateLog.noChartData")}</p>
            ) : (
              <ResponsiveContainer width="100%" height={ANALYTICS_VERTICAL_CHART_HEIGHT}>
                <BarChart data={hourChart}>
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                  <YAxis allowDecimals={false} />
                  <Tooltip cursor={{ fill: "#ccc", fillOpacity: 0.5 }} />
                  <Bar dataKey="count" barSize={ANALYTICS_BAR_SIZE} name={t("gateLog.checkIns")} shape={(p: object) => <VerticalPillBarShape {...p} flatBottom />} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        <Card data-testid="gate-log-visits-by-site">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <BarChart3 className={CARD_ICON_CLASS} style={iconStyle} />
              {t("gateLog.visitsBySite")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {analytics.visitsBySite.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">{t("gateLog.noChartData")}</p>
            ) : (
              <ResponsiveContainer width="100%" height={analyticsHorizontalChartHeight(analytics.visitsBySite.length)}>
                <BarChart data={analytics.visitsBySite} layout="vertical">
                  <XAxis type="number" allowDecimals={false} />
                  <YAxis type="category" dataKey="siteName" width={120} tick={{ fontSize: 11 }} />
                  <Tooltip cursor={{ fill: "#ccc", fillOpacity: 0.5 }} />
                  <Bar dataKey="count" barSize={ANALYTICS_BAR_SIZE} name={t("gateLog.checkIns")} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card data-testid="gate-log-top-companies">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Users className={CARD_ICON_CLASS} style={iconStyle} />
              {t("gateLog.topCompanies")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {analytics.topCompanies.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">{t("gateLog.noChartData")}</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("gateLog.company")}</TableHead>
                    <TableHead className="text-right">{t("gateLog.visits")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {analytics.topCompanies.map((row) => (
                    <TableRow key={row.name} data-testid="gate-log-company-row">
                      <TableCell>{row.name}</TableCell>
                      <TableCell className="text-right font-medium">{row.count}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      <Card data-testid="gate-log-recommendations">
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Lightbulb className={CARD_ICON_CLASS} style={iconStyle} />
            {t("gateLog.recommendationsTitle")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="list-disc space-y-2 pl-5 text-sm text-muted-foreground">
            <li>{t("gateLog.pendingAdmission")}: {visits.filter((visit) => !visit.checkOutTime && visit.admissionStatus === "pending").length}</li>
            <li>{t("gateLog.overdueNow")}: {analytics.overdueNow}</li>
            <li>{t("gateLog.autoCheckedOut")}: {analytics.autoCheckedOut}</li>
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
