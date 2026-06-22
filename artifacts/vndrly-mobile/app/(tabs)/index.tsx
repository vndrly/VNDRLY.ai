import { Feather } from "@expo/vector-icons";
import * as Notifications from "expo-notifications";
import { router, useFocusEffect } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  Modal,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useScreenTopPadding } from "@/lib/screen-insets";

import { formatTicketTrackingNumber } from "@workspace/db/format";

import AuthedImage from "@/components/AuthedImage";
import ForemanQuickActions from "@/components/ForemanQuickActions";
import ForemanScheduleTicketsModal from "@/components/ForemanScheduleTicketsModal";
import FreshnessPill from "@/components/FreshnessPill";
import HeaderRefreshPillButton from "@/components/HeaderRefreshPillButton";
import LayeredPillButton from "@/components/LayeredPillButton";
import SafetyTrainingBanner from "@/components/SafetyTrainingBanner";
import SafetyDashboardCard from "@/components/SafetyDashboardCard";
import { SCREEN_ROOT_BACKGROUND } from "@/lib/nav-pane-tokens";
import LayeredPortalLogo from "@/components/LayeredPortalLogo";
import { shouldUseLayeredPortalLogo } from "@/lib/portal-branding";
import NudgeFlashOverlay from "@/components/NudgeFlashOverlay";
import { useAuth } from "@/hooks/use-auth";
import { useTicketNudgeFlash } from "@/hooks/useTicketNudgeFlash";
import type { MembershipSummary } from "@/lib/auth";
import { useBrand } from "@/hooks/use-brand";
import { useColors } from "@/hooks/useColors";
import { useTicketsRateLimitGate } from "@/hooks/use-tickets-rate-limit-gate";
import { apiFetch } from "@/lib/api";
import { type MobileOpenTicket, type PortalTicketRow, fetchPortalTicketsForHome, mapPortalTicket } from "@/lib/portal-tickets";
import {
  isFieldEmployeeUser,
  isForemanEmployeeUser,
  isOfficeMobileViewer,
  isPartnerOfficeUser,
  isVendorOfficeUser,
  isAdminOfficeUser,
} from "@/lib/mobile-viewer";
import { VNDRLY_LOGO_SQUARE } from "@/lib/vndrly-brand-assets";
import { setHomeBadge } from "@/lib/tabBadges";
import { syncAppIconBadge } from "@/lib/notificationBadge";
import { isRateLimited, noteRateLimit } from "@/lib/rateLimitGate";
import {
  isTicketsRateLimited,
  noteTicketsRateLimit,
} from "@/lib/ticketsRateLimitGate";
import {
  ticketStaleDays,
  ticketStatusLabel,
  ticketStatusPillStyle,
} from "@/lib/ticketStatusLabels";
import { PILL_CHIP_LAYOUT, PILL_TEXT, SCREEN_SUBTITLE_TEXT, SCREEN_TITLE_TEXT, TEXT_SHADOW } from "@/lib/pill-doctrine";

type OpenTicket = MobileOpenTicket;

