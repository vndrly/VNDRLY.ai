import { useTranslation } from "react-i18next";
import {
  useForemanAnalytics,
  getForemanAnalyticsQueryKey,
  type ForemanAnalytics,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CARD_MINI_CONTENT_CLASS, CARD_ICON_ROW_CLASS, CARD_ICON_CLASS } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import AnalyticsKickbackTrendCard from "@/components/analytics-kickback-trend-card";
import { FileText, CheckCircle2, AlertTriangle, TrendingUp, MapPin, BarChart3, HardHat, Users } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Link } from "wouter";
import ContentPaneBackLink from "@/components/content-pane-back-link";
import { useAuth } from "@/hooks/use-auth";
import { useBrand } from "@/hooks/use-brand";
import { VerticalPillBarShape } from "@/components/vertical-pill-bar-shape";
import { formatStatusLabel } from "@/lib/format-status";
import {
  ANALYTICS_BAR_SIZE,
  ANALYTICS_VERTICAL_CHART_HEIGHT,
} from "@/lib/analytics-bar-chart";
import { FIELD_OPS_PAGE_CLASS } from "@/lib/field-ops-content-pane";
import { usePortalBase } from "@/lib/portal-base";

function normalizeForemanAnalytics(data: ForemanAnalytics): ForemanAnalytics {
  return {
    ...data,
    kickbackTrendByMonth: data.kickbackTrendByMonth ?? [],
    bySite: data.bySite ?? [],
    employeePerformance: (data.employeePerformance ?? []).map((employee) => ({
      ...employee,
      kickbackRate:
        employee.kickbackRate ??
        (employee.ticketCount > 0
          ? Math.round((employee.kickedBackCount / employee.ticketCount) * 100)
          : 0),
    })),
  };
}

