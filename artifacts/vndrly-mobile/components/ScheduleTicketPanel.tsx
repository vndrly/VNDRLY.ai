import { Feather } from "@expo/vector-icons";
import DateTimePicker, {
  type DateTimePickerEvent,
} from "@react-native-community/datetimepicker";
import React, { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";

import BluePillButton from "@/components/BluePillButton";
import GreyButton from "@/components/GreyButton";
import LayeredPillButton from "@/components/LayeredPillButton";
import { useAuth } from "@/hooks/use-auth";
import { useColors } from "@/hooks/useColors";
import { apiFetch } from "@/lib/api";
import { translateApiError } from "@/lib/apiErrors";
import { openScheduleIcs } from "@/lib/openScheduleIcs";

type Coworker = {
  id: number;
  userId: number | null;
  firstName: string | null;
  lastName: string | null;
  vendorRole?: string | null;
  isActive?: boolean;
};

function formatDurationHoursFromMinutes(minutes: number | null): string {
  if (minutes == null) return "1";
  const hours = minutes / 60;
  return Number.isInteger(hours) ? String(hours) : String(Math.round(hours * 100) / 100);
}

function parseDurationHoursToMinutes(hoursStr: string): number | null {
  const trimmed = hoursStr.trim();
  if (!trimmed) return null;
  const hours = Number(trimmed);
  if (!Number.isFinite(hours) || hours < 0) return null;
  return Math.round(hours * 60);
}

type ScheduleSnapshot = {
  scheduledStartAt: string | null;
  scheduledDurationMinutes: number | null;
  foremanUserId: number | null;
  actingForemanUserId: number | null;
  crew: Array<{ employeeId: number; userId: number | null; name: string }>;
  warningKinds: string[];
};

type CrewPreset = {
  id: number;
  name: string;
  memberEmployeeIds: number[];
};

type ScheduleConflict = {
  employeeId: number;
  employeeName: string;
  otherTicketId: number;
  otherWorkType: string | null;
  otherSiteName: string | null;
  otherStartAt: string;
  otherDurationMinutes: number | null;
};

const DEFAULT_KINDS = ["1d", "12h", "1h"] as const;
const KIND_OPTIONS: Array<{ kind: typeof DEFAULT_KINDS[number]; labelKey: string }> = [
  { kind: "1d", labelKey: "scheduleTicket.warning1d" },
  { kind: "12h", labelKey: "scheduleTicket.warning12h" },
  { kind: "1h", labelKey: "scheduleTicket.warning1h" },
];

function empName(e: Coworker): string {
  return `${e.firstName ?? ""} ${e.lastName ?? ""}`.trim() || `#${e.id}`;
}

function formatWhen(d: Date): string {
  return d.toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function ScheduleTicketPanel({
  visible,
  onClose,
  ticketId,
  vendorId,
  onSaved,
}: {
  visible: boolean;
  onClose: () => void;
  ticketId: number;
  vendorId: number;
  onSaved?: () => void;
}) {
  const colors = useColors();
  const { t } = useTranslation();
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [employees, setEmployees] = useState<Coworker[]>([]);
  const [presets, setPresets] = useState<CrewPreset[]>([]);
  const [startAt, setStartAt] = useState(() => {
    const d = new Date();
    d.setMinutes(0, 0, 0);
    d.setHours(d.getHours() + 1);
    return d;
  });
  const [showPicker, setShowPicker] = useState(false);
  const [durationHours, setDurationHours] = useState("1");
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [foremanUserId, setForemanUserId] = useState<number | null>(null);
  const [actingForemanUserId, setActingForemanUserId] = useState<number | null>(null);
  const [warningKinds, setWarningKinds] = useState<string[]>([...DEFAULT_KINDS]);
  const [error, setError] = useState<string | null>(null);
  const [conflicts, setConflicts] = useState<ScheduleConflict[] | null>(null);

  const selectedEmployees = useMemo(
    () => employees.filter((e) => selectedIds.includes(e.id)),
    [employees, selectedIds],
  );

  const foremanCandidates = useMemo(
    () => selectedEmployees.filter((e) => e.userId != null),
    [selectedEmployees],
  );

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    void (async () => {
      setLoading(true);
      setError(null);
      try {
        const [schedule, roster, presetRows] = await Promise.all([
          apiFetch<ScheduleSnapshot>(`/api/tickets/${ticketId}/schedule`),
          apiFetch<Coworker[]>("/api/field/co-workers"),
          apiFetch<CrewPreset[]>("/api/field/crew-presets").catch(() => [] as CrewPreset[]),
        ]);
        if (cancelled) return;
        setEmployees(roster ?? []);
        setPresets(presetRows ?? []);

        if (schedule?.scheduledStartAt) {
          const d = new Date(schedule.scheduledStartAt);
          if (!Number.isNaN(d.getTime())) setStartAt(d);
        } else {
          setShowPicker(true);
        }
        if (schedule?.scheduledDurationMinutes != null) {
          setDurationHours(formatDurationHoursFromMinutes(schedule.scheduledDurationMinutes));
        } else {
          setDurationHours("1");
        }
        if (schedule?.crew?.length) {
          setSelectedIds(schedule.crew.map((c) => c.employeeId));
        } else if (user?.vendorPeopleId) {
          setSelectedIds([user.vendorPeopleId]);
        }
        const myUserId = user?.id ?? null;
        setForemanUserId(schedule?.foremanUserId ?? myUserId);
        setActingForemanUserId(schedule?.actingForemanUserId ?? null);
        if (schedule?.warningKinds?.length) {
          const filtered = schedule.warningKinds.filter((k) =>
            DEFAULT_KINDS.includes(k as typeof DEFAULT_KINDS[number]),
          );
          setWarningKinds(filtered.length ? filtered : [...DEFAULT_KINDS]);
        } else {
          setWarningKinds([...DEFAULT_KINDS]);
        }
      } catch (e) {
        if (!cancelled) setError(translateApiError(e, t));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [visible, ticketId, vendorId, t, user?.id, user?.vendorPeopleId]);

  function toggleEmployee(id: number) {
    setSelectedIds((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
      const removed = employees.find((e) => e.id === id);
      if (prev.includes(id) && removed?.userId) {
        if (foremanUserId === removed.userId) setForemanUserId(null);
        if (actingForemanUserId === removed.userId) setActingForemanUserId(null);
      }
      return next;
    });
  }

  function applyPreset(preset: CrewPreset) {
    const valid = preset.memberEmployeeIds.filter((id) =>
      employees.some((e) => e.id === id),
    );
    setSelectedIds(valid);
    Alert.alert(
      t("scheduleTicket.presetAppliedTitle"),
      t("scheduleTicket.presetAppliedBody", { name: preset.name, count: valid.length }),
    );
  }

  function toggleKind(kind: string) {
    setWarningKinds((prev) =>
      prev.includes(kind) ? prev.filter((k) => k !== kind) : [...prev, kind],
    );
  }

  async function save(force = false) {
    setSaving(true);
    setError(null);
    setConflicts(null);
    const dur = parseDurationHoursToMinutes(durationHours);
    if (dur != null && dur < 15) {
      setError(t("apiErrors.scheduled_duration_invalid"));
      setSaving(false);
      return;
    }
    try {
      const body = {
        scheduledStartAt: startAt.toISOString(),
        scheduledDurationMinutes: dur,
        crewEmployeeIds: selectedIds,
        foremanUserId,
        actingForemanUserId,
        warningKinds,
        force,
      };
      const res = await apiFetch<{
        ok?: boolean;
        requiresConfirm?: boolean;
        conflicts?: ScheduleConflict[];
      }>(`/api/tickets/${ticketId}/schedule`, {
        method: "POST",
        body: JSON.stringify(body),
      });
      if (res?.requiresConfirm && res.conflicts?.length) {
        setConflicts(res.conflicts);
        setSaving(false);
        return;
      }
      Alert.alert(
        t("scheduleTicket.savedTitle"),
        t("scheduleTicket.savedBody"),
        [
          {
            text: t("mySchedule.addToCalendar"),
            onPress: () => {
              void openScheduleIcs(ticketId, t).catch((e) => {
                Alert.alert(
                  t("mySchedule.calendarErrorTitle"),
                  e instanceof Error ? e.message : translateApiError(e, t),
                );
              });
            },
          },
          { text: t("common.ok"), style: "cancel" },
        ],
      );
      onSaved?.();
      onClose();
    } catch (e) {
      setError(translateApiError(e, t));
    } finally {
      setSaving(false);
    }
  }

  function onDateChange(_: DateTimePickerEvent, date?: Date) {
    if (Platform.OS === "android") setShowPicker(false);
    if (date) setStartAt(date);
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={[styles.root, { backgroundColor: colors.background }]}>
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <TouchableOpacity onPress={onClose} accessibilityLabel={t("scheduleTicket.cancel")}>
            <Text style={{ color: colors.primary, fontWeight: "600" }}>{t("scheduleTicket.cancel")}</Text>
          </TouchableOpacity>
          <Text style={[styles.title, { color: colors.foreground }]}>{t("scheduleTicket.scheduleNowTitle")}</Text>
          <View style={{ width: 60 }} />
        </View>

        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator color={colors.primary} />
            <Text style={{ color: colors.mutedForeground, marginTop: 8 }}>{t("scheduleTicket.loading")}</Text>
          </View>
        ) : (
          <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
            {error ? (
              <Text style={[styles.error, { color: colors.destructive }]}>{error}</Text>
            ) : null}

            {conflicts?.length ? (
              <View style={[styles.banner, { borderColor: colors.border, backgroundColor: colors.card }]}>
                <Text style={{ color: colors.foreground, fontWeight: "700", marginBottom: 6 }}>
                  {t("scheduleTicket.conflictTitle")}
                </Text>
                {conflicts.map((c) => (
                  <Text key={`${c.employeeId}-${c.otherTicketId}`} style={{ color: colors.mutedForeground, fontSize: 13 }}>
                    {c.employeeName}: #{String(c.otherTicketId).padStart(4, "0")} — {c.otherSiteName ?? "?"}
                  </Text>
                ))}
                <View style={styles.rowBtns}>
                  <GreyButton onPress={() => setConflicts(null)}>{t("scheduleTicket.conflictCancel")}</GreyButton>
                  <LayeredPillButton
                    onPress={() => void save(true)}
                    disabled={saving}
                    height={36}
                    color="#16a34a"
                  >
                    {t("scheduleTicket.conflictOverride")}
                  </LayeredPillButton>
                </View>
              </View>
            ) : null}

            <Text style={[styles.label, { color: colors.foreground }]}>{t("scheduleTicket.whenLabel")}</Text>
            <Pressable
              onPress={() => setShowPicker(true)}
              style={[styles.inputLike, { borderColor: colors.border, backgroundColor: colors.card }]}
              testID="schedule-start-picker"
            >
              <Feather name="calendar" size={18} color={colors.primary} />
              <Text style={{ color: colors.foreground, marginLeft: 8 }}>{formatWhen(startAt)}</Text>
            </Pressable>
            {showPicker ? (
              <DateTimePicker
                value={startAt}
                mode="datetime"
                onChange={onDateChange}
                display={Platform.OS === "ios" ? "spinner" : "default"}
              />
            ) : null}
            {Platform.OS === "ios" && showPicker ? (
              <BluePillButton height={36} onPress={() => setShowPicker(false)} style={{ alignSelf: "flex-start", marginTop: 8 }}>
                {t("scheduleTicket.donePicker")}
              </BluePillButton>
            ) : null}

            <Text style={[styles.label, { color: colors.foreground }]}>{t("scheduleTicket.durationLabel")}</Text>
            <TextInput
              value={durationHours}
              onChangeText={setDurationHours}
              keyboardType="decimal-pad"
              placeholder={t("scheduleTicket.durationPlaceholder")}
              placeholderTextColor={colors.mutedForeground}
              style={[styles.textInput, { borderColor: colors.border, color: colors.foreground, backgroundColor: colors.card }]}
              testID="schedule-duration"
            />

            {presets.length > 0 ? (
              <>
                <Text style={[styles.label, { color: colors.foreground }]}>{t("scheduleTicket.crewPresetLabel")}</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 8 }}>
                  {presets.map((p) => (
                    <TouchableOpacity
                      key={p.id}
                      onPress={() => applyPreset(p)}
                      style={[styles.presetChip, { borderColor: colors.border, backgroundColor: colors.card }]}
                      testID={`crew-preset-${p.id}`}
                    >
                      <Text style={{ color: colors.foreground, fontSize: 13 }}>{p.name}</Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </>
            ) : null}

            <Text style={[styles.label, { color: colors.foreground }]}>{t("scheduleTicket.individualCrewLabel")}</Text>
            {employees.length === 0 ? (
              <Text style={{ color: colors.mutedForeground }}>{t("scheduleTicket.noEmployees")}</Text>
            ) : (
              employees.map((e) => {
                const on = selectedIds.includes(e.id);
                return (
                  <TouchableOpacity
                    key={e.id}
                    onPress={() => toggleEmployee(e.id)}
                    style={[
                      styles.crewRow,
                      { borderColor: on ? colors.primary : colors.border, backgroundColor: colors.card },
                    ]}
                    testID={`schedule-crew-${e.id}`}
                  >
                    <Feather name={on ? "check-square" : "square"} size={20} color={on ? colors.primary : colors.mutedForeground} />
                    <View style={{ flex: 1, marginLeft: 10 }}>
                      <Text style={{ color: colors.foreground, fontWeight: "600" }}>{empName(e)}</Text>
                      {!e.userId ? (
                        <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>{t("scheduleTicket.noLogin")}</Text>
                      ) : null}
                    </View>
                  </TouchableOpacity>
                );
              })
            )}

            <Text style={[styles.label, { color: colors.foreground }]}>{t("scheduleTicket.foremanLabel")}</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <TouchableOpacity
                onPress={() => setForemanUserId(null)}
                style={[styles.presetChip, { borderColor: foremanUserId == null ? colors.primary : colors.border }]}
              >
                <Text style={{ color: colors.foreground }}>{t("scheduleTicket.noForeman")}</Text>
              </TouchableOpacity>
              {foremanCandidates.map((e) => (
                <TouchableOpacity
                  key={e.id}
                  onPress={() => setForemanUserId(e.userId!)}
                  style={[styles.presetChip, { borderColor: foremanUserId === e.userId ? colors.primary : colors.border }]}
                >
                  <Text style={{ color: colors.foreground }}>{empName(e)}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            <Text style={[styles.label, { color: colors.foreground }]}>{t("scheduleTicket.actingForemanLabel")}</Text>
            <Text style={{ color: colors.mutedForeground, fontSize: 12, marginBottom: 8 }}>
              {t("scheduleTicket.actingForemanHint")}
            </Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <TouchableOpacity
                onPress={() => setActingForemanUserId(null)}
                style={[styles.presetChip, { borderColor: actingForemanUserId == null ? colors.primary : colors.border }]}
              >
                <Text style={{ color: colors.foreground }}>{t("scheduleTicket.noActingForeman")}</Text>
              </TouchableOpacity>
              {foremanCandidates.map((e) => (
                <TouchableOpacity
                  key={`acting-${e.id}`}
                  onPress={() => setActingForemanUserId(e.userId!)}
                  style={[styles.presetChip, { borderColor: actingForemanUserId === e.userId ? colors.primary : colors.border }]}
                >
                  <Text style={{ color: colors.foreground }}>{empName(e)}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            <Text style={[styles.label, { color: colors.foreground }]}>{t("scheduleTicket.warningsLabel")}</Text>
            <Text style={{ color: colors.mutedForeground, fontSize: 12, marginBottom: 8 }}>
              {t("scheduleTicket.warningsHint")}
            </Text>
            <View style={styles.kindRow}>
              {KIND_OPTIONS.map(({ kind, labelKey }) => {
                const on = warningKinds.includes(kind);
                return (
                  <TouchableOpacity
                    key={kind}
                    onPress={() => toggleKind(kind)}
                    style={[styles.kindChip, { borderColor: on ? colors.primary : colors.border, backgroundColor: on ? colors.primary + "22" : colors.card }]}
                  >
                    <Text style={{ color: colors.foreground, fontSize: 12 }}>{t(labelKey)}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <LayeredPillButton
              onPress={() => void save(false)}
              disabled={saving || selectedIds.length === 0}
              loading={saving}
              height={44}
              color="#16a34a"
              testID="button-notify-crew"
              style={{ marginTop: 24 }}
            >
              {saving ? t("scheduleTicket.saving") : t("scheduleTicket.notifyCrew")}
            </LayeredPillButton>
          </ScrollView>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  title: { fontSize: 17, fontWeight: "700" },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  body: { padding: 16, paddingBottom: 40 },
  label: { fontSize: 14, fontWeight: "700", marginTop: 16, marginBottom: 8 },
  inputLike: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
  },
  textInput: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    fontSize: 16,
  },
  crewRow: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
  },
  presetChip: {
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 8,
    marginRight: 8,
  },
  kindRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  kindChip: { borderWidth: 1, borderRadius: 16, paddingHorizontal: 10, paddingVertical: 6 },
  error: { marginBottom: 12, fontSize: 14 },
  banner: { borderWidth: 1, borderRadius: 10, padding: 12, marginBottom: 12 },
  rowBtns: { flexDirection: "row", gap: 12, marginTop: 12, justifyContent: "flex-end" },
});
