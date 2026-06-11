import { Feather } from "@expo/vector-icons";
import * as Location from "expo-location";
import * as Notifications from "expo-notifications";
import { Stack, router, useFocusEffect, useLocalSearchParams } from "expo-router";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ActivityIndicator,
  Alert,
  AppState,
  type AppStateStatus,
  Image,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";

import { formatTicketTrackingNumber } from "@workspace/db/format";

import ActiveOrgIndicator from "@/components/ActiveOrgIndicator";
import AmberButton from "@/components/AmberButton";
import LayeredPillButton from "@/components/LayeredPillButton";
import Pill9Slice from "@/components/Pill9Slice";
import BlueButton from "@/components/BlueButton";
import FreshnessPill from "@/components/FreshnessPill";
import InPageHeader from "@/components/InPageHeader";
import TogglePill2 from "@/components/TogglePill2";
import LiveLocationStatusPill from "@/components/LiveLocationStatusPill";
import { TicketRouteMap } from "@/components/TicketRouteMap";
import TicketSiteVisitSummary from "@/components/TicketSiteVisitSummary";
import { TicketTrackingTimeline } from "@/components/TicketTrackingTimeline";
import CrewTimeSection, { type CrewTimeSectionHandle } from "@/components/CrewTimeSection";
import ScheduleTicketPanel from "@/components/ScheduleTicketPanel";
import TicketNudgePanel from "@/components/TicketNudgePanel";
import NudgeFlashOverlay from "@/components/NudgeFlashOverlay";
import CommentsPanel from "@/components/CommentsPanel";
import TicketStatusStepper from "@/components/TicketStatusStepper";
import { useColors } from "@/hooks/useColors";
import { useTicketsRateLimitGate } from "@/hooks/use-tickets-rate-limit-gate";
import { useTicketNudgeFlash } from "@/hooks/useTicketNudgeFlash";
import { apiFetch, getApiBase } from "@/lib/api";
import {
  inlineErrorForTicketAction,
  translateApiError,
  type TicketActionField,
} from "@/lib/apiErrors";
import {
  isTicketsRateLimited,
  noteTicketsRateLimit,
} from "@/lib/ticketsRateLimitGate";
import { getUser, type StoredUser } from "@/lib/auth";
import { nudgeLiveLocationReporter } from "@/lib/liveLocationReporter";
import { MAP_TILE_SIZE, getOsmTile, openInMaps } from "@/lib/maps";
import { captureAndUploadImage } from "@/lib/photos";
import { ticketStatusLabel, ticketStatusPillStyle } from "@/lib/ticketStatusLabels";
import { PILL_CHIP_LAYOUT, PILL_TEXT } from "@/lib/pill-doctrine";

type Ticket = {
  id: number;
  status: string;
  description: string | null;
  siteName?: string | null;
  siteLocationId?: number | null;
  state?: string | null;
  workTypeName?: string | null;
  afe?: string | null;
  partnerName?: string | null;
  checkInTime?: string | null;
  checkOutTime?: string | null;
  checkInLatitude?: number | null;
  checkInLongitude?: number | null;
  checkOutLatitude?: number | null;
  checkOutLongitude?: number | null;
  vendorId?: number | null;
  scheduledStartAt?: string | null;
  foremanUserId?: number | null;
  actingForemanUserId?: number | null;
  kickbackReason?: string | null;
  createdAt?: string | null;
  unlockedAt?: string | null;
  unlockedByName?: string | null;
  unlockCount?: number | null;
  // Foreman / vendor-admin / org-admin pressed "Close Ticket" — running
  // [auto] labor lines are now frozen. We use this to hide the Close
  // Ticket button once the ticket is locked.
  closedAt?: string | null;
  closedById?: number | null;
  closedByName?: string | null;
  lifecycleState?: "pending_arrival" | "en_route" | "on_location" | "on_site" | "off_site" | null;
  enRouteAt?: string | null;
  // Vendor pressed "On Location": arrived at site but not yet on the clock.
  // Distinct from `arrivedAt` (geofence-detected) so the office can tell
  // physically-present-but-idle apart from actively-billing-hours.
  onLocationAt?: string | null;
  arrivedAt?: string | null;
  // Task #508: caller name captured by office phone intake on the
  // initial transition row. Null when the ticket wasn't opened via
  // phone intake (or the field employee opened it themselves).
  phoneIntakeCallerName?: string | null;
  // ── Task #497 / #600: payment dispersal fields ──
  // Populated by the server on every GET /tickets/:id. The first three
  // are the metadata recorded when AP marks funds dispersed; the read-
  // only summary card already keys off paymentDispersedAt. The fourth
  // is a per-viewer capability flag the server computes by checking
  // admin role OR partner contact in the AP role on the owning partner.
  // We gate the Disperse Funds button on this flag rather than the
  // broad role so non-AP partners never see the action.
  paymentMethod?: "etf" | "check" | "other" | null;
  paymentReference?: string | null;
  paymentNote?: string | null;
  paymentDispersedAt?: string | null;
  paymentDispersedById?: number | null;
  paymentDispersedByName?: string | null;
  // Task #852 — optional proof-of-payment image attached at dispersal
  // time. Object-storage path/URL persisted alongside the other payment
  // columns; renders as a thumbnail on the read-only Payment Details
  // panel below.
  paymentReceiptUrl?: string | null;
  viewerCanDisperseFunds?: boolean | null;
  // Task #853 — server-computed flag (admin OR partner-AP viewer when
  // ticket status is `funds_dispersed`). Drives the "Reverse dispersal"
  // action on the Payment Details card; `null`/`false` keeps it hidden.
  viewerCanReverseDispersal?: boolean | null;
};

type TicketUnlock = {
  id: number;
  unlockedAt: string;
  unlockedById: number | null;
  unlockedByName: string | null;
  previousStatus: string;
};

// Task #501 — invite/accept/deny/reinvite audit row. Mirrors the OpenAPI
// `TicketTransition` schema written by every status-mutating handler via
// `recordTicketTransition()`. The server resolves the `vendor #N` IDs
// embedded in reinvite reason text to vendor names so the close-out
// screen can render "Reassigned from Acme to Permian Welders" without
// a follow-up round-trip.
type TicketTransition = {
  id: number;
  ticketId: number;
  fromStatus: string | null;
  toStatus: string;
  actorUserId: number | null;
  actorName: string | null;
  actorRole: string | null;
  reason: string | null;
  displayReason: string | null;
  fromVendorName: string | null;
  toVendorName: string | null;
  createdAt: string;
};

type SiteLocation = {
  afe?: string | null;
  id: number;
  name?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  siteRadiusMeters?: number | null;
};

type GpsLog = {
  id: number;
  ticketId: number;
  latitude: number;
  longitude: number;
  eventType: "check_in" | "check_out" | "tracking" | string;
  recordedAt: string;
};

const PHOTO_PREFIX = "[photo] ";

function parsePhotoNote(content: string): string | null {
  if (!content.startsWith(PHOTO_PREFIX)) return null;
  const path = content.slice(PHOTO_PREFIX.length).trim();
  return path || null;
}

function objectUrl(objectPath: string): string {
  const base = getApiBase();
  let suffix = objectPath;
  if (suffix.startsWith("/objects/")) {
    suffix = suffix.slice("/objects/".length);
  } else if (suffix.startsWith("objects/")) {
    suffix = suffix.slice("objects/".length);
  } else if (suffix.startsWith("/")) {
    suffix = suffix.slice(1);
  }
  return `${base}/api/storage/objects/${suffix}`;
}

type TaxRate = { state: string; rate: string };

type LineItem = {
  id: number;
  type: string;
  description: string;
  quantity: string | number;
  unitPrice: string | number;
};

type NoteLog = {
  id: number;
  content: string;
  createdAt: string;
  createdByName?: string | null;
  createdByRole?: string | null;
};

const ITEM_TYPES = ["part", "equipment", "labor", "other"] as const;
const ITEM_TYPE_KEYS: Record<(typeof ITEM_TYPES)[number], string> = {
  part: "tickets.itemPart",
  equipment: "tickets.itemEquipment",
  labor: "tickets.itemLabor",
  other: "tickets.itemOther",
};

