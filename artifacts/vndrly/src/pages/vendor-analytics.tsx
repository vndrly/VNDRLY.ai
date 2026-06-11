import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  useVendorAnalytics,
  useGetVendor,
  getGetVendorQueryKey,
  getVendorAnalyticsQueryKey,
  useGetVendorTransitionAggregate,
  getGetVendorTransitionAggregateQueryKey,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CARD_MINI_CONTENT_CLASS, CARD_ICON_ROW_CLASS, CARD_ICON_CLASS } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import { TexturedPie, TexturedPieLegend, type PieColor } from "@/components/textured-pie";
import { DollarSign, FileText, CheckCircle2, AlertTriangle, Shield, TrendingUp, Users, MapPin, BarChart3 } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Link, useLocation } from "wouter";
import SphereBackButton from "@/components/sphere-back-button";
import { useAuth } from "@/hooks/use-auth";
import { useBrand } from "@/hooks/use-brand";
import { HorizontalPillBarShape } from "@/components/horizontal-pill-bar-shape";
import { VerticalPillBarShape } from "@/components/vertical-pill-bar-shape";
import { formatStatusLabel } from "@/lib/format-status";

const formatCurrency = (val: number) =>
  val >= 1000000
    ? `$${(val / 1000000).toFixed(1)}M`
    : val >= 1000
    ? `$${(val / 1000).toFixed(1)}K`
    : `$${val.toFixed(2)}`;

