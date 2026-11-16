import { TicketActivityCard } from "@/components/ticket-activity-card";
import {useServiceEmployees,credentialMatchText} from "@/hooks/use-eligible-vendor-field-employees";
import "./vendor-profile.css";
import "@/components/work-hub/calendar-create-cards.css";
import { ContentCardHeader } from "@/components/ui/card";
import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { useGetSiteLocation, getGetSiteLocationQueryKey, useListTickets, useCreateTicket, useListSiteLocations, useListWorkTypes, useListVendors, useReverseFundsDispersal, reverseFundsDispersal, getListTicketsQueryKey, getListSiteLocationsQueryKey, getListWorkTypesQueryKey, getListVendorsQueryKey, getGetTicketQueryKey, getGetTicketNoteLogsQueryKey, getTicket, type Ticket } from "@workspace/api-client-react";
import { useClearStaleFieldEmployeeSelection } from "@/hooks/use-eligible-vendor-field-employees";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useLocation, useSearch } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import CountBadgePill from "@/components/count-badge-pill";
import TicketLifecyclePill from "@/components/ticket-lifecycle-pill";
import TicketStatusBadge from "@/components/ticket-status-badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PngPillButton as PillButton } from "@/components/png-pill-rollover";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowUpDown, FileText, Search, Plus, RotateCcw, ChevronRight, Navigation, Layers, DollarSign, Globe, HardHat, AlertTriangle, MessageCircle } from "lucide-react";
import { translateApiError } from "@/lib/api-error";
import { type V2Color } from "@/components/v2-color-button";
import { PngPillButton } from "@/components/png-pill-rollover";
import { brandStyleVars, useBrand } from "@/hooks/use-brand";
import LiveConnectionPill, { type LiveConnectionStatus } from "@/components/live-connection-pill";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { useTicketsRateLimitGate } from "@/hooks/use-tickets-rate-limit-gate";
import { useTicketNudgeFlash } from "@/hooks/use-ticket-nudge-flash";
import { useTranslation } from "react-i18next";
// Task #648: name the affected ticket in the assignment-restored toast
// using the same canonical tracking-number format the mobile open-tickets
// list (Task #630) uses, so a dispatcher juggling several tickets can
// see at a glance which one was restored.
import { formatTicketTrackingNumber } from "@workspace/db/format";
import ContentPaneBackLink from "@/components/content-pane-back-link";
import { DashboardTicketJourneys } from "@/components/dashboard-ticket-journeys";
import { DashboardTicketLocationCount, useDashboardTicketPanels } from "@/components/dashboard-ticket-panels";

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

