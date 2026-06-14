import { useTranslation } from "react-i18next";
import {
  usePartnerAnalytics,
  useGetPartner,
  getGetPartnerQueryKey,
  getPartnerAnalyticsQueryKey,
  useGetPartnerTransitionAggregate,
  getGetPartnerTransitionAggregateQueryKey,
  type PartnerAnalytics,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CARD_MINI_CONTENT_CLASS, CARD_ICON_ROW_CLASS, CARD_ICON_CLASS } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import { DollarSign, FileText, CheckCircle2, AlertTriangle, Shield, TrendingUp, Users, MapPin, BarChart3 } from "lucide-react";
import SpendByLineTypeChart from "@/components/spend-by-line-type-chart";
import AnalyticsPipelineCard from "@/components/analytics-pipeline-card";
import AnalyticsKickbackTrendCard from "@/components/analytics-kickback-trend-card";
import AnalyticsSpendByAfeCard from "@/components/analytics-spend-by-afe-card";
import AnalyticsInvoiceAgingCard from "@/components/analytics-invoice-aging-card";
import AnalyticsNec1099Card from "@/components/analytics-nec1099-card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Link, useLocation } from "wouter";
import SphereBackButton from "@/components/sphere-back-button";
import { useAuth } from "@/hooks/use-auth";
import { useBrand } from "@/hooks/use-brand";
import { HorizontalPillBarShape } from "@/components/horizontal-pill-bar-shape";
import { VerticalPillBarShape } from "@/components/vertical-pill-bar-shape";
import { type PillColor } from "@/components/status-pill-assets";
import { formatStatusLabel } from "@/lib/format-status";
import {
  ANALYTICS_BAR_SIZE,
  ANALYTICS_VERTICAL_CHART_HEIGHT,
  analyticsHorizontalChartHeight,
} from "@/lib/analytics-bar-chart";

const sitePillColors: PillColor[] = ["amber", "blue", "green", "red", "grey"];

const formatCurrency = (val: number) =>
  val >= 1000000
    ? `$${(val / 1000000).toFixed(1)}M`
    : val >= 1000
    ? `$${(val / 1000).toFixed(1)}K`
    : `$${val.toFixed(2)}`;