export default function HomeScreen() {
  const colors = useColors();
  const brand = useBrand();
  const { t } = useTranslation();
  const {
    user: me,
    activeMembership,
    activeMembershipId,
    // Defensive defaults so legacy useAuth mocks (which only stub user +
    // activeMembership) keep rendering after Task #187 added the switcher.
    availableMemberships = [],
    switchContext = async () => {
      throw new Error("switchContext not provided");
    },
  } = useAuth();
  const topPadding = useScreenTopPadding();
  const [tickets, setTickets] = useState<OpenTicket[]>([]);
  // Task #498 — recent history rows used to broaden adjacent-ticket CTA
  // eligibility to "currently assigned to OR recently checked-in to a
  // site" per the task spec. We only need the most recent few rows
  // (the CTA picks the freshest one with a `siteLocationId` and a
  // checkout within the last 4 hours), so the regular /api/field/history
  // limit of 100 is plenty. We tolerate any fetch failure silently —
  // the CTA simply degrades to the open-tickets-only path.
  const [recentHistory, setRecentHistory] = useState<{
    id: number;
    siteLocationId: number | null;
    siteName: string | null;
    checkOutTime: string | null;
  }[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [pendingScheduleCount, setPendingScheduleCount] = useState(0);
  const [schedulePickerOpen, setSchedulePickerOpen] = useState(false);
  // Task #630: brief confirmation toast that appears when a foreground
  // `ticket_unblocked` push arrives while the worker is on the open-
  // tickets list. Mirrors the detail-screen toast added in Task #623 so
  // a worker who isn't on the affected ticket's detail screen still
  // gets a clear signal that the office restored their access. The
  // payload includes the formatted tracking number so the worker knows
  // which ticket was unblocked.
  const [crewToastMessage, setCrewToastMessage] = useState<string | null>(null);
  const [restoredToastMessage, setRestoredToastMessage] = useState<string | null>(
    null,
  );
  const [nudgeToastMessage, setNudgeToastMessage] = useState<string | null>(null);
  const { nudgeFlashingTicketIds, handlePushData } = useTicketNudgeFlash({
    enabled: !!me,
    onNudge: (ticketId) => {
      setNudgeToastMessage(
        t("tickets.nudgeReceivedToastForList", {
          ticket: formatTicketTrackingNumber(ticketId),
        }),
      );
    },
  });
  // Task #669: brief "Refreshed" confirmation toast for manual refresh
  // (header button or pull-to-refresh). Mirrors the web LiveConnectionPill's
  // "refreshed" state from Task #667 — the user gets the same visible
  // confirmation that their data is now current. Auto-dismisses after ~3s.
  // Pull-to-refresh and the header button both flip this on success so
  // foremen on either affordance see the same cue.
  const [refreshedToastVisible, setRefreshedToastVisible] = useState(false);
  // Task #691 — most-recent error from `load()`. Drives the rate-limit
  // gate hook below so the home/dashboard tab pauses + surfaces the
  // same "reconnecting" affordance the ticket detail screen uses
  // (Task #686) when the per-session limiter (Task #675) trips on the
  // field endpoints. The field-specific endpoints (/api/field/open-tickets,
  // /api/field/history, /api/field/open-tickets/:id) aren't covered by
  // the limiter today, but the web app already assumes parity for the
  // /api/tickets reads it polls, so the moment the server team extends
  // the same per-session cap to the field endpoints this screen will
  // pause cleanly instead of falling back to a generic alert + tight
  // retry that would just re-trip the limit.
  const [loadError, setLoadError] = useState<unknown>(null);
  // Direct Partner→Vendor work offers (Task: direct assignments). Vendor
  // admins / vendor field employees who own a vendor org membership see a
  // Pending section above the open-tickets list with Commit / Pass actions.
  // We use the shared `apiFetch` helper rather than the generated hooks to
  // stay consistent with the rest of this screen.
  type PendingDirectAssignment = {
    id: number;
    partnerId: number;
    siteLocationId: number;
    vendorId: number;
    siteName: string;
    partnerName: string;
    vendorName: string;
    scopeOfWork: string | null;
    startDate: string;
    endDate: string;
    status: string;
    passReason: string | null;
  };
  const [pendingDirectAssignments, setPendingDirectAssignments] = useState<
    PendingDirectAssignment[]
  >([]);
  const [directBusyId, setDirectBusyId] = useState<number | null>(null);
  const [passDialogId, setPassDialogId] = useState<number | null>(null);
  const [passReason, setPassReason] = useState("");
  const { rateLimited, retryAfterSeconds } = useTicketsRateLimitGate(loadError);
  // Task #187 — drives the inline org-switcher bottom sheet that opens
  // when a dual-role user taps the Partner/Vendor pill on the Home
  // header. Putting the switcher one tap away from the most-used screen
  // saves the two extra taps a foreman would otherwise spend going to
  // Profile every time they need to flip context. Single-membership
  // users never see the sheet (the pill stays non-interactive), so
  // there's no behavior change for them.
  const [switcherOpen, setSwitcherOpen] = useState(false);
  // Tracks which membership row is mid-`switchContext` so that row can
  // show a busy indicator while the others dim. Mirrors the same
  // affordance the Profile screen uses so the visual cue is consistent
  // across both entry points.
  const [switchingId, setSwitchingId] = useState<number | null>(null);

  // Task #678 — timestamp of the most recent successful `load()`. Drives
  // the FreshnessPill in the header so foremen can see at a glance how
  // current the on-screen list is. Bumped only on a confirmed successful
  // primary fetch (the `ok` branch in `load()`); failed/silent loads
  // leave it untouched so the pill correctly flips to "stale" /
  // "reconnecting" instead of falsely declaring "Live".
  const [lastLoadedAt, setLastLoadedAt] = useState<number | null>(null);

  // Prefer the active membership's org name (mirrors the web sidebar
  // pill). Fall back to a `/api/field/me` lookup for legacy field users
  // whose memberships haven't been backfilled yet.
  const [fallbackOrgName, setFallbackOrgName] = useState<string | null>(null);
  useEffect(() => {
    if (activeMembership) {
      setFallbackOrgName(null);
      return;
    }
    if (me?.role !== "field_employee") {
      let cancelled = false;
      apiFetch<{ vendorName?: string | null; partnerName?: string | null }>("/api/field/me")
        .then((fm) => {
          if (!cancelled) {
            setFallbackOrgName(fm?.vendorName ?? fm?.partnerName ?? null);
          }
        })
        .catch(() => undefined);
      return () => {
        cancelled = true;
      };
    }
    let cancelled = false;
    apiFetch<{ vendorName: string | null }>("/api/field/me")
      .then((fm) => {
        if (!cancelled) setFallbackOrgName(fm?.vendorName ?? null);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [activeMembership, me?.role]);

  const orgName = activeMembership?.orgName ?? fallbackOrgName;
  const orgType: "partner" | "vendor" | null =
    activeMembership?.orgType ??
    (me?.role === "field_employee" || me?.role === "vendor" ? "vendor" : me?.role === "partner" ? "partner" : null);

  // The mobile home screen has historically been a field-employee
  // workspace: "New Ticket", "History", and the adjacent-ticket CTA
  // all assume a vendor_people row backs the session. We now also let
  // vendor admins log in to see all open tickets across their team
  // (read-only). Use this flag everywhere those field-only affordances
  // would otherwise create dead ends or 401 errors.
  const isFieldEmployee = isFieldEmployeeUser(me);
  const isForemanEmployee = isForemanEmployeeUser(me);
  const isOfficeViewer = isOfficeMobileViewer(me);
  const isPartnerViewer = isPartnerOfficeUser(me);
  const isVendorOfficeViewer = isVendorOfficeUser(me);
  const isAdminViewer = isAdminOfficeUser(me);
  // Direct assignments are vendor-side (offered to a vendor org). Surface
  // for any user whose active org is a vendor (admin, member, or field).
  const isVendorViewer = orgType === "vendor";

  const loadPendingDirect = useCallback(async () => {
    if (!isVendorViewer) return;
    try {
      const data = await apiFetch<PendingDirectAssignment[]>(
        "/api/direct-assignments?status=pending",
      );
      setPendingDirectAssignments(Array.isArray(data) ? data : []);
    } catch {
      // Silent — the section just stays empty if the fetch fails. Pull-
      // to-refresh re-tries on demand.
    }
  }, [isVendorViewer]);

  const respondDirect = useCallback(
    async (
      id: number,
      action: "commit" | "pass",
      reason?: string | null,
    ): Promise<boolean> => {
      setDirectBusyId(id);
      try {
        await apiFetch(`/api/direct-assignments/${id}/${action}`, {
          method: "POST",
          body:
            action === "pass"
              ? JSON.stringify({ reason: reason ?? null })
              : undefined,
        });
        setPendingDirectAssignments((prev) => prev.filter((a) => a.id !== id));
        return true;
      } catch {
        Alert.alert(
          t("common.error"),
          action === "commit"
            ? t("directAssignment.commitFailedToast")
            : t("directAssignment.passFailedToast"),
        );
        return false;
      } finally {
        setDirectBusyId(null);
      }
    },
    [t],
  );

  const loadUnread = useCallback(async () => {
    // Task #699 — skip the unread-count poll while the notifications
    // resource is parked by a 429. Otherwise this 60s-on-focus poll
    // (and the surgical post-push refreshes) would re-trip the limiter
    // every time, leaving the user stuck in a slow-down loop.
    if (isRateLimited("notifications.rate_limited")) return;
    try {
      const r = await apiFetch<{ count: number }>("/api/notifications/unread-count");
      setUnreadCount(r?.count ?? 0);
      void syncAppIconBadge();
    } catch (e) {
      // Park the badge poll if the limiter tripped. The notifications
      // screen instance also subscribes to this same resource via the
      // shared cooldown, so both sides park together.
      noteRateLimit(e, "notifications.rate_limited");
      // Silent otherwise — header badge just hides if unavailable.
    }
  }, []);

  const loadPendingSchedule = useCallback(async () => {
    if (!isForemanEmployee) return;
    try {
      const r = await apiFetch<{ tickets?: Array<{ myAckStatus?: string }> }>(
        "/api/me/upcoming-schedule?days=14",
      );
      const pending = (r?.tickets ?? []).filter((tk) => tk.myAckStatus === "pending").length;
      setPendingScheduleCount(pending);
    } catch {
      setPendingScheduleCount(0);
    }
  }, [isForemanEmployee]);

  // `silent` callers (e.g. Task #630's push-triggered refresh) suppress
  // the failure Alert so a transient network blip doesn't pop a blocking
  // modal on top of the brief "assignment restored" confirmation toast.
  // Returns `true` only when the primary `/api/field/open-tickets` fetch
  // succeeded — Task #669 callers gate the "Refreshed" confirmation toast
  // on this so a failed manual refresh never falsely confirms.
  const load = useCallback(
    async ({ silent = false }: { silent?: boolean } = {}): Promise<boolean> => {
      let ok = false;
      try {
        // Task #691: short-circuit if the shared tickets rate-limit
        // cooldown is already active. Firing another /api/field/...
        // request now would just re-trip the limiter and indefinitely
        // extend the window. The hook above re-renders when the
        // cooldown expires; the recovery effect below then re-invokes
        // load() so the screen converges naturally.
        if (isTicketsRateLimited()) return false;
        const data = isOfficeViewer
          ? await fetchPortalTicketsForHome()
          : await apiFetch<OpenTicket[]>(
              isForemanEmployee
                ? "/api/field/open-tickets?vendorWide=1"
                : "/api/field/open-tickets",
            );
        setTickets(data || []);
        // Task #691: a successful load means we're no longer in an
        // error state — clear so the gate hook doesn't re-fire on
        // stale references.
        setLoadError(null);
        // Task #678 — bump the freshness timestamp only on a confirmed
        // primary fetch. Auxiliary fetches (history, unread count) are
        // best-effort and don't represent the on-screen ticket list, so
        // leaving the pill green when only the history fetch succeeded
        // would be misleading.
        setLastLoadedAt(Date.now());
        ok = true;
      } catch (e) {
        // Task #691: arm the rate-limit gate BEFORE deciding whether
        // to alert. We always feed the error through `setLoadError`
        // so the hook can park the screen for the cooldown — and we
        // suppress the modal alert on a 429 (silent or not), since
        // the bottom-of-screen reconnecting toast is the right
        // affordance and a blocking modal on top of it would be
        // noisy and redundant.
        const rlSeconds = noteTicketsRateLimit(e);
        setLoadError(e);
        if (!silent && rlSeconds == null) {
          Alert.alert(t("common.error"), t("tickets.errorLoadOpen"));
        }
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
      // Task #498 — fire-and-forget refresh of recent history so the
      // adjacent-ticket CTA can also fire when the field employee just
      // checked out (within the last 4 hours) and no longer has an
      // open ticket on that site. Tolerated silently — a failure here
      // simply means the CTA falls back to the open-tickets-only path.
      // Vendor admins don't get the adjacent-ticket CTA at all (it
      // initiates a new field-employee ticket on behalf of the caller),
      // so skip the history fetch for them — it would 401 anyway.
      // Task #691: also skip while the tickets rate-limit cooldown is
      // active — /api/field/history shares the same per-session budget,
      // and there's no point burning a slot on the optional CTA hint
      // while we're trying to recover the primary list.
      if (isFieldEmployee && !isTicketsRateLimited()) {
        void (async () => {
          try {
            const hist = await apiFetch<typeof recentHistory>(
              "/api/field/history",
            );
            setRecentHistory(hist || []);
          } catch (e) {
            // Soft-fail for the CTA — but if this call is what tripped
            // the limiter, still arm the shared cooldown so the next
            // primary load() short-circuits instead of re-tripping it.
            noteTicketsRateLimit(e);
          }
        })();
      }
      void loadUnread();
      void loadPendingSchedule();
      // Direct work assignments inbox refresh — vendor-only, silent. The
      // UI just hides the section when empty so any failure here is fine.
      void loadPendingDirect();
      return ok;
    },
    [loadUnread, loadPendingDirect, loadPendingSchedule, isFieldEmployee, isForemanEmployee, isOfficeViewer, t],
  );

  // Task #668 — surgical per-row refresh used by the foreground push
  // path. The web tickets page uses the same pattern for both
  // `ticket.unblocked` (Task #656) and `location.ping` lifecycle pings
  // (Task #663): when a single ticket transitions, fetch only that
  // row via its per-id endpoint and replace it in place rather than
  // refetching the entire list. On a slow network with many open
  // tickets, the difference between a single ~1KB row GET and a
  // full list GET (which carries every row plus joins) is large
  // enough to matter — and field employees are exactly the audience
  // most likely to be on a poor link.
  //
  // If the ticket isn't in the current view we no-op (the row would
  // appear via the regular `load()` cycle if it became eligible). On
  // any failure (network blip, 5xx, 404 because the row is no longer
  // open for this employee) we fall back to the legacy full refresh
  // so the list still converges. The 404 path also covers the case
  // where the office moved the ticket to another field employee or
  // closed it in another tab — `load()` will then drop it from local
  // state on its own.
  //
  // We mirror the current `tickets` array into a ref so the push
  // listener (which is set up once and captures only stable deps)
  // can read the *current* visible-row set without re-subscribing
  // every render and without depending on setState updater timing.
  const ticketsRef = React.useRef<OpenTicket[]>(tickets);
  useEffect(() => {
    ticketsRef.current = tickets;
  }, [tickets]);

  // Tab badge: number of open tickets in the field employee's queue.
  // Counts pending direct assignments too so the badge reflects the
  // total "you have stuff to deal with" load, not just the already-
  // accepted rows.
  useEffect(() => {
    setHomeBadge(tickets.length + pendingDirectAssignments.length);
  }, [tickets.length, pendingDirectAssignments.length]);

  const refreshTicketRow = useCallback(
    async (ticketId: number): Promise<void> => {
      const inView = ticketsRef.current.some((tk) => tk.id === ticketId);
      if (!inView) return;
      // Task #691: don't burn a per-id GET into an active tickets
      // rate-limit cooldown — the row will converge naturally on the
      // next normal load() once the cooldown expires (the recovery
      // effect below re-fires load when `rateLimited` flips back to
      // false). Skipping here also avoids feeding stale errors back
      // into the gate hook through the silent load() fallback.
      if (isTicketsRateLimited()) return;
      try {
        const fresh = isOfficeViewer
          ? mapPortalTicket(await apiFetch<PortalTicketRow>(`/api/tickets/${ticketId}`))
          : await apiFetch<OpenTicket>(`/api/field/open-tickets/${ticketId}`);
        if (!fresh || typeof fresh.id !== "number") {
          await load({ silent: true });
          return;
        }
        setTickets((prev) =>
          prev.some((tk) => tk.id === ticketId)
            ? prev.map((tk) => (tk.id === ticketId ? fresh : tk))
            : prev,
        );
      } catch (e) {
        // Task #691: if the surgical fetch was the call that tripped
        // the limiter, arm the shared cooldown so load() short-
        // circuits instead of immediately re-tripping it.
        noteTicketsRateLimit(e);
        // Surgical fetch failed — fall back to the legacy full refresh
        // so the row still converges. `silent: true` keeps the failure
        // Alert suppressed so a transient blip doesn't pop a modal on
        // top of the assignment-restored confirmation toast.
        await load({ silent: true });
      }
      void loadUnread();
    },
    [load, loadUnread, isOfficeViewer],
  );

  useFocusEffect(
    useCallback(() => {
      load();
      void loadPendingSchedule();
    }, [load, loadPendingSchedule]),
  );

  // Task #691: auto-recover from a tickets rate-limit cooldown.
  // If `load()` short-circuited because the shared cooldown was
  // already active (e.g. the background live-location reporter or the
  // ticket detail screen tripped the limit just before this tab
  // gained focus), the home tab would otherwise sit on the previous
  // (or empty) list with the reconnecting toast forever — no further
  // call site would re-fire load() until the next pull-to-refresh.
  // The hook flips `rateLimited` back to false the moment the
  // cooldown expires; that's our cue to re-run load() so the list
  // converges on its own. Mirrors the detail screen's recovery
  // effect from Task #686.
  //
  // We track the previous `rateLimited` value in a ref so this only
  // fires on a true→false transition. Without that guard the effect
  // would also fire on the initial render (`rateLimited` starts at
  // false), double-loading alongside the focus effect above.
  const prevRateLimitedRef = React.useRef(false);
  useEffect(() => {
    const prev = prevRateLimitedRef.current;
    prevRateLimitedRef.current = rateLimited;
    if (!prev) return; // wasn't parked → nothing to recover from
    if (rateLimited) return; // still parked
    void load();
  }, [rateLimited, load]);

  // Task #630: foreground push toasts (assignment restored, crew, schedule).
  //
  // Task #592 fans out a `ticket_unblocked` push the moment the office
  // restores a vendor's site/work-type assignment. Task #623 surfaces a
  // brief in-screen confirmation on the ticket detail screen for workers
  // who are *on* that screen when the push lands. Workers on the open-
  // tickets list got no signal at all — the assignment-removed banner
  // only lives on the detail screen, so they never knew their access
  // was restored without re-opening the ticket. Mirror the detail-
  // screen toast here so the loop closes everywhere the worker might be
  // looking. The toast names the affected tracking number so the worker
  // knows which ticket was unblocked (helpful when several tickets are
  // in flight). It is non-blocking and auto-dismisses after ~3s.
  //
  // We also kick off a refresh so the row itself reflects any status
  // change that came along with the unblock — e.g. a ticket the office
  // restored may now be visible/actionable in a different way.
  //
  // Task #668 — use the surgical per-row refresh instead of refetching
  // the entire `/api/field/open-tickets` list. The push payload carries
  // the affected `ticketId`, and the row's status pill / labels come
  // from the same shape the per-id endpoint returns, so a single ~1KB
  // GET is sufficient. On a slow link with several open tickets this
  // is a meaningful win over the legacy full-list refetch. Mirrors the
  // web tickets page's per-row refresh shipped in Tasks #656 / #663.
  useEffect(() => {
    let sub: Notifications.EventSubscription | undefined;
    try {
      sub = Notifications.addNotificationReceivedListener((n) => {
      const data = n.request.content.data as Record<string, unknown> | null;
      if (!data || typeof data !== "object") return;

      void syncAppIconBadge();

      if (data.type === "workflow_nudge") {
        handlePushData(data);
        return;
      }

      const incomingTicketId =
        typeof data.ticketId === "number"
          ? data.ticketId
          : typeof data.ticketId === "string"
            ? Number(data.ticketId)
            : null;
      const validTicketId =
        incomingTicketId != null &&
        Number.isFinite(incomingTicketId) &&
        Number.isInteger(incomingTicketId) &&
        incomingTicketId >= 1
          ? incomingTicketId
          : null;

      if (data.type === "crew_added") {
        setCrewToastMessage(
          t("notifications.toast.crewAdded", {
            ticket: validTicketId
              ? formatTicketTrackingNumber(validTicketId)
              : t("notifications.toast.trackingFallback"),
          }),
        );
        void loadUnread();
        if (validTicketId) void refreshTicketRow(validTicketId);
        return;
      }

      if (data.type === "schedule_changed" || data.type === "ticket_scheduled") {
        setCrewToastMessage(
          t("notifications.toast.scheduleChanged", {
            ticket: validTicketId
              ? formatTicketTrackingNumber(validTicketId)
              : t("notifications.toast.trackingFallback"),
          }),
        );
        void loadUnread();
        if (validTicketId) void refreshTicketRow(validTicketId);
        return;
      }

      if (data.type !== "ticket_unblocked") return;
      if (!validTicketId) return;
      setRestoredToastMessage(
        t("tickets.assignmentRestoredToastForList", {
          ticket: formatTicketTrackingNumber(validTicketId),
        }),
      );
      void refreshTicketRow(validTicketId);
    });
    } catch {
      return;
    }
    return () => sub?.remove();
  }, [refreshTicketRow, t, handlePushData, loadUnread]);

  useEffect(() => {
    if (!crewToastMessage) return;
    const handle = setTimeout(() => setCrewToastMessage(null), 3000);
    return () => clearTimeout(handle);
  }, [crewToastMessage]);

  useEffect(() => {
    if (!nudgeToastMessage) return;
    const handle = setTimeout(() => setNudgeToastMessage(null), 3000);
    return () => clearTimeout(handle);
  }, [nudgeToastMessage]);

  // Task #630: auto-dismiss the restored confirmation after ~3s. The
  // toast is non-blocking and never requires manual dismissal.
  useEffect(() => {
    if (!restoredToastMessage) return;
    const handle = setTimeout(() => setRestoredToastMessage(null), 3000);
    return () => clearTimeout(handle);
  }, [restoredToastMessage]);

  // Task #669: auto-dismiss the "Refreshed" confirmation after ~3s.
  // Same cadence as the assignment-restored toast above so the two
  // never linger long enough to overlap visually.
  useEffect(() => {
    if (!refreshedToastVisible) return;
    const handle = setTimeout(() => setRefreshedToastVisible(false), 3000);
    return () => clearTimeout(handle);
  }, [refreshedToastVisible]);

  // Task #669: manual refresh entry point shared by the header refresh
  // button and the existing pull-to-refresh gesture. Mirrors the web
  // dispatcher's "Refresh now" flow (Task #667): trigger the same fetch
  // the auto-poll uses, then flash a brief "Refreshed" toast on success
  // so the user knows the list is current. Failures fall through to the
  // existing Alert from `load()` so we never confirm a stale view.
  const onRefresh = useCallback(() => {
    setRefreshing(true);
    void (async () => {
      const ok = await load();
      if (ok) setRefreshedToastVisible(true);
    })();
  }, [load]);

  // Header refresh button handler. We intentionally don't show the
  // RefreshControl spinner here — that affordance belongs to the
  // pull gesture. Instead the icon button fades while the request is
  // in flight (via the disabled prop + opacity) and the toast confirms
  // completion the same way the pull gesture does.
  const [headerRefreshing, setHeaderRefreshing] = useState(false);
  const onHeaderRefresh = useCallback(() => {
    if (headerRefreshing || refreshing) return;
    setHeaderRefreshing(true);
    void (async () => {
      try {
        const ok = await load();
        if (ok) setRefreshedToastVisible(true);
      } finally {
        setHeaderRefreshing(false);
      }
    })();
  }, [headerRefreshing, refreshing, load]);

  // Task #187 — handler for the org-switcher bottom sheet. Mirrors the
  // Profile screen's picker (artifacts/vndrly-mobile/app/(tabs)/profile.tsx):
  // tapping the active membership is a no-op; tapping any other
  // membership flips the active context via the shared `useAuth`
  // `switchContext` and dismisses the sheet so the user immediately
  // sees the Home screen reflect the new org. Failures pop the same
  // localized alert the Profile picker uses so the visual + textual
  // feedback is consistent across both entry points.
  const onPickContext = useCallback(
    async (m: MembershipSummary) => {
      if (m.id === activeMembershipId) {
        setSwitcherOpen(false);
        return;
      }
      setSwitchingId(m.id);
      try {
        await switchContext(m.id);
        setSwitcherOpen(false);
      } catch (e) {
        Alert.alert(
          t("common.error"),
          e instanceof Error ? e.message : t("auth.switchFailed"),
        );
      } finally {
        setSwitchingId(null);
      }
    },
    [activeMembershipId, switchContext, t],
  );

  // The pill only behaves like a switcher for users with more than one
  // membership — single-membership users keep the existing static pill
  // so we don't add a tap target that does nothing.
  const canSwitchOrg = availableMemberships.length >= 2;

  const badgeText = String(unreadCount);

  return (
    <View style={[styles.container, { backgroundColor: SCREEN_ROOT_BACKGROUND }]}>
      <View
        style={[
          styles.brandRow,
          { borderBottomColor: colors.border, paddingTop: topPadding },
        ]}
      >
        <View style={styles.brandLeft}>
          {brand.isOrgBranded && (brand.logoSquareUrl || brand.logoUrl) ? (
            shouldUseLayeredPortalLogo(brand) ? (
              <LayeredPortalLogo
                uri={(brand.logoSquareUrl ?? brand.logoUrl) as string}
                fallback={
                  <View
                    style={[
                      styles.brandLogo,
                      {
                        backgroundColor: brand.primary,
                        borderRadius: 12,
                        alignItems: "center",
                        justifyContent: "center",
                      },
                    ]}
                    accessibilityLabel={brand.name ?? t("home.brandWordmark")}
                  >
                    <Text style={{ color: "#ffffff", fontFamily: "Inter_700Bold", fontSize: 32 }}>
                      {(brand.name?.[0] ?? "V").toUpperCase()}
                    </Text>
                  </View>
                }
                accessibilityLabel={brand.name ?? t("home.brandWordmark")}
              />
            ) : (
              <AuthedImage
                uri={(brand.logoSquareUrl ?? brand.logoUrl) as string}
                fallback={
                  <View
                    style={[
                      styles.brandLogo,
                      {
                        backgroundColor: brand.primary,
                        borderRadius: 12,
                        alignItems: "center",
                        justifyContent: "center",
                      },
                    ]}
                    accessibilityLabel={brand.name ?? t("home.brandWordmark")}
                  >
                    <Text style={{ color: "#ffffff", fontFamily: "Inter_700Bold", fontSize: 32 }}>
                      {(brand.name?.[0] ?? "V").toUpperCase()}
                    </Text>
                  </View>
                }
                style={styles.brandLogo}
                resizeMode="contain"
                accessibilityLabel={brand.name ?? t("home.brandWordmark")}
              />
            )
          ) : (
            <Image
              source={VNDRLY_LOGO_SQUARE}
              style={styles.brandLogo}
              resizeMode="contain"
              accessibilityLabel={t("home.brandWordmark")}
            />
          )}
          {(me?.displayName || orgName) ? (
            <View style={styles.brandIdentity}>
              <Text
                style={[styles.brandVendor, { color: colors.mutedForeground }]}
                numberOfLines={1}
                ellipsizeMode="tail"
              >
                {t("home.brandWordmark")}
              </Text>
              {me?.displayName ? (
                <Text
                  style={[styles.brandName, { color: colors.foreground }]}
                  numberOfLines={1}
                  ellipsizeMode="tail"
                >
                  {me.displayName}
                </Text>
              ) : null}
              {orgName ? (
                // Task #187 — when the user belongs to more than one
                // org, the row becomes a tappable switcher that opens
                // a bottom sheet listing every membership. Single-
                // membership users keep the previous static View so
                // the pill doesn't advertise an interaction that
                // wouldn't do anything. We pick TouchableOpacity (the
                // same primitive the existing header buttons use) so
                // the press feedback feels consistent with the rest
                // of the row, and we extend the hit area with
                // `hitSlop` because the pill itself is small.
                canSwitchOrg ? (
                  <TouchableOpacity
                    onPress={() => setSwitcherOpen(true)}
                    accessibilityRole="button"
                    accessibilityLabel={t("auth.switchOrgOpenA11y", {
                      org: orgName,
                    })}
                    accessibilityHint={t("auth.switchOrgOpenHint")}
                    style={styles.orgRow}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    testID="button-open-org-switcher"
                  >
                    <Text
                      style={[styles.brandVendor, { color: colors.mutedForeground, flexShrink: 1 }]}
                      numberOfLines={1}
                      ellipsizeMode="tail"
                      testID="text-active-org-name"
                    >
                      {orgName}
                    </Text>
                    {orgType && !isFieldEmployee ? (
                      <View
                        style={[
                          styles.orgPill,
                          orgType === "partner" ? styles.orgPillPartner : styles.orgPillVendor,
                        ]}
                        testID={`badge-active-org-${orgType}`}
                      >
                        <Text style={styles.orgPillText}>
                          {orgType === "partner" ? t("auth.partner") : t("auth.vendor")}
                        </Text>
                      </View>
                    ) : null}
                    {/* Affordance hint that the pill is interactive — the
                        chevron mirrors the iOS/Android convention for a
                        control that opens a sheet of options. */}
                    <Feather
                      name="chevron-down"
                      size={14}
                      color={colors.mutedForeground}
                    />
                  </TouchableOpacity>
                ) : (
                  <View style={styles.orgRow}>
                    <Text
                      style={[styles.brandVendor, { color: colors.mutedForeground, flexShrink: 1 }]}
                      numberOfLines={1}
                      ellipsizeMode="tail"
                      testID="text-active-org-name"
                    >
                      {orgName}
                    </Text>
                    {orgType && !isFieldEmployee ? (
                      <View
                        style={[
                          styles.orgPill,
                          orgType === "partner" ? styles.orgPillPartner : styles.orgPillVendor,
                        ]}
                        testID={`badge-active-org-${orgType}`}
                      >
                        <Text style={styles.orgPillText}>
                          {orgType === "partner" ? t("auth.partner") : t("auth.vendor")}
                        </Text>
                      </View>
                    ) : null}
                  </View>
                )
              ) : null}
            </View>
          ) : null}
        </View>
        {!isForemanEmployee ? (
          <TouchableOpacity
            onPress={() => router.push("/notifications")}
            accessibilityLabel={t("nav.notifications")}
            accessibilityHint={
              unreadCount > 0 ? t("home.unreadNotifications", { count: unreadCount }) : t("home.noUnreadNotifications")
            }
            style={styles.bellBtn}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Feather name="bell" size={28} color="#ffffff" />
            {unreadCount > 0 ? (
              <View style={[styles.badge, { backgroundColor: "#dc2626", borderColor: colors.background }]}>
                <Text style={[styles.badgeText, { color: "#ffffff" }]} numberOfLines={1}>
                  {badgeText}
                </Text>
              </View>
            ) : null}
          </TouchableOpacity>
        ) : null}
      </View>

      <View style={{ paddingHorizontal: 16, marginBottom: 12 }}>
        <SafetyTrainingBanner />
      </View>

      {(isPartnerViewer || isVendorOfficeViewer) && !isFieldEmployee ? (
        <View style={{ paddingHorizontal: 16 }}>
          <SafetyDashboardCard />
        </View>
      ) : null}

      {isForemanEmployee ? (
        <ForemanQuickActions
          unreadAlerts={unreadCount}
          pendingSchedule={pendingScheduleCount}
          onSchedulePress={() => setSchedulePickerOpen(true)}
        />
      ) : null}

      {isFieldEmployee ? (
        <View style={styles.activeJobsHeader}>
          <Text style={[styles.heading, { color: colors.foreground }]}>
            {isForemanEmployee ? t("foremanHome.activeJobs") : t("tickets.title")}
          </Text>
          <View style={styles.activeJobsActions}>
            <LayeredPillButton
              testID="button-tickets-history"
              onPress={() => router.push("/history")}
              inactive
              height={40}
              style={isForemanEmployee ? styles.foremanPillFull : styles.foremanPillHalf}
            >
              <Feather name="clock" size={14} color="#ffffff" style={styles.btnIconShadow} />
              <Text style={[styles.newBtnText, { color: "#ffffff" }]} numberOfLines={1}>
                {t("tickets.history")}
              </Text>
            </LayeredPillButton>
            {!isForemanEmployee ? (
              <LayeredPillButton
                testID="button-new-ticket"
                onPress={() => router.push("/new-ticket")}
                height={40}
                style={styles.foremanPillHalf}
              >
                <Feather name="plus" size={16} color="#ffffff" style={styles.btnIconShadow} />
                <Text style={[styles.newBtnText, { color: "#ffffff" }]} numberOfLines={1}>
                  {t("tickets.newTicket")}
                </Text>
              </LayeredPillButton>
            ) : null}
            <LayeredPillButton
              testID="button-safety-report"
              onPress={() => router.push("/safety-report")}
              inactive
              height={40}
              style={isForemanEmployee ? styles.foremanPillFull : styles.foremanPillHalf}
            >
              <Feather name="shield" size={14} color="#ffffff" style={styles.btnIconShadow} />
              <Text style={[styles.newBtnText, { color: "#ffffff" }]} numberOfLines={1}>
                {t("safety.reportTitle")}
              </Text>
            </LayeredPillButton>
            <LayeredPillButton
              testID="button-safety-my-reports"
              onPress={() => router.push("/safety-my-reports")}
              inactive
              height={36}
              style={{ marginTop: 8 }}
            >
              <Text style={[styles.newBtnText, { color: "#ffffff" }]} numberOfLines={1}>
                {t("safety.myReportsTitle")}
              </Text>
            </LayeredPillButton>
            <HeaderRefreshPillButton
              onPress={onHeaderRefresh}
              disabled={headerRefreshing || refreshing || rateLimited}
              loading={headerRefreshing}
              testID="button-refresh-tickets"
            />
          </View>
        </View>
      ) : (
        <>
          <View style={styles.headerRow}>
            <View style={{ flex: 1, marginRight: 8 }}>
              <Text style={[styles.heading, { color: colors.foreground }]} numberOfLines={1}>
                {isPartnerViewer
                  ? t("partnerHome.openTickets")
                  : isVendorOfficeViewer
                    ? t("vendorHome.openTickets")
                    : t("tickets.title")}
              </Text>
              {isOfficeViewer ? (
                <Text
                  style={[styles.officeSubtitle, { color: colors.mutedForeground }]}
                  numberOfLines={2}
                >
                  {isPartnerViewer
                    ? t("partnerHome.subtitle")
                    : isVendorOfficeViewer
                      ? t("vendorHome.subtitle")
                      : t("adminHome.subtitle")}
                </Text>
              ) : null}
            </View>
            <View style={styles.freshnessRow}>
              <FreshnessPill
                lastLoadedAt={lastLoadedAt}
                inFlight={loading || refreshing || headerRefreshing}
                errored={loadError != null}
                rateLimited={rateLimited}
                testID="tickets-freshness-pill"
              />
            </View>
          </View>
          <View style={styles.actionsRow}>
            <LayeredPillButton
              testID="button-tickets-history"
              onPress={() => router.push("/history")}
              inactive
              height={40}
              style={styles.officeActionPill}
            >
              <Feather name="clock" size={14} color="#ffffff" style={styles.btnIconShadow} />
              <Text style={[styles.newBtnText, { color: "#ffffff" }]} numberOfLines={1}>
                {t("tickets.history")}
              </Text>
            </LayeredPillButton>
            <LayeredPillButton
              testID="button-new-ticket"
              onPress={() => router.push("/new-ticket")}
              height={40}
              style={styles.officeActionPill}
            >
              <Feather name="plus" size={16} color="#ffffff" style={styles.btnIconShadow} />
              <Text style={[styles.newBtnText, { color: "#ffffff" }]} numberOfLines={1}>
                {t("tickets.newTicket")}
              </Text>
            </LayeredPillButton>
            <HeaderRefreshPillButton
              onPress={onHeaderRefresh}
              disabled={headerRefreshing || refreshing || rateLimited}
              loading={headerRefreshing}
              testID="button-refresh-tickets"
            />
          </View>
        </>
      )}

      {/*
        Task #498 — "Initiate adjacent ticket" CTA on the dashboard.
        Spec eligibility: the field employee is "currently assigned to
        OR recently checked-in to a site." We satisfy both halves:

        - "currently assigned" = any open ticket on a site
          (/api/field/open-tickets is already scoped to non-closed
          statuses, so we just need a siteLocationId on the row).
        - "recently checked-in" = the most recent history row whose
          checkOutTime is within the last RECENT_CHECKIN_WINDOW_MS.
          This covers the common case of a worker who just checked
          out of one ticket and is still physically on site, ready to
          open a parallel ticket on the same location.

        We prefer the open-ticket case because it's the freshest signal
        ("you're literally working there right now"), and only fall
        back to the recent-history case when no open row points at a
        site. Either way the CTA's destination is identical — the new-
        ticket form prefills `siteLocationId` and the server attributes
        the new ticket to the field employee as foreman by default.
      */}
      {(() => {
        // Vendor admins are read-only on mobile — they can't initiate
        // an adjacent ticket on a field employee's behalf, so the CTA
        // is hidden entirely for them. Field employees keep the
        // existing "currently assigned OR recently checked-in" eligibility.
        if (!isFieldEmployee) return null;
        const RECENT_CHECKIN_WINDOW_MS = 4 * 60 * 60 * 1000;
        const fromOpen = tickets.find((tk) => tk.siteLocationId != null);
        let activeSiteId: number | null = null;
        let activeSiteName: string | null = null;
        if (fromOpen) {
          activeSiteId = fromOpen.siteLocationId;
          activeSiteName = fromOpen.siteName ?? null;
        } else {
          const cutoff = Date.now() - RECENT_CHECKIN_WINDOW_MS;
          const fromHistory = recentHistory.find((h) => {
            if (h.siteLocationId == null || !h.checkOutTime) return false;
            const ts = Date.parse(h.checkOutTime);
            return Number.isFinite(ts) && ts >= cutoff;
          });
          if (fromHistory) {
            activeSiteId = fromHistory.siteLocationId;
            activeSiteName = fromHistory.siteName ?? null;
          }
        }
        if (activeSiteId == null) return null;
        const activeTicket = { siteLocationId: activeSiteId, siteName: activeSiteName };
        return (
          <View style={styles.adjacentRow}>
            <LayeredPillButton
              testID="button-initiate-adjacent-ticket"
              onPress={() =>
                router.push({
                  pathname: "/new-ticket",
                  params: {
                    siteId: String(activeTicket.siteLocationId),
                    adjacent: "1",
                  },
                })
              }
              height={44}
              style={styles.adjacentBtn}
            >
              <View style={styles.adjacentBtnTop}>
                <Feather name="link" size={14} color="#ffffff" style={styles.btnIconShadow} />
                <Text style={[styles.adjacentBtnText, { color: "#ffffff" }]}>
                  {t("tickets.initiateAdjacent")}
                </Text>
              </View>
              {activeTicket.siteName ? (
                <Text
                  style={[styles.adjacentBtnHint, { color: "rgba(255,255,255,0.85)" }]}
                  numberOfLines={1}
                >
                  {t("tickets.adjacentSiteHint", { site: activeTicket.siteName })}
                </Text>
              ) : null}
            </LayeredPillButton>
          </View>
        );
      })()}

      {/* Pending direct work assignments — vendor org sessions only.
          Shown above the open-tickets list so the offer is the first
          thing a vendor sees on the home tab. Hidden when empty. */}
      {isVendorViewer && pendingDirectAssignments.length > 0 ? (
        <View
          style={[
            styles.directSection,
            { borderColor: colors.border, backgroundColor: colors.card },
          ]}
          testID="section-pending-direct-assignments"
        >
          <Text style={[styles.directSectionTitle, { color: colors.foreground }]}>
            {t("directAssignment.vendorInboxTitle", {
              count: pendingDirectAssignments.length,
            })}
          </Text>
          {pendingDirectAssignments.map((a) => {
            const busy = directBusyId === a.id;
            return (
              <View
                key={a.id}
                style={[styles.directCard, { borderColor: colors.border }]}
                testID={`card-pending-direct-${a.id}`}
              >
                <Text style={[styles.directPartner, { color: colors.foreground }]}>
                  {a.partnerName}
                </Text>
                <Text style={[styles.directSite, { color: colors.mutedForeground }]}>
                  {a.siteName}
                </Text>
                <Text style={[styles.directDates, { color: colors.mutedForeground }]}>
                  {a.startDate} → {a.endDate}
                </Text>
                {a.scopeOfWork ? (
                  <Text
                    style={[styles.directScope, { color: colors.foreground }]}
                    numberOfLines={3}
                  >
                    {a.scopeOfWork}
                  </Text>
                ) : null}
                <View style={styles.directActions}>
                  <TouchableOpacity
                    onPress={() => {
                      void respondDirect(a.id, "commit");
                    }}
                    disabled={busy}
                    style={[
                      styles.directBtn,
                      { backgroundColor: "#16a34a", opacity: busy ? 0.6 : 1 },
                    ]}
                    testID={`button-commit-direct-${a.id}`}
                  >
                    <Feather name="check" size={14} color="#ffffff" />
                    <Text style={styles.directBtnText}>
                      {t("directAssignment.commit")}
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => {
                      setPassReason("");
                      setPassDialogId(a.id);
                    }}
                    disabled={busy}
                    style={[
                      styles.directBtn,
                      { backgroundColor: "#dc2626", opacity: busy ? 0.6 : 1 },
                    ]}
                    testID={`button-pass-direct-${a.id}`}
                  >
                    <Feather name="x" size={14} color="#ffffff" />
                    <Text style={styles.directBtnText}>
                      {t("directAssignment.pass")}
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>
            );
          })}
        </View>
      ) : null}

      <Modal
        visible={passDialogId !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setPassDialogId(null)}
      >
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalCard, { backgroundColor: colors.card }]}>
            <Text style={[styles.modalTitle, { color: colors.foreground }]}>
              {t("directAssignment.passDialogTitle")}
            </Text>
            <Text style={[styles.modalLabel, { color: colors.mutedForeground }]}>
              {t("directAssignment.passReasonLabel")}
            </Text>
            <TextInput
              value={passReason}
              onChangeText={setPassReason}
              placeholder={t("directAssignment.passReasonPlaceholder")}
              placeholderTextColor={colors.mutedForeground}
              multiline
              style={[
                styles.modalInput,
                { color: colors.foreground, borderColor: colors.border },
              ]}
              testID="input-pass-reason"
            />
            <View style={styles.modalActions}>
              <TouchableOpacity
                onPress={() => setPassDialogId(null)}
                style={[styles.modalBtn, { borderColor: colors.border }]}
                testID="button-pass-dialog-cancel"
              >
                <Text style={{ color: colors.foreground }}>{t("common.back")}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => {
                  if (passDialogId === null) return;
                  const reason = passReason.trim();
                  void (async () => {
                    const ok = await respondDirect(
                      passDialogId,
                      "pass",
                      reason === "" ? null : reason,
                    );
                    if (ok) {
                      setPassDialogId(null);
                      setPassReason("");
                    }
                  })();
                }}
                disabled={directBusyId !== null}
                style={[
                  styles.modalBtn,
                  {
                    backgroundColor: "#dc2626",
                    borderColor: "#dc2626",
                    opacity: directBusyId !== null ? 0.6 : 1,
                  },
                ]}
                testID="button-pass-dialog-confirm"
              >
                <Text style={{ color: "#ffffff", fontWeight: "600" }}>
                  {t("directAssignment.confirmPass")}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {loading ? (
        <ActivityIndicator style={{ marginTop: 40 }} color={colors.primary} />
      ) : (
        <FlatList
          data={tickets}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={{ padding: 16 }}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
          }
          ListEmptyComponent={
            <Text style={[styles.empty, { color: colors.mutedForeground }]}>
              {t("common.noResults")}
            </Text>
          }
          renderItem={({ item }) => {
            // Always open the in-app ticket detail regardless of role.
            const onPress = () => {
              router.push(`/ticket/${item.id}`);
            };
            const employeeName = (() => {
              const first = item.fieldEmployeeFirstName?.trim() ?? "";
              const last = item.fieldEmployeeLastName?.trim() ?? "";
              const full = `${first} ${last}`.trim();
              return full.length > 0 ? full : null;
            })();
            const crewLine =
              item.crewNames && item.crewNames.length > 0
                ? item.crewNames.join(", ")
                : employeeName;
            return (
              <TouchableOpacity
                onPress={onPress}
                style={[
                  styles.card,
                  {
                    backgroundColor: colors.card,
                    borderColor: isForemanEmployee ? `${brand.primary}55` : colors.border,
                    borderLeftColor: isForemanEmployee ? brand.primary : colors.border,
                    borderLeftWidth: isForemanEmployee ? 4 : 1,
                  },
                ]}
                testID={`card-ticket-${item.id}`}
              >
                <NudgeFlashOverlay active={nudgeFlashingTicketIds.has(item.id)} />
                <View style={styles.cardHeader}>
                  <View style={styles.ticketNumGroup}>
                    <Text style={[styles.ticketNum, { color: colors.foreground }]}>
                      #{String(item.id).padStart(4, "0")}
                    </Text>
                    {/* Task #51 — unread comments badge. Hidden when
                        the count is 0; clears automatically once the
                        user opens the ticket detail (which marks the
                        comment thread as seen) and the home screen
                        re-fetches. */}
                    {item.unreadCommentCount > 0 ? (
                      <View
                        style={styles.unreadBadge}
                        accessibilityLabel={t("tickets.unreadCommentsA11y", {
                          count: item.unreadCommentCount,
                        })}
                        testID={`badge-unread-comments-${item.id}`}
                      >
                        <Feather name="message-circle" size={11} color="#1a1d23" />
                        <Text style={styles.unreadBadgeText}>
                          {item.unreadCommentCount}
                        </Text>
                      </View>
                    ) : null}
                  </View>
                  {(() => {
                    const staleDays = ticketStaleDays(item.status, item.updatedAt);
                    const useStatusPills = !isFieldEmployee || isForemanEmployee;
                    if (!useStatusPills) {
                      return (
                        <View style={styles.statusGroup}>
                          {staleDays != null ? (
                            <Text
                              style={[styles.staleText, { color: colors.mutedForeground }]}
                              accessibilityLabel={t("tickets.staleSuffixA11y", { days: staleDays })}
                              testID={`text-ticket-stale-${item.id}`}
                            >
                              {t("tickets.staleSuffix", { days: staleDays })}
                            </Text>
                          ) : null}
                          <Text
                            style={[styles.statusTextOnly, { color: colors.primary }]}
                            testID={`badge-ticket-status-${item.id}`}
                          >
                            {ticketStatusLabel(item.status, t)}
                          </Text>
                        </View>
                      );
                    }
                    const pill = ticketStatusPillStyle(item.status, item.updatedAt);
                    return (
                      <View style={styles.statusGroup}>
                        {staleDays != null ? (
                          <Text
                            style={[styles.staleText, { color: colors.mutedForeground }]}
                            accessibilityLabel={t("tickets.staleSuffixA11y", { days: staleDays })}
                            testID={`text-ticket-stale-${item.id}`}
                          >
                            {t("tickets.staleSuffix", { days: staleDays })}
                          </Text>
                        ) : null}
                        <View
                          style={[
                            styles.statusBadge,
                            { backgroundColor: pill.background },
                          ]}
                          testID={`badge-ticket-status-${item.id}`}
                        >
                          <Text
                            style={[styles.statusText, { color: pill.foreground }]}
                          >
                            {ticketStatusLabel(item.status, t)}
                          </Text>
                        </View>
                      </View>
                    );
                  })()}
                </View>
                <Text style={[styles.cardTitle, { color: colors.foreground }]}>
                  {item.siteName || t("tickets.siteFallbackPlaceholder")}
                </Text>
                <Text style={[styles.cardMeta, { color: colors.mutedForeground }]}>
                  {item.workTypeName || t("tickets.workTypeFallbackPlaceholder")}
                  {isPartnerViewer && item.vendorName
                    ? t("tickets.vendorSuffix", { vendor: item.vendorName })
                    : item.partnerName
                      ? t("tickets.partnerSuffix", { partner: item.partnerName })
                      : ""}
                </Text>
                {/* Office viewers see crew / assignee context on each row. */}
                {isOfficeViewer || isForemanEmployee ? (
                  crewLine ? (
                  <Text
                    style={[styles.cardMeta, { color: colors.mutedForeground }]}
                    testID={`text-ticket-employee-${item.id}`}
                    numberOfLines={2}
                  >
                    <Feather name="users" size={11} color={colors.mutedForeground} />
                    {"  "}
                    {crewLine}
                  </Text>
                  ) : null
                ) : null}
              </TouchableOpacity>
            );
          }}
        />
      )}
      {/* ── Task #630: Assignment-restored confirmation toast ── */}
      {restoredToastMessage ? (
        <View
          style={styles.restoredToastContainer}
          pointerEvents="none"
          testID="toast-assignment-restored"
        >
          <View style={styles.restoredToast}>
            <Feather name="check-circle" size={16} color="#ffffff" />
            <Text style={styles.restoredToastText}>{restoredToastMessage}</Text>
          </View>
        </View>
      ) : null}
      {crewToastMessage ? (
        <View
          style={[
            styles.restoredToastContainer,
            { bottom: restoredToastMessage ? 80 : 32 },
          ]}
          pointerEvents="none"
          testID="toast-crew-notification"
        >
          <View style={[styles.restoredToast, styles.nudgeToast]}>
            <Feather name="users" size={16} color="#ffffff" />
            <Text style={styles.restoredToastText}>{crewToastMessage}</Text>
          </View>
        </View>
      ) : null}
      {nudgeToastMessage ? (
        <View
          style={[
            styles.restoredToastContainer,
            {
              bottom:
                (restoredToastMessage ? 80 : 0) +
                (crewToastMessage ? 80 : 0) +
                (restoredToastMessage || crewToastMessage ? 0 : 32),
            },
          ]}
          pointerEvents="none"
          testID="toast-nudge-received"
        >
          <View style={[styles.restoredToast, styles.nudgeToast]}>
            <Feather name="bell" size={16} color="#ffffff" />
            <Text style={styles.restoredToastText}>{nudgeToastMessage}</Text>
          </View>
        </View>
      ) : null}
      {/* ── Task #669: Manual refresh confirmation toast ──
          Mirrors the web LiveConnectionPill's "refreshed" state from
          Task #667. Reuses the assignment-restored toast container so
          the visual placement is consistent across confirmations. The
          two states are mutually unlikely to overlap (assignment
          restored fires only on a `ticket_unblocked` push) but if both
          ever flash at once they stack vertically rather than overlap
          because each is its own absolutely-positioned bottom pill. */}
      {refreshedToastVisible ? (
        <View
          style={[styles.restoredToastContainer, { bottom: restoredToastMessage ? 80 : 32 }]}
          pointerEvents="none"
          testID="toast-tickets-refreshed"
        >
          <View style={styles.restoredToast}>
            <Feather name="check-circle" size={16} color="#ffffff" />
            <Text style={styles.restoredToastText}>{t("tickets.refreshedToast")}</Text>
          </View>
        </View>
      ) : null}
      {/* ── Task #691: tickets rate-limit "reconnecting" toast ──
          Mirrors the ticket detail screen's toast from Task #686 so
          the home/dashboard tab surfaces the same pause indicator
          when the per-session limiter (Task #675) trips on the field
          endpoints. We reuse the restored-toast container styling
          (with an amber background to distinguish from the green
          confirmation toasts) and stack it above the other bottom
          toasts when both happen to be visible. The toast disappears
          on its own when the cooldown expires — the hook re-renders,
          `rateLimited` flips back to false, and the recovery effect
          above re-runs `load()` so the list converges naturally. */}
      {rateLimited ? (
        <View
          style={[
            styles.restoredToastContainer,
            {
              bottom:
                (restoredToastMessage ? 80 : 0) +
                (refreshedToastVisible ? 80 : 0) +
                (restoredToastMessage || refreshedToastVisible ? 0 : 32),
            },
          ]}
          pointerEvents="none"
          testID="toast-tickets-rate-limited"
        >
          <View style={[styles.restoredToast, styles.rateLimitedToast]}>
            <Feather name="clock" size={16} color="#ffffff" />
            <Text style={styles.restoredToastText}>
              {t("tickets.rateLimitedToast", {
                seconds: retryAfterSeconds ?? 0,
              })}
            </Text>
          </View>
        </View>
      ) : null}
      {/* ── Task #187: org-switcher bottom sheet ──
          Opens when a dual-role user taps the active-org pill on the
          Home header. Lists every membership; tapping any one calls
          `switchContext` and dismisses. We use the platform `Modal`
          with a translucent overlay rather than pulling in a separate
          bottom-sheet library so we keep the dependency surface flat
          and stay consistent with the existing Modal usage in the
          field app (e.g. `components/CommentsPanel.tsx`,
          `components/ErrorFallback.tsx`). The sheet is mounted only
          while open so the underlying screen retains its existing
          render cost and a11y order when the switcher isn't visible. */}
      {canSwitchOrg ? (
        <Modal
          visible={switcherOpen}
          transparent
          animationType="slide"
          onRequestClose={() => {
            // Don't allow back-button dismissal while a switch is in
            // flight — the resulting state change is what dismisses
            // the sheet on success, and dismissing early would leave
            // `switchingId` set if the request later fails.
            if (switchingId !== null) return;
            setSwitcherOpen(false);
          }}
        >
          <Pressable
            style={styles.switcherOverlay}
            onPress={() => {
              if (switchingId !== null) return;
              setSwitcherOpen(false);
            }}
            accessibilityLabel={t("auth.switchOrgDismissA11y")}
            testID="org-switcher-overlay"
          >
            {/* Stop propagation so taps inside the sheet don't dismiss it. */}
            <Pressable
              onPress={() => undefined}
              style={[
                styles.switcherSheet,
                { backgroundColor: colors.background, borderColor: colors.border },
              ]}
              testID="sheet-org-switcher"
            >
              <View style={styles.switcherHandleWrap}>
                <View style={[styles.switcherHandle, { backgroundColor: colors.border }]} />
              </View>
              <View style={styles.switcherHeaderRow}>
                <Text style={[styles.switcherTitle, { color: colors.foreground }]}>
                  {t("auth.switchOrgTitle")}
                </Text>
                <Pressable
                  onPress={() => {
                    if (switchingId !== null) return;
                    setSwitcherOpen(false);
                  }}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  accessibilityRole="button"
                  accessibilityLabel={t("auth.switchOrgDismissA11y")}
                  testID="button-close-org-switcher"
                >
                  <Feather name="x" size={20} color={colors.mutedForeground} />
                </Pressable>
              </View>
              <Text
                style={[styles.switcherHelp, { color: colors.mutedForeground }]}
              >
                {t("auth.switchOrgHelp")}
              </Text>
              {availableMemberships.map((m) => {
                const isActive = m.id === activeMembershipId;
                const busy = switchingId !== null;
                const isThisBusy = switchingId === m.id;
                const partner = m.orgType === "partner";
                return (
                  <TouchableOpacity
                    key={m.id}
                    onPress={() => onPickContext(m)}
                    disabled={busy}
                    style={[
                      styles.switcherRow,
                      {
                        borderColor: isActive ? colors.primary : colors.border,
                        backgroundColor: isActive ? colors.accent : "transparent",
                        opacity: busy && !isThisBusy ? 0.5 : 1,
                      },
                    ]}
                    accessibilityRole="button"
                    accessibilityState={{ selected: isActive, disabled: busy }}
                    testID={`button-pick-context-${m.id}`}
                  >
                    <View
                      style={[
                        styles.orgPill,
                        partner ? styles.orgPillPartner : styles.orgPillVendor,
                      ]}
                    >
                      <Text style={styles.orgPillText}>
                        {partner ? t("auth.partner") : t("auth.vendor")}
                      </Text>
                    </View>
                    <Text
                      style={[styles.switcherRowName, { color: colors.foreground }]}
                      numberOfLines={1}
                      ellipsizeMode="tail"
                    >
                      {m.orgName}
                    </Text>
                    {isThisBusy ? (
                      <ActivityIndicator size="small" color={colors.primary} />
                    ) : isActive ? (
                      <Feather name="check" size={18} color={colors.primary} />
                    ) : null}
                  </TouchableOpacity>
                );
              })}
            </Pressable>
          </Pressable>
        </Modal>
      ) : null}
      {isForemanEmployee && me?.vendorId ? (
        <ForemanScheduleTicketsModal
          visible={schedulePickerOpen}
          onClose={() => setSchedulePickerOpen(false)}
          vendorId={me.vendorId}
          onScheduled={() => {
            setSchedulePickerOpen(false);
            void load();
            void loadPendingSchedule();
          }}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  // Task #630: assignment-restored toast on the open-tickets list.
  // Mirrors the detail-screen toast added in Task #623 — pinned to the
  // bottom of the screen, `pointerEvents="none"` so the worker can keep
  // tapping cards underneath without waiting for the toast to fade.
  restoredToastContainer: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 32,
    alignItems: "center",
  },
  restoredToast: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#15803d",
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 999,
    maxWidth: "90%",
    shadowColor: "#000",
    shadowOpacity: 0.2,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  nudgeToast: {
    backgroundColor: "#2563eb",
  },
  restoredToastText: {
    color: "#ffffff",
    fontFamily: "Inter_600SemiBold",
    fontSize: 13,
  },
  // Task #691: slate-grey background visually separates the rate-limited
  // pause indicator from the green "confirmed" toasts above so users
  // can tell at a glance whether they're seeing a success or a wait.
  // Mirrors the detail screen's `rateLimitedToast` style from Task #686.
  // Amber was deliberately removed from the mobile palette unless that
  // color is the brand color the admin chose (see use-brand.tsx).
  rateLimitedToast: {
    backgroundColor: "#475569",
  },
  brandRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  brandLeft: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
    minWidth: 0,
  },
  brandLogo: { width: 64, height: 64 },
  brandIdentity: {
    marginLeft: 10,
    flex: 1,
    minWidth: 0,
  },
  brandApp: {
    fontFamily: "Inter_700Bold",
    fontSize: 18,
    letterSpacing: 1,
    ...SCREEN_TITLE_TEXT,
  },
  brandName: {
    fontFamily: "Inter_700Bold",
    fontSize: 16,
    marginTop: 2,
    ...SCREEN_TITLE_TEXT,
  },
  brandVendor: {
    fontFamily: "Inter_400Regular",
    fontSize: 12,
    marginTop: 1,
    ...SCREEN_SUBTITLE_TEXT,
  },
  orgRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 1,
  },
  orgPill: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  orgPillPartner: { backgroundColor: "#3b82f6" },
  orgPillVendor: { backgroundColor: "#7c3aed" },
  orgPillText: {
    fontFamily: "Inter_700Bold",
    fontSize: 9,
    letterSpacing: 0.6,
    textTransform: "uppercase",
    color: "#ffffff",
  },
  bellBtn: {
    padding: 6,
    // Scoot the bell ~10px to the left of the right edge so the
    // notification badge has breathing room and isn't crowded against
    // the screen edge / parent padding.
    marginRight: 10,
    position: "relative",
    overflow: "visible",
  },
  badge: {
    position: "absolute",
    top: -2,
    right: -4,
    // Pill that grows naturally with the digit count. minWidth keeps a
    // perfect circle at "1" while paddingHorizontal lets "12" or "99+"
    // stretch into a properly-proportioned rounded rectangle instead of
    // clipping. Height stays fixed so the pill silhouette is consistent.
    // paddingHorizontal bumped from 6 → 8 so two-digit counts ("12",
    // "47", "99+") get enough horizontal room that the second digit
    // isn't visually clipped by the rounded cap.
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 8,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1.5,
    overflow: "visible",
  },
  badgeText: {
    fontFamily: "Inter_700Bold",
    fontSize: 10,
    lineHeight: 12,
  },
  // Heading row holds JUST the page title and the freshness ("Live")
  // pill, with the pill aligned right so the eye scans
  // identity → status on a single horizontal line. Action buttons live
  // in `actionsRow` below.
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 4,
    gap: 8,
  },
  freshnessRow: { flexDirection: "row", alignItems: "center" },
  heading: { fontFamily: "Inter_700Bold", fontSize: 22 },
  officeSubtitle: {
    fontFamily: "Inter_400Regular",
    fontSize: 13,
    lineHeight: 18,
    marginTop: 4,
  },
  activeJobsHeader: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
    gap: 10,
  },
  activeJobsActions: {
    flexDirection: "row",
    alignItems: "stretch",
    gap: 10,
  },
  foremanPillHalf: {
    flex: 1,
  },
  foremanPillFull: {
    flex: 1,
  },
  officeActionPill: {
    flex: 1,
    minWidth: 0,
  },
  simplePill: {
    flex: 1,
    minHeight: 40,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  simplePillGrey: {
    backgroundColor: "#4b5563",
    borderWidth: 1,
    borderColor: "#6b7280",
  },
  simplePillBrand: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(0,0,0,0.15)",
  },
  simplePillPressed: {
    opacity: 0.88,
  },
  simplePillGreyText: {
    fontFamily: "Inter_400Regular",
    fontSize: 13,
    color: "#f3f4f6",
    flexShrink: 1,
  },
  simplePillBrandText: {
    fontFamily: "Inter_400Regular",
    fontSize: 13,
    color: "#ffffff",
    flexShrink: 1,
  },
  trackingRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
    gap: 8,
  },
  trackingActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flexShrink: 0,
  },
  historyBtnText: {
    fontFamily: "Inter_400Regular",
    fontSize: 13,
    color: "#1a1d23",
  },
  // Action buttons (History / New Ticket / Refresh) drop to their own
  // row below the heading so they have full pill width without
  // squeezing the title. Left-aligned to match the heading's left edge;
  // a flex spacer pushes the icon-only refresh button to the right.
  actionsRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 8,
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  newBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
  },
  // Drop shadow on the button label so the white lettering pops off the
  // brand fill on every TogglePillButton CTA in the row. Subtle on
  // purpose — a hard shadow reads as cheap UI; this is just enough to
  // give the text dimensional separation from the colored chrome.
  newBtnText: {
    fontFamily: "Inter_400Regular",
    fontSize: 13,
    ...TEXT_SHADOW.deep,
  },
  // Feather icons render as Text glyphs from an icon font, so the same
  // textShadow* properties used on `newBtnText` apply cleanly here.
  // Keeping the shadow values identical means the icon and the label
  // sit on the same visual depth plane on the brand-colored pill.
  btnIconShadow: TEXT_SHADOW.deep,
  adjacentRow: {
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  adjacentBtn: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 1,
    borderRadius: 20,
    gap: 4,
  },
  adjacentBtnTop: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  adjacentBtnText: { fontFamily: "Inter_400Regular", fontSize: 13 },
  adjacentBtnHint: {
    fontFamily: "Inter_400Regular",
    fontSize: 12,
    flexShrink: 1,
  },
  empty: {
    textAlign: "center",
    marginTop: 40,
    fontFamily: "Inter_400Regular",
  },
  card: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    overflow: "hidden",
  },
  cardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },
  ticketNum: { fontFamily: "Inter_600SemiBold", fontSize: 14 },
  // Task #51 — keeps the ticket number and the unread-comments pill
  // grouped together on the left side of the card header so the pill
  // reads as a property of that ticket, not as a separate header item.
  ticketNumGroup: { flexDirection: "row", alignItems: "center", gap: 6 },
  unreadBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    backgroundColor: "#f4f4f5",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 999,
  },
  unreadBadgeText: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 11,
    color: "#1a1d23",
  },
  statusBadge: {
    ...PILL_CHIP_LAYOUT,
    borderRadius: 6,
  },
  statusText: { ...PILL_TEXT },
  statusTextOnly: { fontFamily: "Inter_400Regular", fontSize: 13 },
  // Task #890: groups the stale-time suffix with the status pill on
  // the right side of the card header so the two read together as a
  // single status block rather than the suffix floating on its own.
  statusGroup: { flexDirection: "row", alignItems: "center", gap: 6 },
  staleText: { fontFamily: "Inter_500Medium", fontSize: 11 },
  cardTitle: { fontFamily: "Inter_600SemiBold", fontSize: 16, marginBottom: 4 },
  cardMeta: { fontFamily: "Inter_400Regular", fontSize: 13 },
  // Direct work assignments inbox — vendor-only section above the
  // open-tickets list. Visually separated by a border + subtle padding.
  directSection: {
    marginHorizontal: 16,
    marginTop: 12,
    padding: 12,
    borderWidth: 1,
    borderRadius: 10,
    gap: 10,
  },
  directSectionTitle: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 14,
  },
  directCard: {
    borderWidth: 1,
    borderRadius: 8,
    padding: 10,
    gap: 4,
  },
  directPartner: { fontFamily: "Inter_600SemiBold", fontSize: 14 },
  directSite: { fontFamily: "Inter_500Medium", fontSize: 12 },
  directDates: { fontFamily: "Inter_400Regular", fontSize: 12 },
  directScope: { fontFamily: "Inter_400Regular", fontSize: 13, marginTop: 4 },
  directActions: { flexDirection: "row", gap: 8, marginTop: 8 },
  directBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 8,
    borderRadius: 8,
  },
  directBtnText: { color: "#ffffff", fontFamily: "Inter_400Regular", fontSize: 13 },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  modalCard: {
    width: "100%",
    maxWidth: 420,
    borderRadius: 12,
    padding: 16,
    gap: 10,
  },
  modalTitle: { fontFamily: "Inter_600SemiBold", fontSize: 16 },
  modalLabel: { fontFamily: "Inter_500Medium", fontSize: 12 },
  modalInput: {
    minHeight: 80,
    borderWidth: 1,
    borderRadius: 8,
    padding: 10,
    fontFamily: "Inter_400Regular",
    fontSize: 14,
    textAlignVertical: "top",
  },
  modalActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 8,
    marginTop: 4,
  },
  modalBtn: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 8,
    borderWidth: 1,
  },
  // ── Task #187: org-switcher bottom sheet styles ──
  // The overlay covers the screen and dims the underlying content; the
  // sheet itself slides up from the bottom (the Modal's `slide`
  // animation handles the motion). The `borderTopRadius` + handle bar
  // give it the familiar bottom-sheet affordance without pulling in a
  // dedicated sheet library. Membership rows mirror the styling used
  // in the Profile picker so the two entry points feel consistent.
  switcherOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "flex-end",
  },
  switcherSheet: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 24,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
  },
  switcherHandleWrap: {
    alignItems: "center",
    paddingVertical: 6,
  },
  switcherHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
  },
  switcherHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 4,
    marginBottom: 6,
  },
  switcherTitle: {
    fontFamily: "Inter_700Bold",
    fontSize: 16,
  },
  switcherHelp: {
    fontFamily: "Inter_400Regular",
    fontSize: 12,
    lineHeight: 16,
    marginBottom: 10,
  },
  switcherRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 10,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
    marginTop: 6,
  },
  switcherRowName: {
    flex: 1,
    fontFamily: "Inter_600SemiBold",
    fontSize: 14,
  },
});
