import {
  useGetDashboardSummary,
  useGetRecentActivity,
  useGetTicketStats,
  useGetAwaitingPaymentSummary,
  useGetAdminReassignmentAggregate,
  useListDirectAssignments,
  useListSiteLocations,
  useListTickets,
  useCommitDirectAssignment,
  usePassDirectAssignment,
  getGetDashboardSummaryQueryKey,
  getGetRecentActivityQueryKey,
  getGetTicketStatsQueryKey,
  getGetAwaitingPaymentSummaryQueryKey,
  getGetAdminReassignmentAggregateQueryKey,
  getListDirectAssignmentsQueryKey,
  getListSiteLocationsQueryKey,
  getListTicketsQueryKey,
} from "@workspace/api-client-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import TicketStatusBadge from "@/components/ticket-status-badge";
import { Skeleton } from "@/components/ui/skeleton";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import { Handshake, Users, MapPin, FileText, Clock, CheckCircle2, AlertTriangle, Flame, BarChart3, ChevronUp, ChevronDown, Wallet, ArrowRight, Repeat2, Send, CalendarDays, TimerReset, UserCheck, RotateCcw, Landmark, ShieldAlert, Hourglass } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import RedButton from "@/components/red-button";
import { PngPillButton } from "@/components/png-pill-rollover";
import LightGreyRedButton from "@/components/light-grey-red-button";
import { useRateLimitGate } from "@/hooks/use-rate-limit-gate";
import HotlistSection from "@/components/hotlist-section";
import { PillColorLayer } from "@/components/png-pill-chrome";
import FinishSetupWidget from "@/components/finish-setup-widget";
import { AssistantMetricsCard } from "@/components/assistant-metrics-card";
import { RateLimitBudgetsCard } from "@/components/rate-limit-budgets-card";
import { RateLimitTripsCard } from "@/components/rate-limit-trips-card";
import { VerticalPillBarShape } from "@/components/vertical-pill-bar-shape";
import { TICKET_LIFECYCLE_ORDER } from "@workspace/ticket-status-meta";
import { ticketStatusMeta } from "@/lib/ticket-status-meta";
import { formatStatusLabel } from "@/lib/format-status";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { useTranslation } from "react-i18next";
import { useBrand } from "@/hooks/use-brand";
import { useToast } from "@/hooks/use-toast";
import { brandImagePillSrc } from "@/components/png-pill-rollover";

// Maps a raw ticket status key to the same i18n label that the
// tracking-page "All Status" jump list (`pages/tickets.tsx` →
// `stateOptions`) uses, so the Tracking Status Breakdown chart's
// X-axis tick + Tooltip label stay in lockstep with the rest of the
// app when a status pill gets renamed. Statuses that aren't in the
// jump list (draft / initiated / awaiting_acceptance / denied) fall
// back to their canonical badge label key from `ticketStatusMeta`,
// and anything unknown falls back to the title-cased raw key.
const TRACKING_PAGE_LABEL_KEYS: Record<string, string> = {
  in_progress: "tickets.inProgress",
  pending_review: "tickets.pendingReview",
  submitted: "tickets.submitted",
  completed: "tickets.completed",
  approved: "tickets.approved",
  awaiting_payment: "tickets.awaitingPaymentStatus",
  funds_dispersed: "ticketDetail.fundsDispersed",
  kicked_back: "tickets.kickedBack",
  cancelled: "tickets.cancelled",
};

type SiteWorkloadRow = {
  siteId: number;
  siteName: string;
  status: string;
  activeCount: number;
  pendingReviewCount: number;
  awaitingPaymentCount: number;
  totalCount: number;
  vendorCount: number;
  lastActivityAt: string | null;
};

type DashboardAnalyticsCard = {
  key: string;
  title: string;
  value: string;
  detail: string;
  subdetail?: string;
  icon: typeof TimerReset;
  href?: string;
};

function formatShortRelativeDate(value: string | null): string {
  if (!value) return "No activity";
  const ts = new Date(value).getTime();
  if (!Number.isFinite(ts)) return "No activity";
  const diffMs = Date.now() - ts;
  const diffDays = Math.floor(diffMs / (24 * 60 * 60 * 1000));
  if (diffDays <= 0) return "Today";
  if (diffDays === 1) return "1d ago";
  if (diffDays < 30) return `${diffDays}d ago`;
  const diffMonths = Math.floor(diffDays / 30);
  if (diffMonths <= 1) return "1mo ago";
  return `${diffMonths}mo ago`;
}