// Haversine great-circle distance in miles between two lat/lng points.
// Used by the Create New Job site picker to honor the operator-chosen
// radius (default 100 mi) so a vendor with 140+ assignable sites isn't
// scrolling a giant unfiltered dropdown.
function milesBetween(
  aLat: number,
  aLng: number,
  bLat: number,
  bLng: number,
): number {
  const R = 3958.7613; // Earth radius in miles
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const lat1 = toRad(aLat);
  const lat2 = toRad(bLat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

const SITE_RADIUS_OPTIONS: Array<{ value: string; miles: number | null }> = [
  { value: "25", miles: 25 },
  { value: "50", miles: 50 },
  { value: "100", miles: 100 },
  { value: "250", miles: 250 },
  { value: "all", miles: null },
];

type SortKey = "ticket" | "site" | "vendor" | "fieldEmployee" | "status" | "created" | "daysWaiting";
type SortDir = "asc" | "desc";

type TicketsListCacheShape = { items?: unknown } | Ticket[] | null | undefined;

function ticketItemsFromCache(cache: TicketsListCacheShape): Ticket[] {
  if (Array.isArray(cache)) return cache;
  const items = cache && typeof cache === "object" ? cache.items : undefined;
  return Array.isArray(items) ? (items as Ticket[]) : [];
}

function patchTicketInListCache<T>(cache: T, ticketId: number, fresh: Ticket): T {
  if (Array.isArray(cache)) {
    return cache.map((t) => (t.id === ticketId ? fresh : t)) as T;
  }
  const page = cache as unknown as { items?: unknown };
  if (cache && typeof cache === "object" && Array.isArray(page.items)) {
    return {
      ...cache,
      items: page.items.map((t) =>
        t.id === ticketId ? fresh : t,
      ),
    } as T;
  }
  return cache;
}

export default function Tickets() {
  const { user } = useAuth();
  const { t, i18n } = useTranslation();
  const { toast } = useToast();
  const brand = useBrand();
  // Task #648: stable refs for the long-lived SSE handler. The
  // ticket.unblocked listener fires across the lifetime of the page's
  // EventSource, but we deliberately exclude `toast`/`t` from that
  // effect's deps so the connection isn't torn down and re-opened on
  // every render (per the existing "exactly one EventSource per
  // mount" contract). Refs let the handler always read the latest
  // versions even though the closure was captured once.
  const toastRef = useRef(toast);
  toastRef.current = toast;
  const tRef = useRef(t);
  tRef.current = t;
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();
  const search = useSearch();
  const isVendor = user?.role === "vendor" && user.vendorId;
  const isPartner = user?.role === "partner" && !!user.partnerId;
  const isFieldEmployee = user?.role === "field_employee";
  // Task #863 — admins are the only role allowed to reverse a fund
  // dispersal directly from the AP/payments list. Server enforces
  // role + status, but we hide the row-level action for everyone else
  // so it doesn't tease a 403.
  const isAdmin = user?.role === "admin";
  const initialStatus = useMemo(() => {
    const params = new URLSearchParams(search);
    const s = params.get("status");
    return s ?? "all";
  }, []);
  const [statusFilter, setStatusFilter] = useState<string>(initialStatus);
  const [siteFilter, setSiteFilter] = useState<string>("all");
  useEffect(() => {
    const params = new URLSearchParams(search);
    const s = params.get("status");
    if (s && s !== statusFilter) setStatusFilter(s);
  }, [search]);
  const [searchQuery, setSearchQuery] = useState("");
  const [historyPage, setHistoryPage] = useState(0);
  const historyScrollRef = useRef<HTMLDivElement>(null);

  const [sortKey, setSortKey] = useState<SortKey>("ticket");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const apSortAppliedRef = useRef(false);
  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState<{ siteLocationId: string; vendorId: string; workTypeIds: number[]; fieldEmployeeId: string; description: string }>({ siteLocationId: "", vendorId: "", workTypeIds: [], fieldEmployeeId: "", description: "" });
  const [creatingBatch, setCreatingBatch] = useState(false);
  // Create New Job site picker proximity filter — defaults to 100 mi
  // around the operator (browser geolocation when granted, falling back
  // to the vendor's primary lat/lng). Operator can widen to 250 / All
  // or tighten to 25 / 50.
  const [siteRadius, setSiteRadius] = useState<string>("100");
  const [geoOrigin, setGeoOrigin] = useState<{ lat: number; lng: number } | null>(null);
  const [geoStatus, setGeoStatus] = useState<"idle" | "pending" | "granted" | "denied" | "unavailable">("idle");
  // Task #574 (extends Tasks #535 + #559 + #573): when POST /api/tickets
  // from the vendor / partner "Create New Job" dialog rejects with
  // `site_not_found` (the picked site was deleted or unassigned between
  // dialog open and submit), mirror the phone-intake recovery: re-fetch
  // the site list, drop the now-invalid selection (and the dependent
  // vendor / work-type picks), and surface the same friendly banner
  // *instead of* the generic "Failed to create" toast — the operator
  // needs to know their list is stale, not just that the request failed.
  const [addSiteUnavailableNotice, setAddSiteUnavailableNotice] =
    useState(false);
  // Task #871: parallel of #574 for `work_type_not_allowed`. The
  // phone-intake dialog already runs the same recovery (Task #573) — re-
  // fetch the work-types list, drop the now-invalid checkboxes, and
  // surface a friendly banner instead of the generic "Failed to create"
  // toast. Triggers when every parallel POST in the batch was rejected
  // with `work_type_not_allowed` (admin pulled the work type from the
  // chosen site between dialog open and submit). Mixed-outcome batches
  // — where some work types succeeded and only the pulled one failed —
  // already drop into the existing success-with-failures toast path and
  // don't need this banner.
  const [addWorkTypeUnavailableNotice, setAddWorkTypeUnavailableNotice] =
    useState(false);
  // Task #497 — Partner-only AP queue toggle. When on, the server narrows
  // results to status='approved' AND paymentDispersedAt IS NULL. Task #866
  // — when the page is opened with `?awaitingPayment=true` (e.g. via the
  // dashboard "Awaiting payment" tile deep-link), seed the toggle on so
  // the filter is applied on first paint instead of requiring a click.
  const initialAwaitingPayment = useMemo(() => {
    const params = new URLSearchParams(search);
    return params.get("awaitingPayment") === "true";
  }, []);
  const [awaitingPayment, setAwaitingPayment] = useState(initialAwaitingPayment);
  useEffect(() => {
    const params = new URLSearchParams(search);
    const v = params.get("awaitingPayment") === "true";
    if (v !== awaitingPayment && v) setAwaitingPayment(v);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);
  // Task #865 — when the partner AP queue toggle is on, default the
  // table sort to "Days waiting" descending so the oldest unpaid ticket
  // floats to the top. We only flip once (per toggle activation) so a
  // partner that explicitly clicks another column header keeps their
  // chosen sort while the filter stays on. The same flip happens in
  // reverse when the toggle is turned off so the regular ticket list
  // returns to the historical default.
  useEffect(() => {
    if (isPartner && awaitingPayment) {
      if (!apSortAppliedRef.current) {
        setSortKey("daysWaiting");
        setSortDir("desc");
        apSortAppliedRef.current = true;
      }
    } else if (apSortAppliedRef.current) {
      setSortKey("ticket");
      setSortDir("asc");
      apSortAppliedRef.current = false;
    }
  }, [isPartner, awaitingPayment]);
  // Task #863 — Reverse / void payment dialog state, hoisted to the page
  // level so a single dialog can serve every funds_dispersed row in the
  // table. We track the target ticket id (null when closed) plus the
  // reason text. The mutation lives here too so onSuccess can invalidate
  // the list query in one place — same shape as the per-ticket version
  // in ticket-detail.tsx (Task #504).
  const [reverseFundsTicketId, setReverseFundsTicketId] =
    useState<number | null>(null);
  const [reverseFundsReason, setReverseFundsReason] = useState("");
  const reverseFundsDispersalMut = useReverseFundsDispersal();
  // Task #1029 — Bulk reverse-payment selection state. Admins can tick
  // multiple `funds_dispersed` rows in the AP queue and reverse them in
  // one shot with a shared reason. We keep the picked ids in a Set and
  // run the reversals sequentially against the same single-ticket
  // endpoint that powers the per-row flow (Task #863), so the audit
  // trail stays identical (one status_history entry per ticket, with
  // the same reason snapshot). Progress is tracked so the confirm
  // button can show "Reversing N of M…" while it works.
  const [bulkSelectedIds, setBulkSelectedIds] = useState<Set<number>>(
    () => new Set(),
  );
  const [bulkReverseOpen, setBulkReverseOpen] = useState(false);
  const [bulkReverseReason, setBulkReverseReason] = useState("");
  const [bulkReverseProgress, setBulkReverseProgress] = useState<{
    done: number;
    total: number;
    failures: number;
  } | null>(null);

  // Task #576: include `awaiting_payment` so office staff can filter the
  // list down to tickets the field crew has marked as wrapped-but-unpaid.
  // Mirrors the amber pill we use in the badge.
  // Task #863: include `funds_dispersed` so admins triaging a misposted
  // batch can pull up every paid ticket and reverse the affected ones
  // from this list without bouncing through ticket-detail one by one.
  const validStatuses = ["in_progress", "pending_review", "completed", "submitted", "approved", "awaiting_payment", "funds_dispersed", "kicked_back", "denied", "cancelled"] as const;
  const workflowStages = ["offered", "working", "work_verification", "payment_approval", "payment"];
  const stateOptions = [
    { value: "all", label: t("tickets.workflowFilters.all") },
    { value: "offered", label: t("tickets.workflowFilters.offered") },
    { value: "working", label: t("tickets.workflowFilters.working") },
    { value: "work_verification", label: t("tickets.workflowFilters.workVerification") },
    { value: "payment_approval", label: t("tickets.workflowFilters.paymentApproval") },
    { value: "kicked_back", label: t("tickets.workflowFilters.kickedBack") },
    { value: "payment", label: t("tickets.workflowFilters.payment") },
    { value: "funds_dispersed", label: t("tickets.workflowFilters.paid") },
    { value: "denied", label: t("tickets.workflowFilters.denied") },
    { value: "cancelled", label: t("tickets.cancelled") },
  ];
  type TicketStatus = (typeof validStatuses)[number];
  const isValidStatus = (s: string): s is TicketStatus => validStatuses.includes(s as TicketStatus);
  const listParams: Record<string, any> = { limit: 25, offset: historyPage * 25, allHistory: true };
  if (searchQuery.trim()) listParams.search = searchQuery.trim().replace(/^#/, "").replace(/^0+/, "");
  if (siteFilter !== "all") listParams.siteLocationId = Number(siteFilter);
  useEffect(() => { setHistoryPage(0); }, [searchQuery, siteFilter, statusFilter, awaitingPayment]);
  useEffect(() => { if (historyScrollRef.current) historyScrollRef.current.scrollTop = 0; }, [historyPage]);
  if (workflowStages.includes(statusFilter)) listParams.workflowStage = statusFilter;
  if (statusFilter === "approval_history") listParams.approvalHistory = true;
  if (statusFilter !== "all" && isValidStatus(statusFilter)) listParams.status = statusFilter;
  if (isVendor) listParams.vendorId = user.vendorId!;
  if (isPartner) listParams.partnerId = user.partnerId!;
  // The AP queue filter is partner-only because vendors don't have a
  // notion of an Accounts Payable inbox. We pass it as a query param so
  // the server can apply the status='approved' AND paymentDispersedAt
  // IS NULL predicate at the SQL layer.
  if (isPartner && awaitingPayment) listParams.awaitingPayment = true;
  // Task #675 — track whether the per-session rate limit has parked
  // this page. The state machine is:
  //   1. fetch → 429 → useTicketsRateLimitGate parses Retry-After and
  //      flips `listRateLimited` to true.
  //   2. With `enabled: !listRateLimited`, react-query stops issuing
  //      refetches for the cooldown window. Any SSE-driven
  //      invalidateQueries calls during this window mark the cache as
  //      stale but do NOT refetch (invalidate only refetches active
  //      queries) — exactly what we want.
  //   3. The gate auto-clears at the end of the cooldown; the query
  //      flips back to enabled and react-query refetches once on its
  //      own to bring the page up to date.
  // We declare `listRateLimited` *before* useListTickets so the
  // generated hook sees the latest enabled flag on the same render
  // that the gate trips.
  const [listRateLimitedState, setListRateLimitedState] = useState(false);
  const ticketSummaryEnabled = Boolean(user && !isFieldEmployee && !listRateLimitedState);
  const ticketSummary = useDashboardTicketPanels(
    `${user?.userId}:${user?.activeMembershipId}:${user?.role}:${user?.vendorId ?? user?.partnerId}`,
    ticketSummaryEnabled,
  );
  // Stash in a ref so SSE handlers (set up once with stable deps) and
  // the manual-refresh handler can read the latest gate state without
  // rebuilding their listeners.
  const listRateLimitedRef = useRef(listRateLimitedState);
  listRateLimitedRef.current = listRateLimitedState;
  const ticketsListQuery = useListTickets(
    Object.keys(listParams).length > 0 ? listParams : undefined,
    {
      query: {
        queryKey: getListTicketsQueryKey(
          Object.keys(listParams).length > 0 ? listParams : undefined,
        ),
        // Park the query during the cooldown so neither
        // refetchOnWindowFocus, refetchOnReconnect, nor SSE-triggered
        // invalidations can re-fire /api/tickets while we're rate
        // limited. Existing cached data stays visible.
        enabled: !listRateLimitedState,
        // Disable retry on 429 explicitly — a 3-retry storm into the
        // same limiter window would burn through the budget for no
        // recovery benefit. For every other error we keep
        // react-query's default (3 retries with backoff) so transient
        // network blips still self-heal.
        retry: (failureCount: number, err: unknown) => {
          const status = (err as { status?: number } | null)?.status;
          if (status === 429) return false;
          return failureCount < 3;
        },
      },
    },
  );
  const { data: ticketsPage, isLoading, error: ticketsListError } = ticketsListQuery;
  const tickets = ticketItemsFromCache(ticketsPage as TicketsListCacheShape);
  type TicketsPageData = NonNullable<typeof ticketsPage>;
  const { rateLimited: listRateLimited } = useTicketsRateLimitGate(ticketsListError);
  useEffect(() => {
    setListRateLimitedState(listRateLimited);
  }, [listRateLimited]);
  // Keep an up-to-date copy so the SSE handler (which is set up once and
  // captures only stable deps) always invalidates the *current* filtered
  // query key — otherwise changing a filter would leave invalidations
  // pointing at a stale query that's no longer mounted.
  const listParamsRef = useRef(listParams);
  listParamsRef.current = listParams;

  // Briefly highlight a row when the ticket transitions between lifecycle
  // stages (pending_arrival → en_route → on_site → off_site / cycle reset).
  // The transition is detected by comparing each incoming live-location ping
  // against the last lifecycle state we've seen for that ticket.
  const lifecycleByTicketRef = useRef<Map<number, string | null>>(new Map());
  const flashTimersRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());
  const initialSeedDoneRef = useRef(false);
  const [flashingTicketIds, setFlashingTicketIds] = useState<Set<number>>(new Set());

  const flashTicket = (ticketId: number) => {
    setFlashingTicketIds((prev) => {
      if (prev.has(ticketId)) return prev;
      const next = new Set(prev);
      next.add(ticketId);
      return next;
    });
    const existing = flashTimersRef.current.get(ticketId);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      flashTimersRef.current.delete(ticketId);
      setFlashingTicketIds((prev) => {
        if (!prev.has(ticketId)) return prev;
        const next = new Set(prev);
        next.delete(ticketId);
        return next;
      });
    }, 2000);
    flashTimersRef.current.set(ticketId, timer);
  };

  const { nudgeFlashingTicketIds } = useTicketNudgeFlash({
    enabled: !!user,
    onNudge: (ticketId) => {
      toastRef.current({
        title: tRef.current("tickets.nudgeReceivedToastForList", {
          ticket: formatTicketTrackingNumber(ticketId),
        }),
        duration: 3000,
      });
    },
  });

  const ticketRowFlashClass = (id: number) =>
    nudgeFlashingTicketIds.has(id)
      ? "nudge-flash"
      : flashingTicketIds.has(id)
        ? "lifecycle-flash"
        : undefined;

  useEffect(() => {
    let es: EventSource | null = null;
    try {
      const params = new URLSearchParams();
      if (isVendor) params.set("vendorId", String(user!.vendorId));
      const qs = params.toString();
      es = new EventSource(
        `${API_BASE}/api/live-locations/events${qs ? `?${qs}` : ""}`,
        { withCredentials: true },
      );
      const onPing = (msg: MessageEvent) => {
        try {
          const parsed = JSON.parse(msg.data) as {
            location?: { ticketId: number; lifecycleState: string | null };
          };
          const loc = parsed.location;
          if (!loc || typeof loc.ticketId !== "number") return;
          const incoming = loc.lifecycleState ?? null;
          const prev = lifecycleByTicketRef.current.get(loc.ticketId);
          if (prev === undefined) {
            // First time we see this ticket on the wire. If the initial
            // list snapshot has already loaded, this is a brand-new ticket
            // (e.g. demo cycle reset). Trigger a refetch — the resulting
            // list update will run through the seed effect, which records
            // and flashes it. Don't seed the ref here so the seed effect
            // can detect it as "new".
            if (initialSeedDoneRef.current) {
              const lp = listParamsRef.current;
              queryClient.invalidateQueries({
                queryKey: getListTicketsQueryKey(
                  Object.keys(lp).length > 0 ? lp : undefined,
                ),
              });
            }
            return;
          }
          if (prev !== incoming) {
            lifecycleByTicketRef.current.set(loc.ticketId, incoming);
            // Task #663: lifecycle pings fire much more frequently than
            // the unblock pings hardened in Task #656 — every crew
            // moving between pending_arrival → en_route → on_site →
            // off_site emits one. Apply the same surgical pattern:
            // fetch only the affected ticket via its per-id endpoint
            // and patch its row in the cached list, instead of
            // refetching the entire list on every transition. The row's
            // lifecycle badge is sourced from the ticket payload, so a
            // per-row refresh updates the badge within ~1s — same UX,
            // a fraction of the network and re-render cost on a busy
            // dispatcher screen with hundreds of rows. If the row
            // isn't in the current cached view (filter hides it), we
            // skip the fetch entirely. On fetch failure we fall back
            // to the legacy full-list invalidation so the badge still
            // updates.
            const tid = loc.ticketId;
            const lp = listParamsRef.current;
            const listKey = getListTicketsQueryKey(
              Object.keys(lp).length > 0 ? lp : undefined,
            );
            const cachedList = queryClient.getQueryData<TicketsPageData>(listKey);
            if (ticketItemsFromCache(cachedList as TicketsListCacheShape).some((t) => t.id === tid)) {
              queryClient
                .fetchQuery({
                  queryKey: getGetTicketQueryKey(tid),
                  queryFn: ({ signal }) => getTicket(tid, { signal }),
                })
                .then((fresh) => {
                  queryClient.setQueryData<TicketsPageData>(listKey, (old) =>
                    patchTicketInListCache(old, tid, fresh),
                  );
                })
                .catch(() => {
                  // Surgical fetch failed (network blip, 5xx, etc.) —
                  // fall back to invalidating the list so the badge
                  // still updates on the next render cycle.
                  queryClient.invalidateQueries({ queryKey: listKey });
                });
            }
            flashTicket(loc.ticketId);
          }
        } catch {
          // ignore malformed payloads
        }
      };
      // Task #660: mirror the `ticket.hello` gap-detection from Task #657
      // onto the live-locations channel. The server emits a one-shot
      // `location.hello` on every (re)connection whose `gap` flag is true
      // when EventSource auto-reconnected with a Last-Event-ID older than
      // the current global sequence — i.e. one or more `location.ping`s
      // fired while we were asleep. Each missed ping may have carried a
      // lifecycle transition (en_route → on_site etc.) that the list
      // depends on for its row badges/sort, so a single list invalidation
      // closes the gap without waiting on the existing 7s poll.
      const onHello = (msg: MessageEvent) => {
        try {
          const parsed = JSON.parse(msg.data) as {
            type?: string;
            gap?: boolean;
          };
          if (parsed.type !== "location.hello") return;
          // First hello on a fresh subscription has no prior
          // Last-Event-ID so `gap` is false — the just-mounted list
          // query is already fresh, no need to refetch.
          if (parsed.gap !== true) return;
          // Task #665 — route through the shared gap-recovery handler
          // so the dispatcher sees the same "list briefly fell behind
          // and refreshed" banner the crew-map shows for its
          // `location.hello` gap. The recovery itself (a single list
          // invalidation) is unchanged from Task #660.
          refreshFromGapRef.current();
        } catch {
          // ignore malformed hello payloads
        }
      };
      es.addEventListener("location.ping", onPing as EventListener);
      es.addEventListener("location.hello", onHello as EventListener);
    } catch {
      es = null;
    }
    const timers = flashTimersRef.current;
    return () => {
      if (es) es.close();
      timers.forEach((t) => clearTimeout(t));
      timers.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isVendor, user?.vendorId]);

  // Task #643 / #656 / #657: extend the Task #622 ticket-events SSE
  // channel from the single ticket-detail page out to the list. The
  // channel is already role-scoped server-side (admin sees everything,
  // vendor/field_employee see their vendor's tickets, partner sees their
  // partner's tickets), so a `ticket.unblocked` push that lands here is
  // always for a row that could be visible in the current list.
  //
  // Task #656: instead of invalidating the entire useListTickets query on
  // every push (which forces a full refetch even when only one row's
  // blocked indicator changed), fetch just the affected ticket via its
  // own /api/tickets/:id endpoint and surgically patch that row in the
  // cached list via setQueryData. The payload already carries the
  // ticketId, and the row's "blocked" indicator is sourced from the
  // ticket payload itself, so a per-row refresh fully drops the
  // indicator within ~1s — same UX, a fraction of the network and
  // re-render cost on a busy dispatcher screen with hundreds of rows.
  // If the unblocked ticket isn't in the current cached view (different
  // filter, or a row the role-scoped channel still considers visible
  // but our filter has hidden), we no-op so an unrelated row never
  // triggers a needless GET. On fetch failure we fall back to the
  // legacy full-list invalidation so the indicator still clears.
  //
  // Task #657: also honor the server's one-shot `ticket.hello` event,
  // which carries `gap === true` when EventSource auto-reconnects with
  // a Last-Event-ID older than the current global sequence. Without
  // this, any ticket.unblocked (or future ticket.* event) that fires
  // while the dispatcher's laptop is asleep is lost, and the row's
  // stale state lingers until the next 7s poll. Invalidating the entire
  // list once on a gap-flagged hello is the right tool here — we don't
  // know which row(s) we missed, so a single full refresh closes the
  // window with one fetch.
  //
  // Task #661 — surface the SSE connection state so dispatchers can
  // tell whether the list they're staring at is actually live. The
  // pill is rendered in the page header below; this effect is the
  // one place that knows about the EventSource lifecycle.
  const [liveStatus, setLiveStatus] = useState<LiveConnectionStatus>("connecting");
  const refreshedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Task #659's simple 3s-timer banner (`liveGap`) was superseded by
  // Task #665's success/error-aware banner below (`listGap`), which
  // mirrors the crew-map's `text-locations-gap-warning` pattern more
  // faithfully — clears auto on a successful refetch, stays up with a
  // "refresh now" button on failure. See the `listGap` block further
  // down for the active implementation.
  // Task #667 — these are lifted out of the SSE effect so the
  // connection pill's manual "Refresh now" button (rendered in the
  // header below) can call them directly. The behavior is exactly
  // what the gap-flagged hello path does: invalidate the list query
  // for the current filter set, then briefly flip the pill to
  // "Refreshed" so the user gets the same visual + screen-reader
  // confirmation they'd see after an automatic gap-recovery.
  const invalidateListNow = useCallback(() => {
    // Task #675 — while the per-session rate limit cooldown is active,
    // suppress invalidations so SSE pushes / manual refresh don't
    // immediately re-fire the same /api/tickets request and re-trip
    // the limiter. The gate clears itself at the end of the
    // Retry-After window and the next SSE event will refresh the
    // list as usual.
    //
    // Task #665 — return the underlying invalidate promise so the
    // gap-banner recovery path can `await` the refetch and decide
    // whether to clear the banner (success) or leave it up so the
    // dispatcher can hit "refresh now" (failure). Existing call
    // sites (manual pill refresh, lifecycle ping fallback, surgical
    // unblock fallback) discard the return value and behave exactly
    // as before.
    if (listRateLimitedRef.current) return Promise.resolve();
    const lp = listParamsRef.current;
    return Promise.resolve(
      queryClient.invalidateQueries({
        queryKey: getListTicketsQueryKey(
          Object.keys(lp).length > 0 ? lp : undefined,
        ),
      }),
    );
  }, [queryClient]);
  // Task #665 — mirror the crew-map's `locationsGap` / `visitorGap`
  // banner pattern on the tickets list. Tasks #657 and #660 already
  // *silently* re-fetch the list when the `ticket.hello` /
  // `location.hello` events report a sequence gap on reconnect, but
  // dispatchers had no way to tell the list had just been re-synced.
  // This banner is the same subtle confidence signal the crew-map
  // shows: it appears when a gap is reported, clears automatically
  // once the triggered re-fetch completes, and stays up with a
  // manual "refresh now" button if the re-fetch fails.
  const [listGap, setListGap] = useState(false);
  // Task #665 — both SSE handlers (live-locations and ticket-events)
  // capture their `onHello` listener once on mount via useEffects with
  // intentionally narrow dep arrays. Stash the latest gap-recovery
  // callback in a ref so those long-lived listeners can call the
  // current version without re-opening the EventSource each render
  // (the same pattern Task #648 uses for `toast` / `t`).
  const refreshFromGapRef = useRef<() => void>(() => {});
  const refreshFromGap = useCallback(() => {
    // Don't put up a banner we can't dismiss — while the rate-limit
    // gate is parking the query, an invalidate is a no-op (it would
    // never refetch) so the banner would never clear. The pill
    // already surfaces the cooldown state for that case.
    if (listRateLimitedRef.current) return;
    setListGap(true);
    const lp = listParamsRef.current;
    const queryKey = getListTicketsQueryKey(
      Object.keys(lp).length > 0 ? lp : undefined,
    );
    Promise.resolve(queryClient.invalidateQueries({ queryKey }))
      .then(() => {
        // `invalidateQueries` resolves once active matching queries
        // have refetched, but it doesn't reject on individual
        // refetch errors. Inspect the post-refetch query state so a
        // failed re-sync leaves the banner up — exactly the contract
        // the crew-map's `fetchLocationsOnly().catch` provides.
        const state = queryClient.getQueryState?.(queryKey);
        if (state?.status === "error") return;
        setListGap(false);
      })
      .catch(() => {
        /* leave the banner up so the user knows to refresh */
      });
  }, [queryClient]);
  refreshFromGapRef.current = refreshFromGap;
  // "Refreshed" is a transient confirmation state — we flip back to
  // "live" after a short hold so the pill doesn't shout forever.
  const flashRefreshed = useCallback(() => {
    setLiveStatus("refreshed");
    if (refreshedTimerRef.current) clearTimeout(refreshedTimerRef.current);
    refreshedTimerRef.current = setTimeout(() => {
      refreshedTimerRef.current = null;
      // Only fall back to "live" if we're still here — a later
      // disconnect will have set us to "reconnecting" and we
      // mustn't clobber that.
      setLiveStatus((prev) => (prev === "refreshed" ? "live" : prev));
    }, 3000);
  }, []);
  // Task #667 — handler the pill calls when a dispatcher clicks
  // "Refresh now" on the offline state. Same payload as the gap
  // hello: invalidate + flash the success state.
  const handleManualRefresh = useCallback(() => {
    invalidateListNow();
    flashRefreshed();
  }, [invalidateListNow, flashRefreshed]);

  useEffect(() => {
    let es: EventSource | null = null;
    try {
      es = new EventSource(`${API_BASE}/api/tickets/events`, {
        withCredentials: true,
      });
      es.onopen = () => {
        // EventSource fires onopen on the initial connect AND after
        // every successful auto-reconnect. We only swap to plain
        // "live" if we're not already in the "refreshed" hold —
        // a gap-driven hello will arrive milliseconds after this
        // and we want that confirmation to win.
        setLiveStatus((prev) => (prev === "refreshed" ? prev : "live"));
      };
      es.onerror = () => {
        // The browser auto-reconnects unless readyState is CLOSED
        // (2). For our purposes, both "still trying" and "fully
        // closed" are best surfaced as "Reconnecting…" — the user
        // doesn't need a different message for the rare permanent
        // close, and the existing 7s poll keeps the list fresh
        // either way.
        setLiveStatus("reconnecting");
      };
      const onUnblocked = (msg: MessageEvent) => {
        let parsed: { type?: string; ticketId?: number };
        try {
          parsed = JSON.parse(msg.data) as {
            type?: string;
            ticketId?: number;
          };
        } catch {
          /* malformed payload — ignore */
          return;
        }
        if (parsed.type !== "ticket.unblocked") return;
        const ticketId = parsed.ticketId;
        if (typeof ticketId !== "number") return;
        const lp = listParamsRef.current;
        const listKey = getListTicketsQueryKey(
          Object.keys(lp).length > 0 ? lp : undefined,
        );
        const cachedList = queryClient.getQueryData<TicketsPageData>(listKey);
        if (!ticketItemsFromCache(cachedList as TicketsListCacheShape).some((t) => t.id === ticketId)) {
          // Row isn't in the current view — nothing to patch and no
          // toast to fire either. Acknowledging restores for tickets
          // outside the dispatcher's filtered view would just be noise.
          return;
        }
        // Task #648: web counterpart to the mobile open-tickets list
        // toast (Task #630). When a ticket the dispatcher is currently
        // looking at has its assignment restored, surface a brief
        // confirmation that names the affected ticket using the same
        // canonical tracking-number format mobile uses. Closes the
        // loop for desktop users who would otherwise only learn of
        // the restore by noticing a row's blocked indicator quietly
        // vanish. Auto-dismisses after ~3s and is non-blocking.
        toastRef.current({
          title: tRef.current("tickets.assignmentRestoredToastForList", {
            ticket: formatTicketTrackingNumber(ticketId),
          }),
          duration: 3000,
        });
        queryClient
          .fetchQuery({
            queryKey: getGetTicketQueryKey(ticketId),
            queryFn: ({ signal }) => getTicket(ticketId, { signal }),
          })
          .then((fresh) => {
            queryClient.setQueryData<TicketsPageData>(listKey, (old) =>
              patchTicketInListCache(old, ticketId, fresh),
            );
          })
          .catch(() => {
            // Surgical fetch failed (network blip, 5xx, etc.) — fall
            // back to invalidating the list so the indicator still
            // clears on the next render cycle.
            invalidateListNow();
          });
      };
      const onHello = (msg: MessageEvent) => {
        try {
          const parsed = JSON.parse(msg.data) as {
            type?: string;
            gap?: boolean;
          };
          if (parsed.type !== "ticket.hello") return;
          // Only refetch when the server reports we missed events.
          // The first hello on a fresh subscription has no prior
          // Last-Event-ID, so `gap` is false and we leave the
          // already-fresh list alone.
          if (parsed.gap === true) {
            // Task #665 — drive the new "list briefly fell behind"
            // banner from the same hello signal. The banner clears
            // once the invalidate-driven refetch completes (or stays
            // up with a manual "refresh now" if the refetch fails),
            // mirroring the crew-map's locationsGap pattern. The pill
            // flash from Task #667 stays alongside it: a fast moving
            // dispatcher may notice one before the other.
            refreshFromGapRef.current();
            flashRefreshed();
          }
        } catch {
          /* malformed payload — ignore */
        }
      };
      es.addEventListener("ticket.unblocked", onUnblocked as EventListener);
      es.addEventListener("ticket.hello", onHello as EventListener);
    } catch {
      // EventSource isn't available (some test environments). The
      // existing 7s polling on useListTickets-driven pages handles the
      // refresh on its normal cadence. We also stop pretending to be
      // "connecting" since we will never connect.
      es = null;
      setLiveStatus("reconnecting");
    }
    return () => {
      if (es) es.close();
      if (refreshedTimerRef.current) {
        clearTimeout(refreshedTimerRef.current);
        refreshedTimerRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryClient, invalidateListNow, flashRefreshed]);

  useEffect(() => {
    const seenIds = new Set<number>();
    for (const tk of tickets) {
      seenIds.add(tk.id);
      const incoming = tk.lifecycleState ?? null;
      const known = lifecycleByTicketRef.current.has(tk.id);
      const prev = lifecycleByTicketRef.current.get(tk.id);
      if (!known) {
        lifecycleByTicketRef.current.set(tk.id, incoming);
        // After the initial snapshot, a brand-new ticket appearing in the
        // list (e.g. the demo cycle reset that creates fresh en_route
        // tickets) should also flash so it's obvious the cycle restarted.
        if (initialSeedDoneRef.current) flashTicket(tk.id);
      } else if (prev !== incoming) {
        lifecycleByTicketRef.current.set(tk.id, incoming);
        if (initialSeedDoneRef.current) flashTicket(tk.id);
      }
    }
    initialSeedDoneRef.current = true;
    // Drop tracking for tickets that left the list so a future re-appearance
    // is treated as new (and flashes again).
    for (const id of Array.from(lifecycleByTicketRef.current.keys())) {
      if (!seenIds.has(id)) lifecycleByTicketRef.current.delete(id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tickets]);

  const { data: filterSites } = useListSiteLocations();
  const { data: sites } = useListSiteLocations(isVendor ? { purpose: "ticket_creation" } : undefined);
  const { data: workTypes } = useListWorkTypes();
  // Ask the browser for location once, the first time the operator
  // opens the Create New Job dialog. We don't re-prompt — if they
  // dismiss it, they can still widen the radius to All.
  const geoRequestedRef = useRef(false);
  useEffect(() => {
    if (!addOpen) return;
    if (geoRequestedRef.current) return;
    geoRequestedRef.current = true;
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setGeoStatus("unavailable");
      return;
    }
    setGeoStatus("pending");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGeoOrigin({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setGeoStatus("granted");
      },
      () => setGeoStatus("denied"),
      { timeout: 10_000, maximumAge: 5 * 60_000 },
    );
  }, [addOpen]);
  // Keep assigned sites available for the first ticket regardless of distance.
  const allSitesForCreate = useMemo(() => {
    if (!sites) return [] as NonNullable<typeof sites>;
    return [...sites].sort((a, b) => a.name.localeCompare(b.name));
  }, [sites]);
  // Task #516: shared hook owns the "active vendor_people for the operator's
  // current vendor" rule and the companion stale-selection cleanup, so every
  // employee picker on this page (and any future picker hardened against the
  // Task #507 server tenancy guard) stays in sync without copy-pasting the
  // filter + effect each time.
  const createEmployees = useServiceEmployees(isVendor ? user.vendorId! : Number(form.vendorId)||undefined,form.workTypeIds,Number(form.siteLocationId)||undefined);
  const serviceEmployees=createEmployees.data??[];
  const creatingGate=form.workTypeIds.length>0&&form.workTypeIds.every(id=>workTypes?.some(w=>w.id===id&&(w.name.toLowerCase()==='gatekeeping'||w.category?.toLowerCase()==='gate')));
  // Task #511: same defensive cleanup for the Create New Job dialog's
  // optional Field Employee picker — sourced from the same eligibleForemen
  // set, so a membership switch / deactivation / soft-delete must null out
  // a stale selection.
  useClearStaleFieldEmployeeSelection({
    selectedId: form.fieldEmployeeId,
    eligibleForemen:serviceEmployees,
    fieldEmployees:createEmployees.data,
    onClear: () => setForm((prev) => ({ ...prev, fieldEmployeeId: "" })),
  });
  // Partners can only invite vendors they have a relationship with — the
  // server already scopes /vendors to that set when called by a partner
  // session, so a plain useListVendors() returns the right shortlist.
  const { data: partnerVendors } = useListVendors({
    query: { enabled: !!isPartner, queryKey: getListVendorsQueryKey() },
  });
  const selectedSiteIdNum = form.siteLocationId ? Number(form.siteLocationId) : 0;
  const { data: selectedSiteDetail } = useGetSiteLocation(selectedSiteIdNum, {
    query: {
      enabled: selectedSiteIdNum > 0,
      queryKey: getGetSiteLocationQueryKey(selectedSiteIdNum),
    },
  });
  // Vendors with at least one work-type assignment at the chosen site —
  // gives the partner a focused dropdown of "who can actually work here"
  // rather than the full relationships list.
  const siteScopedVendorIds = useMemo(() => {
    if (!isPartner || !selectedSiteDetail?.assignments) return new Set<number>();
    return new Set<number>(
      (selectedSiteDetail.assignments as any[]).map((a) => a.vendorId),
    );
  }, [isPartner, selectedSiteDetail]);
  const partnerVendorOptions = useMemo(() => {
    if (!isPartner || !partnerVendors) return [] as NonNullable<typeof partnerVendors>;
    return partnerVendors.filter((v: any) => siteScopedVendorIds.has(v.id) && form.workTypeIds.every(id=>selectedSiteDetail?.assignments?.some((a:any)=>a.vendorId===v.id&&a.workTypeId===id)));
  }, [isPartner, partnerVendors, siteScopedVendorIds,form.workTypeIds,selectedSiteDetail]);
  const siteScopedWorkTypes = useMemo(() => {
    if (!form.siteLocationId || !workTypes) return [] as typeof workTypes;
    if (!selectedSiteDetail?.assignments) return [];
    const filterVendorId = isVendor
      ? user.vendorId
      : null;
    const allowed = new Set(
      (selectedSiteDetail.assignments as any[])
        .filter((a) => filterVendorId == null ? true : a.vendorId === filterVendorId)
        .map((a) => a.workTypeId),
    );
    return workTypes.filter((w) => allowed.has(w.id));
  }, [workTypes, selectedSiteDetail, form.siteLocationId, form.vendorId, isVendor, isPartner, user]);
  const createTicket = useCreateTicket();

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  const handleAddTicket = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isVendor && !isPartner) return;
    if (!form.siteLocationId || form.workTypeIds.length === 0) return;
    // Resolve who owns the work. Vendors are scoped to themselves; partners
    // pick a vendor from the dropdown. Bail early if a partner forgets to
    // pick — backend would 400 on missing vendorId.
    const targetVendorId = isVendor
      ? user.vendorId!
      : form.vendorId
        ? Number(form.vendorId)
        : NaN;
    if (!Number.isFinite(targetVendorId)) return;
    setCreatingBatch(true);
    try {
      const results = await Promise.allSettled(
        form.workTypeIds.map((wtId) =>
          createTicket.mutateAsync({
            data: {
              siteLocationId: Number(form.siteLocationId),
              vendorId: targetVendorId,
              workTypeId: wtId,
              // Partners can't see other vendors' field employees, so we
              // always send null on partner intake — the vendor assigns a
              // crew on accept. Vendor intake honors the chosen employee.
              fieldEmployeeId: isVendor && form.fieldEmployeeId ? Number(form.fieldEmployeeId) : null,
              description: form.description || null,
              checkInLatitude: 0,
              checkInLongitude: 0,
            },
          }),
        ),
      );
      const created = results
        .filter((r): r is PromiseFulfilledResult<Ticket> => r.status === "fulfilled")
        .map((r) => r.value);
      const failed = results.length - created.length;
      queryClient.invalidateQueries({
        queryKey: getListTicketsQueryKey(Object.keys(listParams).length > 0 ? listParams : undefined),
      });
      if (created.length === 0) {
        // Task #574: every parallel POST in this batch shares the same
        // siteLocationId, so if the site was deleted between dialog open
        // and submit the server returns `site_not_found` for every one
        // of them. Detect that machine code on any rejected result and
        // run the same friendly recovery the phone-intake dialog uses
        // (Task #559) and the mobile new-ticket screen uses (Task #535):
        // re-fetch the site list, drop the now-invalid selection and
        // its dependents (vendor for partners, work types for everyone
        // — both are scoped to the chosen site), and render a banner
        // that explains why the picker reset. Refetch failure is
        // non-fatal — the cleared selection plus the banner still gives
        // the operator a recoverable path.
        const rejected = results.filter(
          (r): r is PromiseRejectedResult => r.status === "rejected",
        );
        const hasSiteNotFound = rejected.some((r) => {
          const data =
            r.reason && typeof r.reason === "object" && "data" in r.reason
              ? (r.reason as { data: unknown }).data
              : null;
          const code =
            data && typeof data === "object" && "error" in data
              ? (data as { error: unknown }).error
              : null;
          return code === "site_not_found";
        });
        if (hasSiteNotFound) {
          try {
            await queryClient.refetchQueries({
              queryKey: getListSiteLocationsQueryKey(),
            });
          } catch {
            // swallow — the banner + cleared selection alone is still a
            // recoverable path even if the refetch fails.
          }
          setForm((prev) => ({
            ...prev,
            siteLocationId: "",
            vendorId: "",
            workTypeIds: [],
          }));
          setAddSiteUnavailableNotice(true);
          return;
        }
        // Task #871: same shape as the site_not_found block above, but
        // for `work_type_not_allowed`. The site is still valid — only
        // the picked work type(s) are stale — so we re-fetch the
        // work-types list, clear just the invalid checkboxes, and leave
        // the site (and the partner-side vendor pick) intact so the
        // operator only has to re-tick a still-approved work type.
        // Refetch failure is non-fatal — the banner + cleared
        // checkboxes alone is still a recoverable path. Site_not_found
        // takes precedence above because clearing the site also voids
        // every dependent work-type pick.
        const hasWorkTypeNotAllowed = rejected.some((r) => {
          const data =
            r.reason && typeof r.reason === "object" && "data" in r.reason
              ? (r.reason as { data: unknown }).data
              : null;
          const code =
            data && typeof data === "object" && "error" in data
              ? (data as { error: unknown }).error
              : null;
          return code === "work_type_not_allowed";
        });
        if (hasWorkTypeNotAllowed) {
          try {
            await queryClient.refetchQueries({
              queryKey: getListWorkTypesQueryKey(),
            });
          } catch {
            // swallow — see comment above.
          }
          setForm((prev) => ({
            ...prev,
            workTypeIds: [],
          }));
          setAddWorkTypeUnavailableNotice(true);
          return;
        }
        toast({ title: t("tickets.createTrackingFailed", { defaultValue: "Failed to create tracking numbers" }), variant: "destructive" });
        return;
      }
      setAddOpen(false);
      setForm({ siteLocationId: "", vendorId: "", workTypeIds: [], fieldEmployeeId: "", description: "" });
      if (created.length === 1 && failed === 0) {
        toast({ title: t("tickets.createdSingle", { defaultValue: "Tracking number created" }) });
        const t0 = created[0];
        if (t0) {
          navigate(`/tickets/${t0.id}`);
        }
      } else {
        const numbers = created
          .map((t0) => `#${String(t0.id).padStart(8, "0")}`)
          .join(", ");
        toast({
          title: failed > 0
            ? t("tickets.createdMultipleWithFailures", { count: created.length, failed, defaultValue: "{{count}} tracking numbers created ({{failed}} failed)" })
            : t("tickets.createdMultiple", { count: created.length, defaultValue: "{{count}} tracking numbers created" }),
          description: numbers,
        });
      }
    } finally {
      setCreatingBatch(false);
    }
  };

  const filteredTickets = useMemo(() => {
    let result = [...tickets];
    if (searchQuery.trim()) {
      const query = searchQuery.replace(/^#/, "").replace(/^0+/, "");
      if (query) {
        result = result.filter((t) => String(t.id).includes(query));
      }
    }
    if (siteFilter !== "all") {
      result = result.filter((t) => String(t.siteLocationId) === siteFilter);
    }
    const dir = sortDir === "asc" ? 1 : -1;
    result.sort((a, b) => {
      switch (sortKey) {
        case "ticket":
          return (new Date(b.updatedAt || b.createdAt).getTime() - new Date(a.updatedAt || a.createdAt).getTime()) * dir;
        case "site":
          return (a.siteName || "").localeCompare(b.siteName || "") * dir;
        case "vendor":
          return (a.vendorName || "").localeCompare(b.vendorName || "") * dir;
        case "fieldEmployee":
          return (a.fieldEmployeeName || "").localeCompare(b.fieldEmployeeName || "") * dir;
        case "status":
          return (a.status || "").localeCompare(b.status || "") * dir;
        case "created":
          return (new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()) * dir;
        case "daysWaiting": {
          // Task #865 — `daysWaiting` is `now - approvedAt`, so a larger
          // daysWaiting corresponds to a SMALLER approvedAt timestamp.
          // We invert the timestamp delta so the column behaves like a
          // normal numeric sort: dir=desc surfaces the oldest unpaid
          // ticket (largest daysWaiting) first, dir=asc surfaces the
          // most recently approved one. Rows without an approvedAt
          // always sink to the bottom regardless of direction so the AP
          // queue never accidentally floats a not-yet-approved row.
          const at = a.approvedAt ? new Date(a.approvedAt).getTime() : null;
          const bt = b.approvedAt ? new Date(b.approvedAt).getTime() : null;
          if (at == null && bt == null) return 0;
          if (at == null) return 1;
          if (bt == null) return -1;
          return (bt - at) * dir;
        }
        default:
          return 0;
      }
    });
    return result;
  }, [tickets, searchQuery, sortKey, sortDir, siteFilter]);

  // Task #863 — Reverse the dispersed payment for the currently-targeted
  // ticket and patch the list so the row re-renders with the new
  // `approved` status without a full refetch. Mirrors the dialog handler
  // in ticket-detail.tsx, including the same reason-required guard and
  // the 403-aware error toast. We invalidate the per-ticket query keys
  // (detail + note logs) so any other open tab on this ticket also
  // catches the new state.
  const handleReverseFundsDispersal = () => {
    const id = reverseFundsTicketId;
    if (id == null) return;
    const reason = reverseFundsReason.trim();
    if (!reason) {
      toast({
        title: t("ticketDetail.reverseFundsReasonRequired"),
        variant: "destructive",
      });
      return;
    }
    reverseFundsDispersalMut.mutate(
      { id, data: { reason } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListTicketsQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetTicketQueryKey(id) });
          queryClient.invalidateQueries({
            queryKey: getGetTicketNoteLogsQueryKey(id),
          });
          setReverseFundsTicketId(null);
          setReverseFundsReason("");
          toast({ title: t("ticketDetail.reverseFundsSuccess") });
        },
        onError: (err: unknown) => {
          const status =
            (err as { status?: number; response?: { status?: number } })
              ?.status ??
            (err as { response?: { status?: number } })?.response?.status;
          const fallback =
            status === 403
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

  // Task #1029 — Bulk reverse-payment helpers. We compute the visible
  // funds_dispersed ids on the fly so the master "select all" checkbox in
  // the header reflects whatever the current search / lifecycle filter
  // / sort is showing the admin, and so a row that no longer matches the
  // filter automatically drops out of the selection on next interaction.
  const visibleReversibleIds = useMemo(
    () =>
      filteredTickets
        .filter((t) => t.status === "funds_dispersed")
        .map((t) => t.id),
    [filteredTickets],
  );
  const visibleReversibleCount = visibleReversibleIds.length;
  const selectedReversibleIds = useMemo(
    () => visibleReversibleIds.filter((id) => bulkSelectedIds.has(id)),
    [visibleReversibleIds, bulkSelectedIds],
  );
  const allReversibleSelected =
    visibleReversibleCount > 0 &&
    selectedReversibleIds.length === visibleReversibleCount;
  const someReversibleSelected =
    selectedReversibleIds.length > 0 && !allReversibleSelected;

  const toggleSelectAllReversible = () => {
    setBulkSelectedIds((prev) => {
      const next = new Set(prev);
      if (allReversibleSelected) {
        for (const id of visibleReversibleIds) next.delete(id);
      } else {
        for (const id of visibleReversibleIds) next.add(id);
      }
      return next;
    });
  };
  const toggleSelectOne = (id: number) => {
    setBulkSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Task #1029 — Sequentially reverse the picked dispersals so each
  // ticket gets its own audit-trail entry (same status_history shape as
  // the per-row Task #863 button) and so a transient failure on ticket
  // N+1 still leaves N..1 reversed. We refresh the list once at the end
  // rather than per-row to avoid 50 list refetches in a tight loop. Per-
  // ticket detail/note caches are individually invalidated for any open
  // detail tab. Failures are tallied and surfaced in a single toast so
  // the admin can retry only the failed rows (still selected).
  const handleBulkReverseFundsDispersal = async () => {
    const reason = bulkReverseReason.trim();
    if (!reason) {
      toast({
        title: t("ticketDetail.reverseFundsReasonRequired"),
        variant: "destructive",
      });
      return;
    }
    const targets = selectedReversibleIds.slice();
    if (targets.length === 0) return;
    setBulkReverseProgress({ done: 0, total: targets.length, failures: 0 });
    const succeeded: number[] = [];
    let failures = 0;
    for (let i = 0; i < targets.length; i++) {
      const id = targets[i];
      try {
        await reverseFundsDispersal(id, { reason });
        succeeded.push(id);
      } catch (err) {
        failures += 1;
        // Stash the first failure so we can show a meaningful message,
        // but keep going so partial progress isn't lost.
        if (failures === 1) {
          // eslint-disable-next-line no-console
          console.warn("bulk reverse failed for ticket", id, err);
        }
      }
      setBulkReverseProgress({
        done: i + 1,
        total: targets.length,
        failures,
      });
    }
    // Drop the successfully-reversed rows from the selection so a retry
    // only resends the failed ones (still ticked).
    setBulkSelectedIds((prev) => {
      const next = new Set(prev);
      for (const id of succeeded) next.delete(id);
      return next;
    });
    queryClient.invalidateQueries({ queryKey: getListTicketsQueryKey() });
    for (const id of succeeded) {
      queryClient.invalidateQueries({ queryKey: getGetTicketQueryKey(id) });
      queryClient.invalidateQueries({
        queryKey: getGetTicketNoteLogsQueryKey(id),
      });
    }
    setBulkReverseProgress(null);
    if (failures === 0) {
      setBulkReverseOpen(false);
      setBulkReverseReason("");
      toast({
        title: t("tickets.bulkReverseSuccess", {
          count: succeeded.length,
          defaultValue: "Reversed {{count}} payment(s).",
        }),
      });
    } else if (succeeded.length === 0) {
      toast({
        title: t("tickets.bulkReverseAllFailed", {
          count: failures,
          defaultValue:
            "Could not reverse the {{count}} selected payment(s). Try again.",
        }),
        variant: "destructive",
      });
    } else {
      toast({
        title: t("tickets.bulkReversePartial", {
          done: succeeded.length,
          failed: failures,
          defaultValue:
            "Reversed {{done}} payment(s); {{failed}} failed and stayed selected for retry.",
        }),
        variant: "destructive",
      });
    }
  };

  const SortableHead = ({ label, column }: { label: string; column: SortKey }) => (
    <TableHead className="cursor-pointer select-none" onClick={() => handleSort(column)}>
      <div className="flex items-center gap-1">
        {label}
        <ArrowUpDown
          className={`w-4 h-4 ${sortKey === column ? "" : "text-muted-foreground"}`}
          style={sortKey === column ? { color: brand.primary } : undefined}
        />
      </div>
    </TableHead>
  );

  return (
    <div className={`current-theme-page current-theme-legacy space-y-6 ${user?.role === "vendor" ? "vendor-workspace-page" : ""}`} data-testid="tickets-page">
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2">
        <div className="flex items-start gap-3">
          <ContentPaneBackLink href="/" className="mt-0.5" />
          <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight" data-testid="text-page-title">{t("tickets.title")}</h1>
            {/* Task #661 — non-blocking SSE health pill. Sits next to the
                title so dispatchers can see at a glance whether the
                live ticket feed is connected, reconnecting, or just
                refreshed after a drop.
                Task #667 — when the pill is in the offline state, the
                dispatcher can click it to trigger an immediate list
                refresh instead of waiting for the next poll / browser
                reconnect. The pill briefly flips to "Refreshed" on
                success, mirroring the gap-recovery flash. */}
            <LiveConnectionPill
              appearance="indicator"
              status={listRateLimited ? "reconnecting" : liveStatus}
              onRefresh={listRateLimited ? undefined : handleManualRefresh}
              testId="tickets-live-connection-pill"
            />
          </div>
          <p className="text-muted-foreground text-sm mt-1">{isVendor ? t("tickets.subtitleVendor", { defaultValue: "Your VNDRLY tracking numbers" }) : t("tickets.subtitleAll", { defaultValue: "All VNDRLY tracking numbers" })}</p>
          </div>
        </div>
        <div className="flex flex-col items-end gap-2">
          {/* Row 1: Start New, Group by visit, All states (+ role-specific extras) */}
          <div className="flex flex-wrap items-center gap-3">
          {(isVendor || isPartner) && (
            <button type="button" className="hub-task-mini-card"
              data-testid="button-start-new-ticket"
              onClick={() => setAddOpen(true)}
            >
              <Plus className="w-4 h-4" />
              {t("tickets.startNew", { defaultValue: "Start New" })}
            </button>
          )}
          {isFieldEmployee && (
            <div
              className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 max-w-[320px]"
              data-testid="banner-field-employee-mobile"
            >
              {t("tickets.fieldEmployeeMobileHint", {
                defaultValue:
                  "Use the VNDRLY mobile app to start new tracking numbers. The web view is read-only for field crews.",
              })}
            </div>
          )}
          {/* Task #1029 — bulk reverse action bar. Only renders when an
              admin has ticked at least one funds_dispersed row in the
              tickets table. The dialog is hoisted to the bottom of the
              page so it can serve any subset of selected rows. */}
          {/* Gate on `selectedReversibleIds.length`, NOT
              `bulkSelectedIds.size`, so the visible count and the count
              the bulk handler actually processes always agree. If the
              admin changes the lifecycle filter / search and some
              previously-checked rows fall out of view, those ids stay
              in the Set (so they re-appear when the filter reverts) but
              they don't pad the toolbar count or claim a confirm dialog
              they couldn't deliver on. */}
          {isAdmin && selectedReversibleIds.length > 0 && (
            <button type="button" className="hub-task-mini-card"
              data-testid="button-bulk-reverse-funds"
              onClick={() => {
                setBulkReverseReason("");
                setBulkReverseOpen(true);
              }}
            >
              <RotateCcw className="w-4 h-4" />
              {t("tickets.bulkReverseButton", {
                count: selectedReversibleIds.length,
                defaultValue: "Reverse {{count}} payment(s)",
              })}
            </button>
          )}
          {isPartner && awaitingPayment && (
            <button type="button" className="hub-task-mini-card"
              data-testid="export-awaiting-payment-csv"
              onClick={() => {
                // Task #865 — client-side CSV export of the AP queue.
                // The /tickets list has no per-view server CSV today,
                // so we serialize the same rows the partner is looking
                // at (post search/lifecycle filter, post sort) and
                // include the two columns the AP staff actually need:
                // when the ticket was approved and how many days it's
                // been sitting in the queue. We escape every cell with
                // the standard "wrap in quotes, double the quotes"
                // rule so commas / quotes / newlines in vendor or site
                // names can't break the file open in Excel.
                const escape = (val: unknown) => {
                  const s = val == null ? "" : String(val);
                  return /[",\n\r]/.test(s)
                    ? `"${s.replace(/"/g, '""')}"`
                    : s;
                };
                const now = Date.now();
                const header = [
                  "Ticket #",
                  "Site",
                  "Vendor",
                  "Work type",
                  "Approved on",
                  "Days waiting",
                ];
                const rows = filteredTickets.map((tk) => {
                  const approvedAtMs = tk.approvedAt
                    ? new Date(tk.approvedAt).getTime()
                    : null;
                  const days =
                    approvedAtMs == null
                      ? ""
                      : Math.floor((now - approvedAtMs) / 86_400_000);
                  return [
                    tk.id,
                    tk.siteName ?? "",
                    tk.vendorName ?? "",
                    tk.workTypeName ?? "",
                    tk.approvedAt
                      ? new Date(tk.approvedAt).toISOString()
                      : "",
                    days,
                  ];
                });
                const csv =
                  [header, ...rows]
                    .map((r) => r.map(escape).join(","))
                    .join("\r\n") + "\r\n";
                const blob = new Blob([csv], {
                  type: "text/csv;charset=utf-8;",
                });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = `awaiting-payment-${new Date()
                  .toISOString()
                  .slice(0, 10)}.csv`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
              }}
            >
              <DollarSign className="w-4 h-4" />
              {t("tickets.exportAwaitingPaymentCsv", {
                defaultValue: "Export CSV",
              })}
            </button>
          )}
          {isPartner && (
            <button type="button" className="hub-task-mini-card"
              data-testid="toggle-awaiting-payment"
              onClick={() => {
                const next = !awaitingPayment;
                setAwaitingPayment(next);
                const params = new URLSearchParams(search);
                if (next) params.set("awaitingPayment", "true");
                else params.delete("awaitingPayment");
                const qs = params.toString();
                navigate(`/tickets${qs ? `?${qs}` : ""}`, { replace: true });
              }}
            >
              <DollarSign className="w-4 h-4" />
              {t("tickets.awaitingPayment", { defaultValue: "Awaiting payment" })}
            </button>
          )}
          </div>
          {(isVendor || isPartner) && (
            <Dialog
              open={addOpen}
              onOpenChange={(open) => {
                setAddOpen(open);
                // Task #574: any open/close cycle resets the friendly
                // banner so a re-opened dialog never shows a stale
                // "site no longer available" message from a prior
                // failed submit. Task #871 mirrors the same behavior
                // for the work-type variant.
                if (!open) {
                  setAddSiteUnavailableNotice(false);
                  setAddWorkTypeUnavailableNotice(false);
                }
              }}
            >
              <DialogContent className={isVendor ? "vendor-workspace-page app-dialog" : undefined}>
                <DialogHeader><DialogTitle>{t("tickets.authorizeNewTicket")}</DialogTitle></DialogHeader>
                <form onSubmit={handleAddTicket} className="space-y-4">
                  {addSiteUnavailableNotice && (
                    <div
                      role="status"
                      data-testid="add-site-unavailable-banner"
                      className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900"
                    >
                      {t("tickets.phoneIntakeSiteUnavailableRefreshed", {
                        defaultValue:
                          "That site is no longer available. We refreshed your list — please pick a different one.",
                      })}
                    </div>
                  )}
                  {addWorkTypeUnavailableNotice && (
                    <div
                      role="status"
                      data-testid="add-work-type-unavailable-banner"
                      className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900"
                    >
                      {t("tickets.phoneIntakeWorkTypeUnavailableRefreshed", {
                        defaultValue:
                          "That work type is no longer approved for this site. We refreshed your list — please pick a different one.",
                      })}
                    </div>
                  )}
                  <div>
                    <Label>{t("tickets.siteLocation", { defaultValue: "Site Location" })}</Label>
                    <Select value={form.siteLocationId} onValueChange={(v) => {
                      setForm((prev) => ({ ...prev, siteLocationId: v, vendorId: "", workTypeIds: [] }));
                      // Task #574: picking a site from the refreshed
                      // list means the operator has acted on the "site
                      // no longer available" banner — drop it so the
                      // dialog returns to a clean slate for resubmit.
                      if (addSiteUnavailableNotice) {
                        setAddSiteUnavailableNotice(false);
                      }
                      // Task #871: changing the site also voids any
                      // prior "work type no longer approved" banner —
                      // it was scoped to the previous site, and the
                      // dependent workTypeIds were just cleared above.
                      if (addWorkTypeUnavailableNotice) {
                        setAddWorkTypeUnavailableNotice(false);
                      }
                    }}>
                      <SelectTrigger data-testid="select-site"><SelectValue placeholder={t("tickets.selectSite", { defaultValue: "Select site" })} /></SelectTrigger>
                      <SelectContent>
                        {allSitesForCreate.map((s) => (
                          <SelectItem
                            key={s.id}
                            value={String(s.id)}
                            data-testid={`site-option-${s.id}`}
                          >
                            {s.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  {/* Partner-only vendor picker. We render once a site is
                      chosen so the dropdown is restricted to vendors who
                      already have a work-type assignment at that site —
                      keeps partners from inviting a vendor the site can't
                      actually receive yet. */}
                  <div>
                    <Label>{t("tickets.workTypes", { defaultValue: "Work Types" })}</Label>
                    <p className="text-xs text-muted-foreground mb-2">
                      {t("tickets.workTypesHint", { defaultValue: "Pick one or more — each gets its own tracking number." })}
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-64 overflow-y-auto rounded-md border p-3" data-testid="work-types-multi">
                      {!form.siteLocationId ? (
                        <p className="text-sm text-muted-foreground col-span-full">{t("tickets.pickSiteFirst", { defaultValue: "Pick a site first." })}</p>
                      ) : siteScopedWorkTypes && siteScopedWorkTypes.length > 0 ? (
                        siteScopedWorkTypes.map((w) => {
                          const checked = form.workTypeIds.includes(w.id);
                          return (
                            <label key={w.id} className="flex items-center gap-2 cursor-pointer text-sm" data-testid={`checkbox-work-type-${w.id}`}>
                              <Switch
                                aria-label={w.name}
                                className="data-[state=checked]:bg-[var(--brand-primary)]"
                                checked={checked}
                                onCheckedChange={(v) => {
                                  setForm((prev) => ({
                                    ...prev,
                                    vendorId: "", fieldEmployeeId: "",
                                    workTypeIds: v
                                      ? [...prev.workTypeIds, w.id]
                                      : prev.workTypeIds.filter((x) => x !== w.id),
                                  }));
                                  // Task #871: ticking a work type
                                  // from the refreshed list means the
                                  // operator has acted on the "work
                                  // type no longer approved" banner —
                                  // drop it so the dialog returns to
                                  // a clean slate for resubmit.
                                  if (addWorkTypeUnavailableNotice) {
                                    setAddWorkTypeUnavailableNotice(false);
                                  }
                                }}
                              />
                              <span>{w.name}</span>
                            </label>
                          );
                        })
                      ) : (
                        <p className="text-sm text-muted-foreground col-span-full">{t("tickets.noWorkTypesApproved", { defaultValue: "No work types approved for this site." })}</p>
                      )}
                    </div>
                    {form.workTypeIds.length > 0 && (
                      <p className="text-xs text-muted-foreground mt-1">{t("tickets.selectedCount", { count: form.workTypeIds.length, defaultValue: "{{count}} selected" })}</p>
                    )}
                  </div>
                  {isPartner && (
                    <div>
                      <Label>{t("tickets.vendor", { defaultValue: "Vendor" })}</Label>
                      <Select
                        value={form.vendorId}
                        onValueChange={(v) => {
                          setForm((prev) => ({ ...prev, vendorId: v, fieldEmployeeId: "" }));
                          // Task #871: changing the vendor reshapes
                          // the work-type list (siteScopedWorkTypes is
                          // filtered by vendor for partners), so a
                          // prior "work type no longer approved"
                          // banner is no longer relevant.
                          if (addWorkTypeUnavailableNotice) {
                            setAddWorkTypeUnavailableNotice(false);
                          }
                        }}
                        disabled={!form.siteLocationId || !form.workTypeIds.length}
                      >
                        <SelectTrigger data-testid="select-vendor">
                          <SelectValue placeholder={!form.siteLocationId
                            ? t("tickets.pickSiteFirst", { defaultValue: "Pick a site first." })
                            : t("tickets.selectVendor", { defaultValue: "Select vendor" })} />
                        </SelectTrigger>
                        <SelectContent>
                          {partnerVendorOptions.length > 0 ? (
                            partnerVendorOptions.map((v: any) => (
                              <SelectItem key={v.id} value={String(v.id)}>{v.name}</SelectItem>
                            ))
                          ) : null}
                        </SelectContent>
                      </Select>
                      {form.siteLocationId && partnerVendorOptions.length === 0 && (
                        <p className="text-xs text-muted-foreground mt-1">
                          {t("tickets.noVendorsApproved", { defaultValue: "No vendors are approved for work at this site yet." })}
                        </p>
                      )}
                    </div>
                  )}
                  {/* Vendors only — partners can't see other vendors' field
                      employees, and the assigned vendor will pick the crew
                      after they accept the invite. */}
                  {isVendor && (
                    <div>
                      <Label>{creatingGate ? t("ticketDetail.gateEmployee") : t("tickets.fieldEmployeeOptional", { defaultValue: "Field Employee (optional)" })}</Label>
                      <Select value={form.fieldEmployeeId} onValueChange={(v) => setForm({ ...form, fieldEmployeeId: v })}>
                        <SelectTrigger data-testid="select-field-employee"><SelectValue placeholder={t("tickets.selectEmployee", { defaultValue: "Select employee" })} /></SelectTrigger>
                        <SelectContent>
                          {/* Task #511: source from serviceEmployees so the picker
                              never lists inactive vendor_people or rows from a
                              previously-cached vendor membership. Mirrors the
                              phone-intake foreman dropdown's empty state. */}
                          {serviceEmployees.length > 0 ? (
                            serviceEmployees.map((fe) => (
                              <SelectItem key={fe.id} value={String(fe.id)}>{fe.firstName} {fe.lastName}{credentialMatchText(fe, i18n.language.startsWith("es")) && ` — ${credentialMatchText(fe, i18n.language.startsWith("es"))}`}</SelectItem>
                            ))
                          ) : (
                            <div
                              className="px-2 py-1.5 text-sm text-muted-foreground"
                              data-testid="empty-field-employee-list"
                            >
                              {t("tickets.noForemenAvailable", {
                                defaultValue: "No active field employees on your vendor.",
                              })}
                            </div>
                          )}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                  <div>
                    <Label>{t("tickets.descriptionOptional", { defaultValue: "Description (optional)" })}</Label>
                    <Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder={t("tickets.descriptionPlaceholder", { defaultValue: "Describe the work..." })} data-testid="input-description" />
                  </div>
                  {isPartner && (
                    <p className="text-xs text-muted-foreground">
                      {t("tickets.partnerInviteNotice", { defaultValue: "The vendor will be notified to accept and assign a crew." })}
                    </p>
                  )}
                  <PngPillButton
                    type="submit"
                    color="brand"
                    disabled={
                      creatingBatch
                      || !form.siteLocationId
                      || form.workTypeIds.length === 0
                      || (isPartner && !form.vendorId)
                    }
                    className="w-full"
                    data-testid="button-submit-ticket"
                  >
                    {creatingBatch
                      ? t("tickets.starting", { defaultValue: "Starting..." })
                      : t("tickets.authorizeNewTicket")}
                  </PngPillButton>
                </form>
              </DialogContent>
            </Dialog>
          )}
        </div>
      </div>

      {/* Task #665 — subtle "list briefly fell behind" banner. Mirrors
          the crew-map's locationsGap / visitorGap warning so the
          dispatcher gets the same confidence signal here: a sleep /
          network blip caused a `ticket.hello` or `location.hello`
          gap, we re-synced the list, and (on success) the banner
          clears itself. If the re-sync fails the banner sticks with
          a one-click "refresh now" button so they're never stuck on
          a silently-stale list. */}
      {listGap && (
        <div
          className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1 flex items-center gap-2"
          data-testid="text-tickets-gap-warning"
          role="status"
        >
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          <span>
            {t("tickets.listGapWarning", {
              defaultValue:
                "Reconnected to live updates — some ticket changes may have been missed. Refreshing now…",
            })}
          </span>
          <button
            type="button"
            className="underline ml-auto"
            onClick={refreshFromGap}
            data-testid="button-tickets-gap-refresh"
          >
            {t("tickets.refreshNow", { defaultValue: "Refresh now" })}
          </button>
        </div>
      )}

      {!isFieldEmployee && <DashboardTicketJourneys scope={`${user?.userId}:${user?.activeMembershipId}:${user?.role}:${user?.vendorId ?? user?.partnerId}`} enabled={ticketSummaryEnabled} headerAction={<DashboardTicketLocationCount query={ticketSummary} />} />}
      <Card className="ticket-history-card" data-testid="card-all-tickets-history">
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
          <CardTitle>{t("tickets.allHistoryTitle", {defaultValue:"All tickets/history"})}</CardTitle>
          <div className="ml-auto flex flex-wrap justify-end gap-3">
          {/* Filters wrap as two right-aligned rows within constrained cards. */}
          <div className="ticket-history-controls">
            <div className="ticket-history-search relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input placeholder={t("tickets.searchPlaceholder", { defaultValue: "Search tracking #" })} value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="pl-9 w-[180px]" data-testid="input-search-ticket" />
            </div>
            <div className="ticket-history-selectors">
            <Select value={siteFilter} onValueChange={setSiteFilter}>
              <SelectTrigger className="w-auto min-w-[132px]" aria-label="Site location" data-testid="select-lifecycle-filter"><SelectValue>{siteFilter === "all" ? t("tickets.locationFilterTitle") : filterSites?.find(site => String(site.id) === siteFilter)?.name}</SelectValue></SelectTrigger>
              <SelectContent align="end" className="branded-form-select-menu" style={brandStyleVars(brand)}>
                <SelectItem value="all">{t("tickets.allLocations", { defaultValue: "All locations" })}</SelectItem>
                {[...(filterSites ?? [])].sort((a, b) => a.name.localeCompare(b.name)).map(site => (
                  <SelectItem key={site.id} value={String(site.id)}>{site.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-auto min-w-[132px]" aria-label="Ticket status" data-testid="select-status-filter"><SelectValue>{statusFilter === "all" ? t("tickets.stateFilterTitle") : stateOptions.find(opt => opt.value === statusFilter)?.label}</SelectValue></SelectTrigger>
              <SelectContent align="end" className="branded-form-select-menu" style={brandStyleVars(brand)}>
                {stateOptions.map(opt => <SelectItem key={opt.value} value={opt.value} data-testid={`status-option-${opt.value}`}>{opt.label}</SelectItem>)}
              </SelectContent>
            </Select>
            </div>
          </div>

          </div>
        </CardHeader>
        <CardContent>
          <p className="mb-2 text-xs text-muted-foreground">{t("tickets.newestFirst", {defaultValue:"Newest first"})}</p>
          {isAdmin && <Checkbox checked={allReversibleSelected ? true : someReversibleSelected ? "indeterminate" : false} onCheckedChange={toggleSelectAllReversible} aria-label={t("tickets.bulkSelectAll", {defaultValue:"Select all reversible tickets"})} data-testid="checkbox-bulk-reverse-all" />}
          <div ref={historyScrollRef} className="max-h-[min(75vh,2350px)] overflow-y-auto overscroll-contain space-y-2" data-testid="tickets-history-scroll">
            {isLoading ? <Skeleton className="h-24 w-full" /> : filteredTickets.length ? filteredTickets.map(tk => (
              <TicketActivityCard key={tk.id} ticketId={tk.id} timestamp={tk.updatedAt || tk.createdAt} status={tk.status}
                lifecycleState={tk.lifecycleState} siteName={tk.siteName} vendorName={tk.vendorName} workTypeName={tk.workTypeName}
                testId={`row-ticket-${tk.id}`} statusTestId={`badge-status-${tk.id}`} className={ticketRowFlashClass(tk.id)}>
                {tk.fieldEmployeeName && <span>{tk.fieldEmployeeName}</span>}
                {tk.unreadCommentCount > 0 && <span data-testid={`badge-unread-comments-${tk.id}`}><MessageCircle className="inline h-3 w-3" /> {tk.unreadCommentCount}</span>}
                {isAdmin && tk.status === "funds_dispersed" && <Checkbox checked={bulkSelectedIds.has(tk.id)} onCheckedChange={() => toggleSelectOne(tk.id)} aria-label={`Select ticket #${tk.id} for bulk reverse`} data-testid={`checkbox-bulk-reverse-${tk.id}`} />}
                              {isAdmin && tk.status === "funds_dispersed" && (
                                <span onClick={(e) => e.stopPropagation()}>
                                  <PngPillButton
                                    type="button"
                                    color="red"
                                    className="max-w-full"
                                    onClick={() => {
                                      setReverseFundsReason("");
                                      setReverseFundsTicketId(tk.id);
                                    }}
                                    data-testid={`button-reverse-funds-${tk.id}`}
                                    title={t("ticketDetail.reverseFunds")}
                                  >
                                    {t("ticketDetail.reverseFunds")}
                                  </PngPillButton>
                                </span>
                              )}

                            {tk.unlockedAt && (
                              <Link
                                href={`/tickets/${tk.id}#unlock-history`}
                                onClick={(e) => e.stopPropagation()}
                                className="inline-flex"
                                title={tk.unlockCount > 1
                                  ? t("tickets.reopenedTitleCount", { name: tk.unlockedByName ?? t("tickets.adminFallback", { defaultValue: "admin" }), when: new Date(tk.unlockedAt).toLocaleString(), count: tk.unlockCount, defaultValue: "Reopened by {{name}} on {{when}} ({{count}} times)" })
                                  : t("tickets.reopenedTitle", { name: tk.unlockedByName ?? t("tickets.adminFallback", { defaultValue: "admin" }), when: new Date(tk.unlockedAt).toLocaleString(), defaultValue: "Reopened by {{name}} on {{when}}" })}
                                data-testid={`badge-reopened-${tk.id}`}
                              >
                                <span role="status" className="inline-flex min-h-[26px] items-center gap-[5px] rounded-full status-live-indicator px-[10px] py-[3px] text-xs font-semibold text-amber-500">
                                  <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full !bg-current" />
                                  <RotateCcw className="w-3 h-3" />
                                  {t("tickets.reopenedBy", { name: tk.unlockedByName ?? t("tickets.adminFallback", { defaultValue: "admin" }), defaultValue: "Reopened by {{name}}" })}
                                  {tk.unlockCount > 1 ? t("tickets.reopenedTimes", { count: tk.unlockCount, defaultValue: " · {{count}}×" }) : ""}
                                </span>
                              </Link>
                            )}
                {isPartner && awaitingPayment && <>
                  <span data-testid={`cell-approved-on-${tk.id}`}>{tk.approvedAt ? new Date(tk.approvedAt).toLocaleDateString() : "—"}</span>
                  <span data-testid={`cell-days-waiting-${tk.id}`}>{tk.approvedAt ? Math.max(0,Math.floor((Date.now()-Date.parse(tk.approvedAt))/86400000)) : "—"}</span>
                </>}
              </TicketActivityCard>
            )) : <p className="py-8 text-center text-muted-foreground">{t("tickets.noneFound",{defaultValue:"No tracking numbers found"})}</p>}
          </div>
          <div className="mt-3 flex items-center justify-between gap-3 text-xs">
            <span>{filteredTickets.length ? historyPage*25+1 : 0}–{historyPage*25+filteredTickets.length} / {ticketsPage?.total ?? tickets.length}</span>
            <div className="flex gap-2">
              <button className="hub-task-mini-card" disabled={historyPage===0 || isLoading} onClick={()=>setHistoryPage(p=>Math.max(0,p-1))}>{t("tickets.newer",{defaultValue:"Newer"})}</button>
              <button className="hub-task-mini-card" disabled={isLoading || (historyPage+1)*25 >= (ticketsPage?.total ?? tickets.length)} onClick={()=>setHistoryPage(p=>p+1)}>{t("tickets.older",{defaultValue:"Older"})}</button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Task #863 — Shared Reverse / void payment dialog. One copy
          serves every funds_dispersed row in the list; the trigger
          buttons just stash the target ticket id. We mirror the body of
          the dialog in ticket-detail.tsx (Task #504) so admins see the
          same warning copy and the same reason-required affordance no
          matter where they invoke it from. */}
      <Dialog
        open={reverseFundsTicketId !== null}
        onOpenChange={(open) => {
          if (!open) {
            setReverseFundsTicketId(null);
            setReverseFundsReason("");
          }
        }}
      >
        <DialogContent className={isVendor ? "vendor-workspace-page app-dialog" : undefined}>
          <DialogHeader>
            <DialogTitle>{t("ticketDetail.reverseFundsTitle")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {t("ticketDetail.reverseFundsHelp")}
            </p>
            <div>
              <Label htmlFor="ap-reverse-reason">
                {t("ticketDetail.reverseFundsReason")}
              </Label>
              <Textarea
                id="ap-reverse-reason"
                value={reverseFundsReason}
                onChange={(e) => setReverseFundsReason(e.target.value)}
                placeholder={t("ticketDetail.reverseFundsReasonPlaceholder")}
                rows={3}
                data-testid="input-ap-reverse-funds-reason"
              />
              {!reverseFundsReason.trim() && (
                <p className="text-xs text-muted-foreground mt-1">
                  {t("ticketDetail.reverseFundsReasonRequired")}
                </p>
              )}
            </div>
          </div>
          <DialogFooter>
            <PillButton
              color="red"
              onClick={() => {
                setReverseFundsTicketId(null);
                setReverseFundsReason("");
              }}
              data-testid="button-ap-cancel-reverse-funds"
            >
              {t("common.cancel")}
            </PillButton>
            <PngPillButton
              color="red"
              onClick={handleReverseFundsDispersal}
              disabled={
                reverseFundsDispersalMut.isPending ||
                !reverseFundsReason.trim()
              }
              data-testid="button-ap-confirm-reverse-funds"
            >
              {reverseFundsDispersalMut.isPending
                ? t("ticketDetail.reverseFundsSubmitting")
                : t("ticketDetail.reverseFundsConfirm")}
            </PngPillButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Task #1029 — Bulk reverse-payment dialog. Mirrors the per-row
          dialog above (same warning copy, same reason-required guard)
          but applies the typed reason to every selected funds_dispersed
          ticket sequentially and shows a "Reversing N of M…" progress
          line so the admin knows the loop is alive. Failures stay
          ticked for retry; successes drop out of the selection. */}
      <Dialog
        open={bulkReverseOpen}
        onOpenChange={(open) => {
          // Don't let the admin close the dialog mid-loop, otherwise the
          // progress indicator vanishes while reversals are still in
          // flight and they'll think nothing happened.
          if (bulkReverseProgress) return;
          setBulkReverseOpen(open);
          if (!open) setBulkReverseReason("");
        }}
      >
        <DialogContent className={isVendor ? "vendor-workspace-page app-dialog" : undefined}>
          <DialogHeader>
            <DialogTitle>
              {t("tickets.bulkReverseTitle", {
                count: selectedReversibleIds.length,
                defaultValue: "Reverse {{count}} payment(s)?",
              })}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {t("tickets.bulkReverseHelp", {
                count: selectedReversibleIds.length,
                defaultValue:
                  "The same reason will be recorded on every reversal's audit trail. Each ticket will return to Approved.",
              })}
            </p>
            <div>
              <Label htmlFor="ap-bulk-reverse-reason">
                {t("ticketDetail.reverseFundsReason")}
              </Label>
              <Textarea
                id="ap-bulk-reverse-reason"
                value={bulkReverseReason}
                onChange={(e) => setBulkReverseReason(e.target.value)}
                placeholder={t("ticketDetail.reverseFundsReasonPlaceholder")}
                rows={3}
                disabled={bulkReverseProgress !== null}
                data-testid="input-ap-bulk-reverse-funds-reason"
              />
              {!bulkReverseReason.trim() && (
                <p className="text-xs text-muted-foreground mt-1">
                  {t("ticketDetail.reverseFundsReasonRequired")}
                </p>
              )}
            </div>
            {bulkReverseProgress && (
              <p
                className="text-xs text-muted-foreground"
                data-testid="text-bulk-reverse-progress"
              >
                {t("tickets.bulkReverseProgress", {
                  done: bulkReverseProgress.done,
                  total: bulkReverseProgress.total,
                  defaultValue: "Reversing {{done}} of {{total}}…",
                })}
                {bulkReverseProgress.failures > 0 && (
                  <>
                    {" "}
                    <span className="text-red-600">
                      {t("tickets.bulkReverseFailuresInline", {
                        count: bulkReverseProgress.failures,
                        defaultValue: "{{count}} failed so far",
                      })}
                    </span>
                  </>
                )}
              </p>
            )}
          </div>
          <DialogFooter>
            <PillButton
              color="red"
              onClick={() => {
                setBulkReverseOpen(false);
                setBulkReverseReason("");
              }}
              disabled={bulkReverseProgress !== null}
              data-testid="button-ap-cancel-bulk-reverse-funds"
            >
              {t("common.cancel")}
            </PillButton>
            <PngPillButton
              color="red"
              onClick={handleBulkReverseFundsDispersal}
              disabled={
                bulkReverseProgress !== null ||
                !bulkReverseReason.trim() ||
                selectedReversibleIds.length === 0
              }
              data-testid="button-ap-confirm-bulk-reverse-funds"
            >
              {bulkReverseProgress
                ? t("tickets.bulkReverseSubmitting", {
                    done: bulkReverseProgress.done,
                    total: bulkReverseProgress.total,
                    defaultValue: "Reversing {{done}}/{{total}}…",
                  })
                : t("tickets.bulkReverseConfirm", {
                    count: selectedReversibleIds.length,
                    defaultValue: "Reverse {{count}} payment(s)",
                  })}
            </PngPillButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