const formatFullCurrency = (val: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(val);

const EMPTY_SPEND_PIPELINE: PartnerAnalytics["spendPipeline"] = {
  pendingReview: { count: 0, total: 0 },
  awaitingPayment: { count: 0, total: 0 },
  approvedUnpaid: { count: 0, total: 0 },
};

const EMPTY_INVOICE_AGING: PartnerAnalytics["invoiceAging"] = {
  totals: {
    current: 0,
    bucket1_15: 0,
    bucket16_30: 0,
    bucket31_60: 0,
    bucket60_plus: 0,
    total: 0,
  },
  topVendors: [],
  vendorCount: 0,
};

const EMPTY_NEC1099_EXPOSURE: PartnerAnalytics["nec1099Exposure"] = {
  year: new Date().getUTCFullYear(),
  threshold: 600,
  vendorCount: 0,
  totalPaid: 0,
  vendors: [],
};

/** Tolerate older API payloads / partial responses so the page never white-screens. */
function normalizePartnerAnalytics(data: PartnerAnalytics): PartnerAnalytics {
  const kickbackRate =
    data.kickbackRate ??
    (data.totalTickets > 0
      ? Math.round((data.kickedBackTickets / data.totalTickets) * 100)
      : 0);

  return {
    ...data,
    kickbackRate,
    spendPipeline: data.spendPipeline ?? EMPTY_SPEND_PIPELINE,
    kickbackTrendByMonth: data.kickbackTrendByMonth ?? [],
    costByType: data.costByType ?? [],
    costByVendor: (data.costByVendor ?? []).map((vendor) => {
      const kickbackRateForVendor =
        vendor.kickbackRate ??
        (vendor.ticketCount > 0
          ? Math.round((vendor.kickedBackCount / vendor.ticketCount) * 100)
          : 0);
      const avgCostPerTicket =
        vendor.avgCostPerTicket ??
        (vendor.ticketCount > 0 ? vendor.totalCost / vendor.ticketCount : 0);
      return {
        ...vendor,
        kickbackRate: kickbackRateForVendor,
        avgCostPerTicket,
      };
    }),
    spendByAfe: data.spendByAfe ?? [],
    invoiceAging: data.invoiceAging ?? EMPTY_INVOICE_AGING,
    nec1099Exposure: data.nec1099Exposure ?? EMPTY_NEC1099_EXPOSURE,
  };
}

// Task #858 helper. Converts a duration in seconds (or null) into a short
// human label. The aggregate may legitimately be null when no invites have
// been accepted yet, so a dedicated formatter centralises the empty state.
function formatSecondsAsDuration(seconds: number | null): string {
  if (seconds == null || !Number.isFinite(seconds)) return "—";
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  if (seconds < 86400) {
    const h = Math.floor(seconds / 3600);
    const m = Math.round((seconds % 3600) / 60);
    return m === 0 ? `${h}h` : `${h}h ${m}m`;
  }
  const d = Math.floor(seconds / 86400);
  const h = Math.round((seconds % 86400) / 3600);
  return h === 0 ? `${d}d` : `${d}d ${h}h`;
}

export default function PartnerAnalytics({ partnerId }: { partnerId: number }) {
  const { t } = useTranslation();
  const [, navigate] = useLocation();
  const handleBarClick = (status: string) => navigate(`/tickets?status=${encodeURIComponent(status)}`);
  const { user } = useAuth();
  const brand = useBrand();
  const accentColor = brand.isOrgBranded ? brand.primary : "#f59e0b";
  const iconStyle = { color: accentColor };
  const isOwnPartner = user?.role === "partner" && user.partnerId === partnerId;
  const { data: partner } = useGetPartner(partnerId, { query: { enabled: !!partnerId, queryKey: getGetPartnerQueryKey(partnerId) } });
  const { data, isLoading, isError } = usePartnerAnalytics(partnerId, { query: { enabled: !!partnerId, queryKey: getPartnerAnalyticsQueryKey(partnerId) } });
  // Task #858 — partner KPI: mean time-to-acceptance computed from
  // `ticket_status_history`. Independent fetch so a slow rollup never
  // blocks the rest of the page.
  const { data: transitionAggregate } = useGetPartnerTransitionAggregate(partnerId, {
    query: {
      enabled: !!partnerId,
      queryKey: getGetPartnerTransitionAggregateQueryKey(partnerId),
    },
  });

  if (isLoading) return <div className="space-y-4"><Skeleton className="h-8 w-48" /><Skeleton className="h-48 w-full" /><Skeleton className="h-48 w-full" /></div>;
  if (isError || !data) {
    return (
      <p className="text-muted-foreground">
        {t("partnerAnalytics.loadFailed", { defaultValue: "Could not load analytics. Try refreshing the page." })}
      </p>
    );
  }

  const analytics = normalizePartnerAnalytics(data);

  const statCards = [
    { label: t("partnerAnalytics.totalTickets", { defaultValue: "Total Tickets" }), value: analytics.totalTickets, icon: FileText },
    { label: t("partnerAnalytics.active", { defaultValue: "Active" }), value: analytics.activeTickets, icon: TrendingUp },
    { label: t("partnerAnalytics.awaitingReview", { defaultValue: "Awaiting Review" }), value: analytics.submittedTickets, icon: AlertTriangle },
    { label: t("partnerAnalytics.approved", { defaultValue: "Approved" }), value: analytics.approvedTickets, icon: CheckCircle2 },
    { label: t("partnerAnalytics.totalCost", { defaultValue: "Total Cost" }), value: formatFullCurrency(analytics.totalCost), icon: DollarSign },
    { label: t("partnerAnalytics.kickbackRate", { defaultValue: "Kickback Rate" }), value: `${analytics.kickbackRate}%`, icon: AlertTriangle },
    { label: t("partnerAnalytics.gpsCompliance", { defaultValue: "GPS Compliance" }), value: `${analytics.gpsCompliance.rate}%`, icon: Shield },
  ];

  const pipelineSegments = [
    {
      key: "pendingReview",
      label: t("partnerAnalytics.pipelinePendingReview", { defaultValue: "Pending review" }),
      caption: t("partnerAnalytics.pipelinePendingReviewCaption", { defaultValue: "Submitted or in review" }),
      ...analytics.spendPipeline.pendingReview,
      href: "/tickets?status=pending_review",
    },
    {
      key: "awaitingPayment",
      label: t("partnerAnalytics.pipelineAwaitingPayment", { defaultValue: "Awaiting payment" }),
      caption: t("partnerAnalytics.pipelineAwaitingPaymentCaption", { defaultValue: "Approved work, payment owed" }),
      ...analytics.spendPipeline.awaitingPayment,
      href: "/tickets?status=awaiting_payment",
    },
    {
      key: "approvedUnpaid",
      label: t("partnerAnalytics.pipelineApprovedUnpaid", { defaultValue: "Approved, not dispersed" }),
      caption: t("partnerAnalytics.pipelineApprovedUnpaidCaption", { defaultValue: "Ready for disbursement" }),
      ...analytics.spendPipeline.approvedUnpaid,
      href: "/tickets?status=approved",
    },
  ];

  const agingChartData = [
    { bucket: t("partnerAnalytics.agingCurrent", { defaultValue: "Current" }), total: analytics.invoiceAging.totals.current, color: "green" as const },
    { bucket: t("partnerAnalytics.aging1_15", { defaultValue: "1–15 days" }), total: analytics.invoiceAging.totals.bucket1_15, color: "blue" as const },
    { bucket: t("partnerAnalytics.aging16_30", { defaultValue: "16–30 days" }), total: analytics.invoiceAging.totals.bucket16_30, color: "amber" as const },
    { bucket: t("partnerAnalytics.aging31_60", { defaultValue: "31–60 days" }), total: analytics.invoiceAging.totals.bucket31_60, color: "red" as const },
    { bucket: t("partnerAnalytics.aging60Plus", { defaultValue: "60+ days" }), total: analytics.invoiceAging.totals.bucket60_plus, color: "red" as const },
  ];

  return (
    <div className="space-y-6" data-testid="partner-analytics-page">
      <div className="flex items-center gap-4">
        {!isOwnPartner && <Link href={`/partners/${partnerId}`} className="group inline-flex items-center" aria-label="Back"><SphereBackButton size={40} /></Link>}
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t("partnerAnalytics.titleFor", { defaultValue: "{{name}} Analytics", name: partner?.name || t("partnerAnalytics.partnerFallback", { defaultValue: "Partner" }) })}</h1>
          <p className="text-muted-foreground text-sm mt-1">{t("partnerAnalytics.subtitle", { defaultValue: "Cost tracking and vendor performance overview" })}</p>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3">
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

      {transitionAggregate && (
        <Card data-testid="card-partner-time-to-acceptance">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <TrendingUp className="w-5 h-5" style={iconStyle} />
              {t("partnerAnalytics.timeToAcceptanceTitle", { defaultValue: "Mean time to vendor acceptance" })}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="text-center">
                <p className="text-xs text-gray-700 font-medium">{t("partnerAnalytics.meanTimeToAcceptance", { defaultValue: "Mean time to acceptance" })}</p>
                <p className="text-2xl font-bold mt-1" data-testid="text-mean-time-to-acceptance">
                  {formatSecondsAsDuration(transitionAggregate.meanTimeToAcceptanceSeconds)}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  {t("partnerAnalytics.timeToAcceptanceCaption", {
                    defaultValue: "From invite_sent to vendor accepted, audited via ticket history.",
                  })}
                </p>
              </div>
              <div className="text-center">
                <p className="text-xs text-gray-700 font-medium">{t("partnerAnalytics.invitesAccepted", { defaultValue: "Invites accepted" })}</p>
                <p className="text-2xl font-bold mt-1">{transitionAggregate.acceptedInviteCount}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid md:grid-cols-2 gap-6">
        <AnalyticsPipelineCard
          title={t("partnerAnalytics.spendPipelineTitle", { defaultValue: "Spend pipeline" })}
          segments={pipelineSegments}
          formatFullCurrency={formatFullCurrency}
          ticketCountLabel={(count) =>
            t("partnerAnalytics.pipelineTicketCount", { defaultValue: "{{count}} tickets", count })
          }
          iconStyle={iconStyle}
          testId="card-spend-pipeline"
        />
        <AnalyticsKickbackTrendCard
          title={t("partnerAnalytics.kickbackTrendTitle", { defaultValue: "Kickback trend" })}
          rows={analytics.kickbackTrendByMonth}
          emptyMessage={t("partnerAnalytics.noKickbackTrend", { defaultValue: "No kickbacks recorded yet" })}
          caption={t("partnerAnalytics.kickbackTrendCaption", {
            defaultValue: "Kickbacks recorded each month vs tickets created that month.",
          })}
          kickedBackLabel={t("partnerAnalytics.kickedBack", { defaultValue: "Kicked Back" })}
          kickbackRateLabel={t("partnerAnalytics.kickbackRate", { defaultValue: "Kickback Rate" })}
          totalTicketsLabel={t("partnerAnalytics.totalTickets", { defaultValue: "Total Tickets" })}
          iconStyle={iconStyle}
          testId="card-kickback-trend"
        />
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        <AnalyticsSpendByAfeCard
          title={t("partnerAnalytics.spendByAfeTitle", { defaultValue: "Spend by AFE" })}
          caption={t("partnerAnalytics.spendByAfeCaption", {
            defaultValue: "Ticket spend grouped by AFE code (assignment override, then site default).",
          })}
          emptyMessage={t("partnerAnalytics.noAfeData", { defaultValue: "No AFE-tagged spend yet" })}
          valueLabel={t("partnerAnalytics.cost", { defaultValue: "Cost" })}
          rows={analytics.spendByAfe}
          formatCurrency={formatCurrency}
          formatFullCurrency={formatFullCurrency}
          iconStyle={iconStyle}
        />
        <AnalyticsInvoiceAgingCard
          title={t("partnerAnalytics.invoiceAgingTitle", { defaultValue: "Open bills aging" })}
          totals={analytics.invoiceAging.totals}
          buckets={agingChartData}
          counterparties={analytics.invoiceAging.topVendors.map((vendor) => ({
            id: vendor.vendorId,
            name: vendor.vendorName,
            total: vendor.total,
            href: `/vendors/${vendor.vendorId}`,
            fallbackLabel: t("partnerAnalytics.vendorFallback", {
              defaultValue: "Vendor {{id}}",
              id: vendor.vendorId,
            }),
          }))}
          counterpartyCaption={t("partnerAnalytics.invoiceAgingCaption", {
            defaultValue: "{{count}} vendors with open invoices (sent, open, or overdue).",
            count: analytics.invoiceAging.vendorCount,
          })}
          emptyMessage={t("partnerAnalytics.noOpenBills", { defaultValue: "No open bills" })}
          viewLinkHref="/bills-to-pay"
          viewLinkLabel={t("partnerAnalytics.viewBills", { defaultValue: "View bills" })}
          formatCurrency={formatCurrency}
          formatFullCurrency={formatFullCurrency}
          iconStyle={iconStyle}
          testId="card-invoice-aging"
        />
        <AnalyticsNec1099Card
          title={t("partnerAnalytics.nec1099Title", {
            defaultValue: "1099-NEC exposure ({{year}})",
            year: analytics.nec1099Exposure.year,
          })}
          year={analytics.nec1099Exposure.year}
          threshold={analytics.nec1099Exposure.threshold}
          entityCount={analytics.nec1099Exposure.vendorCount}
          totalPaid={analytics.nec1099Exposure.totalPaid}
          entities={analytics.nec1099Exposure.vendors.map((vendor) => ({
            id: vendor.vendorId,
            name: vendor.vendorName,
            totalPaid: vendor.totalPaid,
            sharedEinWarning: vendor.sharedEinWarning,
          }))}
          entityColumnLabel={t("partnerAnalytics.vendor", { defaultValue: "Vendor" })}
          box1Label={t("partnerAnalytics.nec1099Box1", { defaultValue: "Box 1 NEC" })}
          entityCountLabel={t("partnerAnalytics.nec1099VendorsOverThreshold", {
            defaultValue: "Vendors ≥ ${{threshold}}",
            threshold: analytics.nec1099Exposure.threshold,
          })}
          totalPaidLabel={t("partnerAnalytics.nec1099TotalPaid", { defaultValue: "Total NEC paid YTD" })}
          emptyMessage={t("partnerAnalytics.noNec1099Exposure", {
            defaultValue: "No vendors at or above the ${{threshold}} NEC threshold yet this year.",
            threshold: analytics.nec1099Exposure.threshold,
          })}
          viewReportsLabel={t("partnerAnalytics.view1099Reports", { defaultValue: "Full 1099 reports" })}
          sharedEinWarningTitle={t("partnerAnalytics.sharedEinWarning", {
            defaultValue: "Shared EIN — review before filing",
          })}
          formatFullCurrency={formatFullCurrency}
          entityHref={(id) => `/vendors/${id}`}
          iconStyle={iconStyle}
          testId="card-nec1099-exposure"
        />
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        <Card>
          <CardHeader><CardTitle className="text-lg flex items-center gap-2"><BarChart3 className="w-5 h-5" style={iconStyle} />{t("partnerAnalytics.trackingStatusBreakdown", { defaultValue: "Tracking Status Breakdown" })}</CardTitle></CardHeader>
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
              <p className="text-muted-foreground text-sm text-center py-8">{t("partnerAnalytics.noTicketsYet", { defaultValue: "No tickets yet" })}</p>
            )}
          </CardContent>
        </Card>

        <Card data-testid="card-spend-by-line-type">
          <CardHeader><CardTitle className="text-lg flex items-center gap-2"><DollarSign className="w-5 h-5" style={iconStyle} />{t("partnerAnalytics.spendByLineType", { defaultValue: "Spend by line type" })}</CardTitle></CardHeader>
          <CardContent>
            <SpendByLineTypeChart
              items={analytics.costByType}
              formatCurrency={formatCurrency}
              formatFullCurrency={formatFullCurrency}
              emptyMessage={t("partnerAnalytics.noCostData", { defaultValue: "No cost data" })}
            />
          </CardContent>
        </Card>
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        <Card>
          <CardHeader><CardTitle className="text-lg flex items-center gap-2"><TrendingUp className="w-5 h-5" style={iconStyle} />{t("partnerAnalytics.monthlySpend", { defaultValue: "Monthly Spend" })}</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={ANALYTICS_VERTICAL_CHART_HEIGHT}>
              <BarChart data={analytics.costByMonth.map((m) => ({ ...m, color: "green" as const }))}>
                <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                <YAxis tickFormatter={(v) => formatCurrency(v)} />
                <Tooltip cursor={{ fill: "#ccc", fillOpacity: 0.5 }} formatter={(value: number) => formatFullCurrency(value)} />
                <Bar dataKey="total" name={t("partnerAnalytics.cost", { defaultValue: "Cost" })} barSize={ANALYTICS_BAR_SIZE} shape={(p: object) => <VerticalPillBarShape {...p} flatBottom />} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-lg flex items-center gap-2"><TrendingUp className="w-5 h-5" style={iconStyle} />{t("partnerAnalytics.yearlySpend", { defaultValue: "Yearly Spend" })}</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={ANALYTICS_VERTICAL_CHART_HEIGHT}>
              <BarChart data={(analytics.costByYear ?? []).map((y) => ({ ...y, color: "green" as const }))}>
                <XAxis dataKey="year" tick={{ fontSize: 11 }} />
                <YAxis tickFormatter={(v) => formatCurrency(v)} />
                <Tooltip cursor={{ fill: "#ccc", fillOpacity: 0.5 }} formatter={(value: number) => formatFullCurrency(value)} />
                <Bar dataKey="total" name={t("partnerAnalytics.cost", { defaultValue: "Cost" })} barSize={ANALYTICS_BAR_SIZE} shape={(p: object) => <VerticalPillBarShape {...p} flatBottom />} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-lg flex items-center gap-2"><Users className="w-5 h-5" style={iconStyle} />{t("partnerAnalytics.vendorPerformance", { defaultValue: "Vendor Performance" })}</CardTitle></CardHeader>
        <CardContent className="p-0">
          {analytics.costByVendor.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("partnerAnalytics.vendor", { defaultValue: "Vendor" })}</TableHead>
                  <TableHead className="text-center">{t("partnerAnalytics.tickets", { defaultValue: "Tickets" })}</TableHead>
                  <TableHead className="text-center">{t("partnerAnalytics.approved", { defaultValue: "Approved" })}</TableHead>
                  <TableHead className="text-center">{t("partnerAnalytics.kickedBack", { defaultValue: "Kicked Back" })}</TableHead>
                  <TableHead className="text-center">{t("partnerAnalytics.kickbackRate", { defaultValue: "Kickback Rate" })}</TableHead>
                  <TableHead className="text-right">{t("partnerAnalytics.avgCostPerTicket", { defaultValue: "Avg $ / ticket" })}</TableHead>
                  <TableHead className="text-right">{t("partnerAnalytics.totalCost", { defaultValue: "Total Cost" })}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {analytics.costByVendor.map((v) => (
                  <TableRow key={v.vendorId}>
                    <TableCell>
                      <Link href={`/vendors/${v.vendorId}`} className="font-medium text-gray-700 hover:text-[var(--brand-primary)] transition-colors">
                        <div className={CARD_ICON_ROW_CLASS}><Users className="w-4 h-4" style={iconStyle} />{v.vendorName}</div>
                      </Link>
                    </TableCell>
                    <TableCell className="text-center">{v.ticketCount}</TableCell>
                    <TableCell className="text-center">
                      <span className="text-green-600 font-medium">{v.approvedCount}</span>
                    </TableCell>
                    <TableCell className="text-center">
                      {v.kickedBackCount > 0 ? (
                        <span className="text-red-600 font-medium">{v.kickedBackCount}</span>
                      ) : (
                        <span className="text-muted-foreground">0</span>
                      )}
                    </TableCell>
                    <TableCell className="text-center">
                      {v.kickbackRate > 0 ? (
                        <span className="text-red-600 font-medium">{v.kickbackRate}%</span>
                      ) : (
                        <span className="text-muted-foreground">0%</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right font-medium">{formatFullCurrency(v.avgCostPerTicket)}</TableCell>
                    <TableCell className="text-right font-medium">{formatFullCurrency(v.totalCost)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className="text-muted-foreground text-sm text-center py-8 px-4">{t("partnerAnalytics.noVendorData", { defaultValue: "No vendor data" })}</p>
          )}
        </CardContent>
      </Card>

      <div className="grid md:grid-cols-2 gap-6">
        <Card>
          <CardHeader><CardTitle className="text-lg flex items-center gap-2"><MapPin className="w-5 h-5" style={iconStyle} />{t("partnerAnalytics.costBySite", { defaultValue: "Cost by Site" })}</CardTitle></CardHeader>
          <CardContent>
            {analytics.costBySite.length > 0 ? (
              <>
                <ResponsiveContainer width="100%" height={analyticsHorizontalChartHeight(analytics.costBySite.length)}>
                  <BarChart
                    data={analytics.costBySite.map((s, idx) => ({ ...s, color: sitePillColors[idx % sitePillColors.length] }))}
                    layout="vertical"
                  >
                    <XAxis type="number" tickFormatter={(v) => formatCurrency(v)} />
                    <YAxis type="category" dataKey="siteName" tick={{ fontSize: 11 }} width={150} />
                    <Tooltip cursor={{ fill: "#ccc", fillOpacity: 0.5 }} formatter={(value: number) => formatFullCurrency(value)} />
                    <Bar dataKey="totalCost" name={t("partnerAnalytics.cost", { defaultValue: "Cost" })} barSize={ANALYTICS_BAR_SIZE} shape={(p: object) => <HorizontalPillBarShape {...p} flatLeft />} />
                  </BarChart>
                </ResponsiveContainer>
                <div className="mt-4 space-y-2">
                  {analytics.costBySite.map((s) => (
                    <div key={s.siteId} className="flex justify-between text-sm">
                      <Link href={`/site-locations/${s.siteId}`} className="font-medium text-gray-700 hover:text-[var(--brand-primary)] transition-colors">{s.siteName}</Link>
                      <span className="text-muted-foreground">{t("partnerAnalytics.ticketsAndCost", { defaultValue: "{{count}} tickets · {{cost}}", count: s.ticketCount, cost: formatFullCurrency(s.totalCost) })}</span>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <p className="text-muted-foreground text-sm text-center py-8">{t("partnerAnalytics.noSiteData", { defaultValue: "No site data" })}</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-lg flex items-center gap-2"><FileText className="w-5 h-5" style={iconStyle} />{t("partnerAnalytics.topWorkTypes", { defaultValue: "Top Work Types" })}</CardTitle></CardHeader>
          <CardContent className="p-0">
            {analytics.topWorkTypes.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("partnerAnalytics.workType", { defaultValue: "Work Type" })}</TableHead>
                    <TableHead className="text-center">{t("partnerAnalytics.tickets", { defaultValue: "Tickets" })}</TableHead>
                    <TableHead className="text-right">{t("partnerAnalytics.cost", { defaultValue: "Cost" })}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {analytics.topWorkTypes.map((wt, idx) => (
                    <TableRow key={idx}>
                      <TableCell className="font-medium">{wt.workType}</TableCell>
                      <TableCell className="text-center">{wt.count}</TableCell>
                      <TableCell className="text-right font-medium">{formatFullCurrency(wt.cost)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <p className="text-muted-foreground text-sm text-center py-8 px-4">{t("partnerAnalytics.noWorkTypeData", { defaultValue: "No work type data" })}</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