function daysSince(value?: string | Date | null): number | null {
  if (!value) return null;
  const ts = new Date(value).getTime();
  if (!Number.isFinite(ts)) return null;
  return Math.max(0, Math.floor((Date.now() - ts) / (24 * 60 * 60 * 1000)));
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export default function Dashboard() {
  // Task #710 — three dashboard widgets share the `dashboard.rate_limited`
  // limiter on the server. When any of them returns 429 we park the whole
  // dashboard for the indicated Retry-After window: queries become disabled
  // (so react-query won't re-fire on focus/mount), retries on 429 are
  // skipped, and a single calm banner replaces the three potential error
  // walls. Auto-clears via the gate when Retry-After elapses.
  const [rateLimitedState, setRateLimitedState] = useState(false);
  const sharedRetry = (failureCount: number, err: unknown) => {
    const status = (err as { status?: number } | null)?.status;
    if (status === 429) return false;
    return failureCount < 3;
  };
  const { data: summary, isLoading: summaryLoading, error: summaryError } =
    useGetDashboardSummary({
      query: {
        queryKey: getGetDashboardSummaryQueryKey(),
        enabled: !rateLimitedState,
        retry: sharedRetry,
      },
    });
  const { data: activity, isLoading: activityLoading, error: activityError } =
    useGetRecentActivity({
      query: {
        queryKey: getGetRecentActivityQueryKey(),
        enabled: !rateLimitedState,
        retry: sharedRetry,
      },
    });
  const ACTIVITY_PAGE_SIZE = 10;
  const [activityPage, setActivityPage] = useState(0);
  const activityList = activity ?? [];
  const activityPageCount = Math.max(1, Math.ceil(activityList.length / ACTIVITY_PAGE_SIZE));
  useEffect(() => {
    if (activityPage > activityPageCount - 1) setActivityPage(activityPageCount - 1);
  }, [activityPageCount, activityPage]);
  const visibleActivity = useMemo(
    () => activityList.slice(activityPage * ACTIVITY_PAGE_SIZE, activityPage * ACTIVITY_PAGE_SIZE + ACTIVITY_PAGE_SIZE),
    [activityList, activityPage],
  );
  const activityFirstShown = activityList.length === 0 ? 0 : activityPage * ACTIVITY_PAGE_SIZE + 1;
  const activityLastShown = Math.min(activityList.length, (activityPage + 1) * ACTIVITY_PAGE_SIZE);
  const canPagePrev = activityPage > 0;
  const canPageNext = activityPage < activityPageCount - 1;
  const { data: stats, isLoading: statsLoading, error: statsError } =
    useGetTicketStats({
      query: {
        queryKey: getGetTicketStatsQueryKey(),
        enabled: !rateLimitedState,
        retry: sharedRetry,
      },
    });
  // Render the Tracking Status Breakdown bars in canonical ticket
  // lifecycle order (draft → initiated → in_progress → … → denied)
  // rather than the unspecified groupBy order returned by Postgres.
  // Unknown statuses (shouldn't happen in practice) are appended at
  // the end in their original order so we never silently drop a row.
  const orderedStats = useMemo(() => {
    if (!stats) return stats;
    const orderIndex = new Map<string, number>(
      TICKET_LIFECYCLE_ORDER.map((s, i) => [s, i]),
    );
    return [...stats].filter((row) => row.status !== "draft").sort((a, b) => {
      const ai = orderIndex.get(a.status) ?? Number.MAX_SAFE_INTEGER;
      const bi = orderIndex.get(b.status) ?? Number.MAX_SAFE_INTEGER;
      return ai - bi;
    });
  }, [stats]);
  const summaryGate = useRateLimitGate(summaryError, "dashboard.rate_limited");
  const activityGate = useRateLimitGate(activityError, "dashboard.rate_limited");
  const statsGate = useRateLimitGate(statsError, "dashboard.rate_limited");
  const rateLimited =
    summaryGate.rateLimited || activityGate.rateLimited || statsGate.rateLimited;
  const retryAfterSeconds =
    Math.max(
      summaryGate.retryAfterSeconds ?? 0,
      activityGate.retryAfterSeconds ?? 0,
      statsGate.retryAfterSeconds ?? 0,
    ) || null;
  useEffect(() => {
    setRateLimitedState(rateLimited);
  }, [rateLimited]);
  const [, navigate] = useLocation();
  const { user } = useAuth();
  const isPartner = user?.role === "partner";
  const isAdmin = user?.role === "admin";
  const isVendor = user?.role === "vendor";
  const siteListQuery = useListSiteLocations(undefined, {
    query: {
      queryKey: getListSiteLocationsQueryKey(),
      enabled: !rateLimitedState,
      retry: sharedRetry,
    },
  });
  const siteTicketParams =
    isPartner && user?.partnerId
      ? { partnerId: user.partnerId }
      : isVendor && user?.vendorId
      ? { vendorId: user.vendorId }
      : undefined;
  const siteTicketsQuery = useListTickets(siteTicketParams, {
    query: {
      queryKey: getListTicketsQueryKey(siteTicketParams),
      enabled: !rateLimitedState,
      retry: sharedRetry,
    },
  });
  // Vendor inbox of pending direct work offers (Task: direct assignments).
  // Surfaced ABOVE every other dashboard section so vendors see it first.
  const { data: pendingDirectAssignments, refetch: refetchPendingDirect } =
    useListDirectAssignments(
      { status: "pending" },
      {
        query: {
          queryKey: getListDirectAssignmentsQueryKey({ status: "pending" }),
          enabled: !rateLimitedState && isVendor,
          retry: sharedRetry,
        },
      },
    );
  const commitDirect = useCommitDirectAssignment();
  const passDirect = usePassDirectAssignment();
  const [passDialogId, setPassDialogId] = useState<number | null>(null);
  const [passReason, setPassReason] = useState("");
  // Task #505 — partner-only "Awaiting payment" tile. The endpoint
  // returns zeros for non-partner roles so we still gate on `isPartner`
  // to keep an extra request off vendor/admin/employee dashboards.
  const { data: awaitingPayment, isLoading: awaitingPaymentLoading } =
    useGetAwaitingPaymentSummary({
      query: {
        queryKey: getGetAwaitingPaymentSummaryQueryKey(),
        enabled: !rateLimitedState && isPartner,
        retry: sharedRetry,
      },
    });
  // Task #858 — admin Reassignments tile. Surfaces tickets that bounced
  // through 2+ vendors (i.e. accumulated 2+ `awaiting_acceptance`
  // history rows). Admin-only; the endpoint enforces the same.
  const { data: reassignments, isLoading: reassignmentsLoading } =
    useGetAdminReassignmentAggregate({
      query: {
        queryKey: getGetAdminReassignmentAggregateQueryKey(),
        enabled: !rateLimitedState && isAdmin,
        retry: sharedRetry,
      },
    });
  const { t } = useTranslation();
  const brand = useBrand();
  const { toast } = useToast();
  const siteWorkloadRows = useMemo<SiteWorkloadRow[]>(() => {
    const sites = siteListQuery.data ?? [];
    const tickets = siteTicketsQuery.data ?? [];
    const ticketsBySite = new Map<number, typeof tickets>();

    for (const ticket of tickets) {
      if (ticket.siteLocationId == null) continue;
      const existing = ticketsBySite.get(ticket.siteLocationId) ?? [];
      existing.push(ticket);
      ticketsBySite.set(ticket.siteLocationId, existing);
    }

    return sites
      .filter((site) => {
        const hidden = "hidden" in site && Boolean(site.hidden);
        const supersededAt = "supersededAt" in site ? site.supersededAt : null;
        if (hidden || supersededAt) return false;
        if (isPartner && user?.partnerId) return site.partnerId === user.partnerId;
        if (isVendor) return ticketsBySite.has(site.id);
        return true;
      })
      .map((site) => {
        const siteTickets = ticketsBySite.get(site.id) ?? [];
        const vendorIds = new Set(
          siteTickets
            .map((ticket) => ticket.vendorId)
            .filter((id): id is number => typeof id === "number"),
        );
        const lastActivityAt =
          siteTickets
            .map((ticket) => ticket.updatedAt)
            .filter(Boolean)
            .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0] ?? null;
        return {
          siteId: site.id,
          siteName: site.name,
          status: site.status,
          activeCount: siteTickets.filter((ticket) =>
            ["draft", "initiated", "awaiting_acceptance", "in_progress", "pending_review", "kicked_back"].includes(ticket.status),
          ).length,
          pendingReviewCount: siteTickets.filter((ticket) => ticket.status === "submitted").length,
          awaitingPaymentCount: siteTickets.filter(
            (ticket) => ticket.status === "approved" && ticket.paymentDispersedAt == null,
          ).length,
          totalCount: siteTickets.length,
          vendorCount: vendorIds.size,
          lastActivityAt,
        };
      })
      .sort((a, b) => {
        const active = b.activeCount - a.activeCount;
        if (active !== 0) return active;
        const review = b.pendingReviewCount - a.pendingReviewCount;
        if (review !== 0) return review;
        const ap = b.awaitingPaymentCount - a.awaitingPaymentCount;
        if (ap !== 0) return ap;
        const total = b.totalCount - a.totalCount;
        if (total !== 0) return total;
        return a.siteName.localeCompare(b.siteName);
      })
      .slice(0, 5);
  }, [isPartner, isVendor, siteListQuery.data, siteTicketsQuery.data, user?.partnerId]);
  // Resolves a chart status key to the same display label used by the
  // tracking-page jump list, with a graceful chain of fallbacks so a
  // newly-added enum value can never render as `undefined`.
  const formatChartStatusLabel = useCallback(
    (status: string): string => {
      const trackingKey = TRACKING_PAGE_LABEL_KEYS[status];
      if (trackingKey) return t(trackingKey);
      const meta = ticketStatusMeta[status];
      if (meta?.badgeLabelKey) return t(meta.badgeLabelKey);
      return formatStatusLabel(status);
    },
    [t],
  );
  const analyticsCards = useMemo<DashboardAnalyticsCard[]>(() => {
    const tickets = siteTicketsQuery.data ?? [];
    const activeStatuses = new Set([
      "initiated",
      "awaiting_acceptance",
      "in_progress",
      "pending_review",
      "submitted",
      "kicked_back",
    ]);
    const reviewStatuses = new Set([
      "submitted",
      "approved",
      "awaiting_payment",
      "funds_dispersed",
      "completed",
      "kicked_back",
    ]);
    const byStatus = new Map<string, typeof tickets>();
    const byVendor = new Map<string, { name: string; total: number; kicked: number }>();

    for (const ticket of tickets) {
      const statusRows = byStatus.get(ticket.status) ?? [];
      statusRows.push(ticket);
      byStatus.set(ticket.status, statusRows);

      const vendorKey = String(ticket.vendorId ?? "unknown");
      const vendor = byVendor.get(vendorKey) ?? {
        name: ticket.vendorName ?? "Unassigned vendor",
        total: 0,
        kicked: 0,
      };
      if (reviewStatuses.has(ticket.status)) vendor.total += 1;
      if (ticket.status === "kicked_back") vendor.kicked += 1;
      byVendor.set(vendorKey, vendor);
    }

    const bottleneck = [...byStatus.entries()]
      .filter(([status]) => activeStatuses.has(status))
      .map(([status, rows]) => {
        const ages = rows
          .map((ticket) => daysSince(ticket.updatedAt ?? ticket.createdAt))
          .filter((age): age is number => age != null);
        return {
          status,
          count: rows.length,
          avgAge: Math.round(average(ages)),
          oldest: Math.max(0, ...ages),
        };
      })
      .sort((a, b) => b.avgAge - a.avgAge || b.count - a.count)[0];

    const awaitingAcceptance = tickets.filter((ticket) => ticket.status === "awaiting_acceptance");
    const denied = tickets.filter((ticket) => ticket.status === "denied");
    const awaitingAges = awaitingAcceptance
      .map((ticket) => daysSince(ticket.updatedAt ?? ticket.createdAt))
      .filter((age): age is number => age != null);

    const kickedBack = tickets.filter((ticket) => ticket.status === "kicked_back").length;
    const reviewBase = tickets.filter((ticket) => reviewStatuses.has(ticket.status)).length;
    const reworkRate = reviewBase > 0 ? Math.round((kickedBack / reviewBase) * 100) : 0;
    const topReworkVendor = [...byVendor.values()]
      .filter((vendor) => vendor.kicked > 0)
      .sort((a, b) => b.kicked - a.kicked || b.total - a.total)[0];

    const apTickets = tickets.filter(
      (ticket) =>
        ticket.status === "awaiting_payment" ||
        (ticket.status === "approved" && ticket.paymentDispersedAt == null),
    );
    const apAges = apTickets
      .map((ticket) => daysSince(ticket.approvedAt ?? ticket.updatedAt ?? ticket.createdAt))
      .filter((age): age is number => age != null);

    const siteRisk = siteWorkloadRows
      .map((row) => ({
        ...row,
        score: row.activeCount * 2 + row.pendingReviewCount * 3 + row.awaitingPaymentCount * 2,
      }))
      .sort((a, b) => b.score - a.score || b.totalCount - a.totalCount)[0];

    const staleTickets = tickets.filter((ticket) => {
      if (!activeStatuses.has(ticket.status)) return false;
      const age = daysSince(ticket.updatedAt ?? ticket.createdAt);
      return age != null && age >= 7;
    });
    const staleOldest = Math.max(
      0,
      ...staleTickets
        .map((ticket) => daysSince(ticket.updatedAt ?? ticket.createdAt))
        .filter((age): age is number => age != null),
    );

    return [
      {
        key: "lifecycle-bottleneck",
        title: "Lifecycle Bottleneck",
        value: bottleneck ? formatChartStatusLabel(bottleneck.status) : "No bottleneck",
        detail: bottleneck ? `${bottleneck.count} tickets, avg ${bottleneck.avgAge}d` : "No active status backlog",
        subdetail: bottleneck ? `Oldest ${bottleneck.oldest}d` : undefined,
        icon: TimerReset,
        href: bottleneck ? `/tickets?status=${encodeURIComponent(bottleneck.status)}` : "/tickets",
      },
      {
        key: "vendor-response-health",
        title: "Vendor Response Health",
        value: `${awaitingAcceptance.length} pending`,
        detail: `${denied.length} denied invites`,
        subdetail: awaitingAges.length > 0 ? `Oldest pending ${Math.max(...awaitingAges)}d` : "No pending invites",
        icon: UserCheck,
        href: "/tickets?status=awaiting_acceptance",
      },
      {
        key: "rework-rate",
        title: "Rework Rate",
        value: `${reworkRate}%`,
        detail: `${kickedBack} kicked back of ${reviewBase} reviewed`,
        subdetail: topReworkVendor ? `Most: ${topReworkVendor.name}` : "No rework showing",
        icon: RotateCcw,
        href: "/tickets?status=kicked_back",
      },
      {
        key: "ap-aging",
        title: "AP Aging",
        value: `${apTickets.length} waiting`,
        detail: apAges.length > 0 ? `Avg ${Math.round(average(apAges))}d approved` : "No AP backlog",
        subdetail: apAges.length > 0 ? `Oldest ${Math.max(...apAges)}d` : undefined,
        icon: Landmark,
        href: "/tickets?awaitingPayment=true",
      },
      {
        key: "site-risk-score",
        title: "Site Risk Score",
        value: siteRisk ? String(siteRisk.score) : "0",
        detail: siteRisk ? siteRisk.siteName : "No site risk yet",
        subdetail: siteRisk ? `${siteRisk.activeCount} active, ${siteRisk.pendingReviewCount} review, ${siteRisk.awaitingPaymentCount} AP` : undefined,
        icon: ShieldAlert,
        href: siteRisk ? `/site-locations/${siteRisk.siteId}` : "/site-locations",
      },
      {
        key: "stale-active-work",
        title: "Stale Active Work",
        value: `${staleTickets.length}`,
        detail: "No update in 7+ days",
        subdetail: staleTickets.length > 0 ? `Oldest stale ${staleOldest}d` : "Nothing stale",
        icon: Hourglass,
        href: "/tickets",
      },
    ];
  }, [formatChartStatusLabel, siteTicketsQuery.data, siteWorkloadRows]);

  // Email-verification redirect handler. The /api/onboarding/verify-email/:token
  // endpoint redirects here with ?verify=ok|already|expired|invalid. We
  // surface a single toast and strip the query so a refresh doesn't
  // re-toast.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const v = params.get("verify");
    if (!v) return;
    const messages: Record<string, { title: string; variant?: "destructive" }> = {
      ok: { title: t("verifyEmail.toastOk", { defaultValue: "Email verified — thanks!" }) },
      already: {
        title: t("verifyEmail.toastAlready", {
          defaultValue: "Your email was already verified.",
        }),
      },
      expired: {
        title: t("verifyEmail.toastExpired", {
          defaultValue: "That verification link has expired. Resend a new one from onboarding.",
        }),
        variant: "destructive",
      },
      invalid: {
        title: t("verifyEmail.toastInvalid", {
          defaultValue: "That verification link isn't valid.",
        }),
        variant: "destructive",
      },
    };
    const m = messages[v];
    if (m) toast(m);
    params.delete("verify");
    const qs = params.toString();
    const url = window.location.pathname + (qs ? `?${qs}` : "") + window.location.hash;
    window.history.replaceState({}, "", url);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const accentColor = brand.isOrgBranded ? brand.primary : "#f59e0b";
  const progressPillSrc = brandImagePillSrc(brand.primary, brand.name);
  const iconStyle = { color: accentColor };
  const handleBarClick = (status: string) => navigate(`/tickets?status=${encodeURIComponent(status)}`);

  // First card varies by role:
  //   - partner → hotlist-bids (their inbound bid activity)
  //   - vendor  → site-locations (sites they've worked on); the
  //              dedicated site-locations card is dropped further down
  //              so it isn't shown twice
  //   - other (admin) → cross-tenant partners count
  const firstStatCard = isPartner
    ? { key: "hotlist-bids", label: t("dashboard.stats.hotlistBids"), value: summary?.hotlistBids ?? 0, icon: Flame }
    : isVendor
    ? { key: "site-locations", label: t("dashboard.stats.siteLocations"), value: summary?.totalSiteLocations ?? 0, icon: MapPin }
    : { key: "partners", label: t("dashboard.stats.partners"), value: summary?.totalPartners ?? 0, icon: Handshake };

  const statCards = [
    firstStatCard,
    // Vendors should not see the global Partners or Vendors mini cards
    // — those are cross-tenant rollups and would leak counts the
    // vendor has no business with. Their first card already covers
    // site-locations, so drop the duplicate site-locations card too.
    ...(isVendor
      ? []
      : [
          { key: "vendors", label: t("dashboard.stats.vendors"), value: summary?.totalVendors ?? 0, icon: Users },
          { key: "site-locations", label: t("dashboard.stats.siteLocations"), value: summary?.totalSiteLocations ?? 0, icon: MapPin },
        ]),
    { key: "total-tracking", label: t("dashboard.stats.totalTracking"), value: summary?.totalTickets ?? 0, icon: FileText },
    { key: "active", label: t("dashboard.stats.active"), value: summary?.activeTickets ?? 0, icon: Clock },
    { key: "pending-approval", label: t("dashboard.stats.pendingApproval"), value: summary?.pendingApproval ?? 0, icon: AlertTriangle },
    { key: "approved-month", label: t("dashboard.stats.approvedThisMonth"), value: summary?.approvedThisMonth ?? 0, icon: CheckCircle2 },
  ];

  return (
    <div className="space-y-6" data-testid="dashboard-page">
      <div>
        <h1 className="text-2xl font-bold tracking-tight" data-testid="text-page-title">{t("dashboard.title")}</h1>
        <p className="text-muted-foreground text-sm mt-1">{t("dashboard.subtitle")}</p>
      </div>

      {rateLimited && (
        <div
          className="flex items-center gap-1.5 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800"
          data-testid="dashboard-slow-down"
          role="status"
          aria-live="polite"
        >
          <Clock className="w-3.5 h-3.5 shrink-0" />
          <span>
            {retryAfterSeconds != null
              ? t("common.slowDown.retryIn", { seconds: retryAfterSeconds })
              : t("common.slowDown.brief")}
          </span>
        </div>
      )}

      <FinishSetupWidget />

      {isVendor && (pendingDirectAssignments ?? []).length > 0 && (
        <Card data-testid="card-pending-direct-assignments">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Send className="w-5 h-5" style={iconStyle} />
              {t("directAssignment.vendorInboxTitle", { count: pendingDirectAssignments?.length ?? 0 })}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {(pendingDirectAssignments ?? []).map((a) => (
              <div
                key={a.id}
                className="flex flex-col gap-2 rounded-md border border-amber-200 bg-amber-50/50 p-3 sm:flex-row sm:items-center sm:justify-between"
                data-testid={`row-pending-direct-${a.id}`}
              >
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold">{a.partnerName}</div>
                  <div className="text-xs text-muted-foreground truncate">
                    {a.siteName}
                  </div>
                  <div className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                    <CalendarDays className="w-3 h-3" />
                    <span>{a.startDate} → {a.endDate}</span>
                  </div>
                  {a.scopeOfWork && (
                    <div className="mt-1 text-xs">{a.scopeOfWork}</div>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <PngPillButton
                    color="green"
                    className="px-3"
                    onClick={() => {
                      commitDirect.mutate(
                        { id: a.id },
                        {
                          onSuccess: () => {
                            toast({ title: t("directAssignment.committedToast") });
                            void refetchPendingDirect();
                          },
                          onError: () => {
                            toast({
                              title: t("directAssignment.commitFailedToast"),
                              variant: "destructive",
                            });
                          },
                        },
                      );
                    }}
                    disabled={commitDirect.isPending}
                    data-testid={`button-commit-direct-${a.id}`}
                  >
                    {t("directAssignment.commit")}
                  </PngPillButton>
                  <PngPillButton
                    color="red"
                    className="px-3"
                    onClick={() => {
                      setPassReason("");
                      setPassDialogId(a.id);
                    }}
                    data-testid={`button-pass-direct-${a.id}`}
                  >
                    {t("directAssignment.pass")}
                  </PngPillButton>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Dialog
        open={passDialogId !== null}
        onOpenChange={(o) => {
          if (!o) setPassDialogId(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("directAssignment.passDialogTitle")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Label>{t("directAssignment.passReasonLabel")}</Label>
            <textarea
              className="w-full min-h-[96px] rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              value={passReason}
              onChange={(e) => setPassReason(e.target.value)}
              placeholder={t("directAssignment.passReasonPlaceholder")}
              data-testid="textarea-pass-reason"
            />
            <div className="flex justify-end gap-2">
              <LightGreyRedButton
                onClick={() => setPassDialogId(null)}
                disabled={passDirect.isPending}
                data-testid="button-pass-dialog-cancel"
              >
                {t("common.back")}
              </LightGreyRedButton>
              <PngPillButton color="red"
                onClick={() => {
                  if (passDialogId === null) return;
                  const reason = passReason.trim();
                  passDirect.mutate(
                    {
                      id: passDialogId,
                      data: { reason: reason === "" ? null : reason },
                    },
                    {
                      onSuccess: () => {
                        toast({ title: t("directAssignment.passedToast") });
                        setPassDialogId(null);
                        setPassReason("");
                        void refetchPendingDirect();
                      },
                      onError: () => {
                        toast({
                          title: t("directAssignment.passFailedToast"),
                          variant: "destructive",
                        });
                      },
                    },
                  );
                }}
                disabled={passDirect.isPending}
                data-testid="button-pass-dialog-confirm"
              >
                {passDirect.isPending
                  ? t("directAssignment.passing")
                  : t("directAssignment.confirmPass")}
              </PngPillButton>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {isPartner && (
        <AwaitingPaymentTile
          loading={awaitingPaymentLoading}
          count={awaitingPayment?.count ?? 0}
          totalAmount={awaitingPayment?.totalApprovedAmount ?? "0.00"}
          oldestApprovedAt={awaitingPayment?.oldestApprovedAt ?? null}
          accentColor={accentColor}
        />
      )}

      {isAdmin && <AssistantMetricsCard />}
      {isAdmin && <RateLimitBudgetsCard />}
      {isAdmin && <RateLimitTripsCard />}
      {isAdmin && (
        <ReassignmentsTile
          loading={reassignmentsLoading}
          data={reassignments ?? null}
          accentColor={accentColor}
        />
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
        {statCards.map((stat) => (
          <Card key={stat.key} data-testid={`card-stat-${stat.key}`}>
            <CardContent className="p-4 h-24 flex flex-col">
              {summaryLoading ? (
                <Skeleton className="h-10 w-full" />
              ) : (
                <>
                  <div className="flex items-center gap-2">
                    <stat.icon className="w-4 h-4" style={iconStyle} />
                    <span className="text-xs text-gray-700 font-medium">{stat.label}</span>
                  </div>
                  <p
                    className="text-lg font-bold mt-auto text-center"
                    data-testid={`text-stat-${stat.key}`}
                  >
                    {stat.value}
                  </p>
                </>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      <HotlistSection />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card className="bg-white text-gray-900 dark:bg-white dark:text-gray-900" data-testid="card-ticket-stats">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2"><BarChart3 className="w-5 h-5" style={iconStyle} />{t("dashboard.trackingStatus")}</CardTitle>
          </CardHeader>
          <CardContent>
            {statsLoading ? (
              <Skeleton className="h-[250px] w-full" />
            ) : orderedStats && orderedStats.length > 0 ? (
              <>
                <ResponsiveContainer width="100%" height={250}>
                  {/*
                    Keep the YAxis line + tick labels visible but tighten
                    its width to ~30px (counts are single/double digits)
                    and mirror that on `margin.right` so the plot area
                    sits equidistant from the left and right card edges
                    without being shrunk further than the axis footprint
                    itself requires.
                  */}
                  <BarChart data={orderedStats} margin={{ top: 8, right: 30, left: 0, bottom: 0 }}>
                    <XAxis dataKey="status" tick={{ fontSize: 11 }} tickFormatter={formatChartStatusLabel} />
                    <YAxis allowDecimals={false} width={30} />
                    <Tooltip
                      cursor={{ fill: "#ccc", fillOpacity: 0.5 }}
                      labelFormatter={(label) => formatChartStatusLabel(String(label))}
                      formatter={(value: number) => [value, ""]}
                      separator=""
                    />
                    <Bar dataKey="count" maxBarSize={28} shape={(p: object) => <VerticalPillBarShape {...p} flatBottom onBarClick={handleBarClick} />} />
                  </BarChart>
                </ResponsiveContainer>
              </>
            ) : (
              <p className="text-muted-foreground text-sm text-center py-8">{t("dashboard.noTrackingData")}</p>
            )}
          </CardContent>
        </Card>

        <SiteLocationSnapshotCard
          loading={siteListQuery.isLoading || siteTicketsQuery.isLoading}
          rows={siteWorkloadRows}
          accentColor={accentColor}
          progressPillSrc={progressPillSrc}
        />
      </div>

      <DashboardAnalyticsCards
        cards={analyticsCards}
        loading={siteTicketsQuery.isLoading || siteListQuery.isLoading}
        accentColor={accentColor}
      />

      <div className="grid grid-cols-1 gap-6">
        <Card className="bg-white text-gray-900 dark:bg-white dark:text-gray-900" data-testid="card-recent-activity">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2"><Clock className="w-5 h-5" style={iconStyle} />{t("dashboard.recentActivity")}</CardTitle>
          </CardHeader>
          <CardContent>
            {activityLoading ? (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-12 w-full" />
                ))}
              </div>
            ) : activityList.length > 0 ? (
              <div className="space-y-3" data-testid="recent-activity-scroll">
                <div className="space-y-2">
                  {visibleActivity.map((item) => (
                    <Link
                      key={item.id}
                      href={item.ticketId ? `/tickets/${item.ticketId}` : "#"}
                      className={`group flex items-start gap-3 p-2 rounded-md transition-colors cursor-pointer ${
                        item.needsAttention
                          ? "bg-amber-50 hover:bg-amber-100 border border-amber-200"
                          : "bg-muted/50 hover:bg-muted"
                      }`}
                      data-testid={`activity-item-${item.id}`}
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate transition-colors group-hover:[color:var(--brand-primary)]">
                          {item.description}
                        </p>
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-xs text-muted-foreground">
                            {new Date(item.timestamp).toLocaleString()}
                          </p>
                          {item.needsAttention && (
                            <span
                              className="inline-flex items-center px-3 h-[23px] rounded-full border border-gray-300 bg-gray-50 text-gray-600 text-xs font-normal whitespace-nowrap"
                              data-testid={`badge-needs-attention-${item.id}`}
                            >
                              ⚠ Needs attention
                            </span>
                          )}
                        </div>
                      </div>
                      {/* Status column matches the tracking page exactly:
                          same TicketStatusBadge pill + the same
                          stacked secondary lifecycle chip
                          (pending_arrival / en_route / on_site /
                          off_site). Keeps the two surfaces visually
                          identical since they're showing the same
                          underlying signal. */}
                      <div className="flex flex-col items-end gap-1 shrink-0">
                        <TicketStatusBadge
                          status={item.action}
                          updatedAt={item.timestamp}
                          data-testid={`activity-status-${item.id}`}
                        />
                        {item.lifecycleState === "pending_arrival" && (
                          <span
                            className="inline-flex items-center px-3 h-[23px] rounded-full border border-gray-300 bg-gray-50 text-gray-600 text-xs font-normal whitespace-nowrap"
                            data-testid={`activity-pending-arrival-${item.id}`}
                            title={t("tickets.lifecyclePendingArrivalTitle", { defaultValue: "Field employee has not arrived yet" })}
                          >
                            {t("tickets.lifecyclePendingArrival", { defaultValue: "Pending Arrival" })}
                          </span>
                        )}
                        {item.lifecycleState === "en_route" && (
                          <span
                            className="inline-flex items-center px-3 h-[23px] rounded-full border border-gray-300 bg-gray-50 text-gray-600 text-xs font-normal whitespace-nowrap"
                            data-testid={`activity-en-route-${item.id}`}
                            title={t("tickets.lifecycleEnRouteTitle", { defaultValue: "Field employee is en route" })}
                          >
                            {t("tickets.lifecycleEnRoute", { defaultValue: "En Route" })}
                          </span>
                        )}
                        {item.lifecycleState === "on_site" && (
                          <span
                            className="inline-flex items-center px-3 h-[23px] rounded-full border border-gray-300 bg-gray-50 text-gray-600 text-xs font-normal whitespace-nowrap"
                            data-testid={`activity-on-site-${item.id}`}
                            title={t("tickets.lifecycleOnSiteTitle", { defaultValue: "Field employee is on site" })}
                          >
                            {t("tickets.lifecycleOnSite", { defaultValue: "On Site" })}
                          </span>
                        )}
                        {item.lifecycleState === "off_site" && (
                          <span
                            className="inline-flex items-center px-3 h-[23px] rounded-full border border-gray-300 bg-gray-50 text-gray-600 text-xs font-normal whitespace-nowrap"
                            data-testid={`activity-off-site-${item.id}`}
                            title={t("tickets.lifecycleOffSiteTitle", { defaultValue: "Field employee has left the site" })}
                          >
                            {t("tickets.lifecycleOffSite", { defaultValue: "Off Site" })}
                          </span>
                        )}
                      </div>
                    </Link>
                  ))}
                </div>
                {activityList.length > ACTIVITY_PAGE_SIZE && (
                  <div className="flex items-center justify-between pt-2" data-testid="recent-activity-pager">
                    <span className="text-xs text-muted-foreground" data-testid="text-activity-range">
                      {activityFirstShown}–{activityLastShown} of {activityList.length}
                    </span>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => canPagePrev && setActivityPage((p) => Math.max(0, p - 1))}
                        disabled={!canPagePrev}
                        aria-label="Show previous 10"
                        title="Show previous 10"
                        className="inline-flex items-center justify-center p-1 rounded transition-opacity hover:opacity-80 disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:opacity-30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-amber-400"
                        data-testid="button-activity-prev"
                      >
                        <ChevronUp className="w-5 h-5" style={iconStyle} />
                      </button>
                      <button
                        type="button"
                        onClick={() => canPageNext && setActivityPage((p) => Math.min(activityPageCount - 1, p + 1))}
                        disabled={!canPageNext}
                        aria-label="Show next 10"
                        title="Show next 10"
                        className="inline-flex items-center justify-center p-1 rounded transition-opacity hover:opacity-80 disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:opacity-30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-amber-400"
                        data-testid="button-activity-next"
                      >
                        <ChevronDown className="w-5 h-5" style={iconStyle} />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-muted-foreground text-sm text-center py-8">{t("dashboard.noRecentActivity")}</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function DashboardAnalyticsCards({
  cards,
  loading,
  accentColor,
}: {
  cards: DashboardAnalyticsCard[];
  loading: boolean;
  accentColor: string;
}) {
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3" data-testid="dashboard-analytics-prototypes">
      {cards.map((card) => {
        const Icon = card.icon;
        const body = (
          <Card
            className="h-full bg-white text-gray-900 transition-shadow hover:shadow-md dark:bg-white dark:text-gray-900"
            data-testid={`card-analytics-${card.key}`}
          >
            <CardContent className="flex h-full min-h-[128px] flex-col p-4">
              {loading ? (
                <div className="space-y-3">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-7 w-24" />
                  <Skeleton className="h-4 w-full" />
                </div>
              ) : (
                <>
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                      {card.title}
                    </p>
                    <Icon className="h-4 w-4 shrink-0" style={{ color: accentColor }} />
                  </div>
                  <p className="mt-3 truncate text-xl font-bold text-gray-950">
                    {card.value}
                  </p>
                  <p className="mt-1 text-sm font-medium text-gray-700">{card.detail}</p>
                  {card.subdetail && (
                    <p className="mt-auto pt-3 text-xs text-muted-foreground">
                      {card.subdetail}
                    </p>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        );

        if (!card.href || loading) return <div key={card.key}>{body}</div>;

        return (
          <Link key={card.key} href={card.href} className="block h-full">
            {body}
          </Link>
        );
      })}
    </div>
  );
}

function SiteLocationSnapshotCard({
  loading,
  rows,
  accentColor,
  progressPillSrc,
}: {
  loading: boolean;
  rows: SiteWorkloadRow[];
  accentColor: string;
  progressPillSrc: string;
}) {
  const { t } = useTranslation();
  const maxActive = Math.max(1, ...rows.map((row) => row.activeCount));

  return (
    <Card className="bg-white text-gray-900 dark:bg-white dark:text-gray-900" data-testid="card-site-location-snapshot">
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <MapPin className="w-5 h-5" style={{ color: accentColor }} />
          {t("dashboard.siteSnapshot.title", { defaultValue: "Site Location Snapshot" })}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-14 w-full" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <p className="text-muted-foreground text-sm text-center py-8">
            {t("dashboard.siteSnapshot.empty", { defaultValue: "No site workload yet" })}
          </p>
        ) : (
          <div className="space-y-3">
            {rows.map((row) => {
              const width = Math.max(8, Math.round((row.activeCount / maxActive) * 100));
              const needsAttention = row.pendingReviewCount > 0 || row.awaitingPaymentCount > 0;
              return (
                <Link
                  key={row.siteId}
                  href={`/site-locations/${row.siteId}`}
                  className="group block rounded-md border border-gray-200 px-3 py-2 transition-colors hover:bg-muted/50"
                  data-testid={`link-site-snapshot-${row.siteId}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="truncate text-sm font-semibold transition-colors group-hover:[color:var(--brand-primary)]">
                          {row.siteName}
                        </p>
                        {needsAttention && (
                          <AlertTriangle
                            className="h-3.5 w-3.5 shrink-0"
                            style={{ color: accentColor }}
                            aria-label={t("dashboard.siteSnapshot.needsAttention", { defaultValue: "Needs attention" })}
                          />
                        )}
                      </div>
                      <div className="mt-2 h-2 overflow-hidden rounded-full bg-gray-100">
                        <div className="relative h-full rounded-full overflow-hidden" style={{ width: `${width}%` }}>
                          <PillColorLayer src={progressPillSrc} className="opacity-100" />
                        </div>
                      </div>
                    </div>
                    <ArrowRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                  </div>

                  <div className="mt-2 grid grid-cols-4 gap-2 text-xs">
                    <div>
                      <p className="font-semibold" data-testid={`site-snapshot-active-${row.siteId}`}>
                        {row.activeCount}
                      </p>
                      <p className="text-muted-foreground">
                        {t("dashboard.siteSnapshot.active", { defaultValue: "Active" })}
                      </p>
                    </div>
                    <div>
                      <p className="font-semibold">{row.pendingReviewCount}</p>
                      <p className="text-muted-foreground">
                        {t("dashboard.siteSnapshot.review", { defaultValue: "Review" })}
                      </p>
                    </div>
                    <div>
                      <p className="font-semibold">{row.awaitingPaymentCount}</p>
                      <p className="text-muted-foreground">
                        {t("dashboard.siteSnapshot.ap", { defaultValue: "AP" })}
                      </p>
                    </div>
                    <div>
                      <p className="font-semibold">{row.vendorCount}</p>
                      <p className="text-muted-foreground">
                        {t("dashboard.siteSnapshot.vendors", { defaultValue: "Vendors" })}
                      </p>
                    </div>
                  </div>

                  <div className="mt-2 flex items-center justify-between gap-2 text-xs text-muted-foreground">
                    <span>
                      {t("dashboard.siteSnapshot.totalTracking", {
                        count: row.totalCount,
                        defaultValue: "{{count}} total tracking",
                      })}
                    </span>
                    <span>{formatShortRelativeDate(row.lastActivityAt)}</span>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

interface AwaitingPaymentTileProps {
  loading: boolean;
  count: number;
  totalAmount: string;
  oldestApprovedAt: string | null;
  accentColor: string;
}

function AwaitingPaymentTile({
  loading,
  count,
  totalAmount,
  oldestApprovedAt,
  accentColor,
}: AwaitingPaymentTileProps) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language?.startsWith("es") ? "es-MX" : "en-US";
  const totalNumber = Number(totalAmount);
  const totalLabel = Number.isFinite(totalNumber)
    ? totalNumber.toLocaleString(locale, { style: "currency", currency: "USD" })
    : `$${totalAmount}`;
  const oldestDays = oldestApprovedAt
    ? Math.max(
        1,
        Math.floor(
          (Date.now() - new Date(oldestApprovedAt).getTime()) /
            (24 * 60 * 60 * 1000),
        ),
      )
    : 0;
  const empty = !loading && count === 0;
  return (
    <Link
      to="/tickets?awaitingPayment=true"
      data-testid="link-dashboard-awaiting-payment"
      aria-label={t("dashboard.awaitingPayment.title")}
      className="block focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 rounded-lg"
      style={{ ["--ring-color" as string]: accentColor }}
    >
      <Card
        className="hover-elevate active-elevate-2 transition-shadow"
        data-testid="card-awaiting-payment"
      >
        <CardContent className="p-5">
          {loading ? (
            <div className="space-y-2">
              <Skeleton className="h-5 w-40" />
              <Skeleton className="h-8 w-24" />
              <Skeleton className="h-4 w-56" />
            </div>
          ) : (
            <div className="flex items-start gap-4">
              <Wallet
                className="w-5 h-5 mt-0.5 shrink-0"
                style={{ color: accentColor }}
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <h3 className="text-sm font-semibold text-gray-900">
                      {t("dashboard.awaitingPayment.title")}
                    </h3>
                    <p className="text-xs text-muted-foreground">
                      {t("dashboard.awaitingPayment.subtitle")}
                    </p>
                  </div>
                  <ArrowRight
                    className="w-4 h-4 text-muted-foreground shrink-0"
                    aria-hidden="true"
                  />
                </div>
                {empty ? (
                  <p
                    className="mt-3 text-sm text-muted-foreground"
                    data-testid="text-awaiting-payment-empty"
                  >
                    {t("dashboard.awaitingPayment.noneWaiting")}
                  </p>
                ) : (
                  <div className="mt-3 flex flex-wrap items-baseline gap-x-6 gap-y-2">
                    <div>
                      <p
                        className="text-2xl font-bold"
                        style={{ color: accentColor }}
                        data-testid="text-awaiting-payment-count"
                      >
                        {count}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {t("dashboard.awaitingPayment.count", { count })}
                      </p>
                    </div>
                    <div>
                      <p
                        className="text-base font-semibold"
                        data-testid="text-awaiting-payment-total"
                      >
                        {totalLabel}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {t("dashboard.awaitingPayment.totalLabel")}
                      </p>
                    </div>
                    {oldestApprovedAt && (
                      <div>
                        <p
                          className="text-base font-semibold"
                          data-testid="text-awaiting-payment-oldest"
                        >
                          {t("dashboard.awaitingPayment.daysWaiting", {
                            count: oldestDays,
                          })}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {t("dashboard.awaitingPayment.oldestLabel")}
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </Link>
  );
}


interface ReassignmentsTileProps {
  loading: boolean;
  data: {
    reassignedTicketCount: number;
    tickets: {
      ticketId: number;
      vendorInviteCount: number;
      status: string;
      currentVendorId: number | null;
      currentVendorName: string | null;
      // Generated client types serialise dates as ISO strings; match that
      // here so we don't have to coerce on every assignment.
      lastInviteAt: string;
    }[];
  } | null;
  accentColor: string;
}

// Task #858 — admin "Reassignments" tile. Shows the count of tickets
// that bounced through 2+ vendors and a top-N drilldown. Each row
// links to the per-ticket page where the audit trail (status history)
// is rendered, satisfying the "drilldown" requirement.
function ReassignmentsTile({ loading, data, accentColor }: ReassignmentsTileProps) {
  const { t } = useTranslation();
  const count = data?.reassignedTicketCount ?? 0;
  const drilldown = data?.tickets ?? [];
  const empty = !loading && count === 0;
  return (
    <Card data-testid="card-reassignments">
      <CardContent className="p-5">
        {loading ? (
          <div className="space-y-2">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-8 w-24" />
            <Skeleton className="h-4 w-56" />
          </div>
        ) : (
          <div className="flex items-start gap-4">
            <div className="rounded-md p-2" style={{ backgroundColor: `${accentColor}1a` }}>
              <Repeat2 className="w-5 h-5" style={{ color: accentColor }} />
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="text-sm font-semibold text-gray-900">
                {t("dashboard.reassignments.title", { defaultValue: "Reassignments" })}
              </h3>
              <p className="text-xs text-muted-foreground">
                {t("dashboard.reassignments.subtitle", {
                  defaultValue: "Tickets that bounced through 2+ vendors. Audited via ticket history.",
                })}
              </p>
              {empty ? (
                <p className="mt-3 text-sm text-muted-foreground" data-testid="text-reassignments-empty">
                  {t("dashboard.reassignments.none", { defaultValue: "No bounced tickets yet." })}
                </p>
              ) : (
                <>
                  <div className="mt-3">
                    <p
                      className="text-2xl font-bold"
                      style={{ color: accentColor }}
                      data-testid="text-reassignments-count"
                    >
                      {count}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {t("dashboard.reassignments.count", {
                        defaultValue: "{{count}} tickets reassigned at least once",
                        count,
                      })}
                    </p>
                  </div>
                  {drilldown.length > 0 && (
                    <ul className="mt-4 space-y-1.5" data-testid="list-reassignment-drilldown">
                      {drilldown.slice(0, 5).map((row) => (
                        <li key={row.ticketId} className="flex items-center justify-between text-sm gap-3">
                          <Link
                            to={`/tickets/${row.ticketId}`}
                            className="text-amber-600 hover:underline font-medium"
                            data-testid={`link-reassignment-ticket-${row.ticketId}`}
                          >
                            #{row.ticketId}
                          </Link>
                          <span className="text-xs text-muted-foreground truncate flex-1">
                            {row.currentVendorName ?? t("dashboard.reassignments.noCurrentVendor", { defaultValue: "No active vendor" })}
                          </span>
                          <Badge variant="secondary" className="shrink-0">
                            {t("dashboard.reassignments.invitesBadge", {
                              defaultValue: "{{count}} invites",
                              count: row.vendorInviteCount,
                            })}
                          </Badge>
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
