import { PngPillButton } from "@/components/png-pill-rollover";
import type { TicketTransition } from "@workspace/api-client-react";
import {
  useGetTicket,
  useGetCrewSessions,
  useGetSiteLocation,
  useGetTicketNoteLogs,
  useGetTicketUnlocks,
  getGetTicketUnlocksQueryKey,
  useGetTicketTransitions,
  getGetTicketTransitionsQueryKey,
  useCreateTicketNoteLog,
  useUpdateTicket,
  useSubmitTicket,
  useCheckOutTicket,
  useApproveTicket,
  useKickbackTicket,
  useUnlockTicket,
  useAcceptTicket,
  useDenyTicket,
  useReinviteTicket,
  useGetNearbyVendors,
  getGetNearbyVendorsQueryKey,
  useCancelTicket,
  useReactivateTicket,
  useDisperseFundsTicket,
  useReverseFundsDispersal,
  useReverseDispersal,
  useGetTicketLineItems,
  useCreateTicketLineItem,
  useDeleteTicketLineItem,
  getGetTicketQueryKey,
  getGetTicketNoteLogsQueryKey,
  getGetTicketLineItemsQueryKey,
  getGetCrewSessionsQueryKey,
  getGetSiteLocationQueryKey,
  useGetVendorRatings,
  useUpsertVendorRating,
  getGetVendorRatingsQueryKey,
} from "@workspace/api-client-react";
import { formatTicketTrackingNumber } from "@workspace/db/format";
import { computeTicketTaxPreview } from "@workspace/db/ticket-tax-preview";
import StarRating from "@/components/star-rating";
import TicketStatusStepper from "@/components/ticket-status-stepper";
import { TicketSiteVisitSummaryCard } from "@/components/ticket-site-visit-summary-card";
import { CrewTimeSection } from "@/components/crew-time-section";
import { TicketNudgePanel } from "@/components/ticket-nudge-panel";
import { TicketFlagPanel } from "@/components/ticket-flag-panel";
import { getGoogleMapsUrl } from "@/lib/maps";
import { forwardRef, useState, useEffect, useMemo, useRef, useCallback, type ButtonHTMLAttributes } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PngPillButton as PillButton } from "@/components/png-pill-rollover";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { CheckCircle2, XCircle, Send, RotateCcw, MapPin, Pencil, Save, X, AlertTriangle, ShieldCheck, ShieldAlert, FileText, ClipboardList, BookOpen, DollarSign, Plus, Trash2, Printer, CalendarClock, Users, History, UserPlus, UserCheck, UserX, Repeat, Ban, Play, Undo2, Camera, Receipt } from "lucide-react";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { useBrand } from "@/hooks/use-brand";
import {
  useEligibleVendorFieldEmployeesByVendorId,
  useClearStaleFieldEmployeeSelection,
} from "@/hooks/use-eligible-vendor-field-employees";
import SphereBackButton from "@/components/sphere-back-button";
import GreenButton from "@/components/green-button";
import GreenSquareButton from "@/components/green-square-button";
import RedButton from "@/components/red-button";
import OrangeButton from "@/components/orange-button";
import BlueButton from "@/components/blue-button";
import AfePill from "@/components/afe-pill";
import AmberButton from "@/components/amber-button";
import GreyButton from "@/components/grey-button";
import CommentsPanel from "@/components/comments-panel";
import TicketStatusActionPill from "@/components/ticket-status-action-pill";
import ImagePill from "@/components/image-pill";
import TicketStatusBadge from "@/components/ticket-status-badge";
import ScheduleTicketDialog from "@/components/schedule-ticket-dialog";
import LiveConnectionPill, { type LiveConnectionStatus } from "@/components/live-connection-pill";
import { useTicketsRateLimitGate } from "@/hooks/use-tickets-rate-limit-gate";
import { useTicketNudgeFlash } from "@/hooks/use-ticket-nudge-flash";
import { useTranslation } from "react-i18next";
import { translateApiError } from "@/lib/api-error";
import { isForemanPersona } from "@/lib/portal-base";
import { cn } from "@/lib/utils";
import { PillColorLayer } from "@/components/png-pill-chrome";
import {
  PILL_HEIGHT_CLASS,
  PILL_HEIGHT_PX,
  PILL_LABEL_CLASS,
  PILL_MIN_HEIGHT_CLASS,
  PILL_WRAPPER_CLASS,
  pillLabelToneClass,
} from "@/lib/pill-doctrine";
import { ticketLifecyclePillForStatus } from "@/lib/ticket-status-palette";

function getDistanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

const GPS_MATCH_THRESHOLD_KM = 0.5;

const ApprovalActionButton = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & { lifecycleStatus: string }
>(({ lifecycleStatus, className, children, disabled, type = "button", ...props }, ref) => {
  const cfg = ticketLifecyclePillForStatus(lifecycleStatus);

  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled}
      className={cn(
        PILL_WRAPPER_CLASS,
        PILL_HEIGHT_CLASS,
        "min-w-[118px] border-0 bg-transparent p-0",
        "disabled:cursor-not-allowed disabled:opacity-60",
        className,
      )}
      style={{ height: PILL_HEIGHT_PX }}
      {...props}
    >
      <PillColorLayer src={cfg.src} />
      <span
        className={cn(
          PILL_LABEL_CLASS,
          "h-full gap-1.5",
          pillLabelToneClass(cfg.light),
        )}
      >
        {children}
      </span>
    </button>
  );
});
ApprovalActionButton.displayName = "ApprovalActionButton";

type CrewTrackerRow = {
  employeeId: number; userId: number | null; name: string;
  ackStatus: string; ackAt: string | null;
  lastPing: { latitude: number; longitude: number; recordedAt: string; batteryLevel: number | null } | null;
  distanceMeters: number | null; etaMinutes: number | null;
};
type CrewTrackerData = {
  ticketId: number;
  site: { name: string | null; latitude: number | null; longitude: number | null };
  scheduledStartAt: string | null;
  avgRoadSpeedKmh: number;
  crew: CrewTrackerRow[];
};