export default function ForemanAnalytics() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const portalBase = usePortalBase();
  const brand = useBrand();
  const accentColor = brand.isOrgBranded ? brand.primary : "#f59e0b";
  const iconStyle = { color: accentColor };
  const userId = user?.userId ?? 0;

  const { data, isLoading, isError } = useForemanAnalytics(userId, {
    query: { enabled: !!userId, queryKey: getForemanAnalyticsQueryKey(userId) },
  });

  if (isLoading) {
    return (
      <div className={FIELD_OPS_PAGE_CLASS}>
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-48 w-full mt-4" />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className={FIELD_OPS_PAGE_CLASS} data-testid="foreman-analytics-page">
        <ContentPaneBackLink href={portalBase} />
        <p className="text-muted-foreground mt-4">
          {t("foremanAnalytics.loadFailed", { defaultValue: "Could not load crew analytics." })}
        </p>
      </div>
    );
  }

  const analytics = normalizeForemanAnalytics(data);

  const statCards = [
    { label: t("foremanAnalytics.totalTickets", { defaultValue: "My tickets" }), value: analytics.totalTickets, icon: FileText },
    { label: t("foremanAnalytics.active", { defaultValue: "Active" }), value: analytics.activeTickets, icon: TrendingUp },
    { label: t("foremanAnalytics.onSiteToday", { defaultValue: "On site today" }), value: analytics.onSiteToday, icon: HardHat },
    { label: t("foremanAnalytics.awaitingReview", { defaultValue: "Awaiting review" }), value: analytics.submittedTickets, icon: AlertTriangle },
    { label: t("foremanAnalytics.approved", { defaultValue: "Approved" }), value: analytics.approvedTickets, icon: CheckCircle2 },
    { label: t("foremanAnalytics.kickbackRate", { defaultValue: "Kickback rate" }), value: `${analytics.kickbackRate}%`, icon: AlertTriangle },
  ];

  return (
    <div className={FIELD_OPS_PAGE_CLASS} data-testid="foreman-analytics-page">
      <ContentPaneBackLink href={portalBase} />
      <div className="mt-2">
        <h1 className="text-2xl font-bold tracking-tight">{t("foremanAnalytics.title", { defaultValue: "Crew analytics" })}</h1>
        <p className="text-muted-foreground text-sm mt-1">
          {t("foremanAnalytics.subtitle", { defaultValue: "Operational snapshot for tickets you foreman." })}
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mt-6">
        {statCards.map((stat) => (
          <Card key={stat.label}>
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

      <div className="grid md:grid-cols-2 gap-6 mt-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <BarChart3 className="w-5 h-5" style={iconStyle} />
              {t("foremanAnalytics.statusBreakdown", { defaultValue: "Status breakdown" })}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {analytics.statusBreakdown.length > 0 ? (
              <ResponsiveContainer width="100%" height={ANALYTICS_VERTICAL_CHART_HEIGHT}>
                <BarChart data={analytics.statusBreakdown}>
                  <XAxis dataKey="status" tick={{ fontSize: 11 }} tickFormatter={formatStatusLabel} />
                  <YAxis allowDecimals={false} />
                  <Tooltip cursor={{ fill: "#ccc", fillOpacity: 0.5 }} />
                  <Bar dataKey="count" barSize={ANALYTICS_BAR_SIZE} shape={(props: object) => <VerticalPillBarShape {...props} flatBottom />} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-muted-foreground text-sm text-center py-8">
                {t("foremanAnalytics.noTicketsYet", { defaultValue: "No tickets yet" })}
              </p>
            )}
          </CardContent>
        </Card>

        <AnalyticsKickbackTrendCard
          title={t("foremanAnalytics.kickbackTrendTitle", { defaultValue: "Kickback trend" })}
          rows={analytics.kickbackTrendByMonth}
          emptyMessage={t("foremanAnalytics.noKickbackTrend", { defaultValue: "No kickbacks recorded yet" })}
          caption={t("foremanAnalytics.kickbackTrendCaption", {
            defaultValue: "Kickbacks on your tickets each month.",
          })}
          kickedBackLabel={t("foremanAnalytics.kickedBack", { defaultValue: "Kicked back" })}
          kickbackRateLabel={t("foremanAnalytics.kickbackRate", { defaultValue: "Kickback rate" })}
          totalTicketsLabel={t("foremanAnalytics.totalTickets", { defaultValue: "My tickets" })}
          iconStyle={iconStyle}
          testId="card-foreman-kickback-trend"
        />
      </div>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Users className="w-5 h-5" style={iconStyle} />
            {t("foremanAnalytics.crewPerformance", { defaultValue: "Crew performance" })}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {analytics.employeePerformance.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("foremanAnalytics.employee", { defaultValue: "Employee" })}</TableHead>
                  <TableHead className="text-center">{t("foremanAnalytics.active", { defaultValue: "Active" })}</TableHead>
                  <TableHead className="text-center">{t("foremanAnalytics.approved", { defaultValue: "Approved" })}</TableHead>
                  <TableHead className="text-center">{t("foremanAnalytics.kickedBack", { defaultValue: "Kicked back" })}</TableHead>
                  <TableHead className="text-center">{t("foremanAnalytics.kickbackRate", { defaultValue: "Kickback rate" })}</TableHead>
                  <TableHead className="text-right">{t("foremanAnalytics.totalTickets", { defaultValue: "My tickets" })}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {analytics.employeePerformance.map((employee) => (
                  <TableRow key={employee.employeeId}>
                    <TableCell>
                      <Link href={`/field-employees/${employee.employeeId}`} className="font-medium text-gray-700 hover:text-[var(--brand-primary)] transition-colors">
                        {employee.name}
                      </Link>
                    </TableCell>
                    <TableCell className="text-center">{employee.activeCount}</TableCell>
                    <TableCell className="text-center">{employee.approvedCount}</TableCell>
                    <TableCell className="text-center">{employee.kickedBackCount}</TableCell>
                    <TableCell className="text-center">
                      {employee.kickbackRate > 0 ? (
                        <span className="text-red-600 font-medium">{employee.kickbackRate}%</span>
                      ) : (
                        <span className="text-muted-foreground">0%</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right font-medium">{employee.ticketCount}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className="text-muted-foreground text-sm text-center py-8 px-4">
              {t("foremanAnalytics.noCrewData", { defaultValue: "No crew ticket activity yet" })}
            </p>
          )}
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <MapPin className="w-5 h-5" style={iconStyle} />
            {t("foremanAnalytics.ticketsBySite", { defaultValue: "Tickets by site" })}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {analytics.bySite.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("foremanAnalytics.site", { defaultValue: "Site" })}</TableHead>
                  <TableHead className="text-center">{t("foremanAnalytics.active", { defaultValue: "Active" })}</TableHead>
                  <TableHead className="text-right">{t("foremanAnalytics.totalTickets", { defaultValue: "My tickets" })}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {analytics.bySite.map((site) => (
                  <TableRow key={site.siteId}>
                    <TableCell>
                      <Link href={`/site-locations/${site.siteId}`} className="font-medium text-gray-700 hover:text-[var(--brand-primary)] transition-colors">
                        {site.siteName}
                      </Link>
                    </TableCell>
                    <TableCell className="text-center">{site.activeCount}</TableCell>
                    <TableCell className="text-right font-medium">{site.ticketCount}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className="text-muted-foreground text-sm text-center py-8 px-4">
              {t("foremanAnalytics.noSiteData", { defaultValue: "No site activity yet" })}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
