import { useTranslation } from "react-i18next";
import {
  usePartnerAnalytics,
  useGetPartner,
  getGetPartnerQueryKey,
  getPartnerAnalyticsQueryKey,
  useGetPartnerTransitionAggregate,
  getGetPartnerTransitionAggregateQueryKey,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { type PillColor } from "@/components/status-pill-assets";
import { formatStatusLabel } from "@/lib/format-status";

const sitePillColors: PillColor[] = ["amber", "blue", "green", "red", "grey"];

const formatCurrency = (val: number) =>
  val >= 1000000
    ? `$${(val / 1000000).toFixed(1)}M`
    : val >= 1000
    ? `$${(val / 1000).toFixed(1)}K`
    : `$${val.toFixed(2)}`;

const formatFullCurrency = (val: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(val);

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
  const { data, isLoading } = usePartnerAnalytics(partnerId, { query: { enabled: !!partnerId, queryKey: getPartnerAnalyticsQueryKey(partnerId) } });
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
  if (!data) return <p className="text-muted-foreground">{t("partnerAnalytics.noAnalyticsData", { defaultValue: "No analytics data available" })}</p>;

  const statCards = [
    { label: t("partnerAnalytics.totalTickets", { defaultValue: "Total Tickets" }), value: data.totalTickets, icon: FileText },
    { label: t("partnerAnalytics.active", { defaultValue: "Active" }), value: data.activeTickets, icon: TrendingUp },
    { label: t("partnerAnalytics.awaitingReview", { defaultValue: "Awaiting Review" }), value: data.submittedTickets, icon: AlertTriangle },
    { label: t("partnerAnalytics.approved", { defaultValue: "Approved" }), value: data.approvedTickets, icon: CheckCircle2 },
    { label: t("partnerAnalytics.totalCost", { defaultValue: "Total Cost" }), value: formatFullCurrency(data.totalCost), icon: DollarSign },
    { label: t("partnerAnalytics.gpsCompliance", { defaultValue: "GPS Compliance" }), value: `${data.gpsCompliance.rate}%`, icon: Shield },
  ];

  const costByTypePie = data.costByType.map((c) => ({ name: c.type.charAt(0).toUpperCase() + c.type.slice(1), value: c.total }));
  const texturedPalette: PieColor[] = ["amber", "blue", "green", "red"];
  // Explicit per-type pie colors. Anything not listed here falls
  // through to the round-robin `texturedPalette` by index.
  const typeColorMap: Record<string, PieColor> = {
    equipment: "amber",
    materials: "red",
    other: "grey",
  };
  const costByTypeTextured = data.costByType.map((c, idx) => {
    const name = c.type.charAt(0).toUpperCase() + c.type.slice(1);
    const explicit = typeColorMap[c.type.toLowerCase()];
    return {
      name,
      value: c.total,
      color: (explicit ?? texturedPalette[idx % texturedPalette.length]) as PieColor,
    };
  });

  return (
    <div className="space-y-6" data-testid="partner-analytics-page">
      <div className="flex items-center gap-4">
        {!isOwnPartner && <Link href={`/partners/${partnerId}`} className="group inline-flex items-center" aria-label="Back"><SphereBackButton size={40} /></Link>}
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t("partnerAnalytics.titleFor", { defaultValue: "{{name}} Analytics", name: partner?.name || t("partnerAnalytics.partnerFallback", { defaultValue: "Partner" }) })}</h1>
          <p className="text-muted-foreground text-sm mt-1">{t("partnerAnalytics.subtitle", { defaultValue: "Cost tracking and vendor performance overview" })}</p>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {statCards.map((stat) => (
          <Card key={stat.label} data-testid={`card-stat-${stat.label}`}>
            <CardContent className="p-4 h-24 flex flex-col">
              <div className="flex items-center gap-2">
                <stat.icon className="w-4 h-4" style={iconStyle} />
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
        <Card>
          <CardHeader><CardTitle className="text-lg flex items-center gap-2"><BarChart3 className="w-5 h-5" style={iconStyle} />{t("partnerAnalytics.trackingStatusBreakdown", { defaultValue: "Tracking Status Breakdown" })}</CardTitle></CardHeader>
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
              <p className="text-muted-foreground text-sm text-center py-8">{t("partnerAnalytics.noTicketsYet", { defaultValue: "No tickets yet" })}</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-lg flex items-center gap-2"><DollarSign className="w-5 h-5" style={iconStyle} />{t("partnerAnalytics.costByCategory", { defaultValue: "Cost by Category" })}</CardTitle></CardHeader>
          <CardContent>
            {costByTypePie.length > 0 ? (
              <div className="flex flex-col items-center gap-3 py-2">
                <TexturedPie
                  data={costByTypeTextured}
                  size={240}
                  formatValue={(v) => formatCurrency(v)}
                />
                <TexturedPieLegend
                  data={costByTypeTextured}
                  formatValue={(v) => formatCurrency(v)}
                />
              </div>
            ) : (
              <p className="text-muted-foreground text-sm text-center py-8">{t("partnerAnalytics.noCostData", { defaultValue: "No cost data" })}</p>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        <Card>
          <CardHeader><CardTitle className="text-lg flex items-center gap-2"><TrendingUp className="w-5 h-5" style={iconStyle} />{t("partnerAnalytics.monthlySpend", { defaultValue: "Monthly Spend" })}</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={data.costByMonth.map((m) => ({ ...m, color: "amber" as const }))}>
                <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                <YAxis tickFormatter={(v) => formatCurrency(v)} />
                <Tooltip cursor={{ fill: "#ccc", fillOpacity: 0.5 }} formatter={(value: number) => formatFullCurrency(value)} />
                <Bar dataKey="total" name={t("partnerAnalytics.cost", { defaultValue: "Cost" })} maxBarSize={28} shape={(p: object) => <VerticalPillBarShape {...p} flatBottom />} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-lg flex items-center gap-2"><TrendingUp className="w-5 h-5" style={iconStyle} />{t("partnerAnalytics.yearlySpend", { defaultValue: "Yearly Spend" })}</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={(data.costByYear ?? []).map((y) => ({ ...y, color: "amber" as const }))}>
                <XAxis dataKey="year" tick={{ fontSize: 11 }} />
                <YAxis tickFormatter={(v) => formatCurrency(v)} />
                <Tooltip cursor={{ fill: "#ccc", fillOpacity: 0.5 }} formatter={(value: number) => formatFullCurrency(value)} />
                <Bar dataKey="total" name={t("partnerAnalytics.cost", { defaultValue: "Cost" })} maxBarSize={28} shape={(p: object) => <VerticalPillBarShape {...p} flatBottom />} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-lg flex items-center gap-2"><Users className="w-5 h-5" style={iconStyle} />{t("partnerAnalytics.vendorPerformance", { defaultValue: "Vendor Performance" })}</CardTitle></CardHeader>
        <CardContent className="p-0">
          {data.costByVendor.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("partnerAnalytics.vendor", { defaultValue: "Vendor" })}</TableHead>
                  <TableHead className="text-center">{t("partnerAnalytics.tickets", { defaultValue: "Tickets" })}</TableHead>
                  <TableHead className="text-center">{t("partnerAnalytics.approved", { defaultValue: "Approved" })}</TableHead>
                  <TableHead className="text-center">{t("partnerAnalytics.kickedBack", { defaultValue: "Kicked Back" })}</TableHead>
                  <TableHead className="text-right">{t("partnerAnalytics.totalCost", { defaultValue: "Total Cost" })}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.costByVendor.map((v) => (
                  <TableRow key={v.vendorId}>
                    <TableCell>
                      <Link href={`/vendors/${v.vendorId}`} className="font-medium text-gray-700 hover:text-[var(--brand-primary)] transition-colors">
                        <div className="flex items-center gap-2"><Users className="w-4 h-4" style={iconStyle} />{v.vendorName}</div>
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
            {data.costBySite.length > 0 ? (
              <>
                <ResponsiveContainer width="100%" height={Math.max(120, data.costBySite.length * 56)}>
                  <BarChart
                    data={data.costBySite.map((s, idx) => ({ ...s, color: sitePillColors[idx % sitePillColors.length] }))}
                    layout="vertical"
                  >
                    <XAxis type="number" tickFormatter={(v) => formatCurrency(v)} />
                    <YAxis type="category" dataKey="siteName" tick={{ fontSize: 11 }} width={150} />
                    <Tooltip cursor={{ fill: "#ccc", fillOpacity: 0.5 }} formatter={(value: number) => formatFullCurrency(value)} />
                    <Bar dataKey="totalCost" name={t("partnerAnalytics.cost", { defaultValue: "Cost" })} maxBarSize={28} shape={(p: object) => <HorizontalPillBarShape {...p} flatLeft />} />
                  </BarChart>
                </ResponsiveContainer>
                <div className="mt-4 space-y-2">
                  {data.costBySite.map((s) => (
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
            {data.topWorkTypes.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("partnerAnalytics.workType", { defaultValue: "Work Type" })}</TableHead>
                    <TableHead className="text-center">{t("partnerAnalytics.tickets", { defaultValue: "Tickets" })}</TableHead>
                    <TableHead className="text-right">{t("partnerAnalytics.cost", { defaultValue: "Cost" })}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.topWorkTypes.map((wt, idx) => (
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
