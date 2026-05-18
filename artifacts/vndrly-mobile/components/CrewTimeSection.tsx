import React, { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useFocusEffect } from "expo-router";
import { View, Text, TouchableOpacity, ActivityIndicator, AppState, type AppStateStatus, StyleSheet, Modal, ScrollView, Image, Pressable } from "react-native";
// Per-employee check-in/out, the bulk in/out buttons (Task #546), and the
// roster-remove flow (Task #561) all surface failures via
// inlineErrorForTicketAction instead of popping modal alerts, so Alert is
// no longer imported here.
import { Feather } from "@expo/vector-icons";
import AmberButton from "@/components/AmberButton";
import { apiFetch } from "@/lib/api";
import { getApiErrorCode, inlineErrorForTicketAction } from "@/lib/apiErrors";

const pillLeft = require("../assets/buttons/blue-left.png");
const pillCenter = require("../assets/buttons/blue-center.png");
const pillRight = require("../assets/buttons/blue-right.png");

type RosterEntry = {
  id: number;
  ticketId: number;
  employeeId: number;
  employeeName: string | null;
  vendorRole: string | null;
  addedAt: string;
};

function CrewChip({
  name,
  onRemove,
  removeLabel,
  testID,
}: {
  name: string;
  onRemove?: () => void;
  removeLabel?: string;
  testID?: string;
}) {
  const height = 28;
  return (
    <View style={[chipStyles.chip, { height }]} testID={testID}>
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        <View style={chipStyles.row}>
          <Image source={pillLeft} style={[chipStyles.cap, { height }]} resizeMode="stretch" />
          <Image source={pillCenter} style={[chipStyles.center, { height }]} resizeMode="stretch" />
          <Image source={pillRight} style={[chipStyles.cap, { height }]} resizeMode="stretch" />
        </View>
      </View>
      <View style={chipStyles.contentRow}>
        <Text style={chipStyles.label} numberOfLines={1}>{name}</Text>
        {onRemove && (
          <TouchableOpacity
            onPress={onRemove}
            accessibilityLabel={removeLabel ?? `Remove ${name}`}
            hitSlop={6}
            style={chipStyles.removeBtn}
          >
            <Feather name="x" size={12} color="#ffffff" />
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

function AddChip({ label, onPress, disabled, testID }: { label: string; onPress: () => void; disabled?: boolean; testID?: string }) {
  const height = 28;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      testID={testID}
      style={({ pressed }) => [chipStyles.chip, { height, opacity: disabled ? 0.5 : pressed ? 0.85 : 0.9 }]}
    >
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        <View style={chipStyles.row}>
          <Image source={pillLeft} style={[chipStyles.cap, { height }]} resizeMode="stretch" />
          <Image source={pillCenter} style={[chipStyles.center, { height }]} resizeMode="stretch" />
          <Image source={pillRight} style={[chipStyles.cap, { height }]} resizeMode="stretch" />
        </View>
      </View>
      <View style={chipStyles.contentRow}>
        <Feather name="plus" size={12} color="#ffffff" />
        <Text style={chipStyles.label} numberOfLines={1}>{label}</Text>
      </View>
    </Pressable>
  );
}

const chipStyles = StyleSheet.create({
  chip: {
    position: "relative",
    paddingHorizontal: 12,
    minWidth: 100,
    justifyContent: "center",
    alignItems: "center",
    marginRight: 6,
    marginBottom: 6,
  },
  row: { flex: 1, flexDirection: "row" },
  cap: { width: 6 },
  center: { flex: 1 },
  contentRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  label: { color: "#ffffff", fontSize: 12, fontWeight: "700" },
  removeBtn: {
    width: 16, height: 16, borderRadius: 8,
    backgroundColor: "rgba(255,255,255,0.25)",
    alignItems: "center", justifyContent: "center",
    marginLeft: 2,
  },
});

type Session = {
  id: number;
  ticketId: number;
  employeeId: number;
  employeeName: string | null;
  checkInAt: string;
  checkOutAt: string | null;
  source: string;
};

function formatHM(hours: number, t: (key: string, opts?: Record<string, unknown>) => string): string {
  if (!Number.isFinite(hours) || hours < 0) return t("crew.hoursMinutes", { h: 0, m: 0 });
  const totalMin = Math.floor(hours * 60);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return t("crew.hoursMinutes", { h, m });
}
type LaborSummary = {
  totals: { totalHours: number; totalCost: number; overtimeHours: number };
  people: Array<{ employeeId: number; employeeName: string; totalHours: number; overtimeHours: number; totalCost: number }>;
};
type FieldEmployee = { id: number; firstName: string; lastName: string; vendorId: number; vendorRole?: string | null; isActive?: boolean | null };

// Task #877: imperative handle the parent ticket detail screen can use
// to drive the same crew + sessions + roster refresh path the 60s sync
// tick already runs. Exposed via the optional `refreshHandleRef` prop
// (an imperative-handle prop, not React.forwardRef) so existing test
// mocks that render a plain function component don't trigger the
// "function components cannot be given refs" warning. The pull-to-
// refresh gesture and header refresh button on `app/ticket/[id].tsx`
// call `refreshHandleRef.current?.refreshAll()` so a foreman who
// wants instant feedback (e.g. confirming the office just deactivated
// a worker) doesn't have to wait for the 60s sync tick or remount.
export type CrewTimeSectionHandle = {
  refreshAll: () => Promise<void>;
};

export default function CrewTimeSection({
  ticketId,
  vendorId,
  isForeman,
  canEdit,
  canEditRoster,
  colors,
  refreshHandleRef,
}: {
  ticketId: number;
  vendorId: number | null;
  isForeman: boolean;
  canEdit: boolean;
  canEditRoster: boolean;
  colors: import("@/hooks/useColors").AppColors;
  refreshHandleRef?: React.MutableRefObject<CrewTimeSectionHandle | null>;
}) {
  const { t } = useTranslation();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [summary, setSummary] = useState<LaborSummary | null>(null);
  const [crew, setCrew] = useState<FieldEmployee[]>([]);
  const [roster, setRoster] = useState<RosterEntry[]>([]);
  const [busy, setBusy] = useState<number | "all-in" | "all-out" | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [pickerOpen, setPickerOpen] = useState(false);
  const [rosterBusy, setRosterBusy] = useState<number | "add" | null>(null);
  // Task #532: per-control inline error for the crew picker. Server-side
  // membership errors (foreman_*_mismatch, field_employee_vendor_mismatch)
  // belong on the picker rather than as a separate alert.
  const [pickerError, setPickerError] = useState<string | null>(null);
  // Task #546: per-row inline errors for the foreman's per-employee
  // check-in / check-out controls, plus per-button summary errors for
  // the bulk "check in all" / "check out all" actions. Replaces the
  // generic Alert.alert popups so a foreman trying to clock a teammate
  // in on a stale ticket sees the failure pinned to that row instead.
  const [rowErrors, setRowErrors] = useState<Record<number, string>>({});
  const [allInError, setAllInError] = useState<string | null>(null);
  const [allOutError, setAllOutError] = useState<string | null>(null);
  // Task #561: per-chip inline error for the roster-remove flow. Replaces
  // the generic Alert.alert popup so a foreman who taps × on a teammate's
  // chip on a stale ticket sees the failure pinned to that chip instead.
  const [rosterRemoveErrors, setRosterRemoveErrors] = useState<Record<number, string>>({});

  const clearRowError = useCallback((empId: number) => {
    setRowErrors(prev => {
      if (!(empId in prev)) return prev;
      const next = { ...prev };
      delete next[empId];
      return next;
    });
  }, []);

  const clearRosterRemoveError = useCallback((empId: number) => {
    setRosterRemoveErrors(prev => {
      if (!(empId in prev)) return prev;
      const next = { ...prev };
      delete next[empId];
      return next;
    });
  }, []);

  const refresh = useCallback(async () => {
    try {
      const [s, sm, r] = await Promise.all([
        apiFetch<Session[]>(`/api/tickets/${ticketId}/crew-sessions`),
        apiFetch<LaborSummary>(`/api/tickets/${ticketId}/labor-summary`),
        apiFetch<RosterEntry[]>(`/api/tickets/${ticketId}/crew-roster`).catch(() => [] as RosterEntry[]),
      ]);
      setSessions(s);
      setSummary(sm);
      setRoster(r);
    } catch {}
  }, [ticketId]);

  // Task #524: dedicated re-fetch for the vendor crew list. Task #521 made
  // the picker drop deactivated workers on initial load, but the list was
  // previously only fetched on mount / when vendor or permissions change.
  // If the office deactivated a worker while the foreman had this screen
  // open, that worker stayed in both the foreman in/out list and the
  // "Crew on Site" picker until the screen was remounted. The refresh
  // pathway is exposed here so the 60s sync tick, focus regain, and the
  // post-error converge path can all share it.
  const refreshCrew = useCallback(async () => {
    if (!vendorId || (!canEdit && !canEditRoster)) return;
    try {
      const list = await apiFetch<FieldEmployee[]>(
        `/api/field-employees?vendorId=${vendorId}`,
      );
      setCrew(list.filter(e => e.isActive !== false));
    } catch {}
  }, [vendorId, canEdit, canEditRoster]);

  useEffect(() => { void refresh(); }, [refresh]);

  // Task #892: gate both the 60s "now" tick and the 60s server-sync
  // interval on AppState so we don't burn battery / cellular while the
  // app is backgrounded (lock screen, app switcher, another app
  // foregrounded). Mirrors the pattern from Task #621 on the ticket
  // detail screen: the current foreground state is mirrored into React
  // state so the interval-owning effect re-runs on every transition and
  // tears down / re-arms the timers accordingly. Initial value reads
  // `AppState.currentState` so a screen rendered while the app is
  // already backgrounded doesn't immediately start the timers.
  const [appForegrounded, setAppForegrounded] = useState(
    () => AppState.currentState === "active",
  );
  useEffect(() => {
    const sub = AppState.addEventListener("change", (next: AppStateStatus) => {
      setAppForegrounded(next === "active");
    });
    return () => sub.remove();
  }, []);

  // Tick "now" every minute so running totals stay live; refresh server data
  // every 60s as well to pick up other devices' check-ins/outs and any
  // mid-shift roster changes from the office (Task #524: piggyback the
  // vendor crew list onto the same tick so deactivations propagate without
  // requiring the foreman to remount the screen). Both timers stop while
  // the app is backgrounded (Task #892) and the foreground-regain path
  // below picks up any drift in `now` and any missed server changes.
  useEffect(() => {
    if (!appForegrounded) return undefined;
    // Snap "now" forward on (re)foreground so the running totals reflect
    // any time that elapsed while the tick was paused, without waiting
    // up to a full minute for the next interval fire.
    setNow(Date.now());
    const tick = setInterval(() => setNow(Date.now()), 60_000);
    const sync = setInterval(() => {
      void refresh();
      void refreshCrew();
    }, 60_000);
    return () => {
      clearInterval(tick);
      clearInterval(sync);
    };
  }, [refresh, refreshCrew, appForegrounded]);

  // Task #877: keep the parent's imperative handle pointed at the latest
  // closure of `refresh` + `refreshCrew` so the ticket detail screen's
  // pull-to-refresh and header refresh button can run the same crew /
  // sessions / roster fetches the 60s sync tick uses. We assign on every
  // render (cheap — ref writes don't trigger renders) and clear on
  // unmount so a stale handle from a previous mount can't be invoked.
  useEffect(() => {
    if (!refreshHandleRef) return;
    refreshHandleRef.current = {
      refreshAll: async () => {
        await Promise.all([refresh(), refreshCrew()]);
      },
    };
    return () => {
      if (refreshHandleRef) refreshHandleRef.current = null;
    };
  }, [refreshHandleRef, refresh, refreshCrew]);

  // Task #524: also re-fetch when the screen regains focus. Expo Router
  // keeps the previous screen mounted when the user pushes deeper into
  // the stack, so a plain useEffect cleanup wouldn't fire on
  // navigate-away / navigate-back. Skip the very first focus pass to
  // avoid double-fetching on initial mount (the mount-time refresh
  // above already covers that).
  const isFirstFocusRef = useRef(true);
  useFocusEffect(
    useCallback(() => {
      if (isFirstFocusRef.current) {
        isFirstFocusRef.current = false;
        return;
      }
      void refresh();
      void refreshCrew();
    }, [refresh, refreshCrew]),
  );

  // Live per-employee + grand totals computed from raw sessions so still-checked-in
  // crew tick up in real time (server-side summary is a snapshot).
  const live = useMemo(() => {
    const byEmp = new Map<number, { name: string; hours: number; isOpen: boolean }>();
    for (const s of sessions) {
      const start = new Date(s.checkInAt).getTime();
      const end = s.checkOutAt ? new Date(s.checkOutAt).getTime() : now;
      const h = Math.max(0, (end - start) / 3_600_000);
      const prev = byEmp.get(s.employeeId);
      if (prev) {
        prev.hours += h;
        if (!s.checkOutAt) prev.isOpen = true;
      } else {
        byEmp.set(s.employeeId, {
          name: s.employeeName ?? t("crew.employeeFallback", { id: s.employeeId }),
          hours: h,
          isOpen: !s.checkOutAt,
        });
      }
    }
    const people = Array.from(byEmp.entries())
      .map(([employeeId, v]) => ({ employeeId, ...v }))
      .sort((a, b) => b.hours - a.hours);
    const totalHours = people.reduce((acc, p) => acc + p.hours, 0);
    const anyOpen = people.some(p => p.isOpen);
    return { people, totalHours, anyOpen };
  }, [sessions, now, t]);

  // Vendor crew list is needed both for the foreman in/out controls (existing)
  // and for the roster picker (anyone with canEditRoster). Fetch when we have a
  // vendor scope and the user can edit either flow.
  //
  // Task #521: refreshCrew() drops deactivated vendor_people so the foreman
  // in/out controls and the "Crew on Site" roster picker mirror the
  // active-only contract Task #515 added to the web pickers.
  // Task #524: the same callback now drives the 60s sync tick and focus
  // re-fetch above; this effect handles the initial load when the
  // component mounts or when the vendor / permissions change.
  useEffect(() => {
    void refreshCrew();
  }, [refreshCrew]);

  const rosterEmployeeIds = useMemo(() => new Set(roster.map(r => r.employeeId)), [roster]);
  const eligibleForRoster = useMemo(
    () => crew.filter(e => !rosterEmployeeIds.has(e.id)),
    [crew, rosterEmployeeIds],
  );

  async function addToRoster(employeeId: number) {
    setRosterBusy("add");
    setPickerError(null);
    try {
      await apiFetch(`/api/tickets/${ticketId}/crew-roster`, {
        method: "POST",
        body: JSON.stringify({ employeeId }),
      });
      await refresh();
      setPickerOpen(false);
    } catch (e) {
      // Task #532: keep the picker open and pin the error inside it
      // when the server returns a structured membership code so the
      // user can fix their selection without dismissing the modal.
      const inline = inlineErrorForTicketAction(
        e,
        t,
        "crew_picker",
        e instanceof Error ? e.message : String(e),
      );
      setPickerError(inline.message);
      // Task #524: when the server rejects with crew.employee_inactive
      // (the office just deactivated this worker), reload the vendor
      // crew list so the now-inactive worker drops out of the picker
      // on the next render. The inline picker error stays so the
      // foreman sees what just happened.
      if (getApiErrorCode(e) === "crew.employee_inactive") {
        void refreshCrew();
      }
    } finally {
      setRosterBusy(null);
    }
  }

  async function removeFromRoster(employeeId: number) {
    setRosterBusy(employeeId);
    clearRosterRemoveError(employeeId);
    try {
      await apiFetch(`/api/tickets/${ticketId}/crew-roster/${employeeId}`, { method: "DELETE" });
      await refresh();
    } catch (e) {
      // Task #561: route through the shared inline-error helper so the
      // foreman gets a localized, code-aware message pinned next to the
      // chip they tapped, mirroring Task #546's per-row check-in/out
      // treatment. State-conflict codes (ticket already moved on, or
      // crew.not_on_roster — added to STATE_CONFLICT_CODES in this task)
      // silently refresh so we don't pin a message under a chip that's
      // about to disappear. The fallback string was introduced upstream
      // for the now-removed Alert.alert; reusing it keeps Spanish
      // foremen on a translated message when no structured code applies.
      const inline = inlineErrorForTicketAction(
        e,
        t,
        "crew_picker",
        t("crew.removeFromRosterFailed"),
      );
      if (inline.isStateConflict) {
        clearRosterRemoveError(employeeId);
        await refresh();
      } else {
        setRosterRemoveErrors(prev => ({ ...prev, [employeeId]: inline.message }));
      }
    } finally {
      setRosterBusy(null);
    }
  }

  const openIds = new Set(sessions.filter(s => !s.checkOutAt).map(s => s.employeeId));
  const LONG_SESSION_HOURS = 8;
  const longOpenNames = Array.from(new Set(
    sessions
      .filter(s => !s.checkOutAt && (Date.now() - new Date(s.checkInAt).getTime()) / 3_600_000 > LONG_SESSION_HOURS)
      .map(s => s.employeeName),
  ));

  // Task #546: route a single per-employee check-in/out failure to the
  // right place. State-conflict codes (ticket cancelled / lifecycle
  // changed) silently refresh — there's no point pinning a message
  // under a row whose button may not even be there after the refresh.
  // Membership codes (foreman_*_mismatch, field_employee_vendor_mismatch,
  // crew_invalid_for_vendor, foreman_not_in_crew) belong on the crew
  // picker; everything else pins to the row that just failed.
  const handleSingleError = useCallback(
    async (
      e: unknown,
      empId: number,
      preferredField: "check_in" | "check_out",
      fallback: string,
    ) => {
      const inline = inlineErrorForTicketAction(e, t, preferredField, fallback);
      // Task #524: when the worker was just deactivated by the office,
      // pin the localized message under the row that failed so the
      // foreman has clear feedback. We deliberately do NOT call
      // refreshCrew() here — the error is rendered inside the row, and
      // refreshing immediately would yank that row out of the list and
      // hide the message before it can be read. The 60s sync tick and
      // useFocusEffect path will both prune the now-inactive worker
      // from the roster shortly after.
      if (getApiErrorCode(e) === "crew.employee_inactive") {
        setRowErrors(prev => ({ ...prev, [empId]: inline.message }));
        return;
      }
      if (inline.isStateConflict) {
        clearRowError(empId);
        await refresh();
        return;
      }
      if (inline.field === "crew_picker") {
        clearRowError(empId);
        setPickerError(inline.message);
        return;
      }
      setRowErrors(prev => ({ ...prev, [empId]: inline.message }));
    },
    [clearRowError, refresh, t],
  );

  async function checkInOne(empId: number) {
    setBusy(empId);
    clearRowError(empId);
    // Task #578: clear any stale membership error from a prior tap so a
    // success (or a non-membership failure) on the same row makes the
    // pinned banner go away. handleSingleError re-pins it if the new
    // failure is itself a membership code.
    setPickerError(null);
    try {
      await apiFetch(`/api/tickets/${ticketId}/crew/${empId}/check-in`, { method: "POST", body: JSON.stringify({}) });
      await refresh();
    } catch (e) {
      await handleSingleError(e, empId, "check_in", t("crew.checkInOneFailed"));
    } finally { setBusy(null); }
  }
  async function checkOutOne(empId: number) {
    setBusy(empId);
    clearRowError(empId);
    // Task #578: see checkInOne above — clear stale membership banner
    // before retrying so a successful (or differently-failing) call
    // doesn't leave the pinned message stranded.
    setPickerError(null);
    try {
      await apiFetch(`/api/tickets/${ticketId}/crew/${empId}/check-out`, { method: "POST", body: JSON.stringify({}) });
      await refresh();
    } catch (e) {
      await handleSingleError(e, empId, "check_out", t("crew.checkOutOneFailed"));
    } finally { setBusy(null); }
  }
  async function checkOutAll() {
    setBusy("all-out");
    setAllOutError(null);
    try {
      const results = await Promise.all(Array.from(openIds).map(id =>
        apiFetch(`/api/tickets/${ticketId}/crew/${id}/check-out`, { method: "POST", body: JSON.stringify({}) })
          .then(() => null)
          .catch((e: unknown) => e)
      ));
      // Convert each rejection into a structured inline error so we can
      // ignore state-conflict failures (the refresh below will reflect
      // whatever the ticket actually is now) and only count the rest
      // toward the per-button summary.
      const inlines = results
        .filter((e): e is unknown => e !== null)
        .map(e => inlineErrorForTicketAction(e, t, "check_out", t("crew.checkOutOneFailed")));
      const realFailures = inlines.filter(i => !i.isStateConflict);
      if (realFailures.length > 0) {
        setAllOutError(t("crew.checkOutSomeFailed", { count: realFailures.length }));
      }
      await refresh();
      // Task #524: re-pull the vendor crew list so any worker the office
      // deactivated mid-bulk drops out of the foreman in/out roster on
      // the next render.
      void refreshCrew();
    } finally { setBusy(null); }
  }
  async function checkInAll() {
    setBusy("all-in");
    setAllInError(null);
    try {
      const toCheckIn = crew.filter(e => !openIds.has(e.id));
      const results = await Promise.all(toCheckIn.map(e =>
        apiFetch(`/api/tickets/${ticketId}/crew/${e.id}/check-in`, { method: "POST", body: JSON.stringify({}) })
          .then(() => null)
          .catch((err: unknown) => err)
      ));
      const inlines = results
        .filter((e): e is unknown => e !== null)
        .map(e => inlineErrorForTicketAction(e, t, "check_in", t("crew.checkInOneFailed")));
      const realFailures = inlines.filter(i => !i.isStateConflict);
      if (realFailures.length > 0) {
        setAllInError(t("crew.checkInSomeFailed", { count: realFailures.length }));
      }
      await refresh();
      // Task #524: re-pull the vendor crew list so any worker the office
      // deactivated mid-bulk drops out of the foreman in/out roster on
      // the next render.
      void refreshCrew();
    } finally { setBusy(null); }
  }

  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={styles.header}>
        <Feather name="users" size={16} color={colors.primary} />
        <Text style={[styles.title, { color: colors.foreground }]}>{t("crew.title")}</Text>
      </View>

      {/* Crew on Site roster — first thing in the card */}
      <View style={{ marginTop: 8 }} testID="section-crew-on-site">
        <Text style={{ fontSize: 11, fontWeight: "600", letterSpacing: 0.5, color: colors.mutedForeground, textTransform: "uppercase", marginBottom: 6 }}>
          {t("crew.crewOnSite")}
        </Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center" }}>
          {roster.length === 0 && (
            <Text style={{ fontSize: 13, fontStyle: "italic", color: colors.mutedForeground, marginRight: 8, marginBottom: 6 }}>
              {t("crew.noCrewOnSite")}
            </Text>
          )}
          {roster.map(r => {
            // Task #561: wrap each chip in a column so a per-chip inline
            // error from the roster-remove flow can sit directly under
            // the chip the foreman just tapped, instead of opening an
            // alert dialog.
            const removeError = rosterRemoveErrors[r.employeeId];
            return (
              <View key={r.id} style={styles.rosterChipColumn}>
                <CrewChip
                  name={r.employeeName ?? t("crew.employeeFallback", { id: r.employeeId })}
                  removeLabel={t("crew.removeFromRoster")}
                  onRemove={canEditRoster ? () => removeFromRoster(r.employeeId) : undefined}
                  testID={`chip-crew-${r.employeeId}`}
                />
                {removeError ? (
                  <Text
                    style={styles.rosterChipError}
                    testID={`inline-error-roster-remove-${r.employeeId}`}
                  >
                    {removeError}
                  </Text>
                ) : null}
              </View>
            );
          })}
          {canEditRoster && (
            <AddChip
              label={roster.length === 0 ? t("crew.addCrewMember") : t("crew.addAnother")}
              onPress={() => setPickerOpen(true)}
              disabled={eligibleForRoster.length === 0 || rosterBusy !== null}
              testID="button-add-crew-roster"
            />
          )}
        </View>
      </View>

      <Modal
        visible={pickerOpen}
        transparent
        animationType="fade"
        onRequestClose={() => { setPickerOpen(false); setPickerError(null); }}
      >
        <Pressable
          style={modalStyles.backdrop}
          onPress={() => { setPickerOpen(false); setPickerError(null); }}
        >
          <Pressable
            style={[modalStyles.sheet, { backgroundColor: colors.card, borderColor: colors.border }]}
            onPress={(e) => e.stopPropagation()}
          >
            <Text style={[modalStyles.title, { color: colors.foreground }]}>{t("crew.addToRoster")}</Text>
            {eligibleForRoster.length === 0 ? (
              <Text style={{ color: colors.mutedForeground, paddingVertical: 12 }}>{t("crew.noEligibleEmployees")}</Text>
            ) : (
              <ScrollView style={{ maxHeight: 320 }}>
                {eligibleForRoster.map(e => (
                  <TouchableOpacity
                    key={e.id}
                    onPress={() => addToRoster(e.id)}
                    disabled={rosterBusy !== null}
                    style={[modalStyles.option, { borderBottomColor: colors.border }]}
                    testID={`option-roster-${e.id}`}
                  >
                    <Text style={{ color: colors.foreground, fontSize: 15 }}>
                      {e.firstName} {e.lastName}
                    </Text>
                    {e.vendorRole && (
                      <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>{e.vendorRole}</Text>
                    )}
                  </TouchableOpacity>
                ))}
              </ScrollView>
            )}
            {pickerError ? (
              <Text
                style={{ color: "#dc2626", fontSize: 12, marginTop: 8 }}
                testID="inline-error-crew-picker"
              >
                {pickerError}
              </Text>
            ) : null}
            <TouchableOpacity
              onPress={() => { setPickerOpen(false); setPickerError(null); }}
              style={modalStyles.cancelBtn}
            >
              <Text style={{ color: colors.primary, fontWeight: "600" }}>{t("crew.cancel")}</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>

      {openIds.size > 0 && (
        <View>
          <View style={[styles.warn, { backgroundColor: "rgba(255,255,255,0.4)", borderColor: "transparent" }]}>
            <Feather name="alert-triangle" size={14} color="#ffffff" />
            <Text style={{ color: "#ffffff", marginLeft: 6, flex: 1 }}>
              {t("crew.stillCheckedIn", { count: openIds.size })}
            </Text>
            {isForeman && canEdit && (
              <TouchableOpacity
                onPress={checkOutAll}
                disabled={busy !== null}
                testID="button-check-out-all"
              >
                <Text style={{ color: "#ffffff", fontWeight: "600" }}>{busy === "all-out" ? t("crew.loadingDots") : t("crew.checkOutAll")}</Text>
              </TouchableOpacity>
            )}
          </View>
          {/* Task #546: per-button summary error pinned under "check out all". */}
          {allOutError ? (
            <Text style={styles.inlineError} testID="inline-error-check-out-all">
              {allOutError}
            </Text>
          ) : null}
        </View>
      )}

      {longOpenNames.length > 0 && (
        <View style={[styles.warn, { backgroundColor: "#f4f4f5", borderColor: "#9ca3af" }]}>
          <Feather name="alert-triangle" size={14} color="#1a1d23" />
          <Text style={{ color: "#1a1d23", marginLeft: 6, flex: 1 }}>
            {t("crew.longSession", { hours: LONG_SESSION_HOURS, names: longOpenNames.join(", ") })}
          </Text>
        </View>
      )}

      {live.people.length > 0 && (
        <View style={{ marginTop: 8 }}>
          {live.people.map(p => {
            const otForP = summary?.people.find(sp => sp.employeeId === p.employeeId);
            return (
              <View key={p.employeeId} style={styles.row}>
                <View style={{ flex: 2, flexDirection: "row", alignItems: "center", gap: 6 }}>
                  {p.isOpen ? (
                    <View style={styles.liveDot} />
                  ) : null}
                  <Text style={[styles.cellName, { color: colors.foreground, flex: 1 }]} numberOfLines={1}>
                    {p.name}
                  </Text>
                </View>
                <Text style={[styles.cellMono, { color: colors.foreground }]}>{formatHM(p.hours, t)}</Text>
                {otForP && otForP.overtimeHours > 0 ? (
                  <Text style={[styles.cellMono, { color: "#dc2626" }]}>{t("crew.overtime", { hours: otForP.overtimeHours.toFixed(1) })}</Text>
                ) : (
                  <Text style={[styles.cellMono, { color: colors.mutedForeground }]}>{p.isOpen ? t("crew.live") : "—"}</Text>
                )}
                {otForP ? (
                  <Text style={[styles.cellMono, { color: colors.foreground, fontWeight: "600" }]}>${otForP.totalCost.toFixed(2)}</Text>
                ) : (
                  <Text style={[styles.cellMono, { color: colors.mutedForeground }]}>—</Text>
                )}
              </View>
            );
          })}
          <View style={[styles.row, { borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 6, marginTop: 4 }]}>
            <Text style={[styles.cellName, { color: colors.foreground, fontWeight: "700" }]}>
              {live.anyOpen ? t("crew.totalLive") : t("crew.total")}
            </Text>
            <Text style={[styles.cellMono, { color: colors.foreground, fontWeight: "700" }]}>{formatHM(live.totalHours, t)}</Text>
            <Text style={[styles.cellMono, { color: "#dc2626", fontWeight: "600" }]}>
              {summary ? t("crew.overtime", { hours: summary.totals.overtimeHours.toFixed(1) }) : ""}
            </Text>
            <Text style={[styles.cellMono, { color: colors.foreground, fontWeight: "700" }]}>
              {summary ? `$${summary.totals.totalCost.toFixed(2)}` : ""}
            </Text>
          </View>
        </View>
      )}

      {isForeman && canEdit && (
        <View style={{ marginTop: 12 }}>
          {/*
            Task #578: surface membership-mismatch failures from the
            per-row In/Out buttons immediately. handleSingleError parks
            those into `pickerError` so the picker can re-render them
            when opened, but the picker is closed by default and
            react-native-web returns null for closed Modals — so
            without this banner the foreman would tap In/Out and see
            absolutely nothing. Hide the banner while the picker is
            open so the message isn't duplicated; the same `pickerError`
            still renders inside the Modal (see inline-error-crew-picker
            below).

            Task #873: wrap the banner in a Pressable that opens the
            crew picker on tap so the foreman can fix their selection
            in one tap instead of scrolling up to "Crew on Site". The
            same `pickerError` value is preserved across the open
            transition (the Modal reads it from state) so the message
            re-renders pinned inside the picker. An explicit
            "Open crew picker" affordance underneath the message keeps
            the action discoverable; an accessibilityLabel + hitSlop
            match the treatment used on the chip × and per-row In/Out
            controls.
          */}
          {pickerError && !pickerOpen ? (
            <Pressable
              onPress={() => setPickerOpen(true)}
              accessibilityRole="button"
              accessibilityLabel={t("crew.openCrewPicker")}
              hitSlop={6}
              testID="button-foreman-membership-open-picker"
              style={({ pressed }) => [
                styles.foremanMembershipBanner,
                pressed ? { opacity: 0.7 } : null,
              ]}
            >
              <Text
                style={styles.inlineError}
                testID="inline-error-foreman-membership"
              >
                {pickerError}
              </Text>
              <Text style={styles.foremanMembershipBannerCta}>
                {t("crew.openCrewPicker")}
              </Text>
            </Pressable>
          ) : null}
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
            <Text style={{ fontSize: 12, color: colors.mutedForeground }}>{t("crew.foremanView")}</Text>
            {crew.some(e => !openIds.has(e.id)) && (
              <AmberButton
                onPress={checkInAll}
                disabled={busy !== null}
                loading={busy === "all-in"}
                height={32}
                textStyle={{ fontSize: 12 }}
                testID="button-check-in-all"
              >
                {t("crew.checkInAll")}
              </AmberButton>
            )}
          </View>
          {/* Task #546: per-button summary error pinned under "check in all". */}
          {allInError ? (
            <Text
              style={[styles.inlineError, { textAlign: "right", marginBottom: 6 }]}
              testID="inline-error-check-in-all"
            >
              {allInError}
            </Text>
          ) : null}
          {crew.map(e => {
            const isOpen = openIds.has(e.id);
            const loading = busy === e.id;
            const rowError = rowErrors[e.id];
            return (
              // Task #546: wrap each crew row in a column so the inline
              // error can sit directly under the row that failed,
              // mirroring the per-control errors Task #532 added for
              // the foreman's own actions.
              <View
                key={e.id}
                style={{
                  borderBottomWidth: StyleSheet.hairlineWidth,
                  borderBottomColor: "#E5E7EB",
                }}
              >
                <View style={styles.crewRowInner}>
                  <Text style={{ flex: 1, color: colors.foreground }}>{e.firstName} {e.lastName}</Text>
                  <TouchableOpacity
                    onPress={() => (isOpen ? checkOutOne(e.id) : checkInOne(e.id))}
                    disabled={loading}
                    style={[styles.smallBtn, { backgroundColor: isOpen ? "#FEE2E2" : colors.primary, opacity: loading ? 0.6 : 1 }]}
                    testID={`button-crew-toggle-${e.id}`}
                  >
                    {loading ? <ActivityIndicator size="small" /> : (
                      <Text style={{ color: isOpen ? "#991B1B" : colors.primaryForeground, fontWeight: "600", fontSize: 12 }}>
                        {isOpen ? t("crew.out") : t("crew.in")}
                      </Text>
                    )}
                  </TouchableOpacity>
                </View>
                {rowError ? (
                  <Text
                    style={[styles.inlineError, { paddingBottom: 6 }]}
                    testID={`inline-error-crew-${e.id}`}
                  >
                    {rowError}
                  </Text>
                ) : null}
              </View>
            );
          })}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 12, padding: 12, marginVertical: 8 },
  header: { flexDirection: "row", alignItems: "center", gap: 6 },
  title: { fontSize: 15, fontWeight: "600", marginLeft: 4 },
  warn: { flexDirection: "row", alignItems: "center", padding: 8, borderRadius: 6, borderWidth: 1, marginTop: 8 },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 4, gap: 8 },
  cellName: { flex: 2, fontSize: 13 },
  cellMono: { fontSize: 12, fontVariant: ["tabular-nums"], minWidth: 56, textAlign: "right" },
  // Task #546: split out the per-row layout from its bottom border so
  // the row + inline error can share the same divider without doubling
  // up. The hairline border now lives on the wrapping column above.
  crewRowInner: { flexDirection: "row", alignItems: "center", paddingVertical: 6 },
  smallBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 6, minWidth: 50, alignItems: "center" },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "#16A34A" },
  // Task #546: per-control inline error pinned under the failed action,
  // matching the style Task #532 introduced on the ticket detail screen.
  inlineError: { color: "#dc2626", fontSize: 12, marginTop: 4 },
  // Task #873: tappable wrapper around the foreman membership banner
  // so the foreman can jump straight into the crew picker. Uses a
  // light red background tint to read as a single actionable surface
  // without redesigning the inline-error palette used elsewhere.
  foremanMembershipBanner: {
    marginBottom: 6,
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "#fecaca",
    backgroundColor: "#fef2f2",
  },
  foremanMembershipBannerCta: {
    color: "#dc2626",
    fontSize: 12,
    fontWeight: "700",
    marginTop: 4,
    textDecorationLine: "underline",
  },
  // Task #561: column wrapper around each crew chip in the "Crew on Site"
  // roster so a per-chip inline error from the roster-remove flow can sit
  // directly beneath the chip without disrupting the wrap behavior of the
  // surrounding flex-wrap row.
  rosterChipColumn: { flexDirection: "column", alignItems: "flex-start" },
  rosterChipError: {
    color: "#dc2626",
    fontSize: 12,
    marginBottom: 6,
    marginRight: 6,
    maxWidth: 220,
  },
});

const modalStyles = StyleSheet.create({
  backdrop: {
    flex: 1, backgroundColor: "rgba(0,0,0,0.4)",
    justifyContent: "center", alignItems: "center", padding: 20,
  },
  sheet: {
    width: "100%", maxWidth: 380, borderRadius: 12, borderWidth: 1, padding: 16,
  },
  title: { fontSize: 16, fontWeight: "700", marginBottom: 8 },
  option: {
    paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth,
  },
  cancelBtn: { paddingTop: 12, alignItems: "center" },
});