function CrewTrackerSection({ ticketId, canSee }: { ticketId: number; canSee: boolean }) {
  const { t } = useTranslation();
  const [data, setData] = useState<CrewTrackerData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!canSee) { setLoading(false); return; }
    let cancelled = false;
    async function load() {
      try {
        const r = await fetch(`/api/tickets/${ticketId}/crew-tracker`, { credentials: "include" });
        if (!r.ok) return;
        const j: CrewTrackerData = await r.json();
        if (!cancelled) setData(j);
      } catch { /* ignore */ } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    const iv = setInterval(load, 30_000);
    return () => { cancelled = true; clearInterval(iv); };
  }, [ticketId, canSee]);

  if (!canSee) return null;

  function fmtDistance(m: number | null) {
    if (m == null) return "â€”";
    if (m < 1609) return `${Math.round(m / 0.3048)} ft`;
    const mi = m / 1609.344;
    return `${mi < 10 ? mi.toFixed(1) : Math.round(mi)} mi`;
  }
  function fmtEta(min: number | null) {
    if (min == null) return "â€”";
    if (min < 1) return t("crewTracker.etaNow");
    if (min < 60) return t("crewTracker.etaMins", { min });
    const h = Math.floor(min / 60);
    const r = min % 60;
    return r === 0 ? t("crewTracker.etaHrs", { h }) : t("crewTracker.etaHrsMins", { h, min: r });
  }
  function fmtAge(iso: string | null) {
    if (!iso) return "â€”";
    const ms = Date.now() - new Date(iso).getTime();
    const min = Math.round(ms / 60000);
    if (min < 1) return t("crewTracker.justNow");
    if (min < 60) return t("crewTracker.agoMin", { min });
    const h = Math.round(min / 60);
    return t("crewTracker.agoHr", { h });
  }

  return (
    <Card data-testid="crew-tracker-section">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 flex-wrap">
          <Users className="w-5 h-5" style={{ color: "var(--brand-primary, #f59e0b)" }} />
          {t("crewTracker.title")}
          <a
            href={`/api/tickets/${ticketId}/schedule.ics`}
            className="ml-auto inline-flex items-center gap-1 text-xs px-2 py-1 rounded border border-amber-300 text-amber-700 hover:bg-amber-50"
            data-testid="link-download-ics"
          >
            <CalendarClock className="w-3 h-3" />
            {t("crewTracker.downloadIcs")}
          </a>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="text-sm text-muted-foreground py-4">{t("crewTracker.loading")}</div>
        ) : !data || data.crew.length === 0 ? (
          <div className="text-sm text-muted-foreground py-4">{t("crewTracker.noCrew")}</div>
        ) : (
          <div className="space-y-2">
            {data.crew.map(row => {
              const sLat = data.site.latitude;
              const sLng = data.site.longitude;
              const directionsHref = sLat != null && sLng != null
                ? `https://www.google.com/maps/dir/?api=1&destination=${sLat},${sLng}`
                : null;
              return (
                <div
                  key={row.employeeId}
                  className="flex flex-wrap items-center gap-2 px-3 py-2 border rounded-md text-sm"
                  data-testid={`crew-tracker-row-${row.employeeId}`}
                >
                  <span className="font-medium">{row.name}</span>
                  <TicketStatusBadge status={row.ackStatus} />

                  <span className="text-xs text-muted-foreground ml-2">
                    {row.lastPing ? t("crewTracker.lastPingAt", { age: fmtAge(row.lastPing.recordedAt) }) : t("crewTracker.noPing")}
                  </span>
                  <span className="text-xs ml-auto">
                    {t("crewTracker.distance", { d: fmtDistance(row.distanceMeters) })}
                    {" Â· "}
                    {t("crewTracker.eta", { eta: fmtEta(row.etaMinutes) })}
                  </span>
                  {directionsHref && (
                    <a
                      href={directionsHref}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs hover:underline"
                      style={{ color: "var(--brand-primary, #f59e0b)" }}
                      data-testid={`link-directions-${row.employeeId}`}
                    >
                      {t("crewTracker.directions")}
                    </a>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// Task #857: kind/role taxonomy for the per-ticket Audit Trail filter.
// Mirrors the server-side derivation in
// `artifacts/api-server/src/lib/audit-trail.ts` so the screen, the CSV,
// and the API contract agree.
const AUDIT_KIND_FILTERS = [
  "created",
  "invite_sent",
  "accepted",
  "denied",
  "reinvited",
  "cancelled",
  "reactivated",
  "reopened",
  "other",
] as const;
type AuditKindFilter = (typeof AUDIT_KIND_FILTERS)[number];

const AUDIT_ROLE_FILTERS = [
  "admin",
  "partner",
  "vendor",
  "field_employee",
  "system",
] as const;
type AuditRoleFilter = (typeof AUDIT_ROLE_FILTERS)[number];

const DETAIL_PRIMARY_STALE_MS = 15_000;
const DETAIL_AUX_STALE_MS = 30_000;
const DETAIL_STATIC_STALE_MS = 5 * 60_000;

function deriveTransitionKind(
  fromStatus: string | null | undefined,
  toStatus: string | null | undefined,
): AuditKindFilter {
  const f = fromStatus ?? null;
  const to = toStatus ?? "";
  if (f == null && to === "awaiting_acceptance") return "invite_sent";
  if (f == null) return "created";
  if (to === "awaiting_acceptance") return "reinvited";
  if (f === "awaiting_acceptance" && to === "initiated") return "accepted";
  if (f === "awaiting_acceptance" && to === "denied") return "denied";
  if (to === "cancelled") return "cancelled";
  if (f === "cancelled") return "reactivated";
  if (f === "submitted" || f === "approved" || f === "funds_dispersed") return "reopened";
  return "other";
}

export default function TicketDetail({ id }: { id: number }) {
  const { user } = useAuth();
  const { t } = useTranslation();
  const { nudgeFlashingTicketIds } = useTicketNudgeFlash({
    enabled: !!user,
    ticketId: id,
  });
  const isNudgeFlashing = nudgeFlashingTicketIds.has(id);
  // Task #157: when a partner brand is active, audit-trail filter chips
  // (and other inline amber/blue accents on this page) flip to the
  // partner's primary/accent so the page chrome reads consistently
  // multi-tenant during demos.
  const brand = useBrand();
  const branded = brand.isOrgBranded;
  const statusLabels: Record<string, string> = {
    draft: t("ticketDetail.statusDraft"),
    in_progress: t("ticketDetail.statusInProgress"),
    pending_review: t("ticketDetail.statusPendingReview"),
    completed: t("ticketDetail.statusCompleted"),
    submitted: t("ticketDetail.statusSubmitted"),
    approved: t("ticketDetail.statusApproved"),
    kicked_back: t("ticketDetail.statusKickedBack"),
    cancelled: t("ticketDetail.statusCancelled"),
    // Task #576: surface the awaiting-payment status the field crew can
    // set from mobile, so the office detail screen reads correctly.
    awaiting_payment: t("ticketDetail.statusAwaitingPayment"),
    funds_dispersed: t("ticketDetail.fundsDispersed"),
  };
  // Task #593: vendor office equivalent of the mobile assignment-removed
  // banner (Task #572). When a state-change POST returns
  // `site_vendor_mismatch` or `work_type_not_allowed`, the partner has
  // pulled the vendor's site/work-type assignment out from under an
  // in-flight ticket. Pinning that as a generic 400 toast invites the
  // dispatcher to keep retrying the same button â€” instead, surface a
  // banner with the same "contact partner / cancel ticket" affordance
  // the field crew sees on mobile, and grey out Submit / Send for
  // Review until the assignment comes back (or the ticket is cancelled).
  // Declared above the ticket query so the query can poll while the
  // banner is up (Task #607).
  const [assignmentRemoved, setAssignmentRemoved] = useState<
    "site_vendor_mismatch" | "work_type_not_allowed" | null
  >(null);
  // Task #648: ref-mirror of `assignmentRemoved` so the SSE
  // `ticket.unblocked` handler (whose closure is captured once per
  // EventSource lifetime) can read the latest banner state without
  // re-creating the subscription on every state flip. Used to gate
  // the assignment-restored confirmation toast â€” we only acknowledge
  // restores when the dispatcher was actively blocked, mirroring
  // mobile (Task #623). Without this gate, the toast would fire on
  // every unblock event for the open ticket and spam dispatchers
  // managing dozens of tickets at once.
  const assignmentRemovedRef = useRef(assignmentRemoved);
  assignmentRemovedRef.current = assignmentRemoved;
  // Snapshot of the ticket query's `dataUpdatedAt` when the banner was
  // raised. The clear-on-refresh effect below compares against this so
  // we don't immediately wipe the banner with the same fetch that was
  // already in cache when the action failed.
  const bannerRaisedAtRef = useRef<number>(0);
  // Task #607: while the assignment-removed banner is up, poll the
  // ticket endpoint every few seconds so the page clears itself the
  // moment the partner re-grants the site/work-type assignment, instead
  // of waiting for the operator to navigate away or refocus the tab.
  // When the banner is not active we fall back to react-query's default
  // (no polling) so we don't add background load to every ticket page.
  // Task #675 â€” track per-session rate-limit cooldown for the detail
  // query the same way the list page does. While `detailRateLimited`
  // is true we set `enabled: false` on this query so neither the
  // assignment-removed 7s poll nor SSE-driven invalidations re-fire
  // /api/tickets/:id; once the gate clears the query re-enables and
  // refetches once. State (not just ref) so react-query sees the new
  // `enabled` value on the next render.
  const [detailRateLimitedState, setDetailRateLimitedState] = useState(false);
  const detailRateLimitedRef = useRef(detailRateLimitedState);
  detailRateLimitedRef.current = detailRateLimitedState;
  const ticketQuery = useGetTicket(id, {
    query: {
      enabled: !!id && !detailRateLimitedState,
      queryKey: getGetTicketQueryKey(id),
      refetchInterval: assignmentRemoved && !detailRateLimitedState ? 7000 : false,
      refetchIntervalInBackground: false,
      staleTime: assignmentRemoved ? 0 : DETAIL_PRIMARY_STALE_MS,
      // Disable retries on 429 â€” burning the budget further when
      // we're already throttled never recovers faster. Other errors
      // keep react-query's default (3 retries with backoff) so a
      // transient network blip doesn't strand the page.
      retry: (failureCount: number, err: unknown) => {
        const status = (err as { status?: number } | null)?.status;
        if (status === 429) return false;
        return failureCount < 3;
      },
    },
  });
  const { data: ticket, isLoading, error: ticketError } = ticketQuery;
  const { rateLimited: detailRateLimited } = useTicketsRateLimitGate(ticketError);
  useEffect(() => {
    setDetailRateLimitedState(detailRateLimited);
  }, [detailRateLimited]);
  const ticketDataUpdatedAt = ticketQuery.dataUpdatedAt;
  const { data: crewSessions } = useGetCrewSessions(id, { query: { enabled: !!id, refetchInterval: 60000, queryKey: getGetCrewSessionsQueryKey(id), staleTime: DETAIL_AUX_STALE_MS } });
  const { data: siteLocation } = useGetSiteLocation(ticket?.siteLocationId ?? 0, { query: { enabled: !!ticket?.siteLocationId, queryKey: getGetSiteLocationQueryKey(ticket?.siteLocationId ?? 0), staleTime: DETAIL_STATIC_STALE_MS } });
  const { data: noteLogs } = useGetTicketNoteLogs(id, { query: { enabled: !!id, queryKey: getGetTicketNoteLogsQueryKey(id), staleTime: DETAIL_AUX_STALE_MS } });
  const { data: unlockHistory } = useGetTicketUnlocks(id, { query: { enabled: !!id, queryKey: getGetTicketUnlocksQueryKey(id), staleTime: DETAIL_AUX_STALE_MS } });
  // Task #501: invite/accept/deny/reinvite audit trail. Always loaded for
  // any role allowed to view the ticket detail surface â€” partners are the
  // primary audience, but vendors/admins/field employees benefit from the
  // same chronology when debugging why a job took multiple invites.
  // Task #857: pass `undefined` for params (the JSON form has no
  // server-side filters â€” the filter chips are local; only the CSV
  // export round-trips its filter set as a query string). The third
  // arg is the React Query options object. The route's response type
  // is `TicketTransition[] | string` (the string is the CSV variant);
  // narrow it to the array form here since this hook never sets
  // `?format=csv`.
  const { data: transitions } = useGetTicketTransitions<TicketTransition[]>(
    id,
    undefined,
    {
      query: { enabled: !!id, queryKey: getGetTicketTransitionsQueryKey(id), staleTime: DETAIL_AUX_STALE_MS },
    },
  );

  // Task #857: per-ticket Audit Trail filter chips + CSV export. Filter
  // state is local to the screen (not persisted in the URL) because the
  // typical use is "open the ticket, narrow to denials, export". The
  // Export button reuses the same filter set so the downloaded CSV
  // matches the rows currently on screen.
  const [auditKindFilter, setAuditKindFilter] = useState<AuditKindFilter[]>([]);
  const [auditRoleFilter, setAuditRoleFilter] = useState<AuditRoleFilter[]>([]);
  const [auditFromDate, setAuditFromDate] = useState("");
  const [auditToDate, setAuditToDate] = useState("");
  const toggleAuditKind = useCallback((k: AuditKindFilter) => {
    setAuditKindFilter((prev) =>
      prev.includes(k) ? prev.filter((x) => x !== k) : [...prev, k],
    );
  }, []);
  const toggleAuditRole = useCallback((r: AuditRoleFilter) => {
    setAuditRoleFilter((prev) =>
      prev.includes(r) ? prev.filter((x) => x !== r) : [...prev, r],
    );
  }, []);
  const resetAuditFilters = useCallback(() => {
    setAuditKindFilter([]);
    setAuditRoleFilter([]);
    setAuditFromDate("");
    setAuditToDate("");
  }, []);
  const filteredTransitions = useMemo(() => {
    if (!transitions) return [];
    const fromTs = auditFromDate ? new Date(auditFromDate).getTime() : null;
    const toTs = auditToDate
      ? new Date(`${auditToDate}T23:59:59.999Z`).getTime()
      : null;
    return transitions.filter((entry) => {
      if (auditKindFilter.length > 0) {
        const k = deriveTransitionKind(entry.fromStatus, entry.toStatus);
        if (!auditKindFilter.includes(k)) return false;
      }
      if (auditRoleFilter.length > 0) {
        const role = entry.actorRole ?? "system";
        if (!(auditRoleFilter as readonly string[]).includes(role)) return false;
      }
      if (fromTs != null || toTs != null) {
        const ts = new Date(entry.createdAt).getTime();
        if (fromTs != null && ts < fromTs) return false;
        if (toTs != null && ts > toTs) return false;
      }
      return true;
    });
  }, [transitions, auditKindFilter, auditRoleFilter, auditFromDate, auditToDate]);
  const handleAuditTrailExport = useCallback(() => {
    if (typeof window === "undefined") return;
    const apiBase = import.meta.env.BASE_URL.replace(/\/$/, "");
    const params = new URLSearchParams();
    params.set("format", "csv");
    for (const k of auditKindFilter) params.append("kind", k);
    for (const r of auditRoleFilter) params.append("actorRole", r);
    if (auditFromDate) params.set("from", new Date(auditFromDate).toISOString());
    if (auditToDate)
      params.set("to", new Date(`${auditToDate}T23:59:59.999Z`).toISOString());
    const url = `${apiBase}/api/tickets/${id}/transitions?${params.toString()}`;
    // Use a hidden anchor so the browser respects the
    // Content-Disposition filename and we keep cookies (the audit-trail
    // route is auth-gated). A `window.open` would also work but pops a
    // tab â€” anchor-click is the conventional CSV-download pattern.
    const a = document.createElement("a");
    a.href = url;
    a.rel = "noopener";
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }, [id, auditKindFilter, auditRoleFilter, auditFromDate, auditToDate]);

  useEffect(() => {
    if (!unlockHistory || unlockHistory.length === 0) return;
    const hash = typeof window !== "undefined" ? window.location.hash.replace(/^#/, "") : "";
    if (!hash) return;
    const tryScroll = () => {
      const el = document.getElementById(hash);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "start" });
        return true;
      }
      return false;
    };
    if (!tryScroll()) {
      const t = setTimeout(tryScroll, 100);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [unlockHistory]);
  const { data: lineItems } = useGetTicketLineItems(id, { query: { enabled: !!id, queryKey: getGetTicketLineItemsQueryKey(id), staleTime: DETAIL_AUX_STALE_MS } });
  const createNoteLog = useCreateTicketNoteLog();
  const createLineItem = useCreateTicketLineItem();
  const deleteLineItem = useDeleteTicketLineItem();
  const updateTicket = useUpdateTicket();
  const submitTicket = useSubmitTicket();
  const checkOutTicket = useCheckOutTicket();
  const approveTicket = useApproveTicket();
  const kickbackTicket = useKickbackTicket();
  const unlockTicket = useUnlockTicket();
  const acceptTicket = useAcceptTicket();
  const denyTicket = useDenyTicket();
  const reinviteTicket = useReinviteTicket();
  const cancelTicket = useCancelTicket();
  const reactivateTicket = useReactivateTicket();
  const disperseFunds = useDisperseFundsTicket();
  // Task #504 â€” admin-only escape hatch to reverse a `funds_dispersed`
  // ticket back to `approved`. Lives next to the disperse mutation so the
  // Payment Details card can offer both write paths from one place.
  const reverseFundsDispersal = useReverseFundsDispersal();
  // Task #853 â€” AP-self-service reversal. Mirrors `reverseFundsDispersal`
  // but talks to POST /tickets/:id/reverse-dispersal so a partner-AP
  // viewer (not just an admin) can correct their own miskeyed dispersal.
  // The trigger is gated on `ticket.viewerCanReverseDispersal` below.
  const reverseDispersal = useReverseDispersal();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  // Task #648: keep latest `toast`/`t` accessible from inside the
  // long-lived SSE effect without adding either to its deps. Adding
  // them would tear down and re-open the EventSource on every
  // language change (or on any render where the mocked `useToast`
  // returns a fresh object identity), which the existing "exactly
  // one EventSource per mount" contract forbids.
  const toastRef = useRef(toast);
  toastRef.current = toast;
  const tRef = useRef(t);
  tRef.current = t;
  const [kickbackReason, setKickbackReason] = useState("");
  const [kickbackOpen, setKickbackOpen] = useState(false);
  const [denyOpen, setDenyOpen] = useState(false);
  const [denyReason, setDenyReason] = useState("");
  const [findVendorOpen, setFindVendorOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [unlockOpen, setUnlockOpen] = useState(false);
  const [unlockReason, setUnlockReason] = useState("");
  // Task #587 â€” Mark Awaiting Payment dialog state. Web counterpart to the
  // mobile sheet added in Task #575. Lets vendors and admins flip an
  // in-progress ticket into `awaiting_payment` from the desktop without
  // grabbing their phone. The note is optional and capped at 500 chars to
  // stay inside the server's `invalid_awaiting_payment_body` bound.
  const [awaitingPaymentOpen, setAwaitingPaymentOpen] = useState(false);
  const [awaitingPaymentNote, setAwaitingPaymentNote] = useState("");
  const [awaitingPaymentPending, setAwaitingPaymentPending] = useState(false);
  // Task #497 â€” Disperse Funds dialog state. Pulled out of the dialog body
  // so we can reset on close and gate the Confirm button on the
  // method/reference combination.
  const [disperseOpen, setDisperseOpen] = useState(false);
  const [disperseMethod, setDisperseMethod] = useState<"etf" | "check" | "other">("etf");
  const [disperseRef, setDisperseRef] = useState("");
  const [disperseNote, setDisperseNote] = useState("");
  // Task #852 â€” optional proof-of-payment image. AP can attach a check
  // stub / wire confirmation / signed receipt by picking a file from
  // the desktop modal; the upload happens immediately and we cache the
  // resulting object path here, then ship it as `paymentReceiptUrl` on
  // submit. `null` means nothing attached yet; `disperseReceiptUploading`
  // drives the inline button spinner.
  const [disperseReceiptUrl, setDisperseReceiptUrl] = useState<string | null>(null);
  const [disperseReceiptUploading, setDisperseReceiptUploading] = useState(false);
  const disperseReceiptInputRef = useRef<HTMLInputElement>(null);
  // Task #504 â€” Reverse / void payment dialog state. Admin-only confirm
  // step that requires a non-empty reason; mirrors disperseOpen so the
  // dialog resets cleanly on close and doesn't keep stale text from the
  // last attempt around.
  const [reverseFundsOpen, setReverseFundsOpen] = useState(false);
  const [reverseFundsReason, setReverseFundsReason] = useState("");
  // Task #853 â€” local state for the AP-self-service reverse-dispersal
  // confirm dialog. Kept separate from the admin reverseFunds* state so
  // the two flows (admin escape hatch / AP self-service) don't share
  // form fields and never fight over which mutation is in flight.
  const [reverseDispersalOpen, setReverseDispersalOpen] = useState(false);
  const [reverseDispersalReason, setReverseDispersalReason] = useState("");
  const [isEditing, setIsEditing] = useState(true);
  const [editDescription, setEditDescription] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [noteContent, setNoteContent] = useState("");
  const [editFieldEmployeeId, setEditFieldEmployeeId] = useState<string>("");
  const [lineItemType, setLineItemType] = useState<string>("labor");
  const [lineItemDesc, setLineItemDesc] = useState("");
  const [lineItemQty, setLineItemQty] = useState("");
  const [lineItemPrice, setLineItemPrice] = useState("");
  const [lineItemsDirty, setLineItemsDirty] = useState(false);
  const [rateOpen, setRateOpen] = useState(false);
  const [draftRating, setDraftRating] = useState(0);
  const [draftReview, setDraftReview] = useState("");
  const isPartner = user?.role === "partner";
  const activeMembership = user?.availableMemberships?.find(
    (membership) => membership.id === user.activeMembershipId,
  );
  const activeMembershipRole = activeMembership?.role ?? null;
  const isApprovalAdmin =
    user?.role === "admin" || (isPartner && activeMembershipRole === "admin");
  const displayName = user?.displayName.toLowerCase() ?? "";
  const isFinanceApprover = displayName.includes("finance");
  const canUseApproval1 =
    isApprovalAdmin || (isPartner && activeMembershipRole === "member");
  const canUseApproval2 =
    isApprovalAdmin ||
    (isPartner && activeMembershipRole === "ap" && !isFinanceApprover);
  const canUseApproval3 =
    isApprovalAdmin ||
    (isPartner && activeMembershipRole === "ap" && isFinanceApprover);
  const ratingsVendorId = ticket?.vendorId ?? 0;
  const { data: vendorRatings } = useGetVendorRatings(ratingsVendorId, {
    query: { enabled: !!ratingsVendorId && isPartner, queryKey: getGetVendorRatingsQueryKey(ratingsVendorId) },
  });
  const upsertRating = useUpsertVendorRating();

  // Task #525: route the assign / reassign picker through the shared
  // eligibility hook (Task #516) instead of fetching the unscoped list and
  // filtering inline. We pass `ticket?.vendorId` because the viewer here
  // may be admin / partner (whose active membership doesn't match the
  // ticket's vendor) â€” the hook fetches the vendor-scoped, active-only
  // set and re-asserts vendorId for the same stale-cache reasons that
  // back the phone-intake / Create New Job pickers, so this dropdown
  // can't surface a foreman the Task #507 server tenancy guard would
  // 400 on.
  const {
    eligibleForemen: vendorFieldEmployees,
    fieldEmployees: ticketVendorFieldEmployeesRaw,
  } = useEligibleVendorFieldEmployeesByVendorId(ticket?.vendorId);

  useEffect(() => {
    if (ticket) {
      setEditDescription(ticket.description || "");
      setEditNotes(ticket.notes || "");
      setEditFieldEmployeeId(ticket.fieldEmployeeId ? String(ticket.fieldEmployeeId) : "none");
    }
  }, [ticket]);

  // Task #525: if the currently-picked field employee leaves the eligible
  // set (vendor membership switch / deactivation / soft-delete after the
  // page loaded), drop the stale selection so a save doesn't ship an id
  // the server would 400 on. The picker uses "none" as its empty sentinel,
  // so we translate that for the shared helper (which treats falsy as
  // "nothing selected") and reset back to "none" on clear.
  useClearStaleFieldEmployeeSelection({
    selectedId: editFieldEmployeeId === "none" ? "" : editFieldEmployeeId,
    eligibleForemen: vendorFieldEmployees,
    fieldEmployees: ticketVendorFieldEmployeesRaw,
    onClear: () => setEditFieldEmployeeId("none"),
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: getGetTicketQueryKey(id) });
    // Task #501: any status-mutating action (accept/deny/reinvite/cancel/
    // reactivate/unlock/etc) writes a new ticket_status_history row, so
    // refresh the audit panel alongside the ticket detail.
    queryClient.invalidateQueries({ queryKey: getGetTicketTransitionsQueryKey(id) });
  };

  // `assignmentRemoved` state and `bannerRaisedAtRef` are declared above
  // so the ticket query can poll while the banner is up (Task #607).
  useEffect(() => {
    if (assignmentRemoved && ticketDataUpdatedAt > bannerRaisedAtRef.current) {
      // Any successful refetch after the banner was raised dismisses it.
      // If the partner hasn't actually re-granted the assignment yet,
      // the next state-change attempt will set the banner again.
      setAssignmentRemoved(null);
    }
  }, [ticketDataUpdatedAt, assignmentRemoved]);

  // Task #622: web counterpart to the mobile foreground unblock auto-clear
  // wired up in Task #613. Mobile receives the `ticket_unblocked` Expo push
  // and re-runs `load()` while the screen is mounted; the web has no push
  // channel, so we listen on the `/api/tickets/events` SSE stream wired up
  // for this purpose. On a `ticket.unblocked` event matching this page's
  // ticket id, invalidate the ticket query â€” the existing clear-on-refresh
  // effect above (which dismisses the banner once `dataUpdatedAt` advances
  // past the snapshot the banner captured) does the rest, so we don't need
  // any extra "is the banner up?" branching here. Pings for other tickets
  // are ignored to avoid pulling unrelated tickets out of cache.
  //
  // The 7-second poll added in Task #607 is still the safety net: if the
  // SSE channel is down or the proxy strips the long-lived stream, the
  // banner still clears within ~7s of the partner re-granting access.
  // Task #661 â€” same SSE health pill as the list page. Tracks the
  // EventSource lifecycle and surfaces it via a small "Live /
  // Reconnectingâ€¦ / Reconnected â€” refreshed" pill rendered in the
  // header below.
  const [liveStatus, setLiveStatus] = useState<LiveConnectionStatus>("connecting");
  const liveRefreshedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Task #659 â€” when EventSource auto-reconnects with a Last-Event-ID
  // older than the current global ticket-events sequence, the server's
  // one-shot `ticket.hello` carries `gap: true` to signal that one or
  // more `ticket.*` pushes were missed while we were disconnected.
  // The pill alone is easy to miss on a busy detail page, so we also
  // raise a subtle inline banner (mirroring the crew-map gap warnings)
  // that explicitly tells the dispatcher live updates briefly dropped
  // and the page is being refreshed. It auto-clears as soon as the
  // re-fetched ticket lands (advancing dataUpdatedAt), or via the
  // banner's own "Refresh now" button if the auto-recovery hasn't
  // completed yet.
  const [liveGap, setLiveGap] = useState(false);
  // Snapshot of `dataUpdatedAt` taken when the gap banner went up, so
  // the clear effect knows whether the *next* refetch (the one we
  // kicked off in response to the gap) actually landed before we drop
  // the banner. Same pattern the assignment-removed banner uses.
  const liveGapRaisedAtRef = useRef<number>(0);
  // Mirror of the live `dataUpdatedAt` so the SSE effect (whose deps
  // intentionally exclude it, to avoid re-opening the EventSource on
  // every refetch) can still read the freshest value when capturing
  // the banner-raised snapshot.
  const ticketDataUpdatedAtRef = useRef<number>(0);
  ticketDataUpdatedAtRef.current = ticketQuery.dataUpdatedAt;
  // Task #659 â€” drop the live-gap banner once the refetch we triggered
  // in response to the gap-flagged hello has actually landed (which
  // advances `dataUpdatedAt` past the snapshot we captured when the
  // banner went up). If the user clicked the inline "Refresh now"
  // button manually, that path also calls invalidateTicketNow() which
  // ultimately bumps the same dataUpdatedAt, so this single effect
  // covers both auto-recovery and manual recovery.
  useEffect(() => {
    if (liveGap && ticketDataUpdatedAt > liveGapRaisedAtRef.current) {
      setLiveGap(false);
    }
  }, [ticketDataUpdatedAt, liveGap]);
  // Task #667 â€” lifted out of the SSE effect so the connection pill's
  // manual "Refresh now" button (rendered in the header below) can
  // call them directly. The behavior matches the gap-flagged hello
  // path: invalidate this ticket's query, then briefly flash the
  // pill to "Refreshed" so the user gets the same confirmation
  // they'd see after an automatic gap-recovery.
  const invalidateTicketNow = useCallback(() => {
    if (!Number.isFinite(id) || id <= 0) return;
    // Task #675 â€” while the per-session rate limit is active, swallow
    // invalidations so SSE pushes / manual refresh don't immediately
    // re-fire /api/tickets/:id and re-trip the limiter. The query is
    // also `enabled: false` during the cooldown, so invalidate alone
    // won't refetch â€” but skipping it entirely also avoids needlessly
    // marking the cache stale and forcing an unnecessary fetch the
    // instant the gate clears.
    if (detailRateLimitedRef.current) return;
    queryClient.invalidateQueries({ queryKey: getGetTicketQueryKey(id) });
  }, [id, queryClient]);
  // "Refreshed" is a transient confirmation â€” flip back to "live"
  // after a short hold so the pill doesn't sit on the success
  // copy forever.
  const flashRefreshed = useCallback(() => {
    setLiveStatus("refreshed");
    if (liveRefreshedTimerRef.current) clearTimeout(liveRefreshedTimerRef.current);
    liveRefreshedTimerRef.current = setTimeout(() => {
      liveRefreshedTimerRef.current = null;
      setLiveStatus((prev) => (prev === "refreshed" ? "live" : prev));
    }, 3000);
  }, []);
  // Task #667 â€” handler the pill calls when a dispatcher clicks
  // "Refresh now" on the offline state. Same payload as the gap
  // hello: invalidate this ticket + flash the success state.
  const handleManualRefresh = useCallback(() => {
    invalidateTicketNow();
    flashRefreshed();
  }, [invalidateTicketNow, flashRefreshed]);
  useEffect(() => {
    if (!Number.isFinite(id) || id <= 0) return;
    let es: EventSource | null = null;
    try {
      const apiBase = import.meta.env.BASE_URL.replace(/\/$/, "");
      es = new EventSource(`${apiBase}/api/tickets/events`, {
        withCredentials: true,
      });
      es.onopen = () => {
        // EventSource fires onopen on initial connect AND every
        // subsequent auto-reconnect. Don't clobber a "refreshed"
        // flash that may have been queued by a hello arriving
        // immediately after the reconnect.
        setLiveStatus((prev) => (prev === "refreshed" ? prev : "live"));
      };
      es.onerror = () => {
        // The browser auto-reconnects; surface the state so the
        // dispatcher knows mid-flight changes may not be reflected
        // until reconnect.
        setLiveStatus("reconnecting");
      };
      const onUnblocked = (msg: MessageEvent) => {
        try {
          const parsed = JSON.parse(msg.data) as {
            type?: string;
            ticketId?: number;
          };
          if (parsed.type !== "ticket.unblocked") return;
          if (parsed.ticketId !== id) return;
          // Task #648: capture whether the assignment-removed banner
          // was actually showing *before* we kick off the refresh.
          // We surface a brief confirmation toast only in that case so
          // a dispatcher who was actively blocked realizes the banner
          // cleared and they can retry the action button without
          // re-mashing it. If the banner wasn't up (the operator just
          // happened to have this ticket open while a partner re-granted
          // assignments en masse), we stay silent â€” toasting on every
          // unblock would spam an office juggling dozens of tickets.
          // Mirrors the mobile gate from Task #623.
          const wasShowingBanner = assignmentRemovedRef.current !== null;
          // Re-fetch the ticket so the clear-on-refresh effect dismisses
          // the assignment-removed banner. We deliberately don't touch
          // any other queries here â€” the unblock signal is purely a
          // refresh hint for the ticket itself.
          invalidateTicketNow();
          if (wasShowingBanner) {
            // 3s matches the mobile auto-dismiss cadence (Task #623)
            // and the existing "Refreshed" pill flash so the two
            // confirmations read as one consistent visual rhythm.
            // Use the refs so this long-lived listener always reads
            // the freshest `toast`/`t` without forcing the SSE effect
            // to re-subscribe on every render.
            toastRef.current({
              title: tRef.current("ticketDetail.assignmentRestoredToast"),
              duration: 3000,
            });
          }
        } catch {
          /* malformed payload â€” ignore */
        }
      };
      // Task #657: the server's one-shot `ticket.hello` reports
      // `gap === true` whenever EventSource auto-reconnects with a
      // Last-Event-ID older than the current global sequence â€” i.e.
      // we missed at least one ticket.* event while disconnected.
      // Re-fetch this ticket so a missed unblock (or any other
      // server-side state change reflected in the ticket payload)
      // shows up immediately instead of waiting on the 7s poll.
      const onHello = (msg: MessageEvent) => {
        try {
          const parsed = JSON.parse(msg.data) as {
            type?: string;
            gap?: boolean;
          };
          if (parsed.type !== "ticket.hello") return;
          if (parsed.gap === true) {
            // Task #659 â€” capture the current dataUpdatedAt before
            // the invalidate fires so the clear-effect below knows
            // whether the resulting refetch has landed yet. The
            // banner stays up until that happens (or the user
            // clicks the inline "Refresh now" affordance).
            liveGapRaisedAtRef.current = ticketDataUpdatedAtRef.current;
            setLiveGap(true);
            invalidateTicketNow();
            // Task #661 â€” only flash "refreshed" when we *did* miss
            // events. The first hello on a fresh subscription has
            // gap=false; in that case we just stay on "live".
            flashRefreshed();
          }
        } catch {
          /* malformed payload â€” ignore */
        }
      };
      es.addEventListener("ticket.unblocked", onUnblocked as EventListener);
      es.addEventListener("ticket.hello", onHello as EventListener);
    } catch {
      // EventSource isn't available (e.g. some test environments). The
      // 7s poll fallback in `useGetTicket` still clears the banner.
      // Surface the offline state instead of leaving the pill stuck
      // on "Connectingâ€¦" forever.
      es = null;
      setLiveStatus("reconnecting");
    }
    return () => {
      if (es) es.close();
      if (liveRefreshedTimerRef.current) {
        clearTimeout(liveRefreshedTimerRef.current);
        liveRefreshedTimerRef.current = null;
      }
    };
  }, [id, queryClient, invalidateTicketNow, flashRefreshed]);

  // Default mutation error handler. Surfaces the structured error code
  // returned by ticket-mutation endpoints (Task #527) so partners and
  // vendors see a precise, localized message â€” e.g. "Only the invited
  // vendor can act on this ticket" â€” instead of a generic "Action failed".
  // Falls back to the legacy generic toast when the response carries no
  // recognizable code.
  const showError = (err: unknown, fallbackKey = "ticketDetail.toastActionFailed") =>
    toast({
      title: translateApiError(err, t, t(fallbackKey)),
      variant: "destructive",
    });
  const onError = (err: unknown) => showError(err);

  // Task #593: state-change error router. If the server says the
  // partner removed the (site, work-type) assignment, swallow the toast
  // and raise the banner instead so the dispatcher gets the right
  // affordance (contact partner / cancel) rather than a button to
  // mash. All other failures fall through to the normal toast path.
  const onStateChangeError = (err: unknown, fallbackKey = "ticketDetail.toastActionFailed") => {
    const data = (err as { data?: { error?: string } } | null | undefined)?.data;
    const code = data && typeof data.error === "string" ? data.error : undefined;
    if (code === "site_vendor_mismatch" || code === "work_type_not_allowed") {
      bannerRaisedAtRef.current = ticketDataUpdatedAt;
      setAssignmentRemoved(code);
      return;
    }
    showError(err, fallbackKey);
  };
  const handleSubmit = () => submitTicket.mutate({ id }, {
    onSuccess: () => { invalidate(); toast({ title: t("ticketDetail.toastSubmittedReview") }); },
    // Task #593: route through the state-change error handler so an
    // assignment-removed response (site_vendor_mismatch /
    // work_type_not_allowed) raises the banner instead of just
    // toasting "Action failed."
    onError: (err: unknown) => onStateChangeError(err),
  });
  const handleSendForReview = () => {
    if (!navigator.geolocation) {
      toast({ title: t("ticketDetail.toastGpsNotAvailable"), description: t("ticketDetail.toastGpsNotAvailableDesc"), variant: "destructive" });
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        checkOutTicket.mutate(
          { id, data: { latitude: lat, longitude: lng, workCompleted: false } },
          {
            onSuccess: () => {
              invalidate();
              if (siteLocation?.latitude != null && siteLocation?.longitude != null) {
                const dist = getDistanceKm(lat, lng, siteLocation.latitude, siteLocation.longitude);
                if (dist <= GPS_MATCH_THRESHOLD_KM) {
                  toast({ title: t("ticketDetail.toastSentForReview"), description: t("ticketDetail.toastSentForReviewMatch", { m: (dist * 1000).toFixed(0) }) });
                } else {
                  toast({ title: t("ticketDetail.toastSentForReview"), description: t("ticketDetail.toastSentForReviewMismatch", { mi: (dist / 1.609344).toFixed(2) }), variant: "destructive" });
                }
              } else {
                toast({ title: t("ticketDetail.toastSentForReview") });
              }
            },
            // Task #593: same routing as Submit so a check-out that
            // hits site_vendor_mismatch / work_type_not_allowed raises
            // the banner.
            onError: (err: unknown) => onStateChangeError(err),
          },
        );
      },
      (err) => toast({ title: t("ticketDetail.toastCouldNotGetLocation"), description: err.message, variant: "destructive" }),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  };
  const handleApprove = () => approveTicket.mutate({ id }, { onSuccess: () => { invalidate(); toast({ title: t("ticketDetail.toastTrackingApproved") }); }, onError });
  const handleUnlock = () => {
    const trimmed = unlockReason.trim();
    if (!trimmed) return;
    unlockTicket.mutate({ id, data: { reason: trimmed } }, {
      onSuccess: () => {
        invalidate();
        queryClient.invalidateQueries({ queryKey: getGetTicketNoteLogsQueryKey(id) });
        queryClient.invalidateQueries({ queryKey: getGetTicketUnlocksQueryKey(id) });
        setUnlockOpen(false);
        setUnlockReason("");
        toast({ title: t("ticketDetail.toastTrackingUnlocked") });
      },
      onError,
    });
  };
  const handleCancel = () => cancelTicket.mutate({ id }, { onSuccess: () => { invalidate(); toast({ title: t("ticketDetail.toastTrackingCancelled") }); }, onError });
  const handleDisperseFunds = () => {
    const ref = disperseRef.trim();
    if (disperseMethod === "check" && !ref) {
      toast({ title: t("ticketDetail.disperseFundsReferenceRequired"), variant: "destructive" });
      return;
    }
    disperseFunds.mutate(
      {
        id,
        data: {
          paymentMethod: disperseMethod,
          paymentReference: ref || null,
          note: disperseNote.trim() || null,
          // Task #852 â€” optional proof-of-payment image. Already
          // uploaded above (we hold the resulting object path on
          // state) so this is just a string pass-through. Server
          // trims + null-fallback so an empty string from a cleared
          // attachment doesn't store a junk URL.
          paymentReceiptUrl: disperseReceiptUrl || null,
        },
      },
      {
        onSuccess: () => {
          invalidate();
          queryClient.invalidateQueries({ queryKey: getGetTicketNoteLogsQueryKey(id) });
          setDisperseOpen(false);
          setDisperseRef("");
          setDisperseNote("");
          setDisperseReceiptUrl(null);
          toast({ title: t("ticketDetail.disperseFundsSuccess") });
        },
        onError: (err: unknown) => {
          // Task #527: structured codes from /disperse-funds now drive the
          // toast â€” payment_reference_required, forbidden_not_ap,
          // ticket_not_approved â€” falling back to the generic AP message
          // for legacy 403s without a code, then to the generic action
          // failed string.
          const status = (err as { status?: number; response?: { status?: number } })
            ?.status ?? (err as { response?: { status?: number } })?.response?.status;
          const fallback = status === 403
            ? t("ticketDetail.disperseFundsForbidden")
            : t("ticketDetail.toastActionFailed");
          toast({
            title: translateApiError(err, t, fallback),
            variant: "destructive",
          });
        },
      },
    );
  };
  const handleReactivate = () => reactivateTicket.mutate({ id }, { onSuccess: () => { invalidate(); toast({ title: t("ticketDetail.toastTrackingRestored") }); }, onError });
  // Task #504 â€” Reverse / void payment. Admin-only escape hatch for
  // miskeyed payment refs / wrong vendor / wrong method. Server enforces
  // role + status, this just hides the trigger from non-admins. On
  // success we invalidate the ticket query so the Payment Details card
  // disappears and the action buttons re-render for the now-`approved`
  // status, and the activity log query so the new transition row shows.
  const handleReverseFundsDispersal = () => {
    const reason = reverseFundsReason.trim();
    if (!reason) {
      toast({
        title: t("ticketDetail.reverseFundsReasonRequired"),
        variant: "destructive",
      });
      return;
    }
    reverseFundsDispersal.mutate(
      { id, data: { reason } },
      {
        onSuccess: () => {
          invalidate();
          queryClient.invalidateQueries({ queryKey: getGetTicketNoteLogsQueryKey(id) });
          setReverseFundsOpen(false);
          setReverseFundsReason("");
          toast({ title: t("ticketDetail.reverseFundsSuccess") });
        },
        onError: (err: unknown) => {
          const status = (err as { status?: number; response?: { status?: number } })
            ?.status ?? (err as { response?: { status?: number } })?.response?.status;
          const fallback = status === 403
            ? t("ticketDetail.reverseFundsForbidden")
            : t("ticketDetail.toastActionFailed");
          toast({
            title: translateApiError(err, t, fallback),
            variant: "destructive",
          });
        },
      },
    );
  };
  // Task #853 â€” partner-AP self-service reversal handler. Same
  // success/error plumbing as the admin reverseFunds* flow above (toast
  // messages key off the new `reverseDispersal*` locale strings) so the
  // two paths share one mental model. Keeps a separate mutation in
  // flight so admins running the legacy escape hatch can't deadlock the
  // AP confirm button (or vice versa).
  const handleReverseDispersal = () => {
    const reason = reverseDispersalReason.trim();
    if (!reason) {
      toast({
        title: t("ticketDetail.reverseDispersalReasonRequired"),
        variant: "destructive",
      });
      return;
    }
    reverseDispersal.mutate(
      { id, data: { reason } },
      {
        onSuccess: () => {
          invalidate();
          queryClient.invalidateQueries({ queryKey: getGetTicketNoteLogsQueryKey(id) });
          setReverseDispersalOpen(false);
          setReverseDispersalReason("");
          toast({ title: t("ticketDetail.reverseDispersalSuccess") });
        },
        onError: (err: unknown) => {
          const status = (err as { status?: number; response?: { status?: number } })
            ?.status ?? (err as { response?: { status?: number } })?.response?.status;
          const fallback = status === 403
            ? t("ticketDetail.reverseDispersalForbidden")
            : t("ticketDetail.toastActionFailed");
          toast({
            title: translateApiError(err, t, fallback),
            variant: "destructive",
          });
        },
      },
    );
  };
  // Task #587: POST /tickets/:id/awaiting-payment from the desktop dialog.
  // No generated react-query hook exists for this endpoint yet, so we
  // hand-roll the fetch + error shape (status + parsed body) to feed
  // translateApiError so server codes â€” invalid_awaiting_payment_body,
  // forbidden_not_assigned, ticket_not_in_progress â€” surface in the
  // viewer's locale via the existing `errors.*` keys. On success we close
  // the dialog, reset the note, and invalidate the ticket query so the
  // new `awaiting_payment` status renders without a manual refresh.
  const handleMarkAwaitingPayment = async () => {
    setAwaitingPaymentPending(true);
    try {
      const trimmed = awaitingPaymentNote.trim();
      const body = trimmed ? { note: trimmed } : {};
      const res = await fetch(`/api/tickets/${id}/awaiting-payment`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        let data: { error?: string; message?: string } | null = null;
        try { data = await res.json(); } catch { /* non-JSON body */ }
        const err = new Error(data?.message || `HTTP ${res.status}`) as Error & {
          status?: number;
          data?: { error?: string; message?: string } | null;
        };
        err.status = res.status;
        err.data = data;
        throw err;
      }
      setAwaitingPaymentOpen(false);
      setAwaitingPaymentNote("");
      invalidate();
      queryClient.invalidateQueries({ queryKey: getGetTicketNoteLogsQueryKey(id) });
      toast({
        title: t("tickets.awaitingPaymentSentTitle"),
        description: t("tickets.awaitingPaymentSentBody"),
      });
    } catch (err) {
      showError(err, t("tickets.errorAwaitingPayment"));
    } finally {
      setAwaitingPaymentPending(false);
    }
  };
  const handleKickback = () => {
    kickbackTicket.mutate({ id, data: { reason: kickbackReason } }, {
      onSuccess: () => { invalidate(); setKickbackOpen(false); setKickbackReason(""); toast({ title: t("ticketDetail.toastTrackingKickedBack") }); },
      onError,
    });
  };
  const handleAccept = () => {
    acceptTicket.mutate({ id }, {
      onSuccess: () => { invalidate(); toast({ title: t("ticketDetail.toastInviteAccepted") }); },
      onError,
    });
  };
  const handleDeny = () => {
    denyTicket.mutate({ id, data: { reason: denyReason } }, {
      onSuccess: () => { invalidate(); setDenyOpen(false); setDenyReason(""); toast({ title: t("ticketDetail.toastInviteDenied") }); },
      onError,
    });
  };
  const handleReinvite = (vendorId: number) => {
    reinviteTicket.mutate({ id, data: { vendorId } }, {
      onSuccess: () => { invalidate(); setFindVendorOpen(false); toast({ title: t("ticketDetail.toastVendorReinvited") }); },
      onError,
    });
  };

  const handleSave = () => {
    updateTicket.mutate(
      {
        id,
        data: {
          description: editDescription || null,
          notes: editNotes || null,
          fieldEmployeeId: editFieldEmployeeId && editFieldEmployeeId !== "none" ? Number(editFieldEmployeeId) : null,
        },
      },
      {
        onSuccess: () => {
          invalidate();
          setLineItemsDirty(false);
          setIsEditing(false);
          toast({ title: t("ticketDetail.toastTrackingUpdated") });
        },
        onError,
      }
    );
  };

  const handleCancelEdit = () => {
    if (ticket) {
      setEditDescription(ticket.description || "");
      setEditNotes(ticket.notes || "");
      setEditFieldEmployeeId(ticket.fieldEmployeeId ? String(ticket.fieldEmployeeId) : "none");
    }
    setLineItemsDirty(false);
    setIsEditing(false);
  };

  const hasChanges = useMemo(() => {
    if (!ticket) return false;
    return (
      editDescription !== (ticket.description || "") ||
      editNotes !== (ticket.notes || "") ||
      editFieldEmployeeId !== (ticket.fieldEmployeeId ? String(ticket.fieldEmployeeId) : "none") ||
      lineItemsDirty
    );
  }, [ticket, editDescription, editNotes, editFieldEmployeeId, lineItemsDirty]);

  const handleLogNote = () => {
    if (!noteContent.trim()) return;
    createNoteLog.mutate(
      { id, data: { content: noteContent.trim() } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetTicketNoteLogsQueryKey(id) });
          setNoteContent("");
          toast({ title: t("ticketDetail.toastNoteLogged") });
        },
        onError,
      }
    );
  };

  const handleAddLineItem = () => {
    if (!lineItemDesc.trim() || !lineItemQty || !lineItemPrice) return;
    createLineItem.mutate(
      { id, data: { type: lineItemType as any, description: lineItemDesc.trim(), quantity: lineItemQty, unitPrice: lineItemPrice } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetTicketLineItemsQueryKey(id) });
          setLineItemDesc("");
          setLineItemQty("");
          setLineItemPrice("");
          setLineItemsDirty(true);
          setIsEditing(true);
          toast({ title: t("ticketDetail.toastLineItemAdded") });
        },
        onError,
      }
    );
  };

  const handleDeleteLineItem = (lineItemId: number) => {
    deleteLineItem.mutate(
      { id, lineItemId },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetTicketLineItemsQueryKey(id) });
          setLineItemsDirty(true);
          setIsEditing(true);
          toast({ title: t("ticketDetail.toastLineItemRemoved") });
        },
        onError,
      }
    );
  };

  const taxPreview = useMemo(() => {
    if (!lineItems?.length) {
      return {
        subtotal: 0,
        taxAmount: 0,
        grandTotal: 0,
        laborTax: 0,
        merchandiseTax: 0,
        taxableSubtotal: 0,
        exemptSubtotal: 0,
        laborSubtotal: 0,
      };
    }
    const combinedTaxRate = siteLocation?.combinedTaxRate
      ? parseFloat(String(siteLocation.combinedTaxRate))
      : siteLocation?.merchandiseTaxRate
        ? parseFloat(String(siteLocation.merchandiseTaxRate))
        : 0;
    return computeTicketTaxPreview({
      lineItems,
      combinedTaxRate,
      state: siteLocation?.state ?? null,
      jurisdictionLabel: siteLocation?.taxJurisdictionLabel ?? null,
      workTypeCategory: ticket?.workTypeCategory ?? null,
      effectiveTaxTreatment: ticket?.effectiveTaxTreatment ?? null,
    });
  }, [
    lineItems,
    siteLocation?.combinedTaxRate,
    siteLocation?.merchandiseTaxRate,
    siteLocation?.state,
    siteLocation?.taxJurisdictionLabel,
    ticket?.workTypeCategory,
    ticket?.effectiveTaxTreatment,
  ]);

  const subtotal = taxPreview.subtotal;
  const taxAmount = taxPreview.taxAmount;
  const grandTotal = taxPreview.grandTotal;
  const combinedTaxRateValue = siteLocation?.combinedTaxRate
    ? parseFloat(String(siteLocation.combinedTaxRate))
    : siteLocation?.merchandiseTaxRate
      ? parseFloat(String(siteLocation.merchandiseTaxRate))
      : 0;

  const canEdit = !!ticket && ticket.status !== "approved" && ticket.status !== "cancelled";
  const canEditDetails = canEdit && user?.role !== "partner" && user?.role !== "admin";
  // Crew tracker is visible to: platform admin, vendor admin (admin membership on this
  // ticket's vendor org), or the foreman ASSIGNED to this ticket. Mirrors backend's
  // ensureSchedulerAuth in artifacts/api-server/src/routes/ticketSchedule.ts.
  const isVendorAdminOnTicketVendor = !!user && !!ticket
    && user.role === "vendor"
    && user.vendorId === ticket.vendorId
    && (user.availableMemberships ?? []).some(
      (m) => m.orgType === "vendor" && m.orgId === ticket.vendorId && m.role === "admin",
    );
  const canSeeCrewTracker = !!ticket && (
    user?.role === "admin"
    || isVendorAdminOnTicketVendor
    || (user?.role === "field_employee" && ticket.foremanUserId === user?.userId)
  );

  if (isLoading) return <div className="space-y-4"><Skeleton className="h-8 w-48" /><Skeleton className="h-64 w-full" /></div>;
  if (!ticket) return <p className="text-muted-foreground">{t("ticketDetail.trackingNotFound")}</p>;

  return (
    <div
      className={`space-y-6 relative ${isNudgeFlashing ? "nudge-flash-page" : ""}`}
      data-testid="ticket-detail-page"
    >
      <div className="relative z-10 flex items-center gap-4">
        <Link href="/tickets" className="group inline-flex items-center gap-2" aria-label={t("ticketDetail.backAlt")} data-testid="button-back"><SphereBackButton size={40} /></Link>
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-lg font-bold" data-testid="text-ticket-id">{formatTicketTrackingNumber(ticket.id)}</h1>
            {/* Task #661 â€” small SSE health pill so the dispatcher
                knows whether the live ticket feed is connected. Sits
                inline with the ticket id; doesn't shift layout
                between states (fixed min width).
                Task #667 â€” when offline, the pill becomes a clickable
                "Refresh now" affordance that re-fetches this ticket
                without a full page reload. The pill briefly flashes
                "Refreshed" on success, mirroring the gap-recovery
                confirmation. */}
            {/* Task #675 â€” when the per-session rate limit trips, surface
                the cooldown via the existing "reconnecting" state on the
                pill so the user gets the same visual treatment as a
                normal SSE outage, and disable manual refresh so they
                can't manually pump the limiter. The gate clears itself
                at the end of the Retry-After window. */}
            <LiveConnectionPill
              status={detailRateLimited ? "reconnecting" : liveStatus}
              onRefresh={detailRateLimited ? undefined : handleManualRefresh}
              testId="ticket-detail-live-connection-pill"
            />
            {ticket.unlockedAt && (
              <a
                href="#unlock-history"
                onClick={(e) => {
                  e.preventDefault();
                  document.getElementById("unlock-history")?.scrollIntoView({ behavior: "smooth", block: "start" });
                }}
                className="inline-flex"
                title={
                  ticket.unlockCount > 1
                    ? t("ticketDetail.reopenedByTitleCount", { name: ticket.unlockedByName ?? t("ticketDetail.adminFallback"), when: new Date(ticket.unlockedAt).toLocaleString(), count: ticket.unlockCount })
                    : t("ticketDetail.reopenedByTitle", { name: ticket.unlockedByName ?? t("ticketDetail.adminFallback"), when: new Date(ticket.unlockedAt).toLocaleString() })
                }
                data-testid="badge-reopened-by-admin"
              >
                <ImagePill color="amber">
                  <RotateCcw className="w-3 h-3" />
                  {t("ticketDetail.reopenedBy", { name: ticket.unlockedByName ?? t("ticketDetail.adminFallback") })}
                  {ticket.unlockCount > 1 ? t("ticketDetail.reopenedByCount", { count: ticket.unlockCount }) : ""}
                </ImagePill>
              </a>
            )}
          </div>
          <p className="text-muted-foreground text-sm">{ticket.siteName} - {ticket.workTypeName}</p>
        </div>
        <div className="ml-auto flex items-center gap-3">
          {canEdit && (user?.role === "admin" || user?.role === "vendor" || user?.role === "field_employee") && (
            <PngPillButton
              color={ticket.scheduledStartAt ? "green" : "brand"}
              onClick={() => setScheduleOpen(true)}
              data-testid="button-schedule-ticket"
            >
              <CalendarClock className="w-4 h-4" />
              {ticket.scheduledStartAt ? t("scheduleTicket.scheduled") : t("scheduleTicket.button")}
            </PngPillButton>
          )}
        </div>
      </div>

      <Card className="mb-6">
        <CardContent className="py-5">
          <TicketStatusStepper status={ticket.status} />
          {ticket.lifecycleState ? (
            <p
              className="mt-3 text-sm text-muted-foreground text-center"
              data-testid="ticket-field-lifecycle"
            >
              {t("ticketDetail.fieldLifecycle")}:{" "}
              {t(`crewMap.lifecycleState.${ticket.lifecycleState}`, {
                defaultValue: ticket.lifecycleState.replace(/_/g, " "),
              })}
            </p>
          ) : null}
        </CardContent>
      </Card>

      {/* â”€â”€ Task #659: Live updates gap banner â”€â”€
          When the SSE channel reconnects after a long enough drop that
          the server reports a gap (`ticket.hello` payload with
          `gap: true`), surface a subtle inline banner so the
          dispatcher knows the page may have been showing stale data
          and is being refreshed. The connection pill above the
          stepper already flashes "Reconnected â€” refreshed", but the
          pill is small and easy to miss while focused on the ticket
          body â€” this banner is the more explicit cue. Mirrors the
          pattern the Crew Map uses for its `location.hello` /
          `visitor.hello` gaps. */}
      {liveGap && (
        <div
          className="mb-6 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1 flex items-center gap-2"
          data-testid="banner-ticket-live-gap"
          role="status"
          aria-live="polite"
        >
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          <span data-testid="text-ticket-live-gap-message">
            {t("ticketDetail.liveGapWarning", {
              defaultValue:
                "Reconnected to live updates â€” some changes may have been missed. Refreshing nowâ€¦",
            })}
          </span>
          <button
            type="button"
            className="underline ml-auto"
            onClick={handleManualRefresh}
            data-testid="button-ticket-live-gap-refresh"
          >
            {t("ticketDetail.liveGapRefreshNow", {
              defaultValue: "Refresh now",
            })}
          </button>
        </div>
      )}

      {/* â”€â”€ Task #593: Assignment-removed banner â”€â”€
          Mirrors the mobile banner (Task #572): when a state-change POST
          returned `site_vendor_mismatch` or `work_type_not_allowed`,
          the partner pulled this vendor's site/work-type assignment
          mid-job. Surface a friendly explanation here instead of
          letting the dispatcher keep mashing Submit / Send for Review,
          and offer Cancel as the right next step. The banner is
          dismissed on the next successful refetch of the ticket query
          (see clear-on-refresh effect above) so re-grants by the
          partner silently restore normal operation. */}
      {assignmentRemoved && (
        <Card className="mb-6 border-amber-400" data-testid="banner-assignment-removed">
          <CardContent className="py-5 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-6 h-6 text-amber-500 mt-0.5 shrink-0" />
              <div>
                <p className="font-semibold text-base" data-testid="text-assignment-removed-title">
                  {assignmentRemoved === "site_vendor_mismatch"
                    ? t("ticketDetail.assignmentRemovedTitleSite")
                    : t("ticketDetail.assignmentRemovedTitleWorkType")}
                </p>
                <p className="text-sm text-muted-foreground mt-0.5" data-testid="text-assignment-removed-body">
                  {assignmentRemoved === "site_vendor_mismatch"
                    ? t("ticketDetail.assignmentRemovedBodySite")
                    : t("ticketDetail.assignmentRemovedBodyWorkType")}
                </p>
              </div>
            </div>
            <div className="flex gap-2 shrink-0">
              <PngPillButton color="red"
                onClick={() => {
                  // Self-contained confirm so the banner's cancel works
                  // for any role that can hit it â€” the existing cancel
                  // Dialog is only rendered inside the vendor / partner /
                  // admin branches of the actions footer, so a
                  // field_employee viewing this page on the web would
                  // otherwise click into a no-op. window.confirm is the
                  // same cross-role escape hatch schedule-ticket-dialog
                  // uses for its conflict prompt.
                  if (window.confirm(t("ticketDetail.cancelJobConfirm"))) {
                    handleCancel();
                  }
                }}
                disabled={cancelTicket.isPending}
                data-testid="button-assignment-removed-cancel"
              >
                <XCircle className="w-4 h-4" />
                {cancelTicket.isPending
                  ? t("ticketDetail.cancelling")
                  : t("ticketDetail.assignmentRemovedCancel")}
              </PngPillButton>
            </div>
          </CardContent>
        </Card>
      )}

      {/* â”€â”€ Task #494: Vendor Accept/Deny banner â”€â”€
          Visible to members of the invited vendor org while the partner-self-service
          ticket is still in `awaiting_acceptance`. Two actions: Accept (transitions to
          `initiated` so the standard En-Route â†’ Check-In flow takes over) or Deny
          (requires a written reason and transitions to `denied`). */}
      {ticket.status === "awaiting_acceptance"
        && user?.role === "vendor"
        && user.vendorId === ticket.vendorId && (
        <Card className="mb-6 border-amber-400" data-testid="vendor-invite-banner">
          <CardContent className="py-5 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-6 h-6 text-amber-500 mt-0.5 shrink-0" />
              <div>
                <p className="font-semibold text-base">{t("ticketDetail.inviteAwaitingTitle")}</p>
                <p className="text-sm text-muted-foreground mt-0.5">
                  {t("ticketDetail.inviteAwaitingBody", { partner: ticket.partnerName ?? "" })}
                </p>
              </div>
            </div>
            <div className="flex gap-2 shrink-0">
              <Dialog open={denyOpen} onOpenChange={setDenyOpen}>
                <DialogTrigger asChild>
                  <PngPillButton color="red" data-testid="button-deny-invite">{t("ticketDetail.denyInvite")}</PngPillButton>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader><DialogTitle>{t("ticketDetail.denyInviteTitle")}</DialogTitle></DialogHeader>
                  <div className="space-y-3">
                    <Textarea
                      placeholder={t("ticketDetail.denyReasonPlaceholder")}
                      value={denyReason}
                      onChange={(e) => setDenyReason(e.target.value)}
                      maxLength={500}
                      data-testid="input-deny-reason"
                    />
                    <PngPillButton color="red"
                      onClick={handleDeny}
                      disabled={denyTicket.isPending || !denyReason.trim()}
                      className="w-full"
                      data-testid="button-submit-deny"
                    >
                      {denyTicket.isPending ? t("ticketDetail.sending") : t("ticketDetail.denyInvite")}
                    </PngPillButton>
                  </div>
                </DialogContent>
              </Dialog>
              <GreenButton
                onClick={handleAccept}
                disabled={acceptTicket.isPending}
                data-testid="button-accept-invite"
              >
                {acceptTicket.isPending ? t("ticketDetail.sending") : t("ticketDetail.acceptInvite")}
              </GreenButton>
            </div>
          </CardContent>
        </Card>
      )}

      {/* â”€â”€ Task #494: Partner "Find another Vendor" banner â”€â”€
          Owning partner can launch the alternate-vendor sheet any time
          before work actually starts (vendor check-in flips status to
          `in_progress`). That covers `awaiting_acceptance` (invite still
          pending), `denied` (vendor opted out), and `initiated` (vendor
          accepted but has not checked in yet). */}
      {/* Partners only ever load tickets the server has already scoped to
          their owning partner, so a viewer with role === "partner" is
          implicitly the owning partner â€” no extra partnerId compare needed
          (and the Ticket payload doesn't expose partnerId). */}
      {(ticket.status === "denied"
          || ticket.status === "awaiting_acceptance"
          || ticket.status === "initiated")
        && user?.role === "partner" && (
        <Card className="mb-6 border-amber-400" data-testid="partner-invite-banner">
          <CardContent className="py-5 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-6 h-6 text-amber-500 mt-0.5 shrink-0" />
              <div>
                <p className="font-semibold text-base">
                  {ticket.status === "denied"
                    ? t("ticketDetail.partnerDeniedTitle", { vendor: ticket.vendorName ?? "" })
                    : t("ticketDetail.partnerAwaitingTitle", { vendor: ticket.vendorName ?? "" })}
                </p>
                {ticket.status === "denied" && ticket.kickbackReason && (
                  <p className="text-sm text-muted-foreground mt-0.5">
                    {t("ticketDetail.partnerDeniedReason", { reason: ticket.kickbackReason })}
                  </p>
                )}
              </div>
            </div>
            <PngPillButton color="amber" onClick={() => setFindVendorOpen(true)} data-testid="button-find-vendor">
              {t("ticketDetail.findAnotherVendor")}
            </PngPillButton>
          </CardContent>
        </Card>
      )}

      <div className="grid md:grid-cols-2 gap-6">
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><ClipboardList className="w-5 h-5" style={{ color: "var(--brand-primary, #f59e0b)" }} />{t("ticketDetail.trackingDetails")}</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div><span className="text-muted-foreground">{t("ticketDetail.site")}</span><br/><span className="font-medium">{ticket.siteName}</span></div>
              <div className="col-span-2">
                <span className="text-muted-foreground">{t("ticketDetail.partner")}</span><br/>
                {ticket.partnerLogoUrl ? (
                  <img
                    src={ticket.partnerLogoUrl}
                    alt={ticket.partnerName || ""}
                    className="mt-0.5 w-[200px] max-w-full object-contain"
                    data-testid="img-partner-logo"
                  />
                ) : (
                  <span className="font-medium" data-testid="text-partner-name">{ticket.partnerName || "-"}</span>
                )}
              </div>
              <div>
                <span className="text-muted-foreground">{t("ticketDetail.vendor")}</span><br/>
                {ticket.vendorLogoUrl ? (
                  <img
                    src={ticket.vendorLogoUrl}
                    alt={ticket.vendorName || ""}
                    className="mt-0.5 h-8 max-w-[140px] object-contain"
                    data-testid="img-vendor-logo"
                  />
                ) : (
                  <span className="font-medium" data-testid="text-vendor-name">{ticket.vendorName}</span>
                )}
              </div>
              <div>
                <span className="text-muted-foreground">{t("ticketDetail.workType")}</span><br/>
                <span className="font-medium">{ticket.workTypeName}</span>
                {ticket.afe && (
                  <div className="mt-1">
                    <AfePill
                      data-testid="text-tracking-afe"
                    >
                      {ticket.afe}
                    </AfePill>
                  </div>
                )}
              </div>
              <div>
                <span className="text-muted-foreground">{t("ticketDetail.initiatedBy")}</span><br/>
                <span className="font-medium" data-testid="text-initiated-by">{ticket.createdByName || "-"}</span>
                {ticket.phoneIntakeCallerName && (
                  <div
                    className="mt-0.5 text-xs text-muted-foreground"
                    data-testid="text-phone-intake-caller"
                  >
                    {t("ticketDetail.createdViaPhoneCaller", {
                      name: ticket.phoneIntakeCallerName,
                    })}
                  </div>
                )}
              </div>
              <div>
                <span className="text-muted-foreground">{t("ticketDetail.closedBy")}</span><br/>
                <span className="font-medium" data-testid="text-closed-by">{ticket.closedByName || "-"}</span>
              </div>
              {/* Task #538 â€” Restore the on-page assign / reassign picker for the
                  ticket's lead field employee. The supporting state, eligibility
                  hook, and stale-selection cleanup were kept by Tasks #515/#525
                  but the rendered Select widget was lost in an earlier
                  restructure. Visible to vendor (admin) and platform admin
                  viewers when the ticket is in an editable status; partners and
                  field_employees see the static name. The picker is sourced
                  from the same `vendorFieldEmployees` (eligibleForemen) set the
                  other six pickers use, so deactivated vendor_people are
                  excluded by construction (Task #522). */}
              <div className="col-span-2">
                <span className="text-muted-foreground">{t("ticketDetail.fieldEmployee", { defaultValue: "Field Employee:" })}</span><br/>
                {isEditing && canEdit && (user?.role === "admin" || user?.role === "vendor") ? (
                  <Select value={editFieldEmployeeId} onValueChange={setEditFieldEmployeeId}>
                    <SelectTrigger className="mt-1" data-testid="select-edit-field-employee">
                      <SelectValue placeholder={t("tickets.selectEmployee", { defaultValue: "Select employee" })} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">{t("tickets.unassigned", { defaultValue: "Unassigned" })}</SelectItem>
                      {vendorFieldEmployees.length > 0 ? (
                        vendorFieldEmployees.map((fe) => (
                          <SelectItem key={fe.id} value={String(fe.id)}>{fe.firstName} {fe.lastName}</SelectItem>
                        ))
                      ) : (
                        <div
                          className="px-2 py-1.5 text-sm text-muted-foreground"
                          data-testid="empty-edit-field-employee-list"
                        >
                          {t("tickets.noForemenAvailable", {
                            defaultValue: "No active field employees on your vendor.",
                          })}
                        </div>
                      )}
                    </SelectContent>
                  </Select>
                ) : (
                  <span className="font-medium" data-testid="text-field-employee">
                    {ticket.fieldEmployeeName || "-"}
                  </span>
                )}
              </div>
            </div>
            <div className="mt-3">
              <span className="text-sm text-muted-foreground">{t("ticketDetail.description")}</span>
              {isEditing && canEditDetails ? (
                <Textarea
                  value={editDescription}
                  onChange={(e) => setEditDescription(e.target.value)}
                  placeholder={t("ticketDetail.enterDescription")}
                  className="mt-1 h-[60px] min-h-[60px] resize-none"
                  data-testid="input-description"
                />
              ) : (
                <p className="mt-1">{ticket.description || "-"}</p>
              )}
            </div>
            {(() => {
              const sessions = crewSessions ?? [];
              if (sessions.length === 0) return null;
              const byEmp = new Map<number, { name: string; ms: number }>();
              for (const s of sessions) {
                const name = s.employeeName || t("ticketDetail.employeeFallback", { id: s.employeeId });
                const start = s.checkInAt ? new Date(s.checkInAt).getTime() : 0;
                const end = s.checkOutAt ? new Date(s.checkOutAt).getTime() : Date.now();
                const dur = start && end > start ? end - start : 0;
                const cur = byEmp.get(s.employeeId);
                if (cur) {
                  cur.ms += dur;
                } else {
                  byEmp.set(s.employeeId, { name, ms: dur });
                }
              }
              const fmt = (ms: number) => {
                const hours = Math.max(0, ms / 3600000);
                return t("ticketDetail.hours", { value: hours.toFixed(2) });
              };
              const rows = Array.from(byEmp.values());
              return (
                <div className="mt-3" data-testid="text-crew-on-ticket">
                  <span className="text-sm text-muted-foreground">
                    {t("ticketDetail.fieldEmployeesOnTicket", { count: rows.length })}
                  </span>
                  <ul className="mt-1 text-sm space-y-0.5">
                    {rows.map((r, i) => (
                      <li key={i} className="flex justify-between gap-3">
                        <span>{r.name}</span>
                        <span className="text-muted-foreground tabular-nums">{fmt(r.ms)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })()}
            {ticket.kickbackReason && (
              <div className="mt-3 flex items-start gap-3 p-3 rounded border border-gray-500" style={{ background: "linear-gradient(180deg, #6b7280 0%, #4b5563 100%)" }}>
                <AlertTriangle className="w-5 h-5 mt-0.5 text-amber-400 shrink-0" />
                <div>
                  <p className="text-sm font-semibold text-amber-400">{t("ticketDetail.kickbackReason")}</p>
                  <p className="text-xs text-white/90 mt-0.5">{ticket.kickbackReason}</p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <TicketSiteVisitSummaryCard ticketId={id} />
      </div>

      {/* Task #497 â€” Read-only payment summary. Visible to both vendor and
          partner once funds have actually been dispersed. We anchor on
          paymentDispersedAt rather than status so a future loosening of the
          status enum (e.g. an extra terminal step) still surfaces the row. */}
      {ticket.paymentDispersedAt && (
        <Card id="payment-details" data-testid="payment-details-card">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <DollarSign className="w-5 h-5" style={{ color: "var(--brand-primary, #f59e0b)" }} />
              {t("ticketDetail.paymentDetails")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex flex-wrap gap-x-6 gap-y-1">
              <div>
                <span className="text-muted-foreground">{t("ticketDetail.disperseFundsMethod")}:</span>{" "}
                <span data-testid="payment-method" className="font-medium">
                  {ticket.paymentMethod === "etf" && t("ticketDetail.disperseFundsMethodEtf")}
                  {ticket.paymentMethod === "check" && t("ticketDetail.disperseFundsMethodCheck")}
                  {ticket.paymentMethod === "other" && t("ticketDetail.disperseFundsMethodOther")}
                  {!ticket.paymentMethod && "â€”"}
                </span>
              </div>
              {ticket.paymentReference && (
                <div>
                  <span className="text-muted-foreground">{t("ticketDetail.paymentReferenceLabel")}:</span>{" "}
                  <span data-testid="payment-reference" className="font-medium">{ticket.paymentReference}</span>
                </div>
              )}
              <div>
                <span className="text-muted-foreground">{t("ticketDetail.paymentDispersedOn")}:</span>{" "}
                <span data-testid="payment-dispersed-at" className="font-medium">
                  {new Date(ticket.paymentDispersedAt).toLocaleString()}
                </span>
              </div>
              {ticket.paymentDispersedByName && (
                <div>
                  <span className="text-muted-foreground">{t("ticketDetail.paymentDispersedBy")}:</span>{" "}
                  <span data-testid="payment-dispersed-by" className="font-medium">
                    {ticket.paymentDispersedByName}
                  </span>
                </div>
              )}
            </div>
            {ticket.paymentNote && (
              <div>
                <span className="text-muted-foreground">{t("ticketDetail.paymentNoteLabel")}:</span>{" "}
                <span data-testid="payment-note">{ticket.paymentNote}</span>
              </div>
            )}
            {/* Task #852 â€” proof-of-payment receipt thumbnail. The
                stored value is either an objectPath like
                `/objects/uploads/abc` (mobile sends raw paths) or a
                full URL (legacy / web sends the prefixed form). We
                normalize both to the public `/api/storage/...` route
                so it loads in the browser. The image is wrapped in an
                anchor so reviewers can pop the full-resolution
                receipt in a new tab. */}
            {ticket.paymentReceiptUrl && (
              <div className="space-y-1">
                <span className="text-muted-foreground">
                  {t("ticketDetail.paymentReceiptLabel")}:
                </span>
                {(() => {
                  const raw = ticket.paymentReceiptUrl;
                  const apiBase = import.meta.env.BASE_URL.replace(/\/$/, "");
                  const url = /^https?:\/\//i.test(raw)
                    ? raw
                    : `${apiBase}/api/storage${raw.startsWith("/") ? "" : "/"}${raw}`;
                  return (
                    <a
                      href={url}
                      target="_blank"
                      rel="noreferrer"
                      className="block"
                    >
                      <img
                        src={url}
                        alt={t("ticketDetail.paymentReceiptLabel")}
                        className="mt-1 max-h-48 rounded border object-cover"
                        data-testid="payment-receipt-image"
                      />
                    </a>
                  );
                })()}
              </div>
            )}
            {/* Task #504 â€” Reverse / void payment. Admin-only escape
                hatch surfaced inside the Payment Details card so it sits
                next to the columns it will clear. We only render the
                action while the ticket is still in `funds_dispersed`;
                once reversed the card disappears (paymentDispersedAt is
                cleared) and the regular `approved` action set takes over. */}
            {user?.role === "admin" && ticket.status === "funds_dispersed" && (
              <div className="pt-2">
                <Dialog
                  open={reverseFundsOpen}
                  onOpenChange={(open) => {
                    setReverseFundsOpen(open);
                    if (!open) setReverseFundsReason("");
                  }}
                >
                  <DialogTrigger asChild>
                    <PngPillButton color="red" data-testid="button-reverse-funds-trigger">
                      <RotateCcw className="w-4 h-4" />
                      {t("ticketDetail.reverseFunds")}
                    </PngPillButton>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>{t("ticketDetail.reverseFundsTitle")}</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4">
                      <p className="text-sm text-muted-foreground">
                        {t("ticketDetail.reverseFundsHelp")}
                      </p>
                      <div className="space-y-2">
                        <label className="text-sm font-medium">
                          {t("ticketDetail.reverseFundsReason")}
                        </label>
                        <Textarea
                          value={reverseFundsReason}
                          onChange={(e) => setReverseFundsReason(e.target.value)}
                          placeholder={t("ticketDetail.reverseFundsReasonPlaceholder")}
                          rows={3}
                          maxLength={500}
                          data-testid="input-reverse-funds-reason"
                        />
                        {!reverseFundsReason.trim() && (
                          <p className="text-xs text-red-500">
                            {t("ticketDetail.reverseFundsReasonRequired")}
                          </p>
                        )}
                      </div>
                      <div className="flex justify-end gap-2">
                        <PngPillButton
                          onClick={() => setReverseFundsOpen(false)}
                          data-testid="button-cancel-reverse-funds"
                        >
                          <X className="w-4 h-4" />{t("ticketDetail.cancel")}
                        </PngPillButton>
                        <PngPillButton color="red"
                          onClick={handleReverseFundsDispersal}
                          disabled={reverseFundsDispersal.isPending || !reverseFundsReason.trim()}
                          data-testid="button-confirm-reverse-funds"
                        >
                          <RotateCcw className="w-4 h-4" />
                          {reverseFundsDispersal.isPending
                            ? t("ticketDetail.reverseFundsSubmitting")
                            : t("ticketDetail.reverseFundsConfirm")}
                        </PngPillButton>
                      </div>
                    </div>
                  </DialogContent>
                </Dialog>
              </div>
            )}
            {/* Task #853 â€” AP-self-service "Reverse dispersal" link.
                Surfaced whenever the server flag
                `viewerCanReverseDispersal` is true (admin OR partner-AP
                viewer + ticket still in `funds_dispersed`). The admin
                escape-hatch button above already covers admins via the
                Task #504 endpoint; this link talks to the broader
                Task #853 endpoint so partner-AP users can correct their
                own miskeyed dispersal without calling dispatch. We use
                a small confirm dialog (reason input + confirm button)
                rather than a heavy modal so it sits unobtrusively next
                to the read-only payment columns. */}
            {ticket.viewerCanReverseDispersal === true && (
              <div className="pt-2">
                <Dialog
                  open={reverseDispersalOpen}
                  onOpenChange={(open) => {
                    setReverseDispersalOpen(open);
                    if (!open) setReverseDispersalReason("");
                  }}
                >
                  <DialogTrigger asChild>
                    <PngPillButton
                      color="red"
                      data-testid="link-reverse-dispersal"
                    >
                      <RotateCcw className="w-4 h-4" />
                      {t("ticketDetail.reverseDispersal")}
                    </PngPillButton>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>{t("ticketDetail.reverseDispersalTitle")}</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4">
                      <p className="text-sm text-muted-foreground">
                        {t("ticketDetail.reverseDispersalHelp")}
                      </p>
                      <div className="space-y-2">
                        <label className="text-sm font-medium">
                          {t("ticketDetail.reverseDispersalReason")}
                        </label>
                        <Textarea
                          value={reverseDispersalReason}
                          onChange={(e) => setReverseDispersalReason(e.target.value)}
                          placeholder={t("ticketDetail.reverseDispersalReasonPlaceholder")}
                          rows={3}
                          maxLength={500}
                          data-testid="input-reverse-dispersal-reason"
                        />
                        {!reverseDispersalReason.trim() && (
                          <p className="text-xs text-red-500">
                            {t("ticketDetail.reverseDispersalReasonRequired")}
                          </p>
                        )}
                      </div>
                      <div className="flex justify-end gap-2">
                        <PngPillButton
                          onClick={() => setReverseDispersalOpen(false)}
                          data-testid="button-cancel-reverse-dispersal"
                        >
                          <X className="w-4 h-4" />{t("ticketDetail.cancel")}
                        </PngPillButton>
                        <PngPillButton color="red"
                          onClick={handleReverseDispersal}
                          disabled={reverseDispersal.isPending || !reverseDispersalReason.trim()}
                          data-testid="button-confirm-reverse-dispersal"
                        >
                          <RotateCcw className="w-4 h-4" />
                          {reverseDispersal.isPending
                            ? t("ticketDetail.reverseDispersalSubmitting")
                            : t("ticketDetail.reverseDispersalConfirm")}
                        </PngPillButton>
                      </div>
                    </div>
                  </DialogContent>
                </Dialog>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Card id="activity-log">
        <CardContent className="pt-6">
          <CommentsPanel source="ticket" parentId={id} testIdPrefix="ticket-comments" />
        </CardContent>
      </Card>

      {transitions && transitions.length > 0 && (
        <Card id="audit-trail">
          <CardHeader>
            <CardTitle className="flex flex-wrap items-center gap-2">
              <History className="w-5 h-5" style={{ color: "var(--brand-primary, #f59e0b)" }} />
              {t("ticketDetail.auditTrail")}
              <span className="text-xs font-normal text-muted-foreground ml-1" data-testid="audit-trail-count">
                {t("ticketDetail.auditTrailCount", { count: filteredTransitions.length })}
                {filteredTransitions.length !== transitions.length && (
                  <span className="text-muted-foreground/70">
                    {" "}
                    {t("ticketDetail.auditTrailFilteredOf", { total: transitions.length })}
                  </span>
                )}
              </span>
              <PillButton
                type="button"
                color="image"
                className="ml-auto h-7 px-2 text-xs"
                onClick={handleAuditTrailExport}
                data-testid="button-audit-trail-export"
                title={t("ticketDetail.auditExportTitle")}
              >
                <FileText className="w-3.5 h-3.5 mr-1" />
                {t("ticketDetail.auditExport")}
              </PillButton>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {/* Task #857: filter chips above the timeline. The filter set
                is sent to the server when the user clicks Export so the
                CSV mirrors what the screen is showing. */}
            <div className="flex flex-wrap items-center gap-2 mb-3" data-testid="audit-trail-filters">
              <span className="text-xs font-semibold text-muted-foreground">
                {t("ticketDetail.auditFilterKindLabel")}
              </span>
              {AUDIT_KIND_FILTERS.map((k) => {
                const active = auditKindFilter.includes(k);
                // Task #157: brand-aware chip colors. When a partner
                // brand is active, the toggle uses brand-primary; else
                // it falls back to the historical amber accent.
                const activeStyle: React.CSSProperties = branded
                  ? { backgroundColor: brand.primary, borderColor: brand.primary, color: "#ffffff" }
                  : {};
                const idleStyle: React.CSSProperties = branded
                  ? { color: brand.primary, borderColor: brand.primary }
                  : {};
                const fallbackClass = active
                  ? "bg-amber-500 text-white border-amber-500"
                  : "bg-white text-amber-700 border-amber-300 hover:bg-amber-50";
                return (
                  <button
                    key={k}
                    type="button"
                    onClick={() => toggleAuditKind(k)}
                    data-testid={`chip-audit-kind-${k}`}
                    className={
                      "inline-flex items-center h-[23px] text-xs font-normal px-3 rounded-full border transition-colors " +
                      (branded ? (active ? "text-white" : "bg-white") : fallbackClass)
                    }
                    style={branded ? (active ? activeStyle : idleStyle) : undefined}
                  >
                    {t(`ticketDetail.auditFilterKind_${k}`)}
                  </button>
                );
              })}
              <span className="text-xs font-semibold text-muted-foreground ml-2">
                {t("ticketDetail.auditFilterRoleLabel")}
              </span>
              {AUDIT_ROLE_FILTERS.map((r) => {
                const active = auditRoleFilter.includes(r);
                // Task #157: brand-aware role chip. Uses brand-accent so
                // it stays visually distinct from the kind chips above
                // (which use brand-primary). Falls back to blue when no
                // partner branding is active.
                const activeStyle: React.CSSProperties = branded
                  ? { backgroundColor: brand.accent, borderColor: brand.accent, color: "#ffffff" }
                  : {};
                const idleStyle: React.CSSProperties = branded
                  ? { color: brand.accent, borderColor: brand.accent }
                  : {};
                const fallbackClass = active
                  ? "bg-blue-500 text-white border-blue-500"
                  : "bg-white text-blue-700 border-blue-300 hover:bg-blue-50";
                return (
                  <button
                    key={r}
                    type="button"
                    onClick={() => toggleAuditRole(r)}
                    data-testid={`chip-audit-role-${r}`}
                    className={
                      "inline-flex items-center h-[23px] text-xs font-normal px-3 rounded-full border transition-colors " +
                      (branded ? (active ? "text-white" : "bg-white") : fallbackClass)
                    }
                    style={branded ? (active ? activeStyle : idleStyle) : undefined}
                  >
                    {t(`ticketDetail.auditRole_${r}`, { defaultValue: r })}
                  </button>
                );
              })}
              <span className="text-xs font-semibold text-muted-foreground ml-2">
                {t("ticketDetail.auditFilterDateLabel")}
              </span>
              <input
                type="date"
                value={auditFromDate}
                onChange={(e) => setAuditFromDate(e.target.value)}
                aria-label={t("ticketDetail.auditFilterFrom")}
                data-testid="input-audit-from"
                className="text-xs border border-amber-300 rounded px-2 py-0.5"
              />
              <span className="text-xs text-muted-foreground">{t("ticketDetail.auditFilterTo")}</span>
              <input
                type="date"
                value={auditToDate}
                onChange={(e) => setAuditToDate(e.target.value)}
                aria-label={t("ticketDetail.auditFilterTo")}
                data-testid="input-audit-to"
                className="text-xs border border-amber-300 rounded px-2 py-0.5"
              />
              {(auditKindFilter.length > 0 ||
                auditRoleFilter.length > 0 ||
                auditFromDate ||
                auditToDate) && (
                <button
                  type="button"
                  onClick={resetAuditFilters}
                  data-testid="button-audit-clear-filters"
                  className="text-xs text-muted-foreground hover:text-amber-700 underline ml-1"
                >
                  {t("ticketDetail.auditFilterClear")}
                </button>
              )}
            </div>
            {filteredTransitions.length === 0 ? (
              <div
                className="text-sm text-muted-foreground italic px-2 py-4"
                data-testid="audit-trail-empty"
              >
                {t("ticketDetail.auditFilterEmpty")}
              </div>
            ) : (
            <ol
              className="relative border-l-2 border-amber-200 ml-2 space-y-4"
              data-testid="audit-trail-timeline"
            >
              {filteredTransitions.map((entry) => {
                // Pick a row label/icon based on the (fromStatus â†’ toStatus)
                // shape. Mirrors the server-side categories that
                // `recordTicketTransition()` writes today: invite sent /
                // invite accepted / invite denied / reinvited (vendor swap)
                // / cancelled / reactivated / reopened (admin unlock) /
                // payment_reversed (Task #504 â€” admin voids a payment via
                // /reverse-funds-dispersal which writes a distinct
                // `funds_dispersed â†’ approved` row whose reason starts
                // with `Reversed:`).
                const reasonForKind = entry.displayReason ?? entry.reason ?? "";
                let kind: "created" | "invite_sent" | "accepted" | "denied" | "reinvited" | "cancelled" | "reactivated" | "reopened" | "payment_reversed" | "other" = "other";
                if (entry.fromStatus == null && entry.toStatus === "awaiting_acceptance") {
                  kind = "invite_sent";
                } else if (entry.fromStatus == null) {
                  kind = "created";
                } else if (entry.toStatus === "awaiting_acceptance") {
                  kind = "reinvited";
                } else if (entry.fromStatus === "awaiting_acceptance" && entry.toStatus === "initiated") {
                  kind = "accepted";
                } else if (entry.fromStatus === "awaiting_acceptance" && entry.toStatus === "denied") {
                  kind = "denied";
                } else if (entry.toStatus === "cancelled") {
                  kind = "cancelled";
                } else if (entry.fromStatus === "cancelled") {
                  kind = "reactivated";
                } else if (
                  entry.fromStatus === "funds_dispersed" &&
                  entry.toStatus === "approved" &&
                  reasonForKind.startsWith("Reversed:")
                ) {
                  // Branch must precede the generic `reopened` arm below
                  // since a fund reversal also matches `fromStatus ===
                  // "funds_dispersed"`.
                  kind = "payment_reversed";
                } else if (entry.fromStatus === "submitted" || entry.fromStatus === "approved" || entry.fromStatus === "funds_dispersed") {
                  kind = "reopened";
                }

                const headlineByKind: Record<typeof kind, string> = {
                  created: t("ticketDetail.auditCreated"),
                  invite_sent: t("ticketDetail.auditInviteSent"),
                  accepted: t("ticketDetail.auditInviteAccepted"),
                  denied: t("ticketDetail.auditInviteDenied"),
                  reinvited:
                    entry.fromVendorName && entry.toVendorName
                      ? t("ticketDetail.auditReinvitedFromTo", {
                          from: entry.fromVendorName,
                          to: entry.toVendorName,
                        })
                      : t("ticketDetail.auditReinvited"),
                  cancelled: t("ticketDetail.auditCancelled"),
                  reactivated: t("ticketDetail.auditReactivated"),
                  reopened: t("ticketDetail.auditReopened", {
                    status:
                      statusLabels[entry.fromStatus ?? ""] ??
                      (entry.fromStatus ?? "").replace(/_/g, " "),
                  }),
                  payment_reversed: t("ticketDetail.auditPaymentReversed"),
                  other: t("ticketDetail.auditTransition", {
                    from:
                      statusLabels[entry.fromStatus ?? ""] ??
                      (entry.fromStatus ?? "â€”").replace(/_/g, " "),
                    to:
                      statusLabels[entry.toStatus] ??
                      entry.toStatus.replace(/_/g, " "),
                  }),
                };
                const Icon = (
                  {
                    created: ClipboardList,
                    invite_sent: Send,
                    accepted: UserCheck,
                    denied: UserX,
                    reinvited: Repeat,
                    cancelled: Ban,
                    reactivated: Play,
                    reopened: RotateCcw,
                    payment_reversed: Undo2,
                    other: History,
                  } as const
                )[kind];

                // Hide the raw `reason` for kinds whose body is already
                // rendered above (denied â†’ kickback reason becomes the
                // headline/body; reinvited â†’ vendor swap is in the
                // headline). For the rest, surface either the
                // server-rewritten `displayReason` or fall back to the
                // raw text. Skip the synthetic `direct_award_from_hotlist`
                // marker â€” that's an internal tag, not a partner-facing
                // explanation.
                const HIDE_REASON_KINDS = new Set(["reinvited", "invite_sent", "accepted", "created"]);
                const rawReason = entry.displayReason ?? entry.reason ?? null;
                // Reversed payments are stored as `Reversed: <admin reason>`
                // by /reverse-funds-dispersal. Strip the marker so the
                // body shows just the human reason â€” the headline + the
                // distinct "Reversal reason:" label already convey that
                // this is a reversal.
                const reasonText =
                  rawReason && rawReason.startsWith("direct_award_from_hotlist:")
                    ? null
                    : kind === "payment_reversed" && rawReason
                      ? rawReason.replace(/^Reversed:\s*/, "").trim() || null
                      : rawReason;
                const showReason =
                  reasonText && !HIDE_REASON_KINDS.has(kind);
                const isDenied = kind === "denied";
                const isPaymentReversed = kind === "payment_reversed";
                const iconClassName = isPaymentReversed
                  ? "w-4 h-4 text-red-600 self-center"
                  : "w-4 h-4 text-amber-600 self-center";
                const dotClassName = isPaymentReversed
                  ? "absolute -left-[7px] flex items-center justify-center w-3 h-3 rounded-full bg-red-500 border-2 border-white"
                  : "absolute -left-[7px] flex items-center justify-center w-3 h-3 rounded-full bg-amber-400 border-2 border-white";
                return (
                  <li
                    key={entry.id}
                    className="ml-4"
                    data-testid={`audit-trail-entry-${entry.id}`}
                    data-kind={kind}
                  >
                    <span className={dotClassName} />
                    <div className="flex flex-wrap items-baseline gap-x-2">
                      <Icon className={iconClassName} />
                      <span className="text-sm font-semibold">
                        {headlineByKind[kind]}
                      </span>
                      {isPaymentReversed && (
                        <ImagePill
                          color="red"
                          className="uppercase tracking-wide"
                          data-testid={`audit-trail-payment-reversed-badge-${entry.id}`}
                        >
                          {t("ticketDetail.auditPaymentReversedBadge")}
                        </ImagePill>
                      )}
                      <span className="text-xs text-muted-foreground">
                        {new Date(entry.createdAt).toLocaleString()}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {entry.actorName
                        ? t("ticketDetail.auditByActor", {
                            name: entry.actorName,
                            role: entry.actorRole
                              ? t(`ticketDetail.auditRole_${entry.actorRole}`, {
                                  defaultValue: entry.actorRole,
                                })
                              : t("ticketDetail.auditUnknownRole"),
                          })
                        : t("ticketDetail.auditBySystem")}
                    </p>
                    {showReason && (
                      <p
                        className={
                          "text-sm mt-1 p-2 rounded border " +
                          (isDenied || isPaymentReversed
                            ? "bg-red-50 border-red-200 text-red-900"
                            : "bg-amber-50 border-amber-200 text-amber-900")
                        }
                        data-testid={`audit-trail-reason-${entry.id}`}
                      >
                        <span className="font-semibold">
                          {isDenied
                            ? t("ticketDetail.auditDenialReasonLabel")
                            : isPaymentReversed
                              ? t("ticketDetail.auditReversalReasonLabel")
                              : t("ticketDetail.reasonLabel")}
                        </span>{" "}
                        {reasonText}
                      </p>
                    )}
                  </li>
                );
              })}
            </ol>
            )}
          </CardContent>
        </Card>
      )}

      {user?.role !== "field_employee" && unlockHistory && unlockHistory.length > 0 && (
        <Card id="unlock-history">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <RotateCcw className="w-5 h-5" style={{ color: "var(--brand-primary, #f59e0b)" }} />
              {t("ticketDetail.unlockHistory")}
              <span className="text-xs font-normal text-muted-foreground ml-1">
                {t("ticketDetail.unlockCount", { count: unlockHistory.length })}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ol className="relative border-l-2 border-amber-200 ml-2 space-y-4" data-testid="unlock-history-timeline">
              {unlockHistory.map((entry, idx) => (
                <li key={entry.id} className="ml-4" data-testid={`unlock-history-entry-${entry.id}`}>
                  <span className="absolute -left-[7px] flex items-center justify-center w-3 h-3 rounded-full bg-amber-400 border-2 border-white" />
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <span className="text-xs font-semibold text-amber-700 uppercase tracking-wide">
                      {t("ticketDetail.unlockNumber", { n: unlockHistory.length - idx })}
                    </span>
                    <span className="text-sm font-medium">
                      {entry.unlockedByName ?? t("ticketDetail.unknownAdmin")}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {new Date(entry.unlockedAt).toLocaleString()}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {t("ticketDetail.reopenedFrom", { status: statusLabels[entry.previousStatus] ?? entry.previousStatus.replace(/_/g, " ") })}
                  </p>
                  {entry.reason && (
                    <p
                      className="text-sm mt-1 p-2 rounded bg-amber-50 border border-amber-200 text-amber-900"
                      data-testid={`unlock-history-reason-${entry.id}`}
                    >
                      <span className="font-semibold">{t("ticketDetail.reasonLabel")}</span> {entry.reason}
                    </p>
                  )}
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>
      )}

      <CrewTimeSection
        ticketId={id}
        vendorId={ticket?.vendorId ?? null}
        canEdit={canEdit && user?.role !== "admin" && user?.role !== "partner"}
        canEditRoster={canEdit && user?.role !== "partner"}
      />

      {ticket?.scheduledStartAt && (
        <CrewTrackerSection ticketId={id} canSee={canSeeCrewTracker} />
      )}

      {ticket && (
        <ScheduleTicketDialog
          open={scheduleOpen}
          onOpenChange={setScheduleOpen}
          ticketId={ticket.id}
          vendorId={ticket.vendorId}
          foremanMode={isForemanPersona(user)}
        />
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 flex-wrap">
            <DollarSign className="w-5 h-5" style={{ color: "var(--brand-primary, #f59e0b)" }} />{t("ticketDetail.partsLabor")}
            {ticket.afe && (
              <AfePill
                className="ml-1"
                data-testid="text-parts-labor-afe"
              >
                {ticket.afe}
              </AfePill>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {canEdit && user?.role !== "admin" && user?.role !== "partner" && (
            <div className="space-y-3">
              <div className="grid grid-cols-12 gap-2 items-end">
                <div className="col-span-3">
                  <span className="text-xs text-muted-foreground">{t("ticketDetail.type")}</span>
                  <Select value={lineItemType} onValueChange={setLineItemType}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="labor">{t("ticketDetail.typeLabor")}</SelectItem>
                      <SelectItem value="part">{t("ticketDetail.typePart")}</SelectItem>
                      <SelectItem value="equipment">{t("ticketDetail.typeEquipment")}</SelectItem>
                      <SelectItem value="other">{t("ticketDetail.typeOther")}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="col-span-5">
                  <span className="text-xs text-muted-foreground">{t("ticketDetail.descriptionShort")}</span>
                  <Input value={lineItemDesc} onChange={(e) => setLineItemDesc(e.target.value)} placeholder={t("ticketDetail.descriptionPlaceholder")} />
                </div>
                <div className="col-span-2">
                  <span className="text-xs text-muted-foreground">{t("ticketDetail.qty")}</span>
                  <Input type="number" step="0.01" value={lineItemQty} onChange={(e) => setLineItemQty(e.target.value)} placeholder="0" />
                </div>
                <div className="col-span-2">
                  <span className="text-xs text-muted-foreground">{t("ticketDetail.unitPrice")}</span>
                  <Input type="number" step="0.01" value={lineItemPrice} onChange={(e) => setLineItemPrice(e.target.value)} placeholder="0.00" />
                </div>
              </div>
              <div className="flex justify-end">
                {lineItemDesc.trim() && lineItemQty && lineItemPrice ? (
                  <PngPillButton color="amber" onClick={handleAddLineItem} disabled={createLineItem.isPending}>
                    <Plus className="w-4 h-4" />{createLineItem.isPending ? t("ticketDetail.adding") : t("ticketDetail.add")}
                  </PngPillButton>
                ) : (
                  <PngPillButton disabled>
                    <Plus className="w-4 h-4" />{t("ticketDetail.add")}
                  </PngPillButton>
                )}
              </div>
            </div>
          )}

          {lineItems && lineItems.length > 0 ? (
            <div className="border rounded overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="text-left p-2 font-medium">{t("ticketDetail.type")}</th>
                    <th className="text-left p-2 font-medium">{t("ticketDetail.descriptionShort")}</th>
                    <th className="text-right p-2 font-medium">{t("ticketDetail.qty")}</th>
                    <th className="text-right p-2 font-medium">{t("ticketDetail.unitPrice")}</th>
                    <th className="text-right p-2 font-medium">{t("ticketDetail.totalCol")}</th>
                    {canEdit && user?.role !== "admin" && user?.role !== "partner" && <th className="p-2 w-8"></th>}
                  </tr>
                </thead>
                <tbody>
                  {lineItems.map((item) => (
                    <tr key={item.id} className="border-t">
                      <td className="p-2 capitalize">{item.type}</td>
                      <td className="p-2">{item.description}</td>
                      <td className="p-2 text-right">{parseFloat(item.quantity).toFixed(2)}</td>
                      <td className="p-2 text-right">${parseFloat(item.unitPrice).toFixed(2)}</td>
                      <td className="p-2 text-right font-medium">${(parseFloat(item.quantity) * parseFloat(item.unitPrice)).toFixed(2)}</td>
                      {canEdit && user?.role !== "admin" && user?.role !== "partner" && (
                        <td className="p-2 text-center">
                          <button onClick={() => handleDeleteLineItem(item.id)} className="text-red-500 hover:text-red-700 cursor-pointer">
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">{t("ticketDetail.noLineItems")}</p>
          )}

          <div className="border-t pt-3 space-y-1">
            {ticket?.effectiveTaxTreatment ? (
              <div className="flex justify-between text-xs text-muted-foreground pb-1">
                <span>{t("ticketDetail.taxClassification")}</span>
                <span data-testid="text-ticket-tax-classification">
                  {t(`taxTreatment.${ticket.effectiveTaxTreatment}`)}
                </span>
              </div>
            ) : null}
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">{t("ticketDetail.subtotal")}</span>
              <span className="font-medium">${subtotal.toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">
                {t("ticketDetail.taxLabelMerchandise", {
                  label: siteLocation?.taxJurisdictionLabel || siteLocation?.state || "—",
                  pct: (combinedTaxRateValue * 100).toFixed(2),
                })}
              </span>
              <span className="font-medium">${taxPreview.merchandiseTax.toFixed(2)}</span>
            </div>
            {taxPreview.laborTax > 0 ? (
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">
                  {t("ticketDetail.taxLabelLabor", {
                    label: siteLocation?.taxJurisdictionLabel || siteLocation?.state || "—",
                    pct: (combinedTaxRateValue * 100).toFixed(2),
                  })}
                </span>
                <span className="font-medium">${taxPreview.laborTax.toFixed(2)}</span>
              </div>
            ) : taxPreview.laborSubtotal > 0 ? (
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">
                  {t("ticketDetail.taxLabelLaborExempt", {
                    state: siteLocation?.state || "N/A",
                  })}
                </span>
                <span className="font-medium">$0.00</span>
              </div>
            ) : null}
            <div className="flex justify-between text-sm font-medium">
              <span className="text-muted-foreground">{t("ticketDetail.taxTotal")}</span>
              <span>${taxAmount.toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-base font-bold border-t pt-2">
              <span>{t("ticketDetail.totalRow")}</span>
              <span>${grandTotal.toFixed(2)}</span>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>{t("ticketDetail.actions")}</CardTitle></CardHeader>
        <CardContent className="flex gap-3 flex-wrap items-center">
          {ticket.siteLocationId ? (
            <Link href={`/safety-report?siteLocationId=${ticket.siteLocationId}&ticketId=${ticket.id}`}>
              <PngPillButton color="image" data-testid="button-safety-report">
                <ShieldAlert className="w-4 h-4" />
                {t("ticketDetail.safetyReport")}
              </PngPillButton>
            </Link>
          ) : null}
          {user?.role === "field_employee" ? (
            <>
              {/* Task #620 â€” status pill mapping moved into the shared
                  TicketStatusActionPill component so admin / vendor / field
                  views always agree on color, icon, label, and data-testid.
                  This subsumes the per-status pill blocks added in
                  Tasks #599 (awaiting_payment) and #619 (funds_dispersed for
                  the field branch); the shared component renders both. */}
              <TicketStatusActionPill status={ticket.status} />
              {(ticket.status === "in_progress" || ticket.status === "kicked_back") && (
                // Task #593: grey out while the assignment-removed banner is
                // showing â€” re-tapping just re-raises the banner.
                <PngPillButton color="blue"
                  onClick={handleSendForReview}
                  disabled={checkOutTicket.isPending || !!assignmentRemoved}
                  data-testid="button-send-for-review"
                >
                  <Send className="w-4 h-4" />
                  {checkOutTicket.isPending ? t("ticketDetail.sending") : t("ticketDetail.sendForReview")}
                </PngPillButton>
              )}
            </>
          ) : user?.role === "vendor" ? (
            <>
              {/* Task #620 â€” see TicketStatusActionPill for the unified
                  status-to-pill mapping shared with the field and admin
                  branches. This also subsumes Tasks #599 (awaiting_payment
                  pill) and #619 (funds_dispersed pill on the vendor view) â€”
                  the shared component renders both. */}
              <TicketStatusActionPill status={ticket.status} />
              {(ticket.status === "draft" || ticket.status === "in_progress" || ticket.status === "pending_review" || ticket.status === "completed" || ticket.status === "kicked_back") && (
                <>
                  {isEditing && canEdit ? (
                    hasChanges ? (
                      <GreenButton onClick={handleSave} disabled={updateTicket.isPending} data-testid="button-save-ticket" className="mr-3">
                        <Save className="w-4 h-4" />{updateTicket.isPending ? t("ticketDetail.saving") : t("ticketDetail.save")}
                      </GreenButton>
                    ) : (
                      <PngPillButton disabled data-testid="button-save-ticket" className="mr-3">
                        <Save className="w-4 h-4" />{t("ticketDetail.save")}
                      </PngPillButton>
                    )
                  ) : canEdit ? (
                    <PngPillButton color="amber" onClick={() => setIsEditing(true)} data-testid="button-edit-ticket" className="mr-3">
                      <Pencil className="w-4 h-4" />{t("ticketDetail.edit")}
                    </PngPillButton>
                  ) : null}
                  <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
                    <DialogTrigger asChild>
                      <PngPillButton color="red" disabled={cancelTicket.isPending} data-testid="button-cancel-ticket" className="mr-3">
                        <XCircle className="w-4 h-4" />{cancelTicket.isPending ? t("ticketDetail.cancelling") : t("ticketDetail.cancel")}
                      </PngPillButton>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader><DialogTitle>{t("ticketDetail.cancelJob")}</DialogTitle></DialogHeader>
                      <p className="text-sm text-muted-foreground">{t("ticketDetail.cancelJobConfirm")}</p>
                      <div className="flex gap-3 justify-end mt-4">
                        <PngPillButton color="amber" onClick={() => setCancelOpen(false)}>{t("ticketDetail.noGoBack")}</PngPillButton>
                        <PngPillButton color="red" onClick={() => { handleCancel(); setCancelOpen(false); }} disabled={cancelTicket.isPending} data-testid="button-confirm-cancel">
                          {cancelTicket.isPending ? t("ticketDetail.cancelling") : t("ticketDetail.yesCancelJob")}
                        </PngPillButton>
                      </div>
                    </DialogContent>
                  </Dialog>
                  {grandTotal > 0 && !assignmentRemoved ? (
                    <PngPillButton color="blue" onClick={handleSubmit} disabled={submitTicket.isPending} data-testid="button-submit-ticket">
                      <Send className="w-4 h-4" />{submitTicket.isPending ? t("ticketDetail.submitting") : t("ticketDetail.submit")}
                    </PngPillButton>
                  ) : (
                    // Task #593: when the assignment-removed banner is up,
                    // collapse Submit into the same disabled grey state we
                    // already use for the empty-line-items case so the
                    // dispatcher can't keep poking it.
                    <PngPillButton disabled data-testid="button-submit-ticket">
                      <Send className="w-4 h-4" />{t("ticketDetail.submit")}
                    </PngPillButton>
                  )}
                </>
              )}
              {/* Task #587 â€” Mark Awaiting Payment (vendor side). Mirrors the
                  mobile sheet from Task #575 so vendor office staff can flip
                  an in-progress ticket into the awaiting-payment queue from
                  the desktop. The server's POST /tickets/:id/awaiting-payment
                  re-checks role and status, so partners are still locked
                  out (forbidden_not_assigned) and the dialog won't render
                  for them either since this branch is vendor-only. */}
              {ticket.status === "in_progress" && (
                <PngPillButton color="amber"
                  onClick={() => { setAwaitingPaymentNote(""); setAwaitingPaymentOpen(true); }}
                  disabled={awaitingPaymentPending}
                  data-testid="button-mark-awaiting-payment"
                >
                  <DollarSign className="w-4 h-4" />
                  {t("tickets.markAwaitingPayment")}
                </PngPillButton>
              )}
            </>
          ) : (
            <>
              {/* Task #620 â€” admin / office shares the same status-pill
                  mapping as the field and vendor branches via
                  TicketStatusActionPill. Action buttons (disperse funds,
                  approve, kickback, etc.) stay role-specific below. */}
              <TicketStatusActionPill status={ticket.status} />
              {/* Task #497 â€” Disperse Funds (AP / admin only). Server returns
                  `viewerCanDisperseFunds` on the GET /tickets/:id response by
                  evaluating admin role OR partner contact in the Accounts
                  Payable role on the owning partner. We gate on that capability
                  flag rather than the broad role so non-AP partners never see
                  the action. The POST endpoint re-checks on submit, but
                  hiding the button matches the AP-only UX requirement.
                  Task #595 â€” also surface the action on awaiting_payment so AP
                  can close the loop on tickets parked in that state without
                  needing them to bounce back through `approved`. */}
              {(
                (isApprovalAdmin && (ticket.status === "approved" || ticket.status === "awaiting_payment")) ||
                (canUseApproval3 && ticket.status === "awaiting_payment")
              ) && ticket.viewerCanDisperseFunds === true && (
                <Dialog open={disperseOpen} onOpenChange={(open) => {
                  setDisperseOpen(open);
                  if (!open) {
                    setDisperseRef("");
                    setDisperseNote("");
                    setDisperseMethod("etf");
                    // Task #852 â€” clear the staged receipt so a
                    // re-open of the modal starts fresh.
                    setDisperseReceiptUrl(null);
                    setDisperseReceiptUploading(false);
                  }
                }}>
                  <DialogTrigger asChild>
                    <ApprovalActionButton lifecycleStatus="funds_dispersed" data-testid="button-disperse-funds-trigger">
                      <DollarSign className="w-4 h-4" />{t("tickets.fundsDispersed")}
                    </ApprovalActionButton>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader><DialogTitle>{t("ticketDetail.disperseFundsTitle")}</DialogTitle></DialogHeader>
                    <div className="space-y-4">
                      <p className="text-sm text-muted-foreground">{t("ticketDetail.disperseFundsHelp")}</p>
                      <div className="space-y-2">
                        <label className="text-sm font-medium">{t("ticketDetail.disperseFundsMethod")}</label>
                        <Select
                          value={disperseMethod}
                          onValueChange={(v) => {
                            // Narrow the loosely-typed Select callback to our
                            // three accepted payment-method literals so the
                            // setter signature stays type-safe end-to-end.
                            if (v === "etf" || v === "check" || v === "other") {
                              setDisperseMethod(v);
                            }
                          }}
                        >
                          <SelectTrigger data-testid="select-disperse-method">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="etf" data-testid="select-disperse-method-etf">{t("ticketDetail.disperseFundsMethodEtf")}</SelectItem>
                            <SelectItem value="check" data-testid="select-disperse-method-check">{t("ticketDetail.disperseFundsMethodCheck")}</SelectItem>
                            <SelectItem value="other" data-testid="select-disperse-method-other">{t("ticketDetail.disperseFundsMethodOther")}</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <label className="text-sm font-medium">{t("ticketDetail.disperseFundsReference")}</label>
                        <Input
                          value={disperseRef}
                          onChange={(e) => setDisperseRef(e.target.value)}
                          placeholder={disperseMethod === "check" ? "Check #" : ""}
                          data-testid="input-disperse-reference"
                        />
                        {disperseMethod === "check" && !disperseRef.trim() && (
                          <p className="text-xs text-red-500">{t("ticketDetail.disperseFundsReferenceRequired")}</p>
                        )}
                      </div>
                      <div className="space-y-2">
                        <label className="text-sm font-medium">{t("ticketDetail.disperseFundsNote")}</label>
                        <Textarea
                          value={disperseNote}
                          onChange={(e) => setDisperseNote(e.target.value)}
                          placeholder={t("ticketDetail.disperseFundsNotePlaceholder")}
                          rows={3}
                          data-testid="input-disperse-note"
                        />
                      </div>
                      {/* Task #852 â€” optional proof-of-payment image. We
                          upload immediately on file pick (so the modal
                          submit only ships a single string) and stash
                          the resulting object path. The hidden <input>
                          + GreyButton pair mirrors the existing
                          PhotoUploadField pattern without spinning up a
                          full reusable component for this one-off. */}
                      <div className="space-y-2">
                        <label className="text-sm font-medium">
                          {t("ticketDetail.disperseFundsReceipt")}
                        </label>
                        <p className="text-xs text-muted-foreground">
                          {t("ticketDetail.disperseFundsReceiptHelp")}
                        </p>
                        <input
                          ref={disperseReceiptInputRef}
                          type="file"
                          accept="image/*"
                          className="hidden"
                          data-testid="input-disperse-receipt-file"
                          onChange={async (e) => {
                            const file = e.target.files?.[0];
                            // Always reset the native input so picking
                            // the same file twice still fires onChange.
                            if (disperseReceiptInputRef.current) {
                              disperseReceiptInputRef.current.value = "";
                            }
                            if (!file) return;
                            if (!file.type.startsWith("image/")) {
                              toast({
                                title: t("ticketDetail.disperseFundsReceiptInvalid"),
                                variant: "destructive",
                              });
                              return;
                            }
                            setDisperseReceiptUploading(true);
                            try {
                              const apiBase = import.meta.env.BASE_URL.replace(
                                /\/$/,
                                "",
                              );
                              const res = await fetch(
                                `${apiBase}/api/storage/uploads/request-url`,
                                {
                                  method: "POST",
                                  credentials: "include",
                                  headers: { "Content-Type": "application/json" },
                                  body: JSON.stringify({
                                    name: file.name,
                                    size: file.size,
                                    contentType: file.type,
                                  }),
                                },
                              );
                              if (!res.ok) {
                                throw new Error("upload_request_failed");
                              }
                              const { uploadURL, objectPath } = (await res.json()) as {
                                uploadURL: string;
                                objectPath: string;
                              };
                              const putRes = await fetch(uploadURL, {
                                method: "PUT",
                                headers: { "Content-Type": file.type },
                                body: file,
                              });
                              if (!putRes.ok) {
                                throw new Error("upload_put_failed");
                              }
                              setDisperseReceiptUrl(objectPath);
                            } catch (err: unknown) {
                              toast({
                                title: translateApiError(
                                  err,
                                  t,
                                  t("ticketDetail.disperseFundsReceiptError"),
                                ),
                                variant: "destructive",
                              });
                            } finally {
                              setDisperseReceiptUploading(false);
                            }
                          }}
                        />
                        {disperseReceiptUrl ? (
                          <div className="space-y-2">
                            <a
                              href={`${import.meta.env.BASE_URL.replace(/\/$/, "")}/api/storage${disperseReceiptUrl.startsWith("/") ? "" : "/"}${disperseReceiptUrl}`}
                              target="_blank"
                              rel="noreferrer"
                            >
                              <img
                                src={`${import.meta.env.BASE_URL.replace(/\/$/, "")}/api/storage${disperseReceiptUrl.startsWith("/") ? "" : "/"}${disperseReceiptUrl}`}
                                alt={t("ticketDetail.paymentReceiptLabel")}
                                className="h-32 w-32 object-cover rounded border"
                                data-testid="disperse-receipt-preview"
                              />
                            </a>
                            <div className="flex gap-2">
                              <PngPillButton color="blue"
                                type="button"
                                onClick={() => disperseReceiptInputRef.current?.click()}
                                disabled={
                                  disperseReceiptUploading || disperseFunds.isPending
                                }
                                data-testid="button-disperse-receipt-replace"
                              >
                                <Camera className="w-4 h-4" />
                                {disperseReceiptUploading
                                  ? t("ticketDetail.disperseFundsReceiptUploading")
                                  : t("ticketDetail.disperseFundsReceiptReplace")}
                              </PngPillButton>
                              <PngPillButton
                                type="button"
                                onClick={() => setDisperseReceiptUrl(null)}
                                disabled={
                                  disperseReceiptUploading || disperseFunds.isPending
                                }
                                data-testid="button-disperse-receipt-remove"
                              >
                                <X className="w-4 h-4" />
                                {t("ticketDetail.disperseFundsReceiptRemove")}
                              </PngPillButton>
                            </div>
                          </div>
                        ) : (
                          <PngPillButton color="blue"
                            type="button"
                            onClick={() => disperseReceiptInputRef.current?.click()}
                            disabled={
                              disperseReceiptUploading || disperseFunds.isPending
                            }
                            data-testid="button-disperse-receipt-attach"
                          >
                            <Camera className="w-4 h-4" />
                            {disperseReceiptUploading
                              ? t("ticketDetail.disperseFundsReceiptUploading")
                              : t("ticketDetail.disperseFundsReceiptAttach")}
                          </PngPillButton>
                        )}
                      </div>
                      <div className="flex justify-end gap-2">
                        <PngPillButton onClick={() => setDisperseOpen(false)} data-testid="button-cancel-disperse">
                          <X className="w-4 h-4" />{t("ticketDetail.cancel")}
                        </PngPillButton>
                        <GreenButton
                          onClick={handleDisperseFunds}
                          disabled={disperseFunds.isPending || (disperseMethod === "check" && !disperseRef.trim())}
                          data-testid="button-confirm-disperse"
                        >
                          <DollarSign className="w-4 h-4" />
                          {disperseFunds.isPending ? t("ticketDetail.disperseFundsSubmitting") : t("ticketDetail.disperseFundsConfirm")}
                        </GreenButton>
                      </div>
                    </div>
                  </DialogContent>
                </Dialog>
              )}
              {/* Task #620 â€” funds_dispersed, awaiting_payment, kicked_back,
                  and submitted status pills are rendered by the shared
                  TicketStatusActionPill at the top of this branch. */}
              {ticket.status === "submitted" && canUseApproval1 && (
                <>
                  <ApprovalActionButton
                    lifecycleStatus="approved"
                    onClick={() => {
                      if (isPartner) {
                        setDraftRating(vendorRatings?.myRating?.rating ?? 0);
                        setDraftReview(vendorRatings?.myRating?.review ?? "");
                        setRateOpen(true);
                      } else {
                        handleApprove();
                      }
                    }}
                    disabled={approveTicket.isPending}
                    data-testid="button-approve-ticket"
                  >
                    <CheckCircle2 className="w-4 h-4" />{approveTicket.isPending ? t("ticketDetail.approving") : t("tickets.approved")}
                  </ApprovalActionButton>
                  <Dialog open={rateOpen} onOpenChange={setRateOpen}>
                    <DialogContent>
                      <DialogHeader><DialogTitle>{t("ticketDetail.rateBeforeApprove", { vendor: ticket.vendorName })}</DialogTitle></DialogHeader>
                      <div className="space-y-4">
                        <p className="text-sm text-muted-foreground">
                          {t("ticketDetail.ratePrompt")}
                        </p>
                        <div className="flex items-center gap-3">
                          <StarRating value={draftRating} onChange={setDraftRating} size={32} data-testid="input-approve-rating-stars" />
                          <span className="text-sm text-muted-foreground">{draftRating > 0 ? t("ticketDetail.ofN", { n: draftRating }) : t("ticketDetail.pickRating")}</span>
                        </div>
                        <Textarea
                          value={draftReview}
                          onChange={(e) => setDraftReview(e.target.value)}
                          placeholder={t("ticketDetail.ratingReviewPlaceholder")}
                          rows={3}
                          data-testid="input-approve-rating-review"
                        />
                        <div className="flex justify-end gap-2">
                          <PngPillButton onClick={() => setRateOpen(false)} data-testid="button-cancel-approve-rating">
                            <X className="w-4 h-4" />{t("ticketDetail.cancel")}
                          </PngPillButton>
                          <GreenButton
                            onClick={() => {
                              if (draftRating < 1) {
                                toast({ title: t("ticketDetail.pickRatingToast"), variant: "destructive" });
                                return;
                              }
                              upsertRating.mutate(
                                { vendorId: ticket.vendorId, data: { rating: draftRating, review: draftReview.trim() || null, ticketId: id } },
                                {
                                  onSuccess: () => {
                                    queryClient.invalidateQueries({ queryKey: getGetVendorRatingsQueryKey(ticket.vendorId) });
                                    approveTicket.mutate({ id }, {
                                      onSuccess: () => {
                                        invalidate();
                                        setRateOpen(false);
                                        toast({ title: t("ticketDetail.ratingSavedApproved") });
                                      },
                                      onError,
                                    });
                                  },
                                  onError: (err: any) => toast({ title: translateApiError(err, t, t("ticketDetail.couldNotSaveRating")), variant: "destructive" }),
                                },
                              );
                            }}
                            disabled={upsertRating.isPending || approveTicket.isPending}
                            data-testid="button-submit-rating-approve"
                          >
                            <CheckCircle2 className="w-4 h-4" />
                            {upsertRating.isPending || approveTicket.isPending ? t("ticketDetail.approving") : t("ticketDetail.submitRatingApprove")}
                          </GreenButton>
                        </div>
                      </div>
                    </DialogContent>
                  </Dialog>
                  {isApprovalAdmin && (
                    <Dialog open={kickbackOpen} onOpenChange={setKickbackOpen}>
                      <DialogTrigger asChild>
                        <PngPillButton color="red" data-testid="button-kickback-trigger">
                          <RotateCcw className="w-4 h-4" />{t("ticketDetail.kickBack")}
                        </PngPillButton>
                      </DialogTrigger>
                      <DialogContent>
                        <DialogHeader><DialogTitle>{t("ticketDetail.kickBackTracking")}</DialogTitle></DialogHeader>
                        <div className="space-y-4">
                          <Textarea placeholder={t("ticketDetail.kickbackReasonPlaceholder")} value={kickbackReason} onChange={(e) => setKickbackReason(e.target.value)} data-testid="input-kickback-reason" />
                          <PngPillButton color="red" onClick={handleKickback} disabled={kickbackTicket.isPending || !kickbackReason} className="w-full" data-testid="button-submit-kickback">
                            {kickbackTicket.isPending ? t("ticketDetail.sending") : t("ticketDetail.kickBackTracking")}
                          </PngPillButton>
                        </div>
                      </DialogContent>
                    </Dialog>
                  )}
                </>
              )}
              {user?.role === "admin" && (ticket.status === "submitted" || ticket.status === "approved") && (
                <Dialog open={unlockOpen} onOpenChange={(open) => { setUnlockOpen(open); if (!open) setUnlockReason(""); }}>
                  <DialogTrigger asChild>
                    <PngPillButton color="amber"
                      disabled={unlockTicket.isPending}
                      data-testid="button-unlock-ticket"
                    >
                      <RotateCcw className="w-4 h-4" />
                      {unlockTicket.isPending ? t("ticketDetail.unlocking") : t("ticketDetail.unlockForEditing")}
                    </PngPillButton>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader><DialogTitle>{t("ticketDetail.unlockTrackingForEditing")}</DialogTitle></DialogHeader>
                    <div className="space-y-4">
                      <p className="text-sm text-muted-foreground">
                        {t("ticketDetail.unlockReasonHelp")}
                      </p>
                      <Textarea
                        placeholder={t("ticketDetail.unlockReasonPlaceholder")}
                        value={unlockReason}
                        onChange={(e) => setUnlockReason(e.target.value.slice(0, 500))}
                        maxLength={500}
                        data-testid="input-unlock-reason"
                      />
                      <p className="text-xs text-muted-foreground text-right">
                        {unlockReason.length}/500
                      </p>
                      <div className="flex justify-end gap-2">
                        <PngPillButton onClick={() => { setUnlockOpen(false); setUnlockReason(""); }}>
                          <X className="w-4 h-4" />{t("ticketDetail.cancel")}
                        </PngPillButton>
                        {unlockReason.trim() ? (
                          <PngPillButton color="amber"
                            onClick={handleUnlock}
                            disabled={unlockTicket.isPending}
                            data-testid="button-confirm-unlock"
                          >
                            <RotateCcw className="w-4 h-4" />
                            {unlockTicket.isPending ? t("ticketDetail.unlocking") : t("ticketDetail.unlock")}
                          </PngPillButton>
                        ) : (
                          <PngPillButton disabled data-testid="button-confirm-unlock">
                            <RotateCcw className="w-4 h-4" />{t("ticketDetail.unlock")}
                          </PngPillButton>
                        )}
                      </div>
                    </div>
                  </DialogContent>
                </Dialog>
              )}
              {isApprovalAdmin && ticket.status !== "approved" && ticket.status !== "cancelled" && (
                <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
                  <DialogTrigger asChild>
                    <PngPillButton color="red" disabled={cancelTicket.isPending} data-testid="button-cancel-ticket">
                      <XCircle className="w-4 h-4" />{cancelTicket.isPending ? t("ticketDetail.cancelling") : t("ticketDetail.cancel")}
                    </PngPillButton>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader><DialogTitle>{t("ticketDetail.cancelJob")}</DialogTitle></DialogHeader>
                    <p className="text-sm text-muted-foreground">{t("ticketDetail.cancelJobConfirm")}</p>
                    <div className="flex gap-3 justify-end mt-4">
                      <PngPillButton color="amber" onClick={() => setCancelOpen(false)}>{t("ticketDetail.noGoBack")}</PngPillButton>
                      <PngPillButton color="red" onClick={() => { handleCancel(); setCancelOpen(false); }} disabled={cancelTicket.isPending} data-testid="button-confirm-cancel">
                        {cancelTicket.isPending ? t("ticketDetail.cancelling") : t("ticketDetail.yesCancelJob")}
                      </PngPillButton>
                    </div>
                  </DialogContent>
                </Dialog>
              )}
              {ticket.status === "cancelled" && user?.role === "admin" && (
                <PngPillButton color="amber"
                  onClick={handleReactivate}
                  disabled={reactivateTicket.isPending}
                  data-testid="button-reactivate-ticket"
                >
                  <RotateCcw className="w-4 h-4" />
                  {reactivateTicket.isPending ? t("ticketDetail.restoring") : t("ticketDetail.restoreUndoCancel")}
                </PngPillButton>
              )}
              {/* Task #587 / Task #729 â€” Mark Awaiting Payment (admin + partner-AP).
                  Same shared dialog state as the vendor branch above. Admins
                  can park `in_progress` or `approved`; partner AP users see
                  it on `approved` so they can confirm receipt before
                  disperse-funds in one click. The server gate
                  (`/tickets/:id/awaiting-payment`) re-validates AP eligibility
                  via `userHasApRole`. */}
              {(
                (ticket.status === "in_progress" && user?.role === "admin") ||
                (ticket.status === "approved" &&
                  canUseApproval2 &&
                  (user?.role === "admin" ||
                    (user?.role === "partner" && ticket.viewerCanDisperseFunds === true)))
              ) && (
                <ApprovalActionButton
                  lifecycleStatus="awaiting_payment"
                  onClick={() => { setAwaitingPaymentNote(""); setAwaitingPaymentOpen(true); }}
                  disabled={awaitingPaymentPending}
                  data-testid="button-mark-awaiting-payment"
                >
                  <DollarSign className="w-4 h-4" />
                  {t("tickets.awaitingPaymentStatus")}
                </ApprovalActionButton>
              )}
            </>
          )}
          {/* Task #587 â€” Shared confirmation dialog for both the vendor and
              admin "Mark Awaiting Payment" buttons. Note is optional and
              capped at 500 chars to stay inside the server's
              `invalid_awaiting_payment_body` validator (Task #551). */}
          <Dialog
            open={awaitingPaymentOpen}
            onOpenChange={(open) => {
              if (awaitingPaymentPending) return;
              setAwaitingPaymentOpen(open);
              if (!open) setAwaitingPaymentNote("");
            }}
          >
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{t("tickets.awaitingPaymentTitle")}</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <p className="text-sm text-muted-foreground">{t("tickets.awaitingPaymentBody")}</p>
                <Textarea
                  value={awaitingPaymentNote}
                  onChange={(e) => setAwaitingPaymentNote(e.target.value.slice(0, 500))}
                  placeholder={t("tickets.awaitingPaymentNotePlaceholder")}
                  maxLength={500}
                  rows={3}
                  data-testid="input-awaiting-payment-note"
                />
                <p className="text-xs text-muted-foreground text-right">
                  {awaitingPaymentNote.length}/500
                </p>
                <div className="flex justify-end gap-2">
                  <PngPillButton
                    onClick={() => { setAwaitingPaymentOpen(false); setAwaitingPaymentNote(""); }}
                    disabled={awaitingPaymentPending}
                    data-testid="button-awaiting-payment-cancel"
                  >
                    <X className="w-4 h-4" />{t("ticketDetail.cancel")}
                  </PngPillButton>
                  <PngPillButton color="amber"
                    onClick={handleMarkAwaitingPayment}
                    disabled={awaitingPaymentPending}
                    data-testid="button-awaiting-payment-submit"
                  >
                    <DollarSign className="w-4 h-4" />
                    {awaitingPaymentPending
                      ? t("ticketDetail.sending")
                      : t("tickets.awaitingPaymentSubmit")}
                  </PngPillButton>
                </div>
              </div>
            </DialogContent>
          </Dialog>
          <a
            href={`${import.meta.env.BASE_URL}print-ticket/${ticket.id}`}
            target="_blank"
            rel="noopener noreferrer"
            className="ml-auto"
          >
            <PngPillButton color="blue" data-testid="button-print-ticket">
              <Printer className="w-4 h-4" />
              {t("ticketDetail.print")}
            </PngPillButton>
          </a>
        </CardContent>
      </Card>

      <TicketNudgePanel
        ticketId={ticket.id}
        ticketStatus={ticket.status}
        userRole={user?.role}
      />

      <TicketFlagPanel
        ticketId={ticket.id}
        ticketStatus={ticket.status}
        userRole={user?.role}
      />

      {/* â”€â”€ Task #494: Find another Vendor sheet â”€â”€ */}
      <FindAnotherVendorSheet
        open={findVendorOpen}
        onOpenChange={setFindVendorOpen}
        ticketId={id}
        onReinvite={handleReinvite}
        isPending={reinviteTicket.isPending}
      />
    </div>
  );
}

function FindAnotherVendorSheet({
  open,
  onOpenChange,
  ticketId,
  onReinvite,
  isPending,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  ticketId: number;
  onReinvite: (vendorId: number) => void;
  isPending: boolean;
}) {
  const { t } = useTranslation();
  // Only fetch when the sheet is opened so we don't slam /nearby-vendors on every render.
  const { data, isLoading } = useGetNearbyVendors(ticketId, {
    query: {
      enabled: open,
      queryKey: getGetNearbyVendorsQueryKey(ticketId),
    },
  });

  const renderRow = (v: NonNullable<typeof data>["approved"][number]) => {
    const insuranceColor =
      v.insuranceStatus === "valid"
        ? "text-green-600"
        : v.insuranceStatus === "expiring_soon"
          ? "text-amber-600"
          : "text-red-600";
    return (
      <li
        key={v.id}
        className="flex items-center justify-between gap-3 py-3 border-b last:border-b-0"
        data-testid={`row-nearby-vendor-${v.id}`}
      >
        <div className="flex items-center gap-3 min-w-0">
          {v.logoUrl ? (
            <img src={v.logoUrl} alt={v.name} className="w-10 h-10 rounded object-contain shrink-0 border" />
          ) : (
            <div className="w-10 h-10 rounded bg-muted shrink-0" />
          )}
          <div className="min-w-0">
            <p className="font-semibold truncate">
              {v.name}
              {v.isCurrentlyInvited && (
                <span className="ml-2 text-xs font-normal text-muted-foreground">
                  ({t("ticketDetail.currentlyInvited")})
                </span>
              )}
            </p>
            <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground mt-0.5">
              <span>{t("ticketDetail.distanceMiles", { miles: v.distanceMiles })}</span>
              <span className={v.coversWorkType ? "text-green-600" : "text-amber-600"}>
                {v.coversWorkType ? t("ticketDetail.workTypeCovered") : t("ticketDetail.workTypeNotCovered")}
              </span>
              <span className={insuranceColor}>{t(`ticketDetail.insurance_${v.insuranceStatus}`)}</span>
              {v.estimatedPrice && <span>${v.estimatedPrice}</span>}
            </div>
          </div>
        </div>
        <GreenButton
          onClick={() => onReinvite(v.id)}
          disabled={isPending || v.isCurrentlyInvited}
          data-testid={`button-reinvite-${v.id}`}
        >
          {t("ticketDetail.invite")}
        </GreenButton>
      </li>
    );
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-xl overflow-y-auto" data-testid="sheet-find-vendor">
        <SheetHeader>
          <SheetTitle>{t("ticketDetail.findAnotherVendor")}</SheetTitle>
          <SheetDescription>{t("ticketDetail.findAnotherVendorDescription")}</SheetDescription>
        </SheetHeader>

        {isLoading ? (
          <div className="space-y-3 mt-6">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        ) : !data ? (
          <p className="mt-6 text-sm text-muted-foreground">{t("ticketDetail.nearbyVendorsError")}</p>
        ) : (
          <div className="mt-6 space-y-6">
            <section>
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                {t("ticketDetail.approvedVendors")} ({data.approved.length})
              </h3>
              {data.approved.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("ticketDetail.noApprovedVendors")}</p>
              ) : (
                <ul>{data.approved.map(renderRow)}</ul>
              )}
            </section>
            <section>
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                {t("ticketDetail.unapprovedVendors")} ({data.unapproved.length})
              </h3>
              {data.unapproved.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("ticketDetail.noUnapprovedVendors")}</p>
              ) : (
                <ul>{data.unapproved.map(renderRow)}</ul>
              )}
            </section>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