export default function TicketDetailScreen() {
  const colors = useColors();
  const [currentUser, setCurrentUser] = useState<StoredUser | null>(null);
  useEffect(() => { getUser().then(setCurrentUser).catch(() => {}); }, []);
  // Pre-warm location permission + a cached fix on mount, so En Route /
  // Check In / Check Out don't have to wait on a cold permission dialog
  // queued behind a closing modal.
  useEffect(() => {
    (async () => {
      try {
        const perm = await Location.getForegroundPermissionsAsync();
        if (perm.status === "granted") {
          // Kick off a background fix so the OS has a fresh cached coord
          // ready when the user taps an action button.
          Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.Balanced,
          }).catch(() => {});
        } else if (perm.canAskAgain) {
          await Location.requestForegroundPermissionsAsync();
        }
      } catch {
        // Permission warm-up is best-effort; captureCoords will retry.
      }
    })();
  }, []);
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const ticketId = Number(id);
  const { nudgeFlashingTicketIds, handlePushData } = useTicketNudgeFlash({
    enabled: Number.isFinite(ticketId) && ticketId > 0,
    ticketId: Number.isFinite(ticketId) ? ticketId : undefined,
  });
  const isNudgeFlashing =
    Number.isFinite(ticketId) && nudgeFlashingTicketIds.has(ticketId);

  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [siteLocation, setSiteLocation] = useState<SiteLocation | null>(null);
  const [items, setItems] = useState<LineItem[]>([]);
  const [notes, setNotes] = useState<NoteLog[]>([]);
  const [gpsLogs, setGpsLogs] = useState<GpsLog[]>([]);
  const [unlocks, setUnlocks] = useState<TicketUnlock[]>([]);
  // Task #501 — chronological invite/accept/deny/reinvite audit trail. The
  // close-out screen renders these between the unlock history and the
  // existing GPS-driven `historyEvents` so foremen can see why their
  // ticket bounced through multiple vendors before they took it.
  const [transitions, setTransitions] = useState<TicketTransition[]>([]);
  const scrollRef = React.useRef<ScrollView | null>(null);
  const unlockHistoryY = React.useRef<number>(0);
  const [taxRate, setTaxRate] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [previewPhoto, setPreviewPhoto] = useState<string | null>(null);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [selectedTrackingId, setSelectedTrackingId] = useState<
    number | string | null
  >(null);

  // line item form
  const [itemType, setItemType] = useState<(typeof ITEM_TYPES)[number]>("part");
  const [itemTypePickerOpen, setItemTypePickerOpen] = useState(false);
  const [itemDesc, setItemDesc] = useState("");
  const [qty, setQty] = useState("1");
  const [unitPrice, setUnitPrice] = useState("0");

  // note form
  const [noteContent, setNoteContent] = useState("");

  // ── Task #494: vendor invite handshake ──
  const [denyOpen, setDenyOpen] = useState(false);
  const [denyReason, setDenyReason] = useState("");
  // T004: gate the en-route and check-out actions behind a single shared
  // prompt that asks the field employee for their odometer reading. Stored
  // as a string because TextInput is the source of truth and we don't want
  // to lose the user's leading zeros / partial typing while they edit. The
  // `mileagePromptFor` discriminator lets one modal serve both flows.
  const [mileagePromptFor, setMileagePromptFor] = useState<null | "en_route" | "check_out">(null);
  const [mileageInput, setMileageInput] = useState("");
  const [mileageError, setMileageError] = useState<string | null>(null);
  const [inviteAction, setInviteAction] = useState<"accept" | "deny" | null>(null);
  // Task #532: per-control inline errors for vendor handshake actions.
  // Mirrors web's `schedule-ticket-dialog.tsx` `fieldError` shape: pin a
  // localized message to whichever control just failed, then clear it
  // when the user retries (or as soon as the screen refreshes after a
  // state-conflict response).
  const [fieldError, setFieldError] = useState<{ field: TicketActionField; message: string } | null>(null);
  // Task #572: when a state-change POST returns `site_vendor_mismatch`
  // or `work_type_not_allowed`, the office removed this vendor's
  // site/work-type assignment after the field employee already opened
  // the ticket. We render a friendly banner (instead of pinning the
  // raw error inline under whichever button just failed) and force the
  // En Route / Check In / Check Out / Close buttons into a disabled
  // state so the operator can't keep retrying — the only safe next
  // steps are "contact dispatch" or "cancel the ticket".
  const [assignmentRemoved, setAssignmentRemoved] = useState<
    "site_vendor_mismatch" | "work_type_not_allowed" | null
  >(null);
  const [cancelInFlight, setCancelInFlight] = useState(false);
  // Task #623: short-lived confirmation that pops up when the assignment
  // banner auto-clears via a foreground `ticket_unblocked` push. We only
  // show this when the *push path* clears the banner (so a worker who's
  // mid-task knows the office restored their access). Pull-to-refresh
  // intentionally clears the banner silently — no toast in that path.
  const [restoredVisible, setRestoredVisible] = useState(false);
  // Task #669: brief "Refreshed" confirmation toast for manual refresh
  // (header button or pull-to-refresh). Mirrors the web LiveConnectionPill's
  // "refreshed" state from Task #667 so a foreman who taps the header
  // refresh — or pulls down — gets the same confirmation that their
  // ticket detail is now current. We deliberately do NOT flash this
  // when `load()` is called from the auto-recovery paths (assignment
  // banner clear, geofence handler, mutation success): those have their
  // own dedicated confirmations, and a redundant toast would clutter
  // the screen.
  const [refreshedVisible, setRefreshedVisible] = useState(false);
  // Task #42 — brief "Checked in — you're on site" confirmation that
  // pops up after the geofence handler auto-fires the check-in. The
  // user never tapped a button, so a non-blocking toast (rather than
  // an Alert) is the right affordance: it acknowledges what just
  // happened without interrupting whatever they're doing on screen.
  // Auto-dismisses after ~3s like the other toasts below.
  const [arrivedVisible, setArrivedVisible] = useState(false);
  // Tracks whether the in-flight `load()` was initiated by a manual
  // user gesture (header button or pull-to-refresh). We can't gate the
  // toast on `refreshing` alone because the header button path doesn't
  // toggle `refreshing` (that owns the pull spinner) — using a separate
  // ref keeps both paths funneled through `load()` without forking it.
  const [headerRefreshing, setHeaderRefreshing] = useState(false);
  // Task #686: most-recent error from `load()`. Drives the rate-limit
  // gate hook below — when the server returns 429 on /api/tickets/:id
  // we surface a "reconnecting" toast and pause auto-refetch loops
  // for the server-supplied window. Set even when `silent: true`
  // suppresses the alert so the gate still arms.
  const [loadError, setLoadError] = useState<unknown>(null);
  const { rateLimited, retryAfterSeconds } = useTicketsRateLimitGate(loadError);
  // Task #678 — timestamp of the most recent successful primary
  // ticket load. Drives the FreshnessPill in the nav-bar header so a
  // foreman who's been parked on the detail screen can see at a glance
  // whether the on-screen state still reflects what the office sees.
  // Bumped only when the primary `/api/tickets/:id` fetch succeeds (the
  // try-block path in `load()`); silent/failed loads leave it untouched
  // so the pill correctly switches to "stale" or "reconnecting" instead
  // of falsely declaring "Live".
  const [lastLoadedAt, setLastLoadedAt] = useState<number | null>(null);
  // Task #877: imperative handle exposed by `<CrewTimeSection>`. The
  // pull-to-refresh and header refresh button below invoke
  // `crewHandleRef.current?.refreshAll()` alongside the primary `load()`
  // so the foreman crew rows (sessions / labor summary / roster /
  // vendor crew list) refetch on the same gesture instead of waiting
  // for the next 60s sync tick or focus-regain. The child registers
  // itself in a useEffect and clears the ref on unmount.
  const crewHandleRef = useRef<CrewTimeSectionHandle | null>(null);

  // Mirror the banner state into a ref so the push listener below can
  // read the *current* value without re-subscribing every render.
  const assignmentRemovedRef = React.useRef(assignmentRemoved);
  useEffect(() => {
    assignmentRemovedRef.current = assignmentRemoved;
  }, [assignmentRemoved]);

  // Returns `true` only when the core ticket refresh succeeded (i.e. the
  // banner was actually cleared). Callers that need to know whether the
  // refresh confirmed the new state — e.g. the Task #623 "assignment
  // restored" toast — can gate on the return value to avoid showing a
  // false-positive confirmation when the refresh itself failed. The
  // optional `silent` flag (Task #615) suppresses the user-facing
  // `Alert.alert(...)` on failure for background polling refreshes; the
  // boolean return value is unaffected.
  const load = useCallback(async (opts?: { silent?: boolean }): Promise<boolean> => {
    const silent = opts?.silent === true;
    try {
      // Task #686: the per-session tickets rate limit (Task #675)
      // returns 429 + Retry-After when a client overruns its budget.
      // While we're parked we MUST not fire another /api/tickets/:id
      // request — that would re-trip the limit and indefinitely extend
      // the cooldown. The hook above re-renders when the cooldown
      // expires, and react-effect / user gesture call sites will then
      // re-invoke load() naturally.
      //
      // CRITICAL: this guard lives INSIDE the try so the `finally`
      // below still fires `setLoading(false)`. If the screen mounts
      // while a cooldown is already active (e.g. the background
      // live-location reporter just tripped a 429), an early return
      // before the try would leave `loading` stuck at true forever,
      // pinning the user on the spinner instead of letting the toast
      // surface and the cooldown expire normally.
      if (isTicketsRateLimited()) return false;
      const [tk, li, nl, gl, ul, tr] = await Promise.all([
        apiFetch<Ticket>(`/api/tickets/${ticketId}`),
        apiFetch<LineItem[]>(`/api/tickets/${ticketId}/line-items`),
        apiFetch<NoteLog[]>(`/api/tickets/${ticketId}/note-logs`),
        apiFetch<GpsLog[]>(`/api/tickets/${ticketId}/gps-logs`).catch(() => [] as GpsLog[]),
        apiFetch<TicketUnlock[]>(`/api/tickets/${ticketId}/unlocks`).catch(() => [] as TicketUnlock[]),
        // Task #501 — audit trail. Treat fetch failures as empty so a
        // legacy server (pre-/transitions) doesn't block the rest of
        // the ticket from rendering.
        apiFetch<TicketTransition[]>(`/api/tickets/${ticketId}/transitions`).catch(
          () => [] as TicketTransition[],
        ),
      ]);
      setTicket(tk);
      setItems(li || []);
      setNotes(nl || []);
      setGpsLogs(gl || []);
      setUnlocks(ul || []);
      setTransitions(tr || []);
      // Task #572: any successful refresh dismisses the
      // "assignment removed" banner — pull-to-refresh after the office
      // re-grants the assignment will silently restore the buttons.
      // (If the assignment is still missing, the banner reappears the
      // next time the operator taps an action.)
      setAssignmentRemoved(null);
      // Task #686: a successful load means we're definitely no
      // longer in an error state — clear so the gate hook doesn't
      // re-fire on stale references.
      setLoadError(null);
      // Task #678: bump freshness only on a confirmed primary fetch.
      // Auxiliary fetches below (site location, tax rate) are best-
      // effort and would otherwise leave the pill green even when the
      // primary ticket query failed.
      setLastLoadedAt(Date.now());
      if (tk?.siteLocationId) {
        try {
          const site = await apiFetch<SiteLocation>(
            `/api/site-locations/${tk.siteLocationId}`,
          );
          setSiteLocation(site || null);
        } catch {
          setSiteLocation(null);
        }
      } else {
        setSiteLocation(null);
      }
      if (tk?.state) {
        try {
          const rate = await apiFetch<TaxRate>(
            `/api/tax-rates/by-state/${encodeURIComponent(tk.state)}`,
          );
          setTaxRate(rate?.rate ? parseFloat(rate.rate) : 0);
        } catch {
          setTaxRate(0);
        }
      }
      return true;
    } catch (e) {
      // Task #686: arm the rate-limit gate BEFORE deciding whether to
      // alert. We always feed the error through `setLoadError` so the
      // hook can park the screen for the cooldown — and we suppress
      // the modal alert on a 429 (silent or not), since the toast
      // pinned to the bottom of the screen is the right affordance
      // and a blocking modal on top of it would be noisy.
      const rlSeconds = noteTicketsRateLimit(e);
      setLoadError(e);
      // Task #615: background polling refreshes pass `silent: true` so a
      // transient connectivity blip doesn't pop a modal alert every 7s
      // while the assignment-removed banner is up. The next successful
      // poll (or any user-initiated load) restores normal alerting.
      if (!silent && rlSeconds == null) {
        Alert.alert(t("common.error"), translateApiError(e, t, t("tickets.errorLoadOpen")));
      }
      // Task #623: even when we suppress the alert, callers that gate
      // confirmation toasts on the return value need to know the
      // refresh failed — return `false` so a banner-clear isn't
      // falsely confirmed.
      return false;
    } finally {
      setLoading(false);
    }
  }, [ticketId, t]);

  useEffect(() => {
    load();
  }, [load]);

  // Task #686: auto-recover from a rate-limit cooldown on initial
  // mount. If the user navigated to this screen while the shared
  // cooldown was already active, the mount-time `load()` above
  // short-circuits and we sit on the spinner + reconnecting toast
  // with no ticket data. The hook flips `rateLimited` back to false
  // when the cooldown expires — that's our cue to re-run load() so
  // the screen actually recovers instead of staying stuck on the
  // spinner forever.
  //
  // We track the previous `rateLimited` value in a ref so this only
  // fires on a true→false transition. Without that guard the effect
  // would also fire on the initial render (`rateLimited` starts at
  // false), double-loading alongside the mount-time effect above —
  // which would burn API budget AND fail tests that count the
  // initial GET (e.g. ticketDetail.awaitingPayment).
  const prevRateLimitedRef = useRef(false);
  useEffect(() => {
    const prev = prevRateLimitedRef.current;
    prevRateLimitedRef.current = rateLimited;
    if (!prev) return; // wasn't parked → nothing to recover from
    if (rateLimited) return; // still parked
    if (ticket) return; // already have data; user can refresh manually
    load();
  }, [rateLimited, ticket, load]);

  // Task #613: foreground auto-clear for the assignment-removed banner.
  // Task #592 sends a `ticket_unblocked` push the moment the office
  // restores this worker's site/work-type assignment. The tap-to-deep-link
  // path in `_layout.tsx` already re-runs `load()` on mount, but if the
  // worker is *already* on this exact ticket screen when the push lands,
  // there is no navigation event to trigger a refresh — the banner would
  // sit stale until they pull-to-refresh. Listen for foreground arrivals
  // matching this ticket id and silently re-run `load()` so the banner
  // disappears the instant the push arrives. Pushes for other tickets
  // are ignored.
  useEffect(() => {
    if (!Number.isFinite(ticketId)) return;
    let sub: Notifications.EventSubscription | undefined;
    try {
      sub = Notifications.addNotificationReceivedListener((n) => {
      const data = n.request.content.data as Record<string, unknown> | null;
      if (!data || typeof data !== "object") return;

      if (data.type === "workflow_nudge") {
        handlePushData(data);
        return;
      }

      if (data.type !== "ticket_unblocked") return;
      const incoming =
        typeof data.ticketId === "number"
          ? data.ticketId
          : typeof data.ticketId === "string"
            ? Number(data.ticketId)
            : null;
      if (incoming !== ticketId) return;
      // Task #623: capture whether the banner was actually showing *before*
      // we kick off the refresh. If it was, we surface a brief confirmation
      // toast so a mid-task worker (taking a photo, typing a note) realizes
      // the banner cleared and they can carry on without re-tapping a
      // disabled action button. If the banner wasn't visible (e.g. they
      // opened the screen fresh from the deep link), nothing to confirm.
      // We *also* gate the toast on `load()` succeeding — if the refresh
      // itself failed (network hiccup), the banner never actually clears
      // and a "you're good to go" toast would be misleading.
      const wasShowingBanner = assignmentRemovedRef.current !== null;
      void (async () => {
        const ok = await load();
        if (ok && wasShowingBanner) setRestoredVisible(true);
      })();
    });
    } catch {
      return;
    }
    return () => sub?.remove();
  }, [ticketId, load, handlePushData]);

  // Task #623: auto-dismiss the restored confirmation after ~3s. The toast
  // is non-blocking and never requires manual dismissal.
  useEffect(() => {
    if (!restoredVisible) return;
    const handle = setTimeout(() => setRestoredVisible(false), 3000);
    return () => clearTimeout(handle);
  }, [restoredVisible]);

  // Task #615: while the assignment-removed banner is visible AND the
  // ticket detail screen is focused, silently re-fetch the ticket every
  // 7s so the screen clears itself the moment the office re-grants the
  // site / work-type assignment — matching the web behavior shipped in
  // Task #607. This complements Task #613's push-driven foreground
  // refresh: the notification path is instant when a push arrives, and
  // this 7s poll is the fallback for when no push lands (notifications
  // disabled, network drop, push delay). We use `useFocusEffect` (not
  // plain `useEffect`) so the interval is torn down whenever the user
  // navigates away — Expo Router keeps the previous screen mounted in
  // the stack on push, so a plain unmount-driven cleanup wouldn't fire.
  // `load({ silent: true })` calls `setAssignmentRemoved(null)` on every
  // successful refresh, which collapses this effect's dependency back to
  // `null` and stops the interval, so there's no extra polling load on
  // the API once the banner is gone.
  // Task #621: pause the banner-driven 7s poll when the OS sends the
  // app to the background (lock screen, app switcher, another app
  // foregrounded). The web mirror of this loop already gets the same
  // behavior for free via React Query's `refetchIntervalInBackground:
  // false`; on mobile we have to gate the interval ourselves against
  // `AppState`. We mirror the *current* state into a piece of React
  // state (not just a ref) so the polling `useFocusEffect` below
  // re-runs on transitions and tears down / restarts the interval
  // accordingly. Initial value reads `AppState.currentState` so a
  // ticket opened while the app is already backgrounded (e.g. from a
  // notification deep link before the user actually foregrounds the
  // app) doesn't immediately start polling.
  const [appForegrounded, setAppForegrounded] = useState(
    () => AppState.currentState === "active",
  );
  useEffect(() => {
    const sub = AppState.addEventListener("change", (next: AppStateStatus) => {
      setAppForegrounded(next === "active");
    });
    return () => sub.remove();
  }, []);

  useFocusEffect(
    useCallback(() => {
      if (!assignmentRemoved) return undefined;
      // Task #686: don't burn poll cycles into a 429 — the rate-limit
      // gate has already parked us, and load() short-circuits while
      // the cooldown is active anyway. The interval reschedules every
      // 7s so the moment the cooldown clears (the hook re-renders,
      // which re-fires this useFocusEffect via its `rateLimited` dep)
      // we resume polling on the next tick.
      if (rateLimited) return undefined;
      // Task #621: skip the interval entirely while backgrounded. The
      // `appForegrounded` dep makes this effect re-run on every
      // foreground/background transition, so the interval is torn
      // down on background and re-armed when the app returns to the
      // foreground (provided the banner is still up).
      if (!appForegrounded) return undefined;
      const handle = setInterval(() => {
        load({ silent: true });
      }, 7000);
      return () => clearInterval(handle);
    }, [assignmentRemoved, load, rateLimited, appForegrounded]),
  );

  useFocusEffect(
    useCallback(() => {
      const state = ticket?.lifecycleState;
      if (state === "en_route" || state === "on_site") {
        void nudgeLiveLocationReporter();
      }
    }, [ticket?.lifecycleState]),
  );

  // Task #42 — Geofence arrival auto-check-in. While the ticket is
  // en_route, subscribe to OS-driven significant-change location
  // updates (Location.watchPositionAsync with a distanceInterval — the
  // OS pushes updates instead of us polling). The moment the device
  // enters the site radius we POST to the existing check-in endpoint
  // automatically (no Alert, no confirm tap) and surface a brief
  // "Checked in — you're on site" toast so the worker realizes the
  // ticket flipped to On Site without them touching the phone.
  // Manual En Route / Check In buttons remain available as a fallback
  // if location permission is denied or the device hasn't reached the
  // radius yet.
  useEffect(() => {
    if (!ticket || ticket.lifecycleState !== "en_route") return;
    if (!siteLocation?.latitude || !siteLocation?.longitude) return;
    let cancelled = false;
    // `attempted` guards against firing the check-in POST repeatedly
    // while the device sits inside the radius emitting position events.
    // Once it flips true we ignore further "inside" pings until the
    // device clearly leaves the radius (1.5x buffer below) — so a
    // bouncing GPS reading at the boundary doesn't double-fire.
    let attempted = false;
    let sub: Location.LocationSubscription | null = null;
    const radius =
      siteLocation.siteRadiusMeters != null && siteLocation.siteRadiusMeters > 0
        ? siteLocation.siteRadiusMeters
        : 150;
    const destLat = siteLocation.latitude;
    const destLng = siteLocation.longitude;

    const distanceTo = (lat: number, lng: number) => {
      const R = 6371000;
      const toRad = (d: number) => (d * Math.PI) / 180;
      const dLat = toRad(destLat - lat);
      const dLng = toRad(destLng - lng);
      const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(lat)) * Math.cos(toRad(destLat)) * Math.sin(dLng / 2) ** 2;
      return 2 * R * Math.asin(Math.sqrt(a));
    };

    const autoCheckIn = async (lat: number, lng: number) => {
      if (attempted || cancelled) return;
      attempted = true;
      try {
        await apiFetch(`/api/tickets/${ticketId}/check-in`, {
          method: "POST",
          body: JSON.stringify({ latitude: lat, longitude: lng }),
        });
        if (cancelled) return;
        // Refresh first so the lifecycle stepper / status pill flip to
        // On Site before the toast appears — otherwise the user sees
        // "Checked in" while the screen still says En Route for a
        // beat. The toast's auto-dismiss (~3s) starts on the state
        // flip below, not on the POST returning. Gate the toast on
        // `load()` succeeding so we don't claim "Checked in" while
        // the on-screen status is still stale (e.g. the refresh
        // itself failed or got rate-limited).
        const ok = await load();
        if (!cancelled && ok) setArrivedVisible(true);
      } catch (e) {
        if (cancelled) return;
        // The auto path is silent on success — but on failure we DO
        // need to tell the user, otherwise they'd assume the auto
        // check-in worked and walk away with the ticket still in
        // En Route. Allow another attempt on the next geofence event
        // since the call failed (we never actually checked in).
        Alert.alert(
          t("tickets.couldntCheckIn"),
          translateApiError(e, t, t("tickets.pleaseTryAgain")),
        );
        attempted = false;
      }
    };

    (async () => {
      try {
        const perm = await Location.getForegroundPermissionsAsync();
        if (perm.status !== "granted" || cancelled) return;
        sub = await Location.watchPositionAsync(
          {
            // Significant-change behaviour: only emit when the device has
            // moved meaningfully (50m) or every ~10s, whichever first.
            accuracy: Location.Accuracy.Balanced,
            distanceInterval: 50,
            timeInterval: 10_000,
          },
          (pos) => {
            if (cancelled) return;
            const meters = distanceTo(
              pos.coords.latitude,
              pos.coords.longitude,
            );
            if (meters <= radius) {
              void autoCheckIn(pos.coords.latitude, pos.coords.longitude);
            } else if (meters > radius * 1.5 && attempted) {
              // User has clearly left the radius — allow re-attempting
              // if they come back later. The 1.5x buffer keeps us from
              // flapping at the boundary.
              attempted = false;
            }
          },
        );
      } catch {
        // location subscription unavailable — manual fallback still works
      }
    })();

    return () => {
      cancelled = true;
      sub?.remove();
    };
  }, [
    ticket,
    siteLocation?.latitude,
    siteLocation?.longitude,
    ticketId,
    load,
    t,
  ]);

  // Task #42 — auto-dismiss the arrival confirmation after ~3s.
  // Mirrors the cadence of the other ticket-detail toasts so they
  // never linger long enough to overlap on screen.
  useEffect(() => {
    if (!arrivedVisible) return;
    const handle = setTimeout(() => setArrivedVisible(false), 3000);
    return () => clearTimeout(handle);
  }, [arrivedVisible]);

  // Task #669: pull-to-refresh now also flashes the "Refreshed" toast on
  // success — mirroring the header refresh button so both manual paths
  // give the user the same confirmation. Failures (network blip) fall
  // through to the existing Alert from `load()`, so we never falsely
  // confirm a stale view.
  // Task #877: also drive the CrewTimeSection refresh path on the same
  // gesture. The crew handle resolves to its own `refresh()` +
  // `refreshCrew()` calls (sessions / labor summary / roster / vendor
  // crew list) — the same fan-out the 60s sync tick uses — so a foreman
  // who pulls to refresh after the office deactivates a worker sees the
  // row drop immediately instead of waiting for the next tick. We run
  // it in parallel with `load()` so neither blocks the other; the
  // toast still gates on the primary `load()` success only, since a
  // partial crew-only failure shouldn't claim "Refreshed".
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const [ok] = await Promise.all([
        load(),
        crewHandleRef.current?.refreshAll() ?? Promise.resolve(),
      ]);
      if (ok) setRefreshedVisible(true);
    } finally {
      setRefreshing(false);
    }
  }, [load]);

  // Task #669: header refresh button handler. Funneled through the same
  // `load()` the auto-poll uses (so the same primary queries are
  // invalidated). The icon swaps to a spinner while in flight so the
  // tap is acknowledged immediately. We bail if a pull-to-refresh is
  // already running to avoid stacking duplicate fetches.
  // Task #877: also fire the crew handle's `refreshAll()` so the
  // header refresh covers the same surface area as pull-to-refresh.
  const onHeaderRefresh = useCallback(() => {
    if (headerRefreshing || refreshing) return;
    setHeaderRefreshing(true);
    void (async () => {
      try {
        const [ok] = await Promise.all([
          load(),
          crewHandleRef.current?.refreshAll() ?? Promise.resolve(),
        ]);
        if (ok) setRefreshedVisible(true);
      } finally {
        setHeaderRefreshing(false);
      }
    })();
  }, [headerRefreshing, refreshing, load]);

  // Task #669: auto-dismiss the "Refreshed" toast after ~3s. Same cadence
  // as the assignment-restored toast above so the two never linger long
  // enough to overlap on screen.
  useEffect(() => {
    if (!refreshedVisible) return;
    const handle = setTimeout(() => setRefreshedVisible(false), 3000);
    return () => clearTimeout(handle);
  }, [refreshedVisible]);

  const addItem = async () => {
    if (!itemDesc.trim()) {
      Alert.alert(t("tickets.missingTitle"), t("tickets.missingDescription"));
      return;
    }
    // The API expects `type` (not `itemType`) and the numeric columns are
    // stored as strings on the wire (drizzle `numeric` -> string in zod).
    // Sending `itemType` or numbers caused a 400 that surfaced as the generic
    // "request couldn't be processed" toast.
    const qtyNum = Number(qty);
    const priceNum = Number(unitPrice);
    try {
      await apiFetch(`/api/tickets/${ticketId}/line-items`, {
        method: "POST",
        body: JSON.stringify({
          type: itemType,
          description: itemDesc.trim(),
          quantity: String(Number.isFinite(qtyNum) && qtyNum > 0 ? qtyNum : 1),
          unitPrice: String(Number.isFinite(priceNum) && priceNum >= 0 ? priceNum : 0),
        }),
      });
      setItemDesc("");
      setQty("1");
      setUnitPrice("0");
      load();
    } catch (e: unknown) {
      Alert.alert(t("common.error"), translateApiError(e, t, t("tickets.errorAddLineItem")));
    }
  };

  const deleteNote = async (noteId: number, isPhoto: boolean) => {
    const title = isPhoto ? t("tickets.deletePhotoTitle") : t("tickets.deleteNoteTitle");
    const message = isPhoto ? t("tickets.deletePhotoBody") : t("tickets.deleteNoteBody");
    Alert.alert(title, message, [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("common.delete"),
        style: "destructive",
        onPress: async () => {
          try {
            await apiFetch(
              `/api/tickets/${ticketId}/note-logs/${noteId}`,
              { method: "DELETE" },
            );
            load();
          } catch (e: unknown) {
            Alert.alert(t("common.error"), translateApiError(e, t, t("tickets.errorDelete")));
          }
        },
      },
    ]);
  };

  const deleteItem = async (lineItemId: number) => {
    try {
      await apiFetch(
        `/api/tickets/${ticketId}/line-items/${lineItemId}`,
        { method: "DELETE" },
      );
      load();
    } catch (e: unknown) {
      Alert.alert(t("common.error"), translateApiError(e, t, t("tickets.errorDelete")));
    }
  };

  const addPhotoNote = async () => {
    try {
      const result = await captureAndUploadImage();
      if (!result) return;
      await apiFetch(`/api/tickets/${ticketId}/note-logs`, {
        method: "POST",
        body: JSON.stringify({ content: `[photo] ${result.objectPath}` }),
      });
      load();
    } catch (e: unknown) {
      Alert.alert(t("common.error"), translateApiError(e, t, t("tickets.errorAttachPhoto")));
    }
  };

  // Task #852 — snap a proof-of-payment image from inside the Disperse
  // Funds modal. Uses the shared `captureAndUploadImage` helper (camera
  // permission + presigned upload) and stashes the resulting object
  // path on local state. Submit later includes it as
  // `paymentReceiptUrl`. We deliberately keep this lightweight (no
  // server round-trip until the modal submits) so the AP user can
  // re-snap before committing the dispersal.
  const captureDisperseReceipt = async () => {
    if (disperseReceiptUploading) return;
    setDisperseReceiptUploading(true);
    try {
      const result = await captureAndUploadImage();
      if (!result) return;
      setDisperseReceiptUrl(result.objectPath);
    } catch (e: unknown) {
      Alert.alert(
        t("common.error"),
        translateApiError(e, t, t("tickets.errorAttachPhoto")),
      );
    } finally {
      setDisperseReceiptUploading(false);
    }
  };

  const addNote = async () => {
    if (!noteContent.trim()) return;
    try {
      await apiFetch(`/api/tickets/${ticketId}/note-logs`, {
        method: "POST",
        body: JSON.stringify({ content: noteContent.trim() }),
      });
      setNoteContent("");
      load();
    } catch (e: unknown) {
      Alert.alert(t("common.error"), translateApiError(e, t, t("tickets.errorAddNote")));
    }
  };

  const [actionInFlight, setActionInFlight] = useState<
    | "check_in"
    | "check_out"
    | "close"
    // Foreman / vendor-admin / org-admin pressed "Close Ticket" — final
    // pass of regenerateAutoLaborLines on the server, then closedAt is
    // stamped and the running [auto] labor totals freeze.
    | "close_ticket"
    | "en_route"
    | "on_location"
    | "awaiting_payment"
    | "disperse_funds"
    // Task #853 — AP self-service reverse-dispersal POST is in flight.
    // Used to disable the trigger + confirm/cancel buttons in the
    // reverse-dispersal sheet so the row can't be submitted twice.
    | "reverse_dispersal"
    | null
  >(null);

  // ── Task #575: awaiting-payment confirmation sheet ──
  // Field crews tap "Mark Awaiting Payment" on an in-progress ticket to
  // flag that the work is wrapped on site and the customer owes payment.
  // The sheet captures an optional free-text note (max 500 chars) which
  // is recorded on the status_history transition by the server.
  const [awaitingPaymentOpen, setAwaitingPaymentOpen] = useState(false);
  const [awaitingPaymentNote, setAwaitingPaymentNote] = useState("");

  // ── Task #600: Disperse Funds modal ──
  // AP partners (and admins) tap Disperse Funds on an approved or
  // awaiting_payment ticket to record the closing payment. The modal
  // collects payment method, an optional reference (required when the
  // method is "check"), and an optional internal note. The submit POSTs
  // to /api/tickets/:id/disperse-funds and the server flips the ticket
  // to funds_dispersed and snapshots the metadata. Mirrors the web
  // dialog state at artifacts/vndrly/src/pages/ticket-detail.tsx.
  const [disperseOpen, setDisperseOpen] = useState(false);
  const [disperseMethod, setDisperseMethod] = useState<"etf" | "check" | "other">(
    "etf",
  );
  const [disperseRef, setDisperseRef] = useState("");
  const [disperseNote, setDisperseNote] = useState("");
  // Task #852 — optional proof-of-payment image. AP taps "Attach receipt"
  // inside the modal to snap a photo with `captureAndUploadImage`; on
  // success we hold the returned object path here and ship it as
  // `paymentReceiptUrl` on submit. `disperseReceiptUploading` drives the
  // button spinner; `null` means nothing attached yet.
  const [disperseReceiptUrl, setDisperseReceiptUrl] = useState<string | null>(
    null,
  );
  const [disperseReceiptUploading, setDisperseReceiptUploading] = useState(false);
  const resetDisperseForm = () => {
    setDisperseMethod("etf");
    setDisperseRef("");
    setDisperseNote("");
    setDisperseReceiptUrl(null);
    setDisperseReceiptUploading(false);
  };
  // Task #853 — AP self-service "Reverse dispersal" sheet state. The
  // trigger is hidden behind `ticket.viewerCanReverseDispersal` (server
  // returns true for admin OR partner-AP viewers when the ticket is
  // still in `funds_dispersed`). Kept separate from the disperse modal
  // state above so opening one never bleeds into the other.
  const [reverseDispersalOpen, setReverseDispersalOpen] = useState(false);
  const [reverseDispersalReason, setReverseDispersalReason] = useState("");
  const resetReverseDispersalForm = () => {
    setReverseDispersalReason("");
  };

  const captureCoords = async (): Promise<{
    lat: number | null;
    lng: number | null;
  }> => {
    // Strategy: get an actual lat/lng whenever possible, but never let the
    // GPS subsystem block the user from completing an action.
    //   1. Request permission (already pre-warmed on mount, so this is a
    //      no-op when granted).
    //   2. Try `getLastKnownPositionAsync` first — returns instantly when
    //      iOS has a cached fix from any other app.
    //   3. Fall back to a fresh `getCurrentPositionAsync` with a 6s ceiling
    //      so a cold first-fix in Expo Go doesn't strand the user.
    //   4. If everything times out, return {null, null} so the action still
    //      goes through (server schema accepts null GPS).
    const withTimeout = <T,>(p: Promise<T>, ms: number): Promise<T> =>
      new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("location_timeout")), ms);
        p.then(
          (v) => { clearTimeout(timer); resolve(v); },
          (e) => { clearTimeout(timer); reject(e); },
        );
      });
    try {
      const perm = await withTimeout(
        Location.requestForegroundPermissionsAsync(),
        5000,
      );
      if (perm.status !== "granted") return { lat: null, lng: null };
      // Fast path: cached fix from the OS, usually <50ms.
      try {
        const last = await Location.getLastKnownPositionAsync({
          maxAge: 60_000,
          requiredAccuracy: 100,
        });
        if (last) {
          return { lat: last.coords.latitude, lng: last.coords.longitude };
        }
      } catch {
        // ignore and fall through to fresh fix
      }
      const pos = await withTimeout(
        Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        }),
        6000,
      );
      return { lat: pos.coords.latitude, lng: pos.coords.longitude };
    } catch {
      return { lat: null, lng: null };
    }
  };

  // Task #532: shared error router. Per-control errors render inline
  // under whichever button just failed; conflict codes (server says the
  // ticket has moved on) trigger a refresh and silently clear the
  // inline error so the user sees the new state instead of a stale
  // message under a button that may no longer be relevant.
  const handleActionError = useCallback(
    async (
      e: unknown,
      preferredField: Exclude<TicketActionField, "general">,
      fallback: string,
    ): Promise<void> => {
      // Task #572: assignment-removed codes are not state conflicts (the
      // ticket itself hasn't moved), but they are *also* not actionable
      // by retrying the same button. Route them to the banner state so
      // the screen offers "contact dispatch / cancel ticket" instead of
      // pinning a confusing message inline under whichever button just
      // failed.
      const code =
        e && typeof e === "object" && "data" in e
          ? (e as { data?: { error?: string } }).data?.error
          : undefined;
      if (
        code === "site_vendor_mismatch" ||
        code === "work_type_not_allowed"
      ) {
        setAssignmentRemoved(code);
        // Clear any per-control message so the user isn't shown both a
        // banner and a stale inline error at once.
        setFieldError(null);
        return;
      }
      const inline = inlineErrorForTicketAction(e, t, preferredField, fallback);
      if (inline.isStateConflict) {
        await load();
        setFieldError(null);
        return;
      }
      setFieldError({ field: inline.field, message: inline.message });
    },
    [load, t],
  );

  // Task #572: confirm + cancel the ticket from the assignment-removed
  // banner. The cancel endpoint already enforces the right permissions
  // (field employees may cancel their own tickets once accepted; the
  // server returns ticket_funds_dispersed / ticket_not_accepted etc. if
  // not allowed) — so we just surface a friendly toast on failure and
  // navigate home on success.
  const cancelFromAssignmentBanner = useCallback(() => {
    Alert.alert(
      t("tickets.assignmentRemovedConfirmTitle"),
      t("tickets.assignmentRemovedConfirmBody"),
      [
        { text: t("tickets.assignmentRemovedKeep"), style: "cancel" },
        {
          text: t("tickets.assignmentRemovedConfirm"),
          style: "destructive",
          onPress: async () => {
            setCancelInFlight(true);
            try {
              await apiFetch(`/api/tickets/${ticketId}/cancel`, {
                method: "POST",
              });
              router.replace("/(tabs)");
            } catch (e) {
              Alert.alert(
                t("common.error"),
                translateApiError(e, t, t("tickets.assignmentRemovedCancelFailed")),
              );
            } finally {
              setCancelInFlight(false);
            }
          },
        },
      ],
    );
  }, [t, ticketId]);

  const onLocation = async () => {
    setActionInFlight("on_location");
    setFieldError(null);
    try {
      const { lat, lng } = await captureCoords();
      await apiFetch(`/api/tickets/${ticketId}/on-location`, {
        method: "POST",
        body: JSON.stringify({ latitude: lat, longitude: lng }),
      });
      await load();
    } catch (e: unknown) {
      await handleActionError(e, "on_location", t("tickets.errorOnLocation"));
    } finally {
      setActionInFlight(null);
    }
  };

  // T004: actual /en-route call, optionally carrying the starting odometer.
  // The button-press handler `enRoute` opens the mileage prompt which then
  // calls back into here with either a parsed number or `null` (skipped).
  const runEnRoute = async (startingMileage: number | null) => {
    setActionInFlight("en_route");
    setFieldError(null);
    try {
      const { lat, lng } = await captureCoords();
      const resp = await apiFetch<{ mapsUrl: string }>(
        `/api/tickets/${ticketId}/en-route`,
        {
          method: "POST",
          body: JSON.stringify({
            latitude: lat,
            longitude: lng,
            ...(startingMileage != null ? { startingMileage } : {}),
          }),
        },
      );
      await load();
      if (resp?.mapsUrl) {
        const { Linking } = await import("react-native");
        Linking.openURL(resp.mapsUrl).catch(() => {});
      }
    } catch (e: unknown) {
      await handleActionError(e, "en_route", t("tickets.errorEnRoute"));
    } finally {
      setActionInFlight(null);
    }
  };
  const enRoute = () => {
    setMileageInput("");
    setMileageError(null);
    setMileagePromptFor("en_route");
  };

  // ── Task #494: vendor accepts/denies a partner-self-service invite ──
  const acceptInvite = async () => {
    setInviteAction("accept");
    setFieldError(null);
    try {
      await apiFetch(`/api/tickets/${ticketId}/accept`, { method: "POST" });
      await load();
    } catch (e: unknown) {
      await handleActionError(e, "accept", t("tickets.errorAcceptInvite"));
    } finally {
      setInviteAction(null);
    }
  };

  const denyInvite = async () => {
    const reason = denyReason.trim();
    if (!reason) return;
    setInviteAction("deny");
    setFieldError(null);
    try {
      await apiFetch(`/api/tickets/${ticketId}/deny`, {
        method: "POST",
        body: JSON.stringify({ reason }),
      });
      setDenyOpen(false);
      setDenyReason("");
      await load();
    } catch (e: unknown) {
      await handleActionError(e, "deny", t("tickets.errorDenyInvite"));
    } finally {
      setInviteAction(null);
    }
  };

  const checkIn = async () => {
    setActionInFlight("check_in");
    setFieldError(null);
    try {
      const { lat, lng } = await captureCoords();
      await apiFetch(`/api/tickets/${ticketId}/check-in`, {
        method: "POST",
        body: JSON.stringify({ latitude: lat, longitude: lng }),
      });
      await load();
    } catch (e: unknown) {
      await handleActionError(e, "check_in", t("tickets.errorCheckIn"));
    } finally {
      setActionInFlight(null);
    }
  };

  // T004: counterpart of runEnRoute — the actual /check-out call carrying
  // the optional ending odometer reading. The button handler `checkOut`
  // opens the same shared prompt; this runs whether the user submits a
  // value or skips.
  const runCheckOut = async (endingMileage: number | null) => {
    setActionInFlight("check_out");
    setFieldError(null);
    try {
      const { lat, lng } = await captureCoords();
      await apiFetch(`/api/tickets/${ticketId}/check-out`, {
        method: "POST",
        body: JSON.stringify({
          latitude: lat,
          longitude: lng,
          workCompleted: false,
          ...(endingMileage != null ? { endingMileage } : {}),
        }),
      });
      await load();
    } catch (e: unknown) {
      await handleActionError(e, "check_out", t("tickets.errorCheckOut"));
    } finally {
      setActionInFlight(null);
    }
  };
  const checkOut = () => {
    setMileageInput("");
    setMileageError(null);
    setMileagePromptFor("check_out");
  };
  // Shared confirm/skip handlers for the mileage modal. Submit parses the
  // input and rejects junk inline (the server validates again, but we want
  // a faster local round-trip). Skip is explicit so a user that genuinely
  // doesn't have an odometer reading isn't trapped behind a required field.
  const submitMileagePrompt = () => {
    const which = mileagePromptFor;
    if (!which) return;
    const trimmed = mileageInput.trim();
    if (trimmed === "") {
      setMileageError(t("tickets.mileageRequired"));
      return;
    }
    const n = Number(trimmed);
    if (!Number.isFinite(n) || n < 0) {
      setMileageError(t("tickets.mileageInvalid"));
      return;
    }
    setMileagePromptFor(null);
    if (which === "en_route") void runEnRoute(n);
    else void runCheckOut(n);
  };
  const skipMileagePrompt = () => {
    const which = mileagePromptFor;
    if (!which) return;
    setMileagePromptFor(null);
    if (which === "en_route") void runEnRoute(null);
    else void runCheckOut(null);
  };

  // Foreman / vendor-admin / org-admin freezes the per-employee running
  // [auto] labor totals. Server runs a final regenerateAutoLaborLines,
  // stamps closedAt + closedById, and short-circuits future regen calls
  // so accounting can edit the rows by hand without late check-out
  // events overwriting them.
  const closeTicketFinal = async () => {
    Alert.alert(
      t("tickets.closeTicketTitle"),
      t("tickets.closeTicketBody"),
      [
        { text: t("common.cancel"), style: "cancel" },
        {
          text: t("tickets.closeTicket"),
          style: "destructive",
          onPress: async () => {
            setActionInFlight("close_ticket");
            setFieldError(null);
            try {
              await apiFetch(`/api/tickets/${ticketId}/close`, { method: "POST" });
              await load();
            } catch (e: unknown) {
              await handleActionError(e, "close", t("tickets.errorCloseTicket"));
            } finally {
              setActionInFlight(null);
            }
          },
        },
      ],
    );
  };

  const submitForReview = async () => {
    setActionInFlight("close");
    setFieldError(null);
    try {
      await apiFetch(`/api/tickets/${ticketId}/submit`, { method: "POST" });
      Alert.alert(
        t("tickets.sentToOfficeTitle"),
        t("tickets.sentToOfficeBody"),
        [{ text: t("common.ok"), onPress: () => router.replace("/(tabs)") }],
      );
    } catch (e: unknown) {
      await handleActionError(e, "close", t("tickets.errorClose"));
    } finally {
      setActionInFlight(null);
    }
  };

  // Task #575: POST /tickets/:id/awaiting-payment from the confirmation
  // sheet. The note is optional (server validates length up to 500 chars
  // and surfaces `invalid_awaiting_payment_body` if we ever send a longer
  // one — the TextInput's maxLength keeps us inside that bound). On
  // success we close the sheet, refresh the ticket so the new status
  // shows immediately, and bounce back to the tabs so the list refreshes
  // — mirroring the post-submit flow.
  const markAwaitingPayment = async () => {
    setActionInFlight("awaiting_payment");
    setFieldError(null);
    try {
      const trimmed = awaitingPaymentNote.trim();
      const body = trimmed ? { note: trimmed } : {};
      await apiFetch(`/api/tickets/${ticketId}/awaiting-payment`, {
        method: "POST",
        body: JSON.stringify(body),
      });
      setAwaitingPaymentOpen(false);
      setAwaitingPaymentNote("");
      await load();
      Alert.alert(
        t("tickets.awaitingPaymentSentTitle"),
        t("tickets.awaitingPaymentSentBody"),
        [{ text: t("common.ok"), onPress: () => router.replace("/(tabs)") }],
      );
    } catch (e: unknown) {
      await handleActionError(
        e,
        "awaiting_payment",
        t("tickets.errorAwaitingPayment"),
      );
    } finally {
      setActionInFlight(null);
    }
  };

  // Task #600: POST /tickets/:id/disperse-funds from the AP modal. The
  // server enforces the AP role and the approved-OR-awaiting_payment
  // status guard server-side; we still pre-validate the check #
  // requirement client-side so the user sees a friendly inline message
  // instead of a 400 round-trip. On success we close the modal, refresh
  // the ticket so the funds_dispersed pill + payment summary card render
  // immediately, and surface a confirmation alert.
  const disperseFunds = async () => {
    setFieldError(null);
    const ref = disperseRef.trim();
    if (disperseMethod === "check" && !ref) {
      setFieldError({
        field: "disperse_funds",
        message: t("ticketDetail.disperseFundsReferenceRequired", {
          defaultValue: "Reference is required for check payments.",
        }),
      });
      return;
    }
    setActionInFlight("disperse_funds");
    try {
      const note = disperseNote.trim();
      // Mirror the web payload shape — only send `paymentReference` /
      // `note` / `paymentReceiptUrl` when present so the server-side
      // trim()/null fallback doesn't store empty strings instead of
      // NULLs. Task #852 added the optional receipt photo.
      const body: {
        paymentMethod: "etf" | "check" | "other";
        paymentReference?: string;
        note?: string;
        paymentReceiptUrl?: string;
      } = { paymentMethod: disperseMethod };
      if (ref) body.paymentReference = ref;
      if (note) body.note = note;
      if (disperseReceiptUrl) body.paymentReceiptUrl = disperseReceiptUrl;
      await apiFetch(`/api/tickets/${ticketId}/disperse-funds`, {
        method: "POST",
        body: JSON.stringify(body),
      });
      setDisperseOpen(false);
      resetDisperseForm();
      await load();
      Alert.alert(
        t("ticketDetail.disperseFundsSuccess", { defaultValue: "Funds dispersed." }),
        "",
        [{ text: t("common.ok") }],
      );
    } catch (e: unknown) {
      await handleActionError(
        e,
        "disperse_funds",
        t("ticketDetail.disperseFundsError", {
          defaultValue: "Couldn't disperse funds. Please try again.",
        }),
      );
    } finally {
      setActionInFlight(null);
    }
  };

  // Task #853 — POST /tickets/:id/reverse-dispersal from the AP-self-service
  // sheet. Server enforces admin-or-AP role and the funds_dispersed status
  // guard, snapshots the existing payment columns into payment_audit, then
  // clears the columns and flips status back to `approved`. We pre-validate
  // the non-empty reason client-side so the user gets an inline message
  // instead of a 400 round-trip; success closes the sheet and reloads the
  // ticket so the Payment Details card disappears immediately.
  const reverseDispersal = async () => {
    setFieldError(null);
    const reason = reverseDispersalReason.trim();
    if (!reason) {
      setFieldError({
        field: "reverse_dispersal",
        message: t("ticketDetail.reverseDispersalReasonRequired", {
          defaultValue: "A reason is required.",
        }),
      });
      return;
    }
    setActionInFlight("reverse_dispersal");
    try {
      await apiFetch(`/api/tickets/${ticketId}/reverse-dispersal`, {
        method: "POST",
        body: JSON.stringify({ reason }),
      });
      setReverseDispersalOpen(false);
      resetReverseDispersalForm();
      await load();
      Alert.alert(
        t("ticketDetail.reverseDispersalSuccess", {
          defaultValue: "Dispersal reversed.",
        }),
        "",
        [{ text: t("common.ok") }],
      );
    } catch (e: unknown) {
      await handleActionError(
        e,
        "reverse_dispersal",
        t("ticketDetail.reverseDispersalError", {
          defaultValue: "Couldn't reverse dispersal. Please try again.",
        }),
      );
    } finally {
      setActionInFlight(null);
    }
  };

  const checkOutOpenCrewThenSubmit = async (
    openSessions: Array<{ employeeId: number; employeeName: string | null }>,
  ) => {
    setActionInFlight("close");
    setFieldError(null);
    try {
      // Best-effort: dedupe by employee, attempt check-out for each. We don't
      // have GPS here (system-initiated close-out) so the server falls back
      // to a null location, which is acceptable for an admin-style force out.
      const uniqueEmpIds = Array.from(new Set(openSessions.map(s => s.employeeId)));
      const results = await Promise.allSettled(
        uniqueEmpIds.map(empId =>
          apiFetch(`/api/tickets/${ticketId}/crew/${empId}/check-out`, {
            method: "POST",
            body: JSON.stringify({}),
          }),
        ),
      );
      const rejectedIndices = results
        .map((r, i) => (r.status === "rejected" ? i : -1))
        .filter(i => i >= 0);
      const rejected = rejectedIndices.map(
        i => results[i] as PromiseRejectedResult,
      );
      if (rejected.length > 0) {
        // If any rejection is a state-conflict code (e.g. the ticket has
        // since been cancelled or moved on), treat the whole step as a
        // state conflict: refresh the ticket and clear any inline error,
        // matching the main-flow handling. Otherwise pin the partial-
        // checkout failure inline on the close button so the user can
        // retry without dismissing an alert and scrolling back up.
        const stateConflict = rejected.find(
          r => inlineErrorForTicketAction(r.reason, t, "close", "").isStateConflict,
        );
        if (stateConflict) {
          await handleActionError(stateConflict.reason, "close", t("tickets.errorClose"));
          setActionInFlight(null);
          return;
        }
        // Task #554: name the specific crew members whose force-checkout
        // failed so the user knows exactly who needs manual attention,
        // instead of having to scroll back up and visually compare.
        // Names line up with `uniqueEmpIds`; long lists get truncated to
        // the first two names plus "…and N more" so the inline error
        // doesn't take over the screen.
        const nameById = new Map<number, string>();
        for (const s of openSessions) {
          if (!nameById.has(s.employeeId)) {
            nameById.set(
              s.employeeId,
              s.employeeName ?? t("tickets.crewStillUnknown", { id: s.employeeId }),
            );
          }
        }
        const failedNames = rejectedIndices.map(
          i => nameById.get(uniqueEmpIds[i]) ?? t("tickets.crewStillUnknown", { id: uniqueEmpIds[i] }),
        );
        let message: string;
        if (failedNames.length === 1) {
          message = t("tickets.couldntCheckEveryoneOutOne", { name: failedNames[0] });
        } else if (failedNames.length === 2) {
          message = t("tickets.couldntCheckEveryoneOutTwo", {
            first: failedNames[0],
            second: failedNames[1],
          });
        } else if (failedNames.length === 3) {
          message = t("tickets.couldntCheckEveryoneOutThree", {
            first: failedNames[0],
            second: failedNames[1],
            third: failedNames[2],
          });
        } else {
          message = t("tickets.couldntCheckEveryoneOutMany", {
            first: failedNames[0],
            second: failedNames[1],
            rest: failedNames.length - 2,
          });
        }
        setFieldError({ field: "close", message });
        setActionInFlight(null);
        await load();
        return;
      }
      // All checked out — proceed with submit.
      await apiFetch(`/api/tickets/${ticketId}/submit`, { method: "POST" });
      Alert.alert(
        t("tickets.sentToOfficeTitle"),
        t("tickets.sentToOfficeBodyCrew"),
        [{ text: t("common.ok"), onPress: () => router.replace("/(tabs)") }],
      );
    } catch (e: unknown) {
      // Mirror the main `submitForReview` flow: route the error through
      // `handleActionError` so a state-conflict code refreshes the ticket
      // (and clears the inline message), and any other failure pins
      // inline on the close button instead of an alert.
      await handleActionError(e, "close", t("tickets.errorClose"));
    } finally {
      setActionInFlight(null);
    }
  };

  const closeForReview = async () => {
    // First, look for any crew that's still checked in. If found, require an
    // explicit second confirmation before force-checking them out, since this
    // step can be hard to undo (it ends their session and snapshots time).
    let openSessions: Array<{ employeeId: number; employeeName: string | null; checkOutAt: string | null }> = [];
    try {
      setActionInFlight("close");
      const sessions = await apiFetch<Array<{ employeeId: number; employeeName: string | null; checkOutAt: string | null }>>(
        `/api/tickets/${ticketId}/crew-sessions`,
      );
      openSessions = sessions.filter(s => !s.checkOutAt);
    } catch {
      // If we can't read sessions for any reason, fall back to original flow.
    } finally {
      setActionInFlight(null);
    }

    if (openSessions.length > 0) {
      const names = Array.from(
        new Set(openSessions.map(s => s.employeeName ?? t("tickets.crewStillUnknown", { id: s.employeeId }))),
      );
      const list = names.length <= 5
        ? names.join("\n• ")
        : t("tickets.crewStillMore", { first: names.slice(0, 5).join("\n• "), rest: names.length - 5 });
      Alert.alert(
        t("tickets.crewStillTitle"),
        t("tickets.crewStillBody", { count: names.length, list }),
        [
          { text: t("common.cancel"), style: "cancel" },
          {
            text: t("tickets.checkOutAndClose"),
            style: "destructive",
            onPress: () => { void checkOutOpenCrewThenSubmit(openSessions); },
          },
        ],
      );
      return;
    }

    Alert.alert(
      t("tickets.closeForReviewTitle"),
      t("tickets.closeForReviewBody"),
      [
        { text: t("common.cancel"), style: "cancel" },
        { text: t("tickets.closeForReview"), style: "default", onPress: () => { void submitForReview(); } },
      ],
    );
  };

  type HistoryEvent = {
    key: string;
    label: string;
    detail?: string;
    at: string;
    coords?: { latitude: number; longitude: number };
  };

  const historyEvents = useMemo<HistoryEvent[]>(() => {
    if (!ticket) return [];
    const events: HistoryEvent[] = [];
    if (ticket.createdAt) {
      events.push({
        key: "created",
        label: t("tickets.eventCreated"),
        // Task #508: when the office logged this ticket from a phoned-in
        // request, surface the caller name so the field crew sees who
        // opened the job (e.g. "Created via phone — caller: Pat Partner").
        detail: ticket.phoneIntakeCallerName
          ? t("tickets.eventCreatedViaPhoneCaller", {
              name: ticket.phoneIntakeCallerName,
            })
          : undefined,
        at: ticket.createdAt,
      });
    }
    for (const log of gpsLogs) {
      const niceLabel =
        log.eventType === "check_in"
          ? t("tickets.eventCheckedIn")
          : log.eventType === "check_out"
            ? t("tickets.eventCheckedOut")
            : log.eventType === "tracking"
              ? t("tickets.eventLocationPinged")
              : log.eventType.replace(/_/g, " ");
      events.push({
        key: `gps-${log.id}`,
        label: niceLabel,
        detail: `${log.latitude.toFixed(5)}, ${log.longitude.toFixed(5)}`,
        at: log.recordedAt,
        coords: { latitude: log.latitude, longitude: log.longitude },
      });
    }
    if (ticket.kickbackReason) {
      events.push({
        key: "kickback",
        label: t("tickets.eventKickedBack"),
        detail: ticket.kickbackReason,
        at: ticket.checkOutTime || ticket.createdAt || new Date().toISOString(),
      });
    }
    return events.sort(
      (a, b) => new Date(a.at).getTime() - new Date(b.at).getTime(),
    );
  }, [ticket, gpsLogs, t]);

  const isEditable = ticket
    ? ["draft", "in_progress", "pending_review", "kicked_back"].includes(
        ticket.status,
      )
    : false;

  const canShowSchedule =
    isEditable &&
    (currentUser?.role === "admin" ||
      currentUser?.role === "vendor" ||
      (currentUser?.role === "field_employee" &&
        (currentUser.vendorRole === "foreman" || currentUser.vendorRole === "both")));

  const subtotal = items.reduce((sum, it) => {
    const q = typeof it.quantity === "string" ? parseFloat(it.quantity) : it.quantity;
    const p = typeof it.unitPrice === "string" ? parseFloat(it.unitPrice) : it.unitPrice;
    return sum + (q || 0) * (p || 0);
  }, 0);
  const taxAmount = subtotal * taxRate;
  const grandTotal = subtotal + taxAmount;

  if (loading || !ticket) {
    // Task #686: when the screen mounts during an active rate-limit
    // cooldown there's no ticket data to render, but we still owe the
    // user a clear "we're paused, will retry shortly" affordance —
    // otherwise they're staring at a silent spinner with no sense of
    // why nothing is loading. Surface the same reconnecting toast
    // copy the bottom-of-screen toast uses so the message is
    // consistent across the parked-while-loaded and parked-on-mount
    // cases.
    return (
      <View
        style={[styles.center, { backgroundColor: colors.background }]}
        testID="ticket-detail-loading"
      >
        <ActivityIndicator color={colors.primary} />
        {rateLimited ? (
          <View
            style={[
              styles.restoredToast,
              styles.rateLimitedToast,
              { marginTop: 16 },
            ]}
            testID="toast-ticket-rate-limited"
          >
            <Feather name="clock" size={16} color="#ffffff" />
            <Text style={styles.restoredToastText}>
              {t("tickets.rateLimitedToast", {
                seconds: retryAfterSeconds ?? 0,
              })}
            </Text>
          </View>
        ) : null}
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
    <NudgeFlashOverlay active={isNudgeFlashing} borderRadius={0} />
    {/* ── Task #669: header refresh button ──
        We render this via Stack.Screen.headerRight so it lives in the
        native nav bar alongside the back affordance — same pattern the
        web dispatcher uses for the connection pill (Task #667). The
        icon swaps to a spinner while in flight so the tap is
        acknowledged without waiting for the toast.
        ── Task #678: also render the FreshnessPill here so the
        connection/freshness indicator sits directly next to the
        manual-refresh affordance — same visual grouping the web pill
        gets next to its "Refresh now" button. */}
    {/* Task: drop the native nav header (back arrow + title + Live pill +
        refresh) into the page body so the controls sit just above the
        tracking number instead of being clipped by the device status bar /
        notch. The InPageHeader renders the same affordances inside the
        scroll content with the proper top safe-area inset. */}
    <Stack.Screen options={{ headerShown: false }} />
    <InPageHeader
      title={t("stack.tracking")}
      right={
        <>
          <ActiveOrgIndicator />
          <FreshnessPill
            lastLoadedAt={lastLoadedAt}
            inFlight={loading || headerRefreshing || refreshing}
            errored={loadError != null}
            rateLimited={rateLimited}
            testID="ticket-detail-freshness-pill"
          />
          <TouchableOpacity
            onPress={onHeaderRefresh}
            disabled={headerRefreshing || refreshing || rateLimited}
            accessibilityRole="button"
            accessibilityLabel={t("tickets.refreshDetailAccessibility")}
            accessibilityHint={t("tickets.refreshDetailAccessibilityHint")}
            accessibilityState={{
              disabled: headerRefreshing || refreshing || rateLimited,
              busy: headerRefreshing,
            }}
            testID="button-refresh-ticket-detail"
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            style={{
              paddingHorizontal: 8,
              paddingVertical: 6,
              opacity: headerRefreshing || refreshing || rateLimited ? 0.6 : 1,
            }}
          >
            {headerRefreshing ? (
              <ActivityIndicator size="small" color={colors.primary} />
            ) : (
              <Feather name="refresh-cw" size={20} color={colors.primary} />
            )}
          </TouchableOpacity>
        </>
      }
    />
    <ScrollView
      ref={scrollRef}
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          tintColor={colors.primary}
          colors={[colors.primary]}
        />
      }
    >
      <View
        style={[
          styles.card,
          { backgroundColor: colors.card, borderColor: colors.border },
        ]}
      >
        <Text style={[styles.title, { color: colors.foreground }]} testID="text-ticket-tracking-number">
          {formatTicketTrackingNumber(ticket.id)} · {ticket.siteName || "—"}
        </Text>
        <Text style={[styles.meta, { color: colors.mutedForeground }]}>
          {ticket.workTypeName || "—"}
          {ticket.partnerName ? ` · ${ticket.partnerName}` : ""}
        </Text>
        {ticket.afe ? (
          <View
            style={{
              alignSelf: "flex-start",
              marginTop: 4,
              paddingHorizontal: 12,
              height: 22,
              justifyContent: "center",
              borderRadius: 999,
              overflow: "hidden",
              position: "relative",
            }}
          >
            <Pill9Slice
              source={require("@/assets/pill-stack/blue-hot.png")}
              height={22}
            />
            <Text
              style={{
                color: "#ffffff",
                fontSize: 11,
                fontFamily: "Inter_400Regular",
                textShadowColor: "rgba(0,0,0,0.55)",
                textShadowOffset: { width: 0, height: 1 },
                textShadowRadius: 2,
              }}
            >
              {ticket.afe}
            </Text>
          </View>
        ) : null}
        {(() => {
          // Task: status pill switches to the layered blue pill image
          // for the "hot" working states (initiated / in_progress) so
          // the badge visually matches the action buttons. Other
          // statuses keep the semantic color from `ticketStatusPillStyle`.
          const isBlueHot =
            ticket.status === "initiated" || ticket.status === "in_progress";
          const label = ticketStatusLabel(ticket.status, t);
          if (isBlueHot) {
            return (
              <View
                style={[
                  styles.statusPill,
                  {
                    paddingHorizontal: 12,
                    height: 22,
                    justifyContent: "center",
                    overflow: "hidden",
                    position: "relative",
                  },
                ]}
                testID="badge-ticket-detail-status"
              >
                <Pill9Slice
                  source={require("@/assets/pill-stack/blue-hot.png")}
                  height={22}
                />
                <Text
                  style={[
                    styles.statusPillText,
                    {
                      color: "#ffffff",
                      textShadowColor: "rgba(0,0,0,0.55)",
                      textShadowOffset: { width: 0, height: 1 },
                      textShadowRadius: 2,
                    },
                  ]}
                >
                  {label}
                </Text>
              </View>
            );
          }
          const pill = ticketStatusPillStyle(ticket.status);
          return (
            <View
              style={[styles.statusPill, { backgroundColor: pill.background }]}
              testID="badge-ticket-detail-status"
            >
              <Text style={[styles.statusPillText, { color: pill.foreground }]}>
                {label}
              </Text>
            </View>
          );
        })()}
        <View style={{ marginTop: 12, marginBottom: 4 }}>
          <TicketStatusStepper status={ticket.status} />
        </View>
        {/* ── Task #56 — Live location status indicator ──
            Visible only while the ticket is en_route or on_site (the
            two phases where the background reporter is supposed to
            be sending pings). The pill polls the reporter's status
            surface every 30s and on app resume so an OS throttle,
            revoked permission, or low-power-mode pause surfaces to
            the worker before dispatch has to call them. */}
        {ticket.lifecycleState === "en_route" ||
        ticket.lifecycleState === "on_site" ? (
          <LiveLocationStatusPill
            enabled
            testID="ticket-detail-live-location-pill"
          />
        ) : null}
        {ticket.unlockedAt ? (
          <TouchableOpacity
            onPress={() =>
              scrollRef.current?.scrollTo({
                y: Math.max(0, unlockHistoryY.current - 12),
                animated: true,
              })
            }
            style={[styles.reopenedBadge, { borderColor: "#9ca3af", backgroundColor: "#f4f4f5" }]}
            accessibilityRole="button"
            testID="badge-reopened-by-admin"
          >
            <Feather name="unlock" size={12} color="#1a1d23" />
            <Text style={styles.reopenedBadgeText}>
              {ticket.unlockCount && ticket.unlockCount > 1
                ? t("tickets.reopenedByCount", { name: ticket.unlockedByName ?? t("tickets.unknownAdmin"), count: ticket.unlockCount })
                : t("tickets.reopenedBy", { name: ticket.unlockedByName ?? t("tickets.unknownAdmin") })}
            </Text>
          </TouchableOpacity>
        ) : null}
      </View>

      {/* ── Task #572: Assignment-removed banner ── */}
      {assignmentRemoved ? (
        <View
          style={[
            styles.card,
            { backgroundColor: colors.card, borderColor: "#dc2626", borderWidth: 2 },
          ]}
          testID="banner-assignment-removed"
        >
          <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 8 }}>
            <Feather name="alert-octagon" size={20} color="#dc2626" />
            <View style={{ flex: 1 }}>
              <Text style={[styles.title, { color: colors.foreground, fontSize: 16 }]}>
                {assignmentRemoved === "site_vendor_mismatch"
                  ? t("tickets.assignmentRemovedTitleSite")
                  : t("tickets.assignmentRemovedTitleWorkType")}
              </Text>
              <Text style={[styles.meta, { color: colors.mutedForeground }]}>
                {assignmentRemoved === "site_vendor_mismatch"
                  ? t("tickets.assignmentRemovedBodySite")
                  : t("tickets.assignmentRemovedBodyWorkType")}
              </Text>
              <Text
                style={[
                  styles.meta,
                  { color: colors.mutedForeground, marginTop: 6, fontStyle: "italic" },
                ]}
                testID="text-assignment-removed-contact-hint"
              >
                {t("tickets.assignmentRemovedContactHint")}
              </Text>
            </View>
          </View>
          <TouchableOpacity
            onPress={cancelFromAssignmentBanner}
            disabled={cancelInFlight}
            style={[
              styles.actionBtn,
              {
                backgroundColor: "#dc2626",
                marginTop: 12,
                opacity: cancelInFlight ? 0.6 : 1,
              },
            ]}
            testID="button-cancel-from-assignment-banner"
          >
            {cancelInFlight ? (
              <ActivityIndicator color="#ffffff" />
            ) : (
              <>
                <Feather name="x-circle" size={16} color="#ffffff" />
                <Text style={[styles.actionBtnText, { color: "#ffffff" }]}>
                  {t("tickets.assignmentRemovedCancel")}
                </Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      ) : null}

      {/* ── Task #494: Vendor Accept/Deny banner ── */}
      {ticket.status === "awaiting_acceptance"
        && currentUser?.role === "vendor"
        && currentUser.vendorId === ticket.vendorId && (
        <View
          style={[
            styles.card,
            { backgroundColor: colors.card, borderColor: colors.primary, borderWidth: 2 },
          ]}
          testID="vendor-invite-banner"
        >
          <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 8 }}>
            <Feather name="alert-triangle" size={20} color={colors.primary} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.title, { color: colors.foreground, fontSize: 16 }]}>
                {t("tickets.inviteAwaitingTitle")}
              </Text>
              <Text style={[styles.meta, { color: colors.mutedForeground }]}>
                {t("tickets.inviteAwaitingBody", { partner: ticket.partnerName ?? "" })}
              </Text>
            </View>
          </View>
          <View style={{ flexDirection: "row", gap: 8, marginTop: 12 }}>
            {/* Deny = inactive/grey pill (destructive but secondary).
                Accept = brand "hot" pill (gold for Winchester, blue for
                VNDRLY default). Both are 40px tall to match the rest of
                the action group, and `flex: 1` + `numberOfLines={1}` +
                `adjustsFontSizeToFit` keep the labels on one line in
                narrow viewports so the row never overflows. */}
            <LayeredPillButton
              onPress={() => setDenyOpen(true)}
              disabled={inviteAction !== null}
              loading={inviteAction === "deny"}
              inactive
              height={40}
              style={{ flex: 1 }}
              testID="button-deny-invite"
            >
              <Feather name="x" size={16} color="#ffffff" style={styles.actionBtnIconShadow} />
              <Text
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.75}
                style={[styles.actionBtnText, styles.actionBtnTextShadow, { color: "#ffffff" }]}
              >
                {t("tickets.denyInvite")}
              </Text>
            </LayeredPillButton>
            <LayeredPillButton
              onPress={acceptInvite}
              disabled={inviteAction !== null}
              loading={inviteAction === "accept"}
              height={40}
              style={{ flex: 1 }}
              testID="button-accept-invite"
            >
              <Feather name="check" size={16} color="#ffffff" style={styles.actionBtnIconShadow} />
              <Text
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.75}
                style={[styles.actionBtnText, styles.actionBtnTextShadow, { color: "#ffffff" }]}
              >
                {t("tickets.acceptInvite")}
              </Text>
            </LayeredPillButton>
          </View>
          {fieldError && (fieldError.field === "accept" || fieldError.field === "deny") ? (
            <Text style={styles.inlineError} testID={`inline-error-${fieldError.field}`}>
              {fieldError.message}
            </Text>
          ) : null}
        </View>
      )}

      {/* ── Task #494: Deny modal ── */}
      {/* T004: shared mileage prompt for en-route + check-out. */}
      <Modal
        visible={mileagePromptFor !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setMileagePromptFor(null)}
      >
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.title, { color: colors.foreground, fontSize: 18 }]}>
              {mileagePromptFor === "en_route"
                ? t("tickets.startingMileageTitle")
                : t("tickets.endingMileageTitle")}
            </Text>
            <Text style={{ color: colors.mutedForeground, marginTop: 6 }}>
              {t("tickets.mileageHelp")}
            </Text>
            <TextInput
              value={mileageInput}
              onChangeText={(v) => { setMileageInput(v); if (mileageError) setMileageError(null); }}
              placeholder={t("tickets.mileagePlaceholder")}
              placeholderTextColor={colors.mutedForeground}
              keyboardType="decimal-pad"
              inputMode="decimal"
              maxLength={12}
              style={{
                marginTop: 12,
                borderWidth: 1,
                borderColor: colors.border,
                borderRadius: 8,
                padding: 10,
                color: colors.foreground,
                fontSize: 18,
              }}
              testID="input-mileage"
            />
            {mileageError ? (
              <Text style={styles.inlineError} testID="inline-error-mileage">
                {mileageError}
              </Text>
            ) : null}
            <View style={{ flexDirection: "row", gap: 8, marginTop: 12 }}>
              <TouchableOpacity
                onPress={skipMileagePrompt}
                style={[styles.actionBtn, { backgroundColor: colors.muted, flex: 1 }]}
                testID="button-mileage-skip"
              >
                <Text style={[styles.actionBtnText, { color: colors.foreground }]}>{t("tickets.mileageSkip")}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={submitMileagePrompt}
                style={[styles.actionBtn, { backgroundColor: "#2563eb", flex: 1 }]}
                testID="button-mileage-submit"
              >
                <Text style={[styles.actionBtnText, { color: "#ffffff" }]}>{t("tickets.mileageSubmit")}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={denyOpen} transparent animationType="fade" onRequestClose={() => setDenyOpen(false)}>
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.title, { color: colors.foreground, fontSize: 18 }]}>
              {t("tickets.denyInviteTitle")}
            </Text>
            <TextInput
              value={denyReason}
              onChangeText={setDenyReason}
              placeholder={t("tickets.denyReasonPlaceholder")}
              placeholderTextColor={colors.mutedForeground}
              multiline
              numberOfLines={4}
              maxLength={500}
              style={{
                marginTop: 12,
                minHeight: 90,
                borderWidth: 1,
                borderColor: colors.border,
                borderRadius: 8,
                padding: 10,
                color: colors.foreground,
                textAlignVertical: "top",
              }}
              testID="input-deny-reason"
            />
            <View style={{ flexDirection: "row", gap: 8, marginTop: 12 }}>
              <TouchableOpacity
                onPress={() => { setDenyOpen(false); setDenyReason(""); }}
                style={[styles.actionBtn, { backgroundColor: colors.muted, flex: 1 }]}
              >
                <Text style={[styles.actionBtnText, { color: colors.foreground }]}>{t("common.cancel")}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={denyInvite}
                disabled={inviteAction === "deny" || !denyReason.trim()}
                style={[
                  styles.actionBtn,
                  { backgroundColor: "#dc2626", flex: 1, opacity: !denyReason.trim() ? 0.5 : 1 },
                ]}
                testID="button-submit-deny"
              >
                {inviteAction === "deny" ? (
                  <ActivityIndicator color="#ffffff" />
                ) : (
                  <Text style={[styles.actionBtnText, { color: "#ffffff" }]}>
                    {t("tickets.denyInvite")}
                  </Text>
                )}
              </TouchableOpacity>
            </View>
            {fieldError && fieldError.field === "deny" ? (
              <Text style={styles.inlineError} testID="inline-error-deny-modal">
                {fieldError.message}
              </Text>
            ) : null}
          </View>
        </View>
      </Modal>

      {(() => {
        const status = ticket.status;
        const lifecycle = ticket.lifecycleState;
        const checkedIn = status === "in_progress";
        // Task #572: when the office removed the vendor's assignment
        // for this ticket, gate every state-change button into its
        // disabled (grey) variant — the only safe next steps live in
        // the assignment-removed banner above. Without this gate the
        // operator could keep tapping a button that will never succeed.
        const blockedByAssignment = assignmentRemoved !== null;
        const canCheckIn =
          !blockedByAssignment &&
          !checkedIn &&
          status !== "submitted" &&
          status !== "approved" &&
          status !== "completed" &&
          status !== "cancelled" &&
          // Task #494: vendor must Accept the partner's invite before they
          // can check in. Denied tickets are dead until the partner reinvites.
          status !== "awaiting_acceptance" &&
          status !== "denied";
        const canCheckOut = !blockedByAssignment && checkedIn;
        const canClose =
          !blockedByAssignment &&
          (status === "pending_review" || status === "kicked_back");
        // Close Ticket — foreman / vendor-admin / org-admin freezes the
        // per-employee running [auto] labor totals on the server. Visible
        // only to that actor set and only when the ticket isn't already
        // closed or in a terminal/pre-accept state. We deliberately do
        // NOT gate on legacy `checkInTime` / `checkOutTime` here — the
        // primary employee may not have clocked in even when crew time
        // exists in the per-employee sessions table, and the server's
        // CLOSE_TICKET_REFUSE_STATUSES guard is the source of truth.
        const isVendorAdminOrOffice =
          currentUser?.role === "vendor" || currentUser?.role === "admin";
        const canCloseTicket =
          isVendorAdminOrOffice &&
          !ticket?.closedAt &&
          status !== "awaiting_acceptance" &&
          status !== "denied" &&
          status !== "submitted" &&
          status !== "approved" &&
          status !== "cancelled" &&
          status !== "completed" &&
          status !== "funds_dispersed";
        const canEnRoute =
          !blockedByAssignment &&
          (lifecycle === "pending_arrival" || lifecycle === "en_route");
        // On Location button: vendor has arrived at the site but is not
        // ready to start billing hours yet. Sits between En Route and
        // Check In so the office can tell "in the truck out front" apart
        // from "actively working". Allowed before check-in only.
        const canOnLocation =
          !blockedByAssignment &&
          !checkedIn &&
          status !== "awaiting_acceptance" &&
          status !== "denied" &&
          (lifecycle === "pending_arrival" ||
            lifecycle === "en_route" ||
            lifecycle === "on_location");
        // Task #575: only in-progress tickets can be flipped into
        // awaiting_payment. The action button is vendor-admin / org-admin
        // only — field employees and foremen see the status on the pill
        // but must not mark awaiting payment from the field app.
        const canMarkAwaitingPayment =
          !blockedByAssignment &&
          status === "in_progress" &&
          isVendorAdminOrOffice;
        // Task #600: Disperse Funds is the AP-side action that closes
        // the loop. The server returns a per-viewer `viewerCanDisperseFunds`
        // capability flag (admin role OR partner contact in the AP role
        // on the owning partner) so non-AP partners never see the button
        // even though their org "owns" the ticket. We surface the action
        // on both `approved` and `awaiting_payment` to mirror the web
        // change in artifacts/vndrly/src/pages/ticket-detail.tsx — Task
        // #595 broadened the server guard so AP can close out tickets
        // parked in awaiting_payment without bouncing them through
        // approved first. The assignment-removed banner blocks the
        // action too: if the office pulled this vendor's assignment,
        // dispersal isn't the right next step (cancel / contact dispatch is).
        const canDisperseFunds =
          !blockedByAssignment &&
          (status === "approved" || status === "awaiting_payment") &&
          ticket.viewerCanDisperseFunds === true;
        return (
          <View style={styles.actionGroup}>
            {canEnRoute ? (
              <LayeredPillButton
                inactive={lifecycle === "en_route"}
                onPress={enRoute}
                disabled={actionInFlight !== null}
                loading={actionInFlight === "en_route"}
                height={40}
                style={styles.actionBtnFull}
                testID="button-en-route"
              >
                <Feather name="navigation" size={16} color="#ffffff" style={styles.actionBtnIconShadow} />
                <Text style={[styles.actionBtnText, styles.actionBtnTextShadow, { color: "#ffffff" }]}>
                  {lifecycle === "en_route" ? t("tickets.updateEnRoute") : t("tickets.enRoute")}
                </Text>
              </LayeredPillButton>
            ) : null}
            {fieldError && fieldError.field === "en_route" ? (
              <Text style={styles.inlineError} testID="inline-error-en_route">
                {fieldError.message}
              </Text>
            ) : null}
            {canOnLocation ? (
              <LayeredPillButton
                inactive={lifecycle === "on_location"}
                onPress={onLocation}
                disabled={actionInFlight !== null}
                loading={actionInFlight === "on_location"}
                height={40}
                style={styles.actionBtnFull}
                testID="button-on-location"
              >
                <Feather name="map-pin" size={16} color="#ffffff" style={styles.actionBtnIconShadow} />
                <Text style={[styles.actionBtnText, styles.actionBtnTextShadow, { color: "#ffffff" }]}>
                  {lifecycle === "on_location"
                    ? t("tickets.updateOnLocation")
                    : t("tickets.onLocation")}
                </Text>
              </LayeredPillButton>
            ) : null}
            {fieldError && fieldError.field === "on_location" ? (
              <Text style={styles.inlineError} testID="inline-error-on_location">
                {fieldError.message}
              </Text>
            ) : null}
            <View style={styles.actionRow}>
              <LayeredPillButton
                onPress={checkIn}
                disabled={!canCheckIn || actionInFlight !== null}
                loading={actionInFlight === "check_in"}
                inactive={!canCheckIn}
                height={40}
                style={styles.actionBtnHalf}
                testID="button-check-in"
              >
                <Feather name="log-in" size={16} color="#ffffff" style={styles.actionBtnIconShadow} />
                <Text style={[styles.directionsBtnText, styles.actionBtnTextShadow, { color: "#ffffff" }]}>
                  {t("tickets.checkIn")}
                </Text>
              </LayeredPillButton>
              <LayeredPillButton
                onPress={checkOut}
                disabled={!canCheckOut || actionInFlight !== null}
                loading={actionInFlight === "check_out"}
                inactive={!canCheckOut}
                height={40}
                style={styles.actionBtnHalf}
                testID="button-check-out"
              >
                <Feather name="log-out" size={16} color="#ffffff" style={styles.actionBtnIconShadow} />
                <Text style={[styles.directionsBtnText, styles.actionBtnTextShadow, { color: "#ffffff" }]}>
                  {t("tickets.checkOut")}
                </Text>
              </LayeredPillButton>
            </View>
            {fieldError && (fieldError.field === "check_in" || fieldError.field === "check_out") ? (
              <Text style={styles.inlineError} testID={`inline-error-${fieldError.field}`}>
                {fieldError.message}
              </Text>
            ) : null}
            <LayeredPillButton
              onPress={closeForReview}
              disabled={!canClose || actionInFlight !== null}
              loading={actionInFlight === "close"}
              inactive={!canClose}
              height={40}
              style={styles.actionBtnFull}
              testID="button-close-for-review"
            >
              <Feather name="send" size={16} color="#ffffff" style={styles.actionBtnIconShadow} />
              <Text style={[styles.directionsBtnText, styles.actionBtnTextShadow, { color: "#ffffff" }]}>
                {t("tickets.closeForReview")}
              </Text>
            </LayeredPillButton>
            {fieldError && fieldError.field === "close" ? (
              <Text style={styles.inlineError} testID="inline-error-close">
                {fieldError.message}
              </Text>
            ) : null}
            {/* Close Ticket — foreman / vendor-admin / org-admin only.
                Final pass of regenerateAutoLaborLines + stamps closedAt
                so accounting can edit the [auto] rows by hand without
                stray late check-out events overwriting them. Hidden once
                the ticket is closed (closedAt set) so the button never
                shows up "already done" on a frozen ticket. */}
            {canCloseTicket ? (
              <LayeredPillButton
                onPress={closeTicketFinal}
                disabled={actionInFlight !== null}
                loading={actionInFlight === "close_ticket"}
                inactive={actionInFlight !== null && actionInFlight !== "close_ticket"}
                height={40}
                style={styles.actionBtnFull}
                testID="button-close-ticket"
              >
                <Feather name="lock" size={16} color="#ffffff" style={styles.actionBtnIconShadow} />
                <Text style={[styles.directionsBtnText, styles.actionBtnTextShadow, { color: "#ffffff" }]}>
                  {t("tickets.closeTicket")}
                </Text>
              </LayeredPillButton>
            ) : null}
            {/* ── Task #575: Mark Awaiting Payment ──
                Active state uses the orange "$" pill image; inactive
                (another action in flight) falls back to the light-grey
                pill image. Both are 40px tall to match the action group.
                Text drops its shadow on the grey state so the label
                reads as visibly disabled. */}
            {canMarkAwaitingPayment
              ? (() => {
                  const isInactive =
                    actionInFlight !== null &&
                    actionInFlight !== "awaiting_payment";
                  const isLoading = actionInFlight === "awaiting_payment";
                  return (
                    <Pressable
                      onPress={() => {
                        setFieldError(null);
                        setAwaitingPaymentNote("");
                        setAwaitingPaymentOpen(true);
                      }}
                      disabled={actionInFlight !== null}
                      style={({ pressed }) => [
                        styles.actionBtnFull,
                        {
                          height: 40,
                          borderRadius: 20,
                          overflow: "hidden",
                          opacity: isInactive ? 0.8 : pressed ? 0.92 : 1,
                          alignItems: "center",
                          justifyContent: "center",
                        },
                      ]}
                      testID="button-mark-awaiting-payment"
                    >
                      <Pill9Slice
                        source={
                          isInactive
                            ? require("@/assets/pill-stack/light-grey.png")
                            : require("@/assets/pill-stack/orange-hot.png")
                        }
                        height={40}
                        borderRadius={20}
                      />
                      <View
                        style={{
                          flexDirection: "row",
                          alignItems: "center",
                          justifyContent: "center",
                          gap: 6,
                        }}
                      >
                        {isLoading ? (
                          <ActivityIndicator color="#ffffff" />
                        ) : (
                          <>
                            <Feather
                              name="dollar-sign"
                              size={16}
                              color={isInactive ? "#374151" : "#ffffff"}
                              style={isInactive ? undefined : styles.actionBtnIconShadow}
                            />
                            <Text
                              numberOfLines={1}
                              adjustsFontSizeToFit
                              minimumFontScale={0.8}
                              style={[
                                styles.actionBtnText,
                                isInactive ? undefined : styles.actionBtnTextShadow,
                                { color: isInactive ? "#374151" : "#ffffff" },
                              ]}
                            >
                              {t("tickets.markAwaitingPayment")}
                            </Text>
                          </>
                        )}
                      </View>
                    </Pressable>
                  );
                })()
              : null}
            {fieldError && fieldError.field === "awaiting_payment" ? (
              <Text style={styles.inlineError} testID="inline-error-awaiting_payment">
                {fieldError.message}
              </Text>
            ) : null}
            {/* ── Task #600: Disperse Funds (AP / admin only) ── */}
            {canDisperseFunds ? (
              <TogglePill2
                color="#16a34a"
                onPress={() => {
                  setFieldError(null);
                  resetDisperseForm();
                  setDisperseOpen(true);
                }}
                disabled={actionInFlight !== null}
                loading={actionInFlight === "disperse_funds"}
                height={40}
                style={styles.actionBtnFull}
                testID="button-disperse-funds-trigger"
              >
                <Feather name="dollar-sign" size={16} color="#ffffff" style={styles.actionBtnIconShadow} />
                <Text style={[styles.actionBtnText, styles.actionBtnTextShadow, { color: "#ffffff" }]}>
                  {t("ticketDetail.disperseFunds", { defaultValue: "Disperse Funds" })}
                </Text>
              </TogglePill2>
            ) : null}
            {/* Inline error pinned under the trigger when the modal is
                closed — when the modal is open the same fieldError also
                renders inside it, but only one is visible at a time. */}
            {fieldError && fieldError.field === "disperse_funds" && !disperseOpen ? (
              <Text style={styles.inlineError} testID="inline-error-disperse-funds">
                {fieldError.message}
              </Text>
            ) : null}
            {fieldError && fieldError.field === "general" ? (
              <Text style={styles.inlineError} testID="inline-error-general">
                {fieldError.message}
              </Text>
            ) : null}
            <Text style={[styles.actionHint, { color: colors.mutedForeground }]}>
              {canCheckIn
                ? t("tickets.hintCheckIn")
                : checkedIn
                  ? t("tickets.hintCheckedIn")
                  : canClose
                    ? t("tickets.hintCanClose")
                    : status === "submitted"
                      ? t("tickets.hintAwaitingReview")
                      : status === "approved" || status === "completed"
                        ? t("tickets.hintFinalized")
                        : ""}
            </Text>

            {/* ── Task #575: Awaiting-payment confirmation sheet ── */}
            <Modal
              visible={awaitingPaymentOpen}
              transparent
              animationType="fade"
              onRequestClose={() => {
                if (actionInFlight === "awaiting_payment") return;
                setAwaitingPaymentOpen(false);
                setAwaitingPaymentNote("");
              }}
            >
              <View style={styles.modalBackdrop}>
                <View
                  style={[
                    styles.modalCard,
                    { backgroundColor: colors.card, borderColor: colors.border },
                  ]}
                >
                  <Text style={[styles.title, { color: colors.foreground, fontSize: 18 }]}>
                    {t("tickets.awaitingPaymentTitle")}
                  </Text>
                  <Text
                    style={[styles.meta, { color: colors.mutedForeground, marginTop: 4 }]}
                  >
                    {t("tickets.awaitingPaymentBody")}
                  </Text>
                  <TextInput
                    value={awaitingPaymentNote}
                    onChangeText={setAwaitingPaymentNote}
                    placeholder={t("tickets.awaitingPaymentNotePlaceholder")}
                    placeholderTextColor={colors.mutedForeground}
                    multiline
                    numberOfLines={4}
                    maxLength={500}
                    style={{
                      marginTop: 12,
                      minHeight: 90,
                      borderWidth: 1,
                      borderColor: colors.border,
                      borderRadius: 8,
                      padding: 10,
                      color: colors.foreground,
                      textAlignVertical: "top",
                    }}
                    testID="input-awaiting-payment-note"
                  />
                  <View style={{ flexDirection: "row", gap: 8, marginTop: 12 }}>
                    <TouchableOpacity
                      onPress={() => {
                        setAwaitingPaymentOpen(false);
                        setAwaitingPaymentNote("");
                      }}
                      disabled={actionInFlight === "awaiting_payment"}
                      style={[styles.actionBtn, { backgroundColor: colors.muted, flex: 1 }]}
                      testID="button-awaiting-payment-cancel"
                    >
                      <Text style={[styles.actionBtnText, { color: colors.foreground }]}>
                        {t("common.cancel")}
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={markAwaitingPayment}
                      disabled={actionInFlight === "awaiting_payment"}
                      style={[
                        styles.actionBtn,
                        {
                          backgroundColor: "#7c3aed",
                          flex: 1,
                          opacity: actionInFlight === "awaiting_payment" ? 0.6 : 1,
                        },
                      ]}
                      testID="button-awaiting-payment-submit"
                    >
                      {actionInFlight === "awaiting_payment" ? (
                        <ActivityIndicator color="#ffffff" />
                      ) : (
                        <Text style={[styles.actionBtnText, { color: "#ffffff" }]}>
                          {t("tickets.awaitingPaymentSubmit")}
                        </Text>
                      )}
                    </TouchableOpacity>
                  </View>
                  {fieldError && fieldError.field === "awaiting_payment" ? (
                    <Text
                      style={styles.inlineError}
                      testID="inline-error-awaiting-payment-modal"
                    >
                      {fieldError.message}
                    </Text>
                  ) : null}
                </View>
              </View>
            </Modal>

            {/* ── Task #600: Disperse Funds modal ── */}
            <Modal
              visible={disperseOpen}
              transparent
              animationType="fade"
              onRequestClose={() => {
                if (actionInFlight === "disperse_funds") return;
                setDisperseOpen(false);
                resetDisperseForm();
              }}
            >
              <View style={styles.modalBackdrop}>
                <View
                  style={[
                    styles.modalCard,
                    { backgroundColor: colors.card, borderColor: colors.border },
                  ]}
                >
                  <Text style={[styles.title, { color: colors.foreground, fontSize: 18 }]}>
                    {t("ticketDetail.disperseFundsTitle", { defaultValue: "Disperse Funds" })}
                  </Text>
                  <Text
                    style={[styles.meta, { color: colors.mutedForeground, marginTop: 4 }]}
                  >
                    {t("ticketDetail.disperseFundsHelp", {
                      defaultValue:
                        "Record the payment that closes this ticket. The vendor will be notified once funds are dispersed.",
                    })}
                  </Text>

                  {/* Payment method picker — three pill buttons. We keep
                      this lightweight (no native picker) so jsdom-based
                      vitest renders match the production layout exactly. */}
                  <Text style={{ marginTop: 12, color: colors.foreground, fontWeight: "600" }}>
                    {t("ticketDetail.disperseFundsMethod", { defaultValue: "Payment method" })}
                  </Text>
                  <View style={{ flexDirection: "row", gap: 8, marginTop: 6 }}>
                    {(["etf", "check", "other"] as const).map((m) => {
                      const selected = disperseMethod === m;
                      const label =
                        m === "etf"
                          ? t("ticketDetail.disperseFundsMethodEtf", { defaultValue: "ETF / Wire" })
                          : m === "check"
                            ? t("ticketDetail.disperseFundsMethodCheck", { defaultValue: "Check" })
                            : t("ticketDetail.disperseFundsMethodOther", { defaultValue: "Other" });
                      return (
                        <TouchableOpacity
                          key={m}
                          onPress={() => {
                            setDisperseMethod(m);
                            // Clear any stale check#-required inline error
                            // when the user switches off "check".
                            if (
                              m !== "check" &&
                              fieldError &&
                              fieldError.field === "disperse_funds"
                            ) {
                              setFieldError(null);
                            }
                          }}
                          disabled={actionInFlight === "disperse_funds"}
                          style={[
                            styles.actionBtn,
                            {
                              flex: 1,
                              backgroundColor: selected ? "#16a34a" : colors.muted,
                              opacity: actionInFlight === "disperse_funds" ? 0.6 : 1,
                            },
                          ]}
                          testID={`button-disperse-method-${m}`}
                          accessibilityState={{ selected }}
                        >
                          <Text
                            style={[
                              styles.actionBtnText,
                              { color: selected ? "#ffffff" : colors.foreground },
                            ]}
                          >
                            {label}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>

                  {/* Reference / check # — required for check, optional otherwise. */}
                  <Text style={{ marginTop: 12, color: colors.foreground, fontWeight: "600" }}>
                    {t("ticketDetail.disperseFundsReference", {
                      defaultValue: "Reference / Check #",
                    })}
                    {disperseMethod === "check" ? " *" : ""}
                  </Text>
                  <TextInput
                    value={disperseRef}
                    onChangeText={(v) => {
                      setDisperseRef(v);
                      if (
                        fieldError &&
                        fieldError.field === "disperse_funds" &&
                        v.trim().length > 0
                      ) {
                        setFieldError(null);
                      }
                    }}
                    placeholder={t("ticketDetail.disperseFundsReference", {
                      defaultValue: "Reference / Check #",
                    })}
                    placeholderTextColor={colors.mutedForeground}
                    maxLength={120}
                    style={{
                      marginTop: 6,
                      borderWidth: 1,
                      borderColor: colors.border,
                      borderRadius: 8,
                      padding: 10,
                      color: colors.foreground,
                    }}
                    testID="input-disperse-reference"
                  />

                  {/* Optional internal note (mirrors web's optional textarea). */}
                  <Text style={{ marginTop: 12, color: colors.foreground, fontWeight: "600" }}>
                    {t("ticketDetail.disperseFundsNote", { defaultValue: "Note (optional)" })}
                  </Text>
                  <TextInput
                    value={disperseNote}
                    onChangeText={setDisperseNote}
                    placeholder={t("ticketDetail.disperseFundsNotePlaceholder", {
                      defaultValue: "Internal note for accounting (optional).",
                    })}
                    placeholderTextColor={colors.mutedForeground}
                    multiline
                    numberOfLines={3}
                    maxLength={500}
                    style={{
                      marginTop: 6,
                      minHeight: 70,
                      borderWidth: 1,
                      borderColor: colors.border,
                      borderRadius: 8,
                      padding: 10,
                      color: colors.foreground,
                      textAlignVertical: "top",
                    }}
                    testID="input-disperse-note"
                  />

                  {/* ── Task #852: optional receipt photo ──
                      AP can snap a check stub / wire confirmation /
                      signed receipt without leaving the modal. The
                      thumbnail (and a Replace / Remove pair) only
                      appear after a successful upload. The capture
                      button is disabled while a dispersal POST is
                      in flight so the user can't churn state on the
                      submit. */}
                  <Text style={{ marginTop: 12, color: colors.foreground, fontWeight: "600" }}>
                    {t("ticketDetail.disperseFundsReceipt", {
                      defaultValue: "Receipt photo (optional)",
                    })}
                  </Text>
                  <Text
                    style={[
                      styles.meta,
                      { color: colors.mutedForeground, marginTop: 2 },
                    ]}
                  >
                    {t("ticketDetail.disperseFundsReceiptHelp", {
                      defaultValue:
                        "Snap a check stub, wire confirmation, or signed receipt for the audit trail.",
                    })}
                  </Text>
                  {disperseReceiptUrl ? (
                    <View style={{ marginTop: 8, gap: 8 }}>
                      <Image
                        source={{ uri: objectUrl(disperseReceiptUrl) }}
                        style={{
                          width: "100%",
                          height: 160,
                          borderRadius: 8,
                          borderWidth: 1,
                          borderColor: colors.border,
                        }}
                        resizeMode="cover"
                        testID="disperse-receipt-preview"
                      />
                      <View style={{ flexDirection: "row", gap: 8 }}>
                        <TouchableOpacity
                          onPress={captureDisperseReceipt}
                          disabled={
                            disperseReceiptUploading ||
                            actionInFlight === "disperse_funds"
                          }
                          style={[
                            styles.actionBtn,
                            {
                              backgroundColor: colors.muted,
                              flex: 1,
                              opacity:
                                disperseReceiptUploading ||
                                actionInFlight === "disperse_funds"
                                  ? 0.6
                                  : 1,
                            },
                          ]}
                          testID="button-disperse-receipt-replace"
                        >
                          {disperseReceiptUploading ? (
                            <ActivityIndicator color={colors.foreground} />
                          ) : (
                            <>
                              <Feather
                                name="camera"
                                size={16}
                                color={colors.foreground}
                              />
                              <Text
                                style={[
                                  styles.actionBtnText,
                                  { color: colors.foreground },
                                ]}
                              >
                                {t("ticketDetail.disperseFundsReceiptReplace", {
                                  defaultValue: "Replace",
                                })}
                              </Text>
                            </>
                          )}
                        </TouchableOpacity>
                        <TouchableOpacity
                          onPress={() => setDisperseReceiptUrl(null)}
                          disabled={
                            disperseReceiptUploading ||
                            actionInFlight === "disperse_funds"
                          }
                          style={[
                            styles.actionBtn,
                            {
                              backgroundColor: colors.muted,
                              flex: 1,
                              opacity:
                                disperseReceiptUploading ||
                                actionInFlight === "disperse_funds"
                                  ? 0.6
                                  : 1,
                            },
                          ]}
                          testID="button-disperse-receipt-remove"
                        >
                          <Feather name="trash-2" size={16} color={colors.foreground} />
                          <Text
                            style={[
                              styles.actionBtnText,
                              { color: colors.foreground },
                            ]}
                          >
                            {t("ticketDetail.disperseFundsReceiptRemove", {
                              defaultValue: "Remove",
                            })}
                          </Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  ) : (
                    <TouchableOpacity
                      onPress={captureDisperseReceipt}
                      disabled={
                        disperseReceiptUploading ||
                        actionInFlight === "disperse_funds"
                      }
                      style={[
                        styles.actionBtn,
                        {
                          backgroundColor: colors.muted,
                          marginTop: 8,
                          opacity:
                            disperseReceiptUploading ||
                            actionInFlight === "disperse_funds"
                              ? 0.6
                              : 1,
                        },
                      ]}
                      testID="button-disperse-receipt-capture"
                    >
                      {disperseReceiptUploading ? (
                        <ActivityIndicator color={colors.foreground} />
                      ) : (
                        <>
                          <Feather name="camera" size={16} color={colors.foreground} />
                          <Text
                            style={[
                              styles.actionBtnText,
                              { color: colors.foreground },
                            ]}
                          >
                            {t("ticketDetail.disperseFundsReceiptAttach", {
                              defaultValue: "Attach receipt",
                            })}
                          </Text>
                        </>
                      )}
                    </TouchableOpacity>
                  )}

                  <View style={{ flexDirection: "row", gap: 8, marginTop: 12 }}>
                    <TouchableOpacity
                      onPress={() => {
                        setDisperseOpen(false);
                        resetDisperseForm();
                        if (
                          fieldError &&
                          fieldError.field === "disperse_funds"
                        ) {
                          setFieldError(null);
                        }
                      }}
                      disabled={actionInFlight === "disperse_funds"}
                      style={[styles.actionBtn, { backgroundColor: colors.muted, flex: 1 }]}
                      testID="button-disperse-cancel"
                    >
                      <Text style={[styles.actionBtnText, { color: colors.foreground }]}>
                        {t("common.cancel")}
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={disperseFunds}
                      disabled={actionInFlight === "disperse_funds"}
                      style={[
                        styles.actionBtn,
                        {
                          backgroundColor: "#16a34a",
                          flex: 1,
                          opacity: actionInFlight === "disperse_funds" ? 0.6 : 1,
                        },
                      ]}
                      testID="button-disperse-submit"
                    >
                      {actionInFlight === "disperse_funds" ? (
                        <ActivityIndicator color="#ffffff" />
                      ) : (
                        <Text style={[styles.actionBtnText, { color: "#ffffff" }]}>
                          {t("ticketDetail.disperseFundsConfirm", {
                            defaultValue: "Disperse Funds",
                          })}
                        </Text>
                      )}
                    </TouchableOpacity>
                  </View>
                  {fieldError && fieldError.field === "disperse_funds" ? (
                    <Text
                      style={styles.inlineError}
                      testID="inline-error-disperse-funds-modal"
                    >
                      {fieldError.message}
                    </Text>
                  ) : null}
                </View>
              </View>
            </Modal>
          </View>
        );
      })()}

      {/* Task #497 / #628 — Read-only payment summary. Visible to vendor +
          partner field users once funds have been dispersed. We intentionally
          mirror the structure (and key set) of the web panel; Task #628
          tightened the visual parity by promoting the title into a row with
          the same dollar-sign accent the web Card uses. */}
      {ticket.paymentDispersedAt ? (
        <View
          style={{
            marginTop: 8,
            marginBottom: 8,
            padding: 12,
            borderRadius: 8,
            backgroundColor: colors.card,
            borderWidth: 1,
            borderColor: colors.border,
            gap: 4,
          }}
          testID="payment-details-card"
        >
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 8,
            }}
          >
            <Feather name="dollar-sign" size={18} color={colors.primary} />
            <Text style={[styles.section, { color: colors.foreground, marginTop: 0 }]}>
              {t("ticketDetail.paymentDetails", { defaultValue: "Payment Details" })}
            </Text>
          </View>
          <Text style={{ color: colors.foreground }}>
            <Text style={{ color: colors.mutedForeground }}>
              {t("ticketDetail.disperseFundsMethod", { defaultValue: "Payment method" })}:{" "}
            </Text>
            <Text testID="payment-method">
              {ticket.paymentMethod === "etf"
                ? t("ticketDetail.disperseFundsMethodEtf", { defaultValue: "ETF / Wire" })
                : ticket.paymentMethod === "check"
                  ? t("ticketDetail.disperseFundsMethodCheck", { defaultValue: "Check" })
                  : ticket.paymentMethod === "other"
                    ? t("ticketDetail.disperseFundsMethodOther", { defaultValue: "Other" })
                    : "—"}
            </Text>
          </Text>
          {ticket.paymentReference ? (
            <Text style={{ color: colors.foreground }}>
              <Text style={{ color: colors.mutedForeground }}>
                {t("ticketDetail.paymentReferenceLabel", { defaultValue: "Reference" })}:{" "}
              </Text>
              <Text testID="payment-reference">{ticket.paymentReference}</Text>
            </Text>
          ) : null}
          <Text style={{ color: colors.foreground }}>
            <Text style={{ color: colors.mutedForeground }}>
              {t("ticketDetail.paymentDispersedOn", { defaultValue: "Dispersed on" })}:{" "}
            </Text>
            <Text testID="payment-dispersed-at">
              {new Date(ticket.paymentDispersedAt).toLocaleString()}
            </Text>
          </Text>
          {ticket.paymentDispersedByName ? (
            <Text style={{ color: colors.foreground }}>
              <Text style={{ color: colors.mutedForeground }}>
                {t("ticketDetail.paymentDispersedBy", { defaultValue: "Dispersed by" })}:{" "}
              </Text>
              <Text testID="payment-dispersed-by">{ticket.paymentDispersedByName}</Text>
            </Text>
          ) : null}
          {ticket.paymentNote ? (
            <Text style={{ color: colors.foreground }}>
              <Text style={{ color: colors.mutedForeground }}>
                {t("ticketDetail.paymentNoteLabel", { defaultValue: "Note" })}:{" "}
              </Text>
              <Text testID="payment-note">{ticket.paymentNote}</Text>
            </Text>
          ) : null}
          {/* Task #852 — surface the proof-of-payment image inline so
              auditors don't have to dig through email. The mobile card
              renders a non-interactive thumbnail; the web side mirrors
              this with an anchor wrapping the same image so reviewers
              can open the full-size receipt in a new tab. */}
          {ticket.paymentReceiptUrl ? (
            <View style={{ marginTop: 8, gap: 4 }}>
              <Text style={{ color: colors.mutedForeground }}>
                {t("ticketDetail.paymentReceiptLabel", { defaultValue: "Receipt" })}
              </Text>
              <Image
                source={{ uri: objectUrl(ticket.paymentReceiptUrl) }}
                style={{
                  width: "100%",
                  height: 200,
                  borderRadius: 8,
                  borderWidth: 1,
                  borderColor: colors.border,
                }}
                resizeMode="cover"
                testID="payment-receipt-image"
              />
            </View>
          ) : null}
          {/* Task #853 — AP self-service "Reverse dispersal" link.
              Server flag `viewerCanReverseDispersal` already encodes
              role + status (admin OR partner-AP, status=funds_dispersed)
              so we render a plain text link inside the card; tapping
              it opens the reason+confirm sheet defined below. */}
          {ticket.viewerCanReverseDispersal === true ? (
            <TouchableOpacity
              onPress={() => {
                resetReverseDispersalForm();
                setReverseDispersalOpen(true);
                if (fieldError && fieldError.field === "reverse_dispersal") {
                  setFieldError(null);
                }
              }}
              disabled={actionInFlight === "reverse_dispersal"}
              style={{ marginTop: 8, alignSelf: "flex-start" }}
              testID="link-reverse-dispersal"
            >
              <Text
                style={{
                  color: "#dc2626",
                  fontWeight: "600",
                  textDecorationLine: "underline",
                }}
              >
                {t("ticketDetail.reverseDispersal", {
                  defaultValue: "Reverse dispersal",
                })}
              </Text>
            </TouchableOpacity>
          ) : null}
        </View>
      ) : null}

      {/* Task #853 — Reverse dispersal sheet. Mirrors the disperse modal
          structure (Modal + card + cancel/confirm buttons + inline error
          slot) so the visual language stays consistent. The trigger is
          rendered inside the Payment Details card above. */}
      <Modal
        visible={reverseDispersalOpen}
        transparent
        animationType="fade"
        onRequestClose={() => {
          if (actionInFlight === "reverse_dispersal") return;
          setReverseDispersalOpen(false);
          resetReverseDispersalForm();
        }}
      >
        <View style={styles.modalBackdrop}>
          <View
            style={[
              styles.modalCard,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
          >
            <Text style={[styles.title, { color: colors.foreground, fontSize: 18 }]}>
              {t("ticketDetail.reverseDispersalTitle", {
                defaultValue: "Reverse fund dispersal",
              })}
            </Text>
            <Text
              style={[styles.meta, { color: colors.mutedForeground, marginTop: 4 }]}
            >
              {t("ticketDetail.reverseDispersalHelp", {
                defaultValue:
                  "Reversing returns this ticket to Approved and clears the payment fields. Both Accounts Payable and the vendor will be notified.",
              })}
            </Text>
            <Text style={{ marginTop: 12, color: colors.foreground, fontWeight: "600" }}>
              {t("ticketDetail.reverseDispersalReason", { defaultValue: "Reason" })}
            </Text>
            <TextInput
              value={reverseDispersalReason}
              onChangeText={(v) => {
                setReverseDispersalReason(v);
                if (
                  fieldError &&
                  fieldError.field === "reverse_dispersal" &&
                  v.trim().length > 0
                ) {
                  setFieldError(null);
                }
              }}
              placeholder={t("ticketDetail.reverseDispersalReasonPlaceholder", {
                defaultValue: "Why is this dispersal being reversed?",
              })}
              placeholderTextColor={colors.mutedForeground}
              multiline
              numberOfLines={3}
              maxLength={500}
              style={{
                marginTop: 6,
                minHeight: 70,
                borderWidth: 1,
                borderColor: colors.border,
                borderRadius: 8,
                padding: 10,
                color: colors.foreground,
                textAlignVertical: "top",
              }}
              testID="input-reverse-dispersal-reason"
            />
            <View style={{ flexDirection: "row", gap: 8, marginTop: 12 }}>
              <TouchableOpacity
                onPress={() => {
                  setReverseDispersalOpen(false);
                  resetReverseDispersalForm();
                  if (
                    fieldError &&
                    fieldError.field === "reverse_dispersal"
                  ) {
                    setFieldError(null);
                  }
                }}
                disabled={actionInFlight === "reverse_dispersal"}
                style={[styles.actionBtn, { backgroundColor: colors.muted, flex: 1 }]}
                testID="button-reverse-dispersal-cancel"
              >
                <Text style={[styles.actionBtnText, { color: colors.foreground }]}>
                  {t("common.cancel")}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={reverseDispersal}
                disabled={
                  actionInFlight === "reverse_dispersal" ||
                  !reverseDispersalReason.trim()
                }
                style={[
                  styles.actionBtn,
                  {
                    backgroundColor: "#dc2626",
                    flex: 1,
                    opacity:
                      actionInFlight === "reverse_dispersal" ||
                      !reverseDispersalReason.trim()
                        ? 0.6
                        : 1,
                  },
                ]}
                testID="button-reverse-dispersal-submit"
              >
                {actionInFlight === "reverse_dispersal" ? (
                  <ActivityIndicator color="#ffffff" />
                ) : (
                  <Text style={[styles.actionBtnText, { color: "#ffffff" }]}>
                    {t("ticketDetail.reverseDispersalConfirm", {
                      defaultValue: "Reverse dispersal",
                    })}
                  </Text>
                )}
              </TouchableOpacity>
            </View>
            {fieldError && fieldError.field === "reverse_dispersal" ? (
              <Text
                style={styles.inlineError}
                testID="inline-error-reverse-dispersal-modal"
              >
                {fieldError.message}
              </Text>
            ) : null}
          </View>
        </View>
      </Modal>

      <TicketSiteVisitSummary ticketId={ticketId} refreshKey={lastLoadedAt} />

      <Text style={[styles.section, { color: colors.foreground }]}>
        {t("tickets.routeSection")}
      </Text>
      <TicketRouteMap
        site={
          siteLocation &&
          siteLocation.latitude != null &&
          siteLocation.longitude != null
            ? {
                latitude: siteLocation.latitude,
                longitude: siteLocation.longitude,
                name: siteLocation.name ?? ticket.siteName ?? null,
              }
            : null
        }
        checkIn={
          ticket.checkInLatitude != null && ticket.checkInLongitude != null
            ? {
                latitude: ticket.checkInLatitude,
                longitude: ticket.checkInLongitude,
                time: ticket.checkInTime ?? null,
              }
            : null
        }
        checkOut={
          ticket.checkOutLatitude != null && ticket.checkOutLongitude != null
            ? {
                latitude: ticket.checkOutLatitude,
                longitude: ticket.checkOutLongitude,
                time: ticket.checkOutTime ?? null,
              }
            : null
        }
        tracking={gpsLogs
          .filter((g) => g.eventType === "tracking")
          .map((g) => ({
            id: g.id,
            latitude: g.latitude,
            longitude: g.longitude,
            recordedAt: g.recordedAt,
          }))}
        selectedTrackingId={selectedTrackingId}
        onSelectTracking={setSelectedTrackingId}
      />
      {siteLocation &&
        siteLocation.latitude != null &&
        siteLocation.longitude != null && (
          <LayeredPillButton
            onPress={() =>
              openInMaps(
                siteLocation.latitude as number,
                siteLocation.longitude as number,
                siteLocation.name ?? ticket.siteName ?? t("tickets.siteLocationFallback"),
              )
            }
            height={40}
            style={[styles.actionBtnFull, { marginTop: 12 }]}
            testID="button-get-directions"
          >
            <Feather name="navigation" size={16} color="#ffffff" style={styles.actionBtnIconShadow} />
            <Text
              style={[styles.directionsBtnText, styles.actionBtnTextShadow, { color: "#ffffff" }]}
            >
              Get Directions to Site
            </Text>
          </LayeredPillButton>
        )}
      <TicketTrackingTimeline
        tracking={gpsLogs
          .filter((g) => g.eventType === "tracking")
          .map((g) => ({
            id: g.id,
            latitude: g.latitude,
            longitude: g.longitude,
            recordedAt: g.recordedAt,
          }))}
        selectedTrackingId={selectedTrackingId}
        onSelectTracking={setSelectedTrackingId}
      />

      <TicketNudgePanel
        ticketId={ticket.id}
        ticketStatus={ticket.status}
        userRole={currentUser?.role}
      />

      {canShowSchedule ? (
        <View style={{ marginBottom: 12 }}>
          {ticket.scheduledStartAt ? (
            <Text style={{ color: colors.mutedForeground, marginBottom: 8 }} testID="text-scheduled-when">
              {t("scheduleTicket.scheduledBanner", {
                when: new Date(ticket.scheduledStartAt).toLocaleString(undefined, {
                  weekday: "short",
                  month: "short",
                  day: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                }),
              })}
            </Text>
          ) : null}
          <BlueButton
            onPress={() => setScheduleOpen(true)}
            testID="button-schedule-ticket"
          >
            {t("scheduleTicket.button")}
          </BlueButton>
          {ticket.scheduledStartAt ? (
            <TouchableOpacity
              onPress={() => router.push(`/ticket/${ticket.id}/crew-tracker`)}
              style={{ marginTop: 8 }}
              testID="button-crew-tracker"
            >
              <Text style={{ color: colors.primary, fontWeight: "600" }}>
                {t("mySchedule.foremanView")}
              </Text>
            </TouchableOpacity>
          ) : null}
        </View>
      ) : null}

      <CrewTimeSection
        ticketId={ticket.id}
        vendorId={ticket.vendorId ?? currentUser?.vendorId ?? null}
        isForeman={
          currentUser?.role === "vendor" ||
          currentUser?.role === "admin" ||
          (currentUser?.role === "field_employee" &&
            (currentUser?.vendorRole === "foreman" || currentUser?.vendorRole === "both"))
        }
        canEdit={["draft", "in_progress", "kicked_back"].includes(ticket.status)}
        canEditRoster={
          ["draft", "in_progress", "kicked_back"].includes(ticket.status) &&
          currentUser?.role !== "partner"
        }
        colors={colors}
        refreshHandleRef={crewHandleRef}
      />

      {transitions.length > 0 ? (
        <View>
          <Text style={[styles.section, { color: colors.foreground }]}>
            {t("tickets.auditTrail", { count: transitions.length })}
          </Text>
          <View
            style={[
              styles.historyCard,
              { borderColor: colors.border, backgroundColor: colors.card },
            ]}
            testID="audit-trail-timeline"
          >
            {transitions.map((entry, idx) => {
              // Same kind classification as web; keep this small inline so
              // we don't need a shared lib for one screen.
              let kind:
                | "created"
                | "invite_sent"
                | "accepted"
                | "denied"
                | "reinvited"
                | "cancelled"
                | "reactivated"
                | "reopened"
                | "other" = "other";
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
                entry.fromStatus === "submitted" ||
                entry.fromStatus === "approved" ||
                entry.fromStatus === "funds_dispersed"
              ) {
                kind = "reopened";
              }

              const headline =
                kind === "reinvited" && entry.fromVendorName && entry.toVendorName
                  ? t("tickets.auditReinvitedFromTo", {
                      from: entry.fromVendorName,
                      to: entry.toVendorName,
                    })
                  : kind === "other"
                    ? t("tickets.auditTransition", {
                        from: (entry.fromStatus ?? "—").replace(/_/g, " "),
                        to: entry.toStatus.replace(/_/g, " "),
                      })
                    : kind === "reopened"
                      ? t("tickets.auditReopened", {
                          status: (entry.fromStatus ?? "").replace(/_/g, " "),
                        })
                      : t(
                          {
                            created: "tickets.auditCreated",
                            invite_sent: "tickets.auditInviteSent",
                            accepted: "tickets.auditInviteAccepted",
                            denied: "tickets.auditInviteDenied",
                            reinvited: "tickets.auditReinvited",
                            cancelled: "tickets.auditCancelled",
                            reactivated: "tickets.auditReactivated",
                          }[kind] as string,
                        );

              const HIDE_REASON_KINDS = new Set([
                "reinvited",
                "invite_sent",
                "accepted",
                "created",
              ]);
              const rawReason = entry.displayReason ?? entry.reason ?? null;
              const reasonText =
                rawReason && rawReason.startsWith("direct_award_from_hotlist:")
                  ? null
                  : rawReason;
              const showReason = !!reasonText && !HIDE_REASON_KINDS.has(kind);
              const isDenied = kind === "denied";

              return (
                <View
                  key={entry.id}
                  style={[
                    styles.historyRow,
                    idx > 0 && { borderTopWidth: 1, borderTopColor: colors.border },
                    { flexDirection: "column", alignItems: "stretch" },
                  ]}
                  testID={`audit-trail-entry-${entry.id}`}
                >
                  <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                    <Text
                      style={{
                        color: colors.foreground,
                        fontFamily: "Inter_600SemiBold",
                        fontSize: 13,
                        flex: 1,
                        paddingRight: 8,
                      }}
                    >
                      {headline}
                    </Text>
                    <Text
                      style={{
                        color: colors.mutedForeground,
                        fontSize: 11,
                      }}
                    >
                      {new Date(entry.createdAt).toLocaleString()}
                    </Text>
                  </View>
                  <Text
                    style={{
                      color: colors.mutedForeground,
                      fontSize: 12,
                      marginTop: 2,
                    }}
                  >
                    {entry.actorName
                      ? t("tickets.auditByActor", {
                          name: entry.actorName,
                          role: entry.actorRole
                            ? t(`tickets.auditRole_${entry.actorRole}`, {
                                defaultValue: entry.actorRole,
                              })
                            : t("tickets.auditUnknownRole"),
                        })
                      : t("tickets.auditBySystem")}
                  </Text>
                  {showReason ? (
                    <View
                      style={{
                        marginTop: 6,
                        padding: 8,
                        borderRadius: 6,
                        borderWidth: 1,
                        borderColor: isDenied ? "#fecaca" : "#e5e7eb",
                        backgroundColor: isDenied ? "#fef2f2" : "#f4f4f5",
                      }}
                      testID={`audit-trail-reason-${entry.id}`}
                    >
                      <Text
                        style={{
                          fontFamily: "Inter_600SemiBold",
                          fontSize: 12,
                          color: isDenied ? "#7f1d1d" : "#1a1d23",
                        }}
                      >
                        {isDenied
                          ? t("tickets.auditDenialReasonLabel")
                          : t("tickets.reasonLabel")}
                      </Text>
                      <Text
                        style={{
                          fontSize: 13,
                          color: isDenied ? "#7f1d1d" : "#1a1d23",
                          marginTop: 2,
                        }}
                      >
                        {reasonText}
                      </Text>
                    </View>
                  ) : null}
                </View>
              );
            })}
          </View>
        </View>
      ) : null}

      {unlocks.length > 0 ? (
        <View
          onLayout={(e) => {
            unlockHistoryY.current = e.nativeEvent.layout.y;
          }}
        >
          <Text style={[styles.section, { color: colors.foreground }]}>
            {t("tickets.unlockHistory", { count: unlocks.length })}
          </Text>
          <View
            style={[
              styles.historyCard,
              { borderColor: colors.border, backgroundColor: colors.card },
            ]}
            testID="unlock-history-timeline"
          >
            {unlocks.map((entry, idx) => (
              <View
                key={entry.id}
                style={[
                  styles.historyRow,
                  idx > 0 && { borderTopWidth: 1, borderTopColor: colors.border },
                ]}
                testID={`unlock-history-entry-${entry.id}`}
              >
                <View style={{ flex: 1 }}>
                  <Text
                    style={{
                      color: colors.foreground,
                      fontFamily: "Inter_600SemiBold",
                      fontSize: 13,
                    }}
                  >
                    {t("tickets.unlockNumber", { num: unlocks.length - idx, name: entry.unlockedByName ?? t("tickets.unknownAdmin") })}
                  </Text>
                  <Text
                    style={{
                      color: colors.mutedForeground,
                      fontSize: 12,
                      marginTop: 2,
                    }}
                  >
                    {t("tickets.reopenedFrom")}{" "}
                    <Text style={{ textTransform: "capitalize" }}>
                      {entry.previousStatus.replace(/_/g, " ")}
                    </Text>
                  </Text>
                </View>
                <Text
                  style={{
                    color: colors.mutedForeground,
                    fontSize: 11,
                    marginLeft: 8,
                  }}
                >
                  {new Date(entry.unlockedAt).toLocaleString()}
                </Text>
              </View>
            ))}
          </View>
        </View>
      ) : null}

      <Text style={[styles.section, { color: colors.foreground }]}>
        {t("tickets.historySection")}
      </Text>
      {historyEvents.length === 0 ? (
        <Text style={{ color: colors.mutedForeground, marginBottom: 8 }}>
          {t("common.noResults")}
        </Text>
      ) : (
        <View
          style={[
            styles.historyCard,
            { borderColor: colors.border, backgroundColor: colors.card },
          ]}
        >
          <ScrollView
            nestedScrollEnabled
            style={styles.historyScroll}
            contentContainerStyle={styles.historyScrollContent}
            showsVerticalScrollIndicator
            testID="history-events-scroll"
          >
            {historyEvents.map((evt, idx) => {
              const tile = evt.coords
                ? getOsmTile(evt.coords.latitude, evt.coords.longitude)
                : null;
              return (
                <View
                  key={evt.key}
                  style={[
                    styles.historyRow,
                    idx > 0 && { borderTopWidth: 1, borderTopColor: colors.border },
                  ]}
                >
                  {tile && evt.coords ? (
                    <Pressable
                      onPress={() =>
                        openInMaps(
                          evt.coords!.latitude,
                          evt.coords!.longitude,
                          evt.label,
                        )
                      }
                      style={[
                        styles.mapThumb,
                        { borderColor: colors.border, backgroundColor: colors.muted },
                      ]}
                      accessibilityRole="button"
                      accessibilityLabel={`View ${evt.label} on map`}
                    >
                      <Image
                        source={{ uri: tile.url }}
                        style={{
                          position: "absolute",
                          width: MAP_TILE_SIZE,
                          height: MAP_TILE_SIZE,
                          left: -tile.offsetX + 32,
                          top: -tile.offsetY + 32,
                        }}
                        resizeMode="cover"
                      />
                      <View style={styles.mapPin} pointerEvents="none">
                        <Feather name="map-pin" size={18} color={colors.primary} />
                      </View>
                    </Pressable>
                  ) : null}
                  <View style={{ flex: 1 }}>
                    <Text
                      style={{
                        color: colors.foreground,
                        fontFamily: "Inter_600SemiBold",
                        fontSize: 13,
                      }}
                    >
                      {evt.label}
                    </Text>
                    {evt.detail ? (
                      <Text
                        style={{
                          color: colors.mutedForeground,
                          fontSize: 12,
                          marginTop: 2,
                        }}
                      >
                        {evt.detail}
                      </Text>
                    ) : null}
                    {evt.coords ? (
                      <TouchableOpacity
                        onPress={() =>
                          openInMaps(
                            evt.coords!.latitude,
                            evt.coords!.longitude,
                            evt.label,
                          )
                        }
                        hitSlop={6}
                      >
                        <Text
                          style={{
                            color: colors.primary,
                            fontSize: 12,
                            fontFamily: "Inter_600SemiBold",
                            marginTop: 4,
                          }}
                        >
                          {t("tickets.viewOnMap")}
                        </Text>
                      </TouchableOpacity>
                    ) : null}
                  </View>
                  <Text
                    style={{
                      color: colors.mutedForeground,
                      fontSize: 11,
                      marginLeft: 8,
                    }}
                  >
                    {new Date(evt.at).toLocaleString()}
                  </Text>
                </View>
              );
            })}
          </ScrollView>
        </View>
      )}

      <Text style={[styles.section, { color: colors.foreground }]}>
        {t("tickets.partsAndLabor")}
      </Text>
      {items.length === 0 ? (
        <Text style={{ color: colors.mutedForeground, marginBottom: 8 }}>
          {t("common.noResults")}
        </Text>
      ) : (
        items.map((it) => (
          <View
            key={it.id}
            style={[
              styles.lineItem,
              { borderColor: colors.border, backgroundColor: colors.card },
            ]}
          >
            <View style={{ flex: 1 }}>
              <Text style={{ color: colors.foreground, fontFamily: "Inter_600SemiBold" }}>
                {it.description}
              </Text>
              <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>
                {t("tickets.itemMeta", {
                  type: ITEM_TYPE_KEYS[it.type as (typeof ITEM_TYPES)[number]]
                    ? t(ITEM_TYPE_KEYS[it.type as (typeof ITEM_TYPES)[number]])
                    : it.type,
                  qty: String(it.quantity),
                  price: String(it.unitPrice),
                })}
              </Text>
            </View>
            {isEditable ? (
              <TouchableOpacity onPress={() => deleteItem(it.id)} style={styles.iconBtn}>
                <Feather name="trash-2" size={16} color={colors.destructive} />
              </TouchableOpacity>
            ) : null}
          </View>
        ))
      )}

      {isEditable ? (
      <View
        style={[
          styles.formCard,
          { borderColor: colors.border, backgroundColor: colors.card },
        ]}
      >
        <TouchableOpacity
          onPress={() => setItemTypePickerOpen(true)}
          style={[
            styles.dropdown,
            { borderColor: colors.border, backgroundColor: colors.background },
          ]}
        >
          <Text
            style={{
              color: colors.foreground,
              fontFamily: "Inter_500Medium",
            }}
          >
            {t(ITEM_TYPE_KEYS[itemType])}
          </Text>
          <Feather name="chevron-down" size={18} color={colors.mutedForeground} />
        </TouchableOpacity>
        <Modal
          visible={itemTypePickerOpen}
          transparent
          animationType="fade"
          onRequestClose={() => setItemTypePickerOpen(false)}
        >
          <Pressable
            style={styles.modalBackdrop}
            onPress={() => setItemTypePickerOpen(false)}
          >
            <Pressable
              style={[
                styles.modalSheet,
                { backgroundColor: colors.card, borderColor: colors.border },
              ]}
              onPress={(e) => e.stopPropagation()}
            >
              {ITEM_TYPES.map((tp) => (
                <TouchableOpacity
                  key={tp}
                  onPress={() => {
                    setItemType(tp);
                    setItemTypePickerOpen(false);
                  }}
                  style={[
                    styles.modalOption,
                    { borderBottomColor: colors.border },
                  ]}
                >
                  <Text
                    style={{
                      color: colors.foreground,
                      fontFamily:
                        itemType === tp ? "Inter_600SemiBold" : "Inter_400Regular",
                      fontSize: 16,
                    }}
                  >
                    {t(ITEM_TYPE_KEYS[tp])}
                  </Text>
                  {itemType === tp ? (
                    <Feather name="check" size={18} color={colors.primary} />
                  ) : null}
                </TouchableOpacity>
              ))}
            </Pressable>
          </Pressable>
        </Modal>
        <TextInput
          value={itemDesc}
          onChangeText={setItemDesc}
          placeholder={t("tickets.descriptionPlaceholder")}
          placeholderTextColor={colors.mutedForeground}
          style={[
            styles.input,
            { borderColor: colors.border, color: colors.foreground },
          ]}
        />
        <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
          <TextInput
            value={qty}
            onChangeText={setQty}
            keyboardType="numeric"
            placeholder={t("tickets.qtyPlaceholder")}
            placeholderTextColor={colors.mutedForeground}
            style={[
              styles.input,
              { flex: 1, borderColor: colors.border, color: colors.foreground },
            ]}
          />
          <TextInput
            value={unitPrice}
            onChangeText={setUnitPrice}
            keyboardType="numeric"
            placeholder={t("tickets.unitPricePlaceholder")}
            placeholderTextColor={colors.mutedForeground}
            style={[
              styles.input,
              { flex: 1, borderColor: colors.border, color: colors.foreground },
            ]}
          />
        </View>
        <LayeredPillButton
          onPress={addItem}
          height={40}
          style={[styles.actionBtnFull, { marginTop: 8 }]}
          testID="button-add-line-item"
        >
          <Feather name="plus" size={16} color="#ffffff" style={styles.actionBtnIconShadow} />
          <Text style={[styles.actionBtnText, styles.actionBtnTextShadow, { color: "#ffffff" }]}>
            {t("tickets.addLineItem")}
          </Text>
        </LayeredPillButton>
      </View>
      ) : null}

      <CommentsPanel source="ticket" parentId={Number(ticketId)} />

      <View
        style={[
          styles.totals,
          { borderColor: colors.border, backgroundColor: colors.card },
        ]}
      >
        <View style={styles.totalRow}>
          <Text style={{ color: colors.mutedForeground }}>{t("tickets.subtotal")}</Text>
          <Text style={{ color: colors.foreground, fontFamily: "Inter_600SemiBold" }}>
            ${subtotal.toFixed(2)}
          </Text>
        </View>
        <View style={styles.totalRow}>
          <Text style={{ color: colors.mutedForeground }}>
            {t("tickets.taxLabel", { state: ticket.state || "—", pct: (taxRate * 100).toFixed(2) })}
          </Text>
          <Text style={{ color: colors.foreground, fontFamily: "Inter_600SemiBold" }}>
            ${taxAmount.toFixed(2)}
          </Text>
        </View>
        <View style={[styles.totalRow, styles.totalRowGrand]}>
          <Text style={{ color: colors.foreground, fontFamily: "Inter_700Bold" }}>
            {t("tickets.total")}
          </Text>
          <Text style={{ color: colors.foreground, fontFamily: "Inter_700Bold" }}>
            ${grandTotal.toFixed(2)}
          </Text>
        </View>
      </View>

      {ticket.siteLocationId ? (
        <TouchableOpacity
          onPress={() =>
            // Task #498: from a live ticket the FE is already on, the
            // "another job" CTA initiates an *adjacent* ticket — same
            // site, same crew, opens immediately as in_progress with
            // foreman=self. The `adjacent=1` flag is a header-only hint;
            // the server still derives intake_channel from the field
            // session.
            router.push(
              `/new-ticket?siteId=${ticket.siteLocationId}&adjacent=1`,
            )
          }
          style={[
            styles.checkoutBtn,
            {
              backgroundColor: "transparent",
              borderWidth: 1,
              borderColor: colors.border,
              flexDirection: "row",
              gap: 8,
              marginTop: 12,
            },
          ]}
          testID="button-initiate-adjacent-ticket"
        >
          <Feather name="plus-circle" size={18} color={colors.foreground} />
          <Text
            style={{
              color: colors.foreground,
              fontFamily: "Inter_600SemiBold",
              fontSize: 15,
            }}
          >
            {t("tickets.initiateAdjacentTicket", {
              defaultValue: "Initiate adjacent ticket",
            })}
          </Text>
        </TouchableOpacity>
      ) : null}

      <Modal
        visible={previewPhoto !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setPreviewPhoto(null)}
      >
        <Pressable
          style={styles.previewBackdrop}
          onPress={() => setPreviewPhoto(null)}
        >
          {previewPhoto ? (
            <Image
              source={{ uri: previewPhoto }}
              style={styles.previewImage}
              resizeMode="contain"
            />
          ) : null}
          <TouchableOpacity
            onPress={() => setPreviewPhoto(null)}
            style={styles.previewClose}
            hitSlop={12}
          >
            <Feather name="x" size={28} color="#fff" />
          </TouchableOpacity>
        </Pressable>
      </Modal>
    </ScrollView>
    {/* ── Task #623: Assignment-restored confirmation toast ── */}
    {restoredVisible ? (
      <View
        style={styles.restoredToastContainer}
        pointerEvents="none"
        testID="toast-assignment-restored"
      >
        <View style={styles.restoredToast}>
          <Feather name="check-circle" size={16} color="#ffffff" />
          <Text style={styles.restoredToastText}>
            {t("tickets.assignmentRestoredToast")}
          </Text>
        </View>
      </View>
    ) : null}
    {/* ── Task #42: Geofence auto-check-in confirmation toast ──
        Surfaces the moment `setArrivedVisible(true)` fires, after the
        geofence handler successfully POSTed /check-in and refreshed
        the ticket so the stepper has flipped to On Site. Reuses the
        green `restoredToast` styling so the visual language matches
        the other success confirmations on this screen. */}
    {arrivedVisible ? (
      <View
        style={[
          styles.restoredToastContainer,
          { bottom: restoredVisible || refreshedVisible ? 80 : 32 },
        ]}
        pointerEvents="none"
        testID="toast-arrived-on-site"
      >
        <View style={styles.restoredToast}>
          <Feather name="check-circle" size={16} color="#ffffff" />
          <Text style={styles.restoredToastText}>
            {t("tickets.arrivedToast")}
          </Text>
        </View>
      </View>
    ) : null}
    {/* ── Task #669: Manual refresh confirmation toast ──
        Mirrors the web LiveConnectionPill's "refreshed" state from
        Task #667. Reuses the assignment-restored toast styling so the
        two confirmations read as one consistent visual language. The
        offsets stack the toasts when both are unexpectedly visible at
        once (assignment-restored is push-driven and unrelated to
        manual refresh, but the `bottom` adjustment keeps them from
        overlapping if they happen to coincide). */}
    {refreshedVisible ? (
      <View
        style={[
          styles.restoredToastContainer,
          { bottom: restoredVisible || arrivedVisible ? 80 : 32 },
        ]}
        pointerEvents="none"
        testID="toast-ticket-refreshed"
      >
        <View style={styles.restoredToast}>
          <Feather name="check-circle" size={16} color="#ffffff" />
          <Text style={styles.restoredToastText}>
            {t("tickets.refreshedToast")}
          </Text>
        </View>
      </View>
    ) : null}
    {/* ── Task #686: tickets rate-limit "reconnecting" toast ──
        The server (Task #675) returns 429 with Retry-After when this
        session has overrun its budget on /api/tickets/:id. Mirrors
        the web's "Reconnecting…" pill so the user sees a familiar
        pause indicator instead of a silent gap or a generic error.
        We reuse the restored-toast container styling (with an amber
        background to distinguish from the green confirmation toasts)
        and stack it above the other bottom toasts when both happen
        to be visible. The toast disappears on its own when the
        cooldown expires — the hook re-renders, `rateLimited` flips
        back to false, and the page resumes normal refetch cadence. */}
    {rateLimited ? (
      <View
        style={[
          styles.restoredToastContainer,
          {
            bottom:
              restoredVisible || refreshedVisible || arrivedVisible ? 80 : 32,
          },
        ]}
        pointerEvents="none"
        testID="toast-ticket-rate-limited"
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
    {ticket.vendorId != null ? (
      <ScheduleTicketPanel
        visible={scheduleOpen}
        onClose={() => setScheduleOpen(false)}
        ticketId={ticket.id}
        vendorId={ticket.vendorId}
        onSaved={() => {
          void load({ silent: true });
          void crewHandleRef.current?.refreshAll();
        }}
      />
    ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  card: { borderWidth: 1, borderRadius: 12, padding: 14, marginBottom: 16 },
  // Task #623: assignment-restored toast. Pinned to the bottom of the
  // screen with `pointerEvents="none"` on the container so input passes
  // straight through — the worker can keep typing/tapping while it shows.
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
  // Task #686: slate-grey background visually separates the rate-limited
  // pause indicator from the green "confirmed" toasts above so users
  // can tell at a glance whether they're seeing a success or a wait.
  // Amber was deliberately removed from the mobile palette unless that
  // color is the brand color the admin chose (see use-brand.tsx).
  rateLimitedToast: {
    backgroundColor: "#475569",
  },
  restoredToastText: {
    color: "#ffffff",
    fontFamily: "Inter_600SemiBold",
    fontSize: 13,
  },
  reopenedBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    alignSelf: "flex-start",
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
    marginTop: 10,
  },
  reopenedBadgeText: {
    color: "#1a1d23",
    fontFamily: "Inter_600SemiBold",
    fontSize: 11,
  },
  title: { fontFamily: "Inter_700Bold", fontSize: 18 },
  meta: { fontFamily: "Inter_400Regular", fontSize: 13, marginTop: 4 },
  statusPill: {
    alignSelf: "flex-start",
    marginTop: 8,
    ...PILL_CHIP_LAYOUT,
  },
  statusPillText: {
    ...PILL_TEXT,
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  section: {
    fontFamily: "Inter_700Bold",
    fontSize: 16,
    marginTop: 8,
    marginBottom: 8,
  },
  lineItem: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
  },
  iconBtn: { padding: 6 },
  formCard: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    marginTop: 8,
    marginBottom: 16,
  },
  toggle: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
  },
  dropdown: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderRadius: 8,
    borderWidth: 1,
    marginBottom: 8,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    paddingHorizontal: 24,
  },
  modalCard: {
    width: "100%",
    maxWidth: 480,
    alignSelf: "center",
    borderRadius: 12,
    borderWidth: 1,
    padding: 16,
  },
  modalSheet: {
    borderRadius: 12,
    borderWidth: 1,
    overflow: "hidden",
  },
  modalOption: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  input: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontFamily: "Inter_400Regular",
    fontSize: 14,
  },
  smallBtn: {
    marginTop: 10,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 10,
    borderRadius: 8,
  },
  actionGroup: {
    marginTop: 8,
    marginBottom: 12,
    gap: 8,
  },
  actionRow: {
    flexDirection: "row",
    gap: 8,
  },
  actionBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    height: 48,
    borderRadius: 10,
  },
  actionBtnHalf: { flex: 1 },
  actionBtnFull: { width: "100%" },
  actionBtnText: { fontFamily: "Inter_400Regular", fontSize: 14 },
  actionBtnTextShadow: {
    textShadowColor: "rgba(0, 0, 0, 0.63)",
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 4,
  },
  actionBtnIconShadow: {
    textShadowColor: "rgba(0, 0, 0, 0.63)",
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 4,
  },
  actionHint: {
    fontFamily: "Inter_400Regular",
    fontSize: 12,
    textAlign: "center",
    marginTop: 2,
  },
  // Task #532: per-control inline error pinned under the failed action.
  inlineError: {
    color: "#dc2626",
    fontFamily: "Inter_400Regular",
    fontSize: 12,
    marginTop: 6,
  },
  note: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
  },
  totals: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    marginTop: 8,
    marginBottom: 8,
    gap: 6,
  },
  totalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  totalRowGrand: {
    borderTopWidth: 1,
    borderTopColor: "rgba(0,0,0,0.08)",
    paddingTop: 8,
    marginTop: 4,
  },
  checkoutBtn: {
    marginTop: 16,
    height: 52,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  historyCard: {
    borderWidth: 1,
    borderRadius: 12,
    marginBottom: 16,
    overflow: "hidden",
  },
  // Cap visible history to ~5 map-thumb rows; older pings scroll inside.
  historyScroll: {
    maxHeight: 420,
  },
  historyScrollContent: {
    flexGrow: 0,
  },
  historyRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  directionsBtn: {
    marginTop: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 10,
  },
  directionsBtnText: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 15,
  },
  mapThumb: {
    width: 64,
    height: 64,
    borderRadius: 8,
    borderWidth: 1,
    overflow: "hidden",
    marginRight: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  mapPin: {
    position: "absolute",
    alignItems: "center",
    justifyContent: "center",
  },
  photoThumb: {
    width: "100%",
    height: 200,
    borderRadius: 8,
    backgroundColor: "rgba(0,0,0,0.05)",
  },
  previewBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.92)",
    alignItems: "center",
    justifyContent: "center",
  },
  previewImage: {
    width: "100%",
    height: "100%",
  },
  previewClose: {
    position: "absolute",
    top: 48,
    right: 20,
    padding: 8,
  },
});