const formatFullCurrency = (val: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(val);

export default function VendorAnalytics({ vendorId }: { vendorId: number }) {
  const { t } = useTranslation();
  const [, navigate] = useLocation();
  const handleBarClick = (status: string) => navigate(`/tickets?status=${encodeURIComponent(status)}`);
  const { user } = useAuth();
  const brand = useBrand();
  const accentColor = brand.isOrgBranded ? brand.primary : "#f59e0b";
  const iconStyle = { color: accentColor };
  const isOwnVendor = user?.role === "vendor" && user.vendorId === vendorId;
  const { data: vendor } = useGetVendor(vendorId, { query: { enabled: !!vendorId, queryKey: getGetVendorQueryKey(vendorId) } });
  const { data, isLoading } = useVendorAnalytics(vendorId, { query: { enabled: !!vendorId, queryKey: getVendorAnalyticsQueryKey(vendorId) } });
  // Task #858 — audit-trail rollup. The legacy vendor-analytics endpoint
  // doesn't read `ticket_status_history`, so accept rate and denial reasons
  // come from the new aggregate endpoint.
  const { data: auditAggregate } = useGetVendorTransitionAggregate(vendorId, {
    query: {
      enabled: !!vendorId,
      queryKey: getGetVendorTransitionAggregateQueryKey(vendorId),
    },
  });

  if (isLoading) return <div className="space-y-4"><Skeleton className="h-8 w-48" /><Skeleton className="h-48 w-full" /><Skeleton className="h-48 w-full" /></div>;
  if (!data) return <p className="text-muted-foreground">{t("vendorAnalytics.noAnalyticsData")}</p>;

  const statCards = [
    { label: t("vendorAnalytics.totalTickets"), value: data.totalTickets, icon: FileText },
    { label: t("vendorAnalytics.approved"), value: data.approvedTickets, icon: CheckCircle2 },
    { label: t("vendorAnalytics.kickedBack"), value: data.kickedBackTickets, icon: AlertTriangle },
    { label: t("vendorAnalytics.totalRevenue"), value: formatFullCurrency(data.totalRevenue), icon: DollarSign },
    { label: t("vendorAnalytics.gpsCompliance"), value: `${data.gpsCompliance.rate}%`, icon: Shield },
    { label: t("vendorAnalytics.kickbackRate"), value: `${data.kickbackRate}%`, icon: TrendingUp },
  ];

  const pieData = data.revenueByType.map((r) => ({ name: r.type.charAt(0).toUpperCase() + r.type.slice(1), value: r.total }));
  const texturedPalette: PieColor[] = ["amber", "blue", "green", "red"];
  // Pinned per-type pie colors. Mirrors `partner-analytics.tsx` so an
  // "equipment" or "materials" slice reads the same color across both
  // analytics pages. Anything not listed falls through to the
  // round-robin `texturedPalette` by index.
  const typeColorMap: Record<string, PieColor> = {
    equipment: "amber",
    materials: "red",
    other: "grey",
  };
  const pieDataTextured = data.revenueByType.map((r, idx) => {
    const name = r.type.charAt(0).toUpperCase() + r.type.slice(1);
    const explicit = typeColorMap[r.type.toLowerCase()];
    return {
      name,
      value: r.total,
      color: (explicit ?? texturedPalette[idx % texturedPalette.length]) as PieColor,
    };
  });

  return (
    <div className="space-y-6" data-testid="vendor-analytics-page">
      <div className="flex items-center gap-4">
        {!isOwnVendor && <Link href={`/vendors/${vendorId}`} className="group inline-flex items-center" aria-label="Back"><SphereBackButton size={40} /></Link>}
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t("vendorAnalytics.titleFor", { name: vendor?.name || t("vendorAnalytics.vendorFallback") })}</h1>
          <p className="text-muted-foreground text-sm mt-1">{t("vendorAnalytics.subtitle")}</p>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {statCards.map((stat) => (
          <Card key={stat.label} data-testid={`card-stat-${stat.label}`}>
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

      {auditAggregate && (
        <Card data-testid="card-vendor-audit-trail">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Shield className="w-5 h-5" style={iconStyle} />
              {t("vendorAnalytics.auditTrailTitle", { defaultValue: "Acceptance audit trail" })}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
              <div className="text-center">
                <p className="text-xs text-gray-700 font-medium">{t("vendorAnalytics.acceptRate", { defaultValue: "Accept rate" })}</p>
                <p className="text-2xl font-bold mt-1" data-testid="text-vendor-accept-rate">
                  {auditAggregate.acceptRatePercent != null ? `${auditAggregate.acceptRatePercent}%` : "—"}
                </p>
              </div>
              <div className="text-center">
                <p className="text-xs text-gray-700 font-medium">{t("vendorAnalytics.invitesAccepted", { defaultValue: "Invites accepted" })}</p>
                <p className="text-2xl font-bold mt-1">{auditAggregate.acceptCount}</p>
              </div>
              <div className="text-center">
                <p className="text-xs text-gray-700 font-medium">{t("vendorAnalytics.invitesDenied", { defaultValue: "Invites denied" })}</p>
                <p className="text-2xl font-bold mt-1">{auditAggregate.denyCount}</p>
              </div>
            </div>
            {auditAggregate.topDenialReasons.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("vendorAnalytics.denialReason", { defaultValue: "Denial reason" })}</TableHead>
                    <TableHead className="text-right">{t("vendorAnalytics.count", { defaultValue: "Count" })}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {auditAggregate.topDenialReasons.map((reason, idx) => (
                    <TableRow key={idx} data-testid={`row-denial-reason-${idx}`}>
                      <TableCell>{reason.reason}</TableCell>
                      <TableCell className="text-right font-medium">{reason.count}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <p className="text-muted-foreground text-sm text-center py-4">
                {t("vendorAnalytics.noDenialReasons", { defaultValue: "No denials recorded yet." })}
              </p>
            )}
          </CardContent>
        </Card>
      )}

      <div className="grid md:grid-cols-2 gap-6">
        <Card>
          <CardHeader><CardTitle className="text-lg flex items-center gap-2"><BarChart3 className="w-5 h-5" style={iconStyle} />{t("vendorAnalytics.trackingStatusBreakdown")}</CardTitle></CardHeader>
          <CardContent>
            {data.statusBreakdown.length > 0 ? (
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={data.statusBreakdown}>
                  <XAxis dataKey="status" tick={{ fontSize: 11 }} tickFormatter={formatStatusLabel} />
                  <YAxis allowDecimals={false} />
                  <Tooltip cursor={{ fill: "#ccc", fillOpacity: 0.5 }} />
                  <Bar dataKey="count" maxBarSize={28} shape={(p: object) => <VerticalPillBarShape {...p} flatBottom onBarClick={handleBarClick} />} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-muted-foreground text-sm text-center py-8">{t("vendorAnalytics.noTicketsYet")}</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-lg flex items-center gap-2"><DollarSign className="w-5 h-5" style={iconStyle} />{t("vendorAnalytics.revenueByCategory")}</CardTitle></CardHeader>
          <CardContent>
            {pieData.length > 0 ? (
              <div className="flex flex-col items-center gap-3 py-2">
                <TexturedPie
                  data={pieDataTextured}
                  size={240}
                  formatValue={(v) => formatCurrency(v)}
                />
                <TexturedPieLegend
                  data={pieDataTextured}
                  formatValue={(v) => formatCurrency(v)}
                />
              </div>
            ) : (
              <p className="text-muted-foreground text-sm text-center py-8">{t("vendorAnalytics.noRevenueData")}</p>
            )}
          </CardContent>
        </Card>
      </div>

      {(data.revenueByMonth.length > 0 || (data.revenueByYear ?? []).length > 0) && (
        <div className="grid md:grid-cols-2 gap-6">
          <RevenueByPeriodCard rows={data.revenueByMonth} view="month" />
          <RevenueByPeriodCard
            rows={(data.revenueByYear ?? []).map((r) => ({ month: `${r.year}-01`, total: r.total }))}
            view="year"
          />
        </div>
      )}

      <div className="grid md:grid-cols-2 gap-6">
        <Card>
          <CardHeader><CardTitle className="text-lg flex items-center gap-2"><Users className="w-5 h-5" style={iconStyle} />{t("vendorAnalytics.employeePerformance")}</CardTitle></CardHeader>
          <CardContent className="p-0">
            {data.employeePerformance.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("vendorAnalytics.employee")}</TableHead>
                    <TableHead className="text-center">{t("vendorAnalytics.tickets")}</TableHead>
                    <TableHead className="text-center">{t("vendorAnalytics.approved")}</TableHead>
                    <TableHead className="text-right">{t("vendorAnalytics.revenue")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.employeePerformance.map((emp) => (
                    <TableRow key={emp.employeeId}>
                      <TableCell>
                        <Link href={`/field-employees/${emp.employeeId}`} className="font-medium text-gray-700 hover:text-[var(--brand-primary)] transition-colors">{emp.name}</Link>
                        {emp.jobTitle && <p className="text-xs text-muted-foreground">{emp.jobTitle}</p>}
                      </TableCell>
                      <TableCell className="text-center">{emp.ticketCount}</TableCell>
                      <TableCell className="text-center">{emp.approvedCount}</TableCell>
                      <TableCell className="text-right font-medium">{formatFullCurrency(emp.revenue)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <p className="text-muted-foreground text-sm text-center py-8 px-4">{t("vendorAnalytics.noEmployeeData")}</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-lg flex items-center gap-2"><MapPin className="w-5 h-5" style={iconStyle} />{t("vendorAnalytics.activityBySite")}</CardTitle></CardHeader>
          <CardContent className="p-0">
            {data.bySite.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("vendorAnalytics.site")}</TableHead>
                    <TableHead className="text-center">{t("vendorAnalytics.tickets")}</TableHead>
                    <TableHead className="text-right">{t("vendorAnalytics.revenue")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.bySite.map((site) => (
                    <TableRow key={site.siteId}>
                      <TableCell>
                        <Link href={`/site-locations/${site.siteId}`} className="font-medium text-gray-700 hover:text-[var(--brand-primary)] transition-colors">{site.siteName}</Link>
                      </TableCell>
                      <TableCell className="text-center">{site.ticketCount}</TableCell>
                      <TableCell className="text-right font-medium">{formatFullCurrency(site.revenue)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <p className="text-muted-foreground text-sm text-center py-8 px-4">{t("vendorAnalytics.noSiteData")}</p>
            )}
          </CardContent>
        </Card>
      </div>

      {data.topWorkTypes.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-lg flex items-center gap-2"><FileText className="w-5 h-5" style={iconStyle} />{t("vendorAnalytics.topWorkTypes")}</CardTitle></CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("vendorAnalytics.workType")}</TableHead>
                  <TableHead className="text-center">{t("vendorAnalytics.tickets")}</TableHead>
                  <TableHead className="text-right">{t("vendorAnalytics.revenue")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.topWorkTypes.map((wt, idx) => (
                  <TableRow key={idx}>
                    <TableCell className="font-medium">{wt.workType}</TableCell>
                    <TableCell className="text-center">{wt.count}</TableCell>
                    <TableCell className="text-right font-medium">{formatFullCurrency(wt.revenue)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

type RevenueRow = { month: string; total: number };

function parseMonth(label: string): { year: number; monthIdx: number } {
  const d = new Date(label + (label.length === 7 ? "-01" : ""));
  if (!isNaN(d.getTime())) return { year: d.getFullYear(), monthIdx: d.getMonth() };
  const m = /^(\d{4})[-/]?(\d{1,2})/.exec(label);
  if (m) return { year: Number(m[1]), monthIdx: Number(m[2]) - 1 };
  return { year: 0, monthIdx: 0 };
}

function RevenueByPeriodCard({ rows, view }: { rows: RevenueRow[]; view: "month" | "year" }) {
  const { t } = useTranslation();
  const brand = useBrand();
  const iconStyle = { color: brand.isOrgBranded ? brand.primary : "#f59e0b" };
  const chartData = useMemo(() => {
    const sorted = [...rows].sort((a, b) => {
      const A = parseMonth(a.month); const B = parseMonth(b.month);
      return A.year !== B.year ? A.year - B.year : A.monthIdx - B.monthIdx;
    });
    let series: { label: string; total: number }[];
    if (view === "year") {
      const byYear = new Map<number, number>();
      for (const r of sorted) {
        const { year } = parseMonth(r.month);
        byYear.set(year, (byYear.get(year) ?? 0) + r.total);
      }
      series = [...byYear.entries()]
        .sort(([a], [b]) => a - b)
        .map(([year, total]) => ({ label: String(year), total }));
    } else {
      series = sorted.map((r) => ({ label: r.month, total: r.total }));
    }
    return series.map((s, i) => {
      const isCurrent = i === series.length - 1;
      let color: "grey" | "red" | "green" = "grey";
      if (isCurrent && series.length >= 2) {
        const prev = series[i - 1]!.total;
        color = s.total >= prev ? "green" : "red";
      }
      return { label: s.label, total: s.total, color };
    });
  }, [rows, view]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <TrendingUp className="w-5 h-5" style={iconStyle} />
          {view === "month" ? t("vendorAnalytics.revenueByMonth") : t("vendorAnalytics.revenueByYear")}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={250}>
          <BarChart data={chartData}>
            <XAxis dataKey="label" tick={{ fontSize: 11 }} />
            <YAxis tickFormatter={(v) => formatCurrency(v)} />
            <Tooltip cursor={{ fill: "#ccc", fillOpacity: 0.5 }} formatter={(value: number) => formatFullCurrency(value)} />
            <Bar dataKey="total" maxBarSize={28} shape={(p: object) => <VerticalPillBarShape {...p} flatBottom />} name={t("vendorAnalytics.revenue")} />
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
