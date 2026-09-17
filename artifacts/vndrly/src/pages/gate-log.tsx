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

import PageBackButton from "@/components/page-back-button";
import SplitToggleHalf from "@/components/split-toggle-half";
import { pickTogglePillSrc, splitToggleDividerClass, TOGGLE_IDLE_PILL_SRC } from "@/lib/pick-toggle-pill";
import { cn } from "@/lib/utils";
import { LiveConnectionPill } from "@/components/live-connection-pill";
import { VerticalPillBarShape } from "@/components/vertical-pill-bar-shape";
import { Card, CardContent, CardHeader, CardTitle, CARD_ICON_CLASS, CARD_INNER_TILE_CLASS } from "@/components/ui/card";
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
import GateLogStatCard from "@/components/gate-log-stat-card";

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
  const [view, setView] = useState<"operations" | "reports">("operations");
  const brand = useBrand();
  const activePillSrc = pickTogglePillSrc(brand.primary, brand.name);
  const dividerClass = splitToggleDividerClass("light");
  return (
    <div className="mx-auto max-w-6xl space-y-5 p-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <PageBackButton fallbackHref="/" />
          <div>
            <h1 className="text-2xl font-semibold text-black">{t("gateLog.title")}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{t("gateLog.subtitle")}</p>
          </div>
        </div>
        <div className="inline-flex items-stretch overflow-hidden rounded-full print:hidden" data-testid="gate-log-view-toggle">
          <SplitToggleHalf side="left" active={view === "operations"} pillSrc={view === "operations" ? activePillSrc : TOGGLE_IDLE_PILL_SRC} onClick={() => setView("operations")} aria-pressed={view === "operations"}>{t("gateLog.operationsTab", { defaultValue: "Operations" })}</SplitToggleHalf>
          <span aria-hidden className={cn("w-px shrink-0 self-stretch", dividerClass)} />
          <SplitToggleHalf side="right" active={view === "reports"} pillSrc={view === "reports" ? activePillSrc : TOGGLE_IDLE_PILL_SRC} onClick={() => setView("reports")} aria-pressed={view === "reports"}>{t("nav.reports")}</SplitToggleHalf>
        </div>
      </header>
      {view === "operations" ? <GateOperations /> : <GateReport />}
    </div>
  );
}

