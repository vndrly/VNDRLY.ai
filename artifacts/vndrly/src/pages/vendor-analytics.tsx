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
import SpendByLineTypeChart from "@/components/spend-by-line-type-chart";
import AnalyticsPipelineCard from "@/components/analytics-pipeline-card";
import AnalyticsKickbackTrendCard from "@/components/analytics-kickback-trend-card";
import AnalyticsSpendByAfeCard from "@/components/analytics-spend-by-afe-card";
import AnalyticsInvoiceAgingCard from "@/components/analytics-invoice-aging-card";
import AnalyticsNec1099Card from "@/components/analytics-nec1099-card";
import type { VendorAnalytics } from "@workspace/api-client-react";
import { DollarSign, FileText, CheckCircle2, AlertTriangle, Shield, TrendingUp, Users, MapPin, BarChart3 } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Link, useLocation } from "wouter";
import SphereBackButton from "@/components/sphere-back-button";
import { useAuth } from "@/hooks/use-auth";
import { useBrand } from "@/hooks/use-brand";
import { VerticalPillBarShape } from "@/components/vertical-pill-bar-shape";
import { formatStatusLabel } from "@/lib/format-status";
import {
  ANALYTICS_BAR_SIZE,
  ANALYTICS_VERTICAL_CHART_HEIGHT,
} from "@/lib/analytics-bar-chart";

const formatCurrency = (val: number) =>
  val >= 1000000
    ? `$${(val / 1000000).toFixed(1)}M`
    : val >= 1000
    ? `$${(val / 1000).toFixed(1)}K`
    : `$${val.toFixed(2)}`;