function GateOperations() {
  const { t } = useTranslation();
  const brand = useBrand();
  const iconStyle = { color: brand.isOrgBranded ? brand.primary : "#f59e0b" };
  const [query, setQuery] = useState("");
  const [siteFilter, setSiteFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [dateFilter, setDateFilter] = useState("");
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

  const fullView = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("view") === "full";
  const recentEvents = useMemo(
    () => [...visits].sort((a, b) => new Date(b.checkOutTime ?? b.checkInTime).getTime() - new Date(a.checkOutTime ?? a.checkInTime).getTime()).slice(0, 10),
    [visits],
  );
  const siteOptions = useMemo(() => Array.from(new Set(visits.map((visit) => visit.siteName).filter((name): name is string => Boolean(name)))).sort(), [visits]);
  const history = useMemo(() => filterGateHistory(visits, query).filter((visit) => {
    if (siteFilter !== "all" && visit.siteName !== siteFilter) return false;
    if (statusFilter === "on-site" && visit.checkOutTime) return false;
    if (statusFilter === "checked-out" && !visit.checkOutTime) return false;
    if (dateFilter && visit.checkInTime.slice(0, 10) !== dateFilter) return false;
    return true;
  }), [dateFilter, query, siteFilter, statusFilter, visits]);
  const liveFiltered = recentEvents;

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

  const visitDetail = (visit: (typeof visits)[number]) => ({ id: visit.id, title: `${visit.firstName} ${visit.lastName}`.trim(), subtitle: [visit.company, visit.siteName, fmt(visit.checkInTime)].filter(Boolean).join(" · ") });
  const todayKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const onSiteRows = visits.filter((visit) => !visit.checkOutTime && visit.admissionStatus !== "pending");
  const overdueRows = onSiteRows.filter((visit) => Boolean(visit.expectedDurationMinutes && dwellMinutes(visit, now) > visit.expectedDurationMinutes));
  const completedRows = visits.filter((visit) => Boolean(visit.checkOutTime) && visit.admissionStatus !== "pending");
  const activeEmployeeIds = new Set((ops.data?.checkIns ?? []).filter((row) => !row.checkOutAt).map((row) => row.employeeId));
  const activeStaffRows = staffRows.filter((row) => activeEmployeeIds.has(row.employeeId));
  const todayRows = visits.filter((visit) => new Date(visit.checkInTime).toLocaleDateString("en-CA") === todayKey);
  const needsAttentionRows = [...new Map([...overdueRows, ...visits.filter((visit) => visit.admissionStatus === "pending")].map((visit) => [visit.id, visit])).values()];
  const statCards = [
    { key: "on-site", label: "On Site Now", value: analytics.onSiteNow, icon: Shield, definition: "People admitted and not yet checked out.", timeWindow: `As of ${now.toLocaleTimeString()}`, details: onSiteRows.map(visitDetail) },
    { key: "overdue", label: "Overdue Visits", value: analytics.overdueNow, icon: AlertTriangle, definition: "On-site visits beyond their expected duration.", timeWindow: `As of ${now.toLocaleTimeString()}`, details: overdueRows.map(visitDetail) },
    { key: "dwell", label: "Average Dwell", value: `${analytics.avgDwellMinutes}m`, icon: Clock, definition: "Average completed visit duration in the returned history window.", timeWindow: "Current Gate Log history window", details: completedRows.slice(0, 25).map(visitDetail) },
    { key: "today", label: "Today’s Entries", value: todayRows.length, icon: ClipboardList, definition: "Gate entries recorded today in local time.", timeWindow: now.toLocaleDateString(), details: todayRows.map(visitDetail) },
    { key: "coverage", label: "Gate Coverage", value: activeStaffRows.length, icon: Users, definition: "Gate staff currently clocked in.", timeWindow: `As of ${now.toLocaleTimeString()}`, details: activeStaffRows.map((row) => ({ id: row.employeeId, title: row.name, subtitle: [row.vendorName, `${row.hoursClocked} hours clocked`].filter(Boolean).join(" · ") })) },
    { key: "attention", label: "Needs Attention", value: needsAttentionRows.length, icon: AlertTriangle, definition: "Pending admissions and overdue on-site visits requiring review.", timeWindow: `As of ${now.toLocaleTimeString()}`, details: needsAttentionRows.map(visitDetail) },
  ];

  return (
    <div className="space-y-6" data-testid="gate-log-page">
      <div className="flex justify-end">
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
        {statCards.map(({ key, ...stat }) => <GateLogStatCard key={key} {...stat} iconColor={String(iconStyle.color)} testId={`gate-log-stat-${key}`} />)}
      </div>

      <Card data-testid="gate-log-on-site">
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <CardTitle className="text-lg flex items-center gap-2">
            <Shield className={CARD_ICON_CLASS} style={iconStyle} />
            {t("gateLog.liveTitle")}
          </CardTitle>
          <Link href="/gate-log?view=full" className="text-sm font-medium underline hover:text-[var(--brand-primary)]">View Full Log</Link>
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
                    <p className="text-xs text-muted-foreground">{visit.checkOutTime ? `${fmt(visit.checkInTime)} → ${fmt(visit.checkOutTime)}` : t("gateLog.dwellSoFar", { minutes: dwellMinutes(visit, now) })}</p>
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

      {fullView && <><div className="flex flex-wrap gap-3">
       <div className="relative min-w-[240px] flex-1">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t("gateLog.searchPlaceholder")}
          aria-label={t("gateLog.searchPlaceholder")}
          className="rounded-full border-2 border-[color:var(--brand-primary)] bg-white pl-9"
          data-testid="gate-log-search"
        />
       </div>
       <select className="h-10 rounded-full border-2 border-[color:var(--brand-primary)] bg-white px-3 text-sm" value={siteFilter} onChange={(event) => setSiteFilter(event.target.value)} aria-label="Filter by site">
         <option value="all">All sites</option>
         {siteOptions.map((site) => <option key={site} value={site}>{site}</option>)}
       </select>
       <select className="h-10 rounded-full border-2 border-[color:var(--brand-primary)] bg-white px-3 text-sm" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} aria-label="Filter by status">
         <option value="all">All statuses</option><option value="on-site">On site</option><option value="checked-out">Checked out</option>
       </select>
       <Input type="date" className="w-auto rounded-full border-2 border-[color:var(--brand-primary)] bg-white" value={dateFilter} onChange={(event) => setDateFilter(event.target.value)} aria-label="Filter by date" />
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
      </Card></>}

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