const formatFullCurrency = (val: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(val);

const EMPTY_REVENUE_PIPELINE: VendorAnalytics["revenuePipeline"] = {
  pendingReview: { count: 0, total: 0 },
  awaitingPayment: { count: 0, total: 0 },
  approvedUnpaid: { count: 0, total: 0 },
};

const EMPTY_INVOICE_AGING: VendorAnalytics["invoiceAging"] = {
  totals: {
    current: 0,
    bucket1_15: 0,
    bucket16_30: 0,
    bucket31_60: 0,
    bucket60_plus: 0,
    total: 0,
  },
  topPartners: [],
  partnerCount: 0,
};

const EMPTY_NEC1099_EXPOSURE: VendorAnalytics["nec1099Exposure"] = {
  year: new Date().getUTCFullYear(),
  threshold: 600,
  partnerCount: 0,
  totalPaid: 0,
  partners: [],
};

function normalizeVendorAnalytics(data: VendorAnalytics): VendorAnalytics {
  return {
    ...data,
    revenuePipeline: data.revenuePipeline ?? EMPTY_REVENUE_PIPELINE,
    kickbackTrendByMonth: data.kickbackTrendByMonth ?? [],
    revenueByType: data.revenueByType ?? [],
    employeePerformance: (data.employeePerformance ?? []).map((employee) => ({
      ...employee,
      kickedBackCount: employee.kickedBackCount ?? 0,
      kickbackRate:
        employee.kickbackRate ??
        (employee.ticketCount > 0
          ? Math.round(((employee.kickedBackCount ?? 0) / employee.ticketCount) * 100)
          : 0),
      avgRevenuePerTicket:
        employee.avgRevenuePerTicket ??
        (employee.ticketCount > 0 ? employee.revenue / employee.ticketCount : 0),
    })),
    invoiceAging: data.invoiceAging ?? EMPTY_INVOICE_AGING,
    nec1099Exposure: data.nec1099Exposure ?? EMPTY_NEC1099_EXPOSURE,
    spendByAfe: data.spendByAfe ?? [],
  };
}

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
  const { data, isLoading, isError } = useVendorAnalytics(vendorId, { query: { enabled: !!vendorId, queryKey: getVendorAnalyticsQueryKey(vendorId) } });
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
  if (isError || !data) {
    return (
      <p className="text-muted-foreground">
        {t("vendorAnalytics.loadFailed", { defaultValue: "Could not load analytics. Try refreshing the page." })}
      </p>
    );
  }

  const analytics = normalizeVendorAnalytics(data);

  const statCards = [
    { label: t("vendorAnalytics.totalTickets"), value: analytics.totalTickets, icon: FileText },
    { label: t("vendorAnalytics.approved"), value: analytics.approvedTickets, icon: CheckCircle2 },
    { label: t("vendorAnalytics.kickedBack"), value: analytics.kickedBackTickets, icon: AlertTriangle },
    { label: t("vendorAnalytics.totalRevenue"), value: formatFullCurrency(analytics.totalRevenue), icon: DollarSign },
    { label: t("vendorAnalytics.gpsCompliance"), value: `${analytics.gpsCompliance.rate}%`, icon: Shield },
    { label: t("vendorAnalytics.kickbackRate"), value: `${analytics.kickbackRate}%`, icon: TrendingUp },
  ];

  const pipelineSegments = [
    {
      key: "pendingReview",
      label: t("vendorAnalytics.pipelinePendingReview", { defaultValue: "Pending review" }),
      caption: t("vendorAnalytics.pipelinePendingReviewCaption", { defaultValue: "Submitted or in review" }),
      ...analytics.revenuePipeline.pendingReview,
      href: "/tickets?status=pending_review",
    },
    {
      key: "awaitingPayment",
      label: t("vendorAnalytics.pipelineAwaitingPayment", { defaultValue: "Awaiting payment" }),
      caption: t("vendorAnalytics.pipelineAwaitingPaymentCaption", { defaultValue: "Approved work, payment owed" }),
      ...analytics.revenuePipeline.awaitingPayment,
      href: "/tickets?status=awaiting_payment",
    },
    {
      key: "approvedUnpaid",
      label: t("vendorAnalytics.pipelineApprovedUnpaid", { defaultValue: "Approved, not dispersed" }),
      caption: t("vendorAnalytics.pipelineApprovedUnpaidCaption", { defaultValue: "Ready for disbursement" }),
      ...analytics.revenuePipeline.approvedUnpaid,
      href: "/tickets?status=approved",
    },
  ];

  const agingChartData = [
    { bucket: t("vendorAnalytics.agingCurrent", { defaultValue: "Current" }), total: analytics.invoiceAging.totals.current, color: "green" as const },
    { bucket: t("vendorAnalytics.aging1_15", { defaultValue: "1–15 days" }), total: analytics.invoiceAging.totals.bucket1_15, color: "blue" as const },
    { bucket: t("vendorAnalytics.aging16_30", { defaultValue: "16–30 days" }), total: analytics.invoiceAging.totals.bucket16_30, color: "amber" as const },
    { bucket: t("vendorAnalytics.aging31_60", { defaultValue: "31–60 days" }), total: analytics.invoiceAging.totals.bucket31_60, color: "red" as const },
    { bucket: t("vendorAnalytics.aging60Plus", { defaultValue: "60+ days" }), total: analytics.invoiceAging.totals.bucket60_plus, color: "red" as const },
  ];

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
        <AnalyticsPipelineCard
          title={t("vendorAnalytics.revenuePipelineTitle", { defaultValue: "Revenue pipeline" })}
          segments={pipelineSegments}
          formatFullCurrency={formatFullCurrency}
          ticketCountLabel={(count) =>
            t("vendorAnalytics.pipelineTicketCount", { defaultValue: "{{count}} tickets", count })
          }
          iconStyle={iconStyle}
          testId="card-vendor-revenue-pipeline"
        />
        <AnalyticsKickbackTrendCard
          title={t("vendorAnalytics.kickbackTrendTitle", { defaultValue: "Kickback trend" })}
          rows={analytics.kickbackTrendByMonth}
          emptyMessage={t("vendorAnalytics.noKickbackTrend", { defaultValue: "No kickbacks recorded yet" })}
          caption={t("vendorAnalytics.kickbackTrendCaption", {
            defaultValue: "Kickbacks recorded each month vs tickets created that month.",
          })}
          kickedBackLabel={t("vendorAnalytics.kickedBack")}
          kickbackRateLabel={t("vendorAnalytics.kickbackRate")}
          totalTicketsLabel={t("vendorAnalytics.totalTickets")}
          iconStyle={iconStyle}
          testId="card-vendor-kickback-trend"
        />
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        <AnalyticsSpendByAfeCard
          title={t("vendorAnalytics.revenueByAfeTitle", { defaultValue: "Revenue by AFE" })}
          caption={t("vendorAnalytics.spendByAfeCaption", {
            defaultValue: "Ticket revenue grouped by AFE code (assignment override, then site default).",
          })}
          emptyMessage={t("vendorAnalytics.noAfeData", { defaultValue: "No AFE-tagged revenue yet" })}
          valueLabel={t("vendorAnalytics.revenue", { defaultValue: "Revenue" })}
          rows={analytics.spendByAfe}
          formatCurrency={formatCurrency}
          formatFullCurrency={formatFullCurrency}
          iconStyle={iconStyle}
          testId="card-vendor-spend-by-afe"
        />
        <AnalyticsInvoiceAgingCard
          title={t("vendorAnalytics.invoiceAgingTitle", { defaultValue: "Open invoices aging" })}
          totals={analytics.invoiceAging.totals}
          buckets={agingChartData}
          counterparties={analytics.invoiceAging.topPartners.map((partner) => ({
            id: partner.partnerId,
            name: partner.partnerName,
            total: partner.total,
            href: `/partners/${partner.partnerId}`,
            fallbackLabel: t("vendorAnalytics.partnerFallback", {
              defaultValue: "Partner {{id}}",
              id: partner.partnerId,
            }),
          }))}
          counterpartyCaption={t("vendorAnalytics.invoiceAgingCaption", {
            defaultValue: "{{count}} partners with open invoices (sent, open, or overdue).",
            count: analytics.invoiceAging.partnerCount,
          })}
          emptyMessage={t("vendorAnalytics.noOpenInvoices", { defaultValue: "No open invoices" })}
          viewLinkHref="/invoices"
          viewLinkLabel={t("vendorAnalytics.viewInvoices", { defaultValue: "View invoices" })}
          formatCurrency={formatCurrency}
          formatFullCurrency={formatFullCurrency}
          iconStyle={iconStyle}
          testId="card-vendor-invoice-aging"
        />
        <AnalyticsNec1099Card
          title={t("vendorAnalytics.nec1099Title", {
            defaultValue: "1099-NEC income ({{year}})",
            year: analytics.nec1099Exposure.year,
          })}
          year={analytics.nec1099Exposure.year}
          threshold={analytics.nec1099Exposure.threshold}
          entityCount={analytics.nec1099Exposure.partnerCount}
          totalPaid={analytics.nec1099Exposure.totalPaid}
          entities={analytics.nec1099Exposure.partners.map((partner) => ({
            id: partner.partnerId,
            name: partner.partnerName,
            totalPaid: partner.totalPaid,
          }))}
          entityColumnLabel={t("vendorAnalytics.partner", { defaultValue: "Partner" })}
          box1Label={t("vendorAnalytics.nec1099Box1", { defaultValue: "Box 1 NEC" })}
          entityCountLabel={t("vendorAnalytics.nec1099PartnersOverThreshold", {
            defaultValue: "Partners ≥ ${{threshold}}",
            threshold: analytics.nec1099Exposure.threshold,
          })}
          totalPaidLabel={t("vendorAnalytics.nec1099TotalPaid", { defaultValue: "Total NEC received YTD" })}
          emptyMessage={t("vendorAnalytics.noNec1099Income", {
            defaultValue: "No partners at or above the ${{threshold}} NEC threshold yet this year.",
            threshold: analytics.nec1099Exposure.threshold,
          })}
          viewReportsLabel={t("vendorAnalytics.view1099Reports", { defaultValue: "Full 1099 reports" })}
          formatFullCurrency={formatFullCurrency}
          entityHref={(id) => `/partners/${id}`}
          iconStyle={iconStyle}
          testId="card-vendor-nec1099-exposure"
        />
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        <Card>
          <CardHeader><CardTitle className="text-lg flex items-center gap-2"><BarChart3 className="w-5 h-5" style={iconStyle} />{t("vendorAnalytics.trackingStatusBreakdown")}</CardTitle></CardHeader>
          <CardContent>
            {analytics.statusBreakdown.length > 0 ? (
              <ResponsiveContainer width="100%" height={ANALYTICS_VERTICAL_CHART_HEIGHT}>
                <BarChart data={analytics.statusBreakdown}>
                  <XAxis dataKey="status" tick={{ fontSize: 11 }} tickFormatter={formatStatusLabel} />
                  <YAxis allowDecimals={false} />
                  <Tooltip cursor={{ fill: "#ccc", fillOpacity: 0.5 }} />
                  <Bar dataKey="count" barSize={ANALYTICS_BAR_SIZE} shape={(p: object) => <VerticalPillBarShape {...p} flatBottom onBarClick={handleBarClick} />} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-muted-foreground text-sm text-center py-8">{t("vendorAnalytics.noTicketsYet")}</p>
            )}
          </CardContent>
        </Card>

        <Card data-testid="card-revenue-by-line-type">
          <CardHeader><CardTitle className="text-lg flex items-center gap-2"><DollarSign className="w-5 h-5" style={iconStyle} />{t("vendorAnalytics.revenueByLineType", { defaultValue: "Revenue by line type" })}</CardTitle></CardHeader>
          <CardContent>
            <SpendByLineTypeChart
              items={analytics.revenueByType}
              formatCurrency={formatCurrency}
              formatFullCurrency={formatFullCurrency}
              emptyMessage={t("vendorAnalytics.noRevenueData")}
              valueLabel={t("vendorAnalytics.revenue")}
            />
          </CardContent>
        </Card>
      </div>

      {(analytics.revenueByMonth.length > 0 || (analytics.revenueByYear ?? []).length > 0) && (
        <div className="grid md:grid-cols-2 gap-6">
          <RevenueByPeriodCard rows={analytics.revenueByMonth} view="month" />
          <RevenueByPeriodCard
            rows={(analytics.revenueByYear ?? []).map((r) => ({ month: `${r.year}-01`, total: r.total }))}
            view="year"
          />
        </div>
      )}

      <div className="grid md:grid-cols-2 gap-6">
        <Card>
          <CardHeader><CardTitle className="text-lg flex items-center gap-2"><Users className="w-5 h-5" style={iconStyle} />{t("vendorAnalytics.employeePerformance")}</CardTitle></CardHeader>
          <CardContent className="p-0">
            {analytics.employeePerformance.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("vendorAnalytics.employee")}</TableHead>
                    <TableHead className="text-center">{t("vendorAnalytics.tickets")}</TableHead>
                    <TableHead className="text-center">{t("vendorAnalytics.approved")}</TableHead>
                    <TableHead className="text-center">{t("vendorAnalytics.kickbackRate")}</TableHead>
                    <TableHead className="text-right">{t("vendorAnalytics.avgRevenuePerTicket", { defaultValue: "Avg $ / ticket" })}</TableHead>
                    <TableHead className="text-right">{t("vendorAnalytics.revenue")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {analytics.employeePerformance.map((emp) => (
                    <TableRow key={emp.employeeId}>
                      <TableCell>
                        <Link href={`/field-employees/${emp.employeeId}`} className="font-medium text-gray-700 hover:text-[var(--brand-primary)] transition-colors">{emp.name}</Link>
                        {emp.jobTitle && <p className="text-xs text-muted-foreground">{emp.jobTitle}</p>}
                      </TableCell>
                      <TableCell className="text-center">{emp.ticketCount}</TableCell>
                      <TableCell className="text-center">{emp.approvedCount}</TableCell>
                      <TableCell className="text-center">
                        {emp.kickbackRate > 0 ? (
                          <span className="text-red-600 font-medium">{emp.kickbackRate}%</span>
                        ) : (
                          <span className="text-muted-foreground">0%</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right font-medium">{formatFullCurrency(emp.avgRevenuePerTicket)}</TableCell>
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
            {analytics.bySite.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("vendorAnalytics.site")}</TableHead>
                    <TableHead className="text-center">{t("vendorAnalytics.tickets")}</TableHead>
                    <TableHead className="text-right">{t("vendorAnalytics.revenue")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {analytics.bySite.map((site) => (
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

      {analytics.topWorkTypes.length > 0 && (
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
                {analytics.topWorkTypes.map((wt, idx) => (
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
        <ResponsiveContainer width="100%" height={ANALYTICS_VERTICAL_CHART_HEIGHT}>
          <BarChart data={chartData}>
            <XAxis dataKey="label" tick={{ fontSize: 11 }} />
            <YAxis tickFormatter={(v) => formatCurrency(v)} />
            <Tooltip cursor={{ fill: "#ccc", fillOpacity: 0.5 }} formatter={(value: number) => formatFullCurrency(value)} />
            <Bar dataKey="total" barSize={ANALYTICS_BAR_SIZE} shape={(p: object) => <VerticalPillBarShape {...p} flatBottom />} name={t("vendorAnalytics.revenue")} />
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
