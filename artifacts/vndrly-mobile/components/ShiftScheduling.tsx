import React, { useEffect, useRef, useState } from "react";
import { Text, TextInput, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/hooks/use-auth";
import { useColors } from "@/hooks/useColors";
import { apiFetch } from "@/lib/api";
import {
  captureAuthScope,
  isAuthScopeCurrent,
  subscribeUser,
  subscribeToken,
} from "@/lib/auth";
import { mobileOwner } from "@/lib/work-hub-mobile";
import TogglePillButton from "@/components/TogglePillButton";
import { z } from "zod/v4";
import GateShiftAssignments from "./GateShiftAssignments";
import {
  localMeetingTime,
  makeShiftAttempt,
  matchingShift,
  createdShiftId,
  recoverCreatedShift,
  type ShiftAttempt,
} from "@/lib/shift-scheduling";
const peopleSchema = z.array(
  z.object({
    id: z.number().int().positive(),
    displayName: z.string(),
    sameCompany: z.boolean(),
  }),
);
export default function ShiftScheduling({
  onSaved,
}: {
  onSaved?: () => Promise<unknown>;
}) {
  const { user } = useAuth();
  const key = [
    user?.id,
    user?.activeMembershipId,
    user?.vendorId,
    user?.partnerId,
    captureAuthScope().generation,
  ].join(":");
  return <Scheduling key={key} onSaved={onSaved} />;
}
function Scheduling({ onSaved }: { onSaved?: () => Promise<unknown> }) {
  const { user } = useAuth();
  const colors = useColors();
  const { i18n, t } = useTranslation();
  const spanish = i18n.language.startsWith("es");
  const owner = mobileOwner(user);
  const active = user?.availableMemberships?.find(
    (m) => m.id === user.activeMembershipId,
  );
  const allowed =
    !!owner &&
    (active?.role === "admin" || user?.vendorRole === "gate_supervisor");
  const supervisor = user?.vendorRole === "gate_supervisor";
  const [gate, setGate] = useState(!!supervisor),
    [sites, setSites] = useState<{ id: number; name: string }[]>([]),
    [stations, setStations] = useState<{ id: string; name: string }[]>([]),
    [siteId, setSiteId] = useState(0),
    [stationId, setStationId] = useState(""),
    [required, setRequired] = useState("1"),
    [policy, setPolicy] = useState<"on_site" | "paid_travel">("on_site"),
    [codes, setCodes] = useState(""),
    [savedId, setSavedId] = useState<string | null>(null),
    [assignmentPending, setAssignmentPending] = useState(false);
  const scope = useRef(captureAuthScope());
  const mounted = useRef(true),
    busy = useRef(false);
  const [title, setTitle] = useState(""),
    [start, setStart] = useState(""),
    [startTime, setStartTime] = useState(""),
    [endTime, setEndTime] = useState(""),
    [end, setEnd] = useState(""),
    [timezone] = useState(Intl.DateTimeFormat().resolvedOptions().timeZone);
  const [people, setPeople] = useState<z.infer<typeof peopleSchema>>([]),
    [selected, setSelected] = useState<number[]>([]),
    [attempt, setAttempt] = useState<ShiftAttempt | null>(null),
    [reviewed, setReviewed] = useState(false),
    [notice, setNotice] = useState(""),
    [sending, setSending] = useState(false),
    [ready, setReady] = useState(false);
  const current = () => mounted.current && isAuthScopeCurrent(scope.current);
  useEffect(() => {
    mounted.current = true;
    const invalidate = () => {
      if (!isAuthScopeCurrent(scope.current)) {
        setAttempt(null);
        setSavedId(null);
        setAssignmentPending(false);
        setSelected([]);
        setSites([]);
        setStations([]);
        setSiteId(0);
        setStationId("");
        setTitle("");
        setStart("");
        setEnd("");
        setStartTime("");
        setEndTime("");
        setPeople([]);
        setReady(false);
        setNotice("");
      }
    };
    const a = subscribeUser(invalidate),
      b = subscribeToken(invalidate);
    if (allowed)
      void apiFetch("/api/work-hub/people", undefined, scope.current)
        .then((raw) => {
          if (current()) {
            setPeople(peopleSchema.parse(raw).filter((p) => p.sameCompany));
            setReady(true);
          }
        })
        .catch(() => {
          if (current())
            setNotice(
              t(
                "shiftScheduling.participantChoicesUnavailableRefreshThisScreen",
              ),
            );
        });
    return () => {
      mounted.current = false;
      a();
      b();
    };
  }, []);
  useEffect(() => {
    let valid = true;
    if (allowed && gate)
      void apiFetch("/api/gate-change-over/sites", undefined, scope.current)
        .then((raw) => {
          if (valid && current())
            setSites(
              z
                .object({
                  sites: z.array(
                    z.object({
                      id: z.number().int().positive(),
                      name: z.string(),
                    }),
                  ),
                })
                .parse(raw).sites,
            );
        })
        .catch(() => {
          if (valid && current()) setSites([]);
        });
    return () => {
      valid = false;
    };
  }, [allowed, gate]);
  useEffect(() => {
    let valid = true;
    setStations([]);
    setStationId("");
    if (siteId)
      void apiFetch(
        "/api/gate-change-over/stations?siteId=" + siteId,
        undefined,
        scope.current,
      )
        .then((raw) => {
          if (valid && current())
            setStations(
              z
                .object({
                  stations: z.array(
                    z.object({ id: z.uuid(), name: z.string() }),
                  ),
                })
                .parse(raw).stations,
            );
        })
        .catch(() => {
          if (valid && current()) setStations([]);
        });
    return () => {
      valid = false;
    };
  }, [siteId]);
  async function review() {
    if (busy.current || !allowed || !ready || !owner || !user) return;
    busy.current = true;
    setSending(true);
    try {
      if (Intl.DateTimeFormat().resolvedOptions().timeZone !== timezone)
        throw new Error("device_timezone_changed");
      const input = {
        title,
        startsAt: localMeetingTime(start, startTime),
        endsAt: localMeetingTime(end, endTime),
        timezone,
        assigneeUserIds: gate ? [] : selected,
        open: false as const,
        qualificationCodes: gate
          ? codes
              .split(",")
              .map((c) => c.trim())
              .filter(Boolean)
          : [],
        ...(gate
          ? {
              siteLocationId: siteId,
              gateStationId: stationId,
              requiredStaffCount: Number(required),
              workStartPolicy: policy,
            }
          : {}),
      };
      const candidate = makeShiftAttempt(
        user.id,
        owner,
        input,
        crypto.randomUUID(),
      );
      if (!current()) return;
      setAttempt(candidate);
      setReviewed(true);
      setNotice("");
    } catch (e) {
      if (current())
        setNotice(t("shiftScheduling.reviewUnavailableCheckTheDateTime"));
    } finally {
      busy.current = false;
      if (current()) setSending(false);
    }
  }
  async function inspect(a: ShiftAttempt, id: string) {
    const snapshot = await apiFetch(
      "/api/work-hub/calendar/items/shift/" + id,
      undefined,
      scope.current,
    );
    if (!current()) throw Error("account_changed");
    if (matchingShift(snapshot, a) !== id) throw Error("shift_id_mismatch");
    return id;
  }
  async function save() {
    if (!attempt || !reviewed || busy.current || !current()) return;
    busy.current = true;
    setSending(true);
    setReviewed(false);
    let responseReceived = false;
    try {
      const raw = await apiFetch(
        "/api/work-hub/shifts",
        { method: "POST", body: JSON.stringify(attempt.body) },
        scope.current,
      );
      if (!current()) return;
      responseReceived = true;
      const saved = await inspect(attempt, createdShiftId(raw, attempt));
      if (!current()) return;
      setSavedId(saved);
      setNotice(t("shiftScheduling.meetingSavedForTheReviewedSchedule"));
      setAttempt(null);
      try {
        await onSaved?.();
      } catch {
        if (current())
          setNotice(t("shiftScheduling.meetingSavedRefreshTheMeetingList"));
      }
    } catch (e) {
      if (
        current() &&
        !responseReceived &&
        (e as { status?: number; code?: string })?.status === 409 &&
        (e as { code?: string })?.code === "work_hub.scheduling_conflict"
      ) {
        setAttempt(null);
        setNotice(t("shiftScheduling.theSelectedTimeConflictsWithA"));
      } else if (current())
        setNotice(t("shiftScheduling.resultUncertainOrRefusedCheckSaved"));
    } finally {
      busy.current = false;
      if (current()) setSending(false);
    }
  }
  async function check() {
    if (!attempt || busy.current) return;
    busy.current = true;
    setSending(true);
    try {
      const id = await recoverCreatedShift(
        attempt,
        (path) => apiFetch(path, undefined, scope.current),
        current,
      );
      if (current()) {
        setSavedId(id);
        setNotice(t("shiftScheduling.matchingRecorded", { id }));
        setAttempt(null);
        await onSaved?.();
      }
    } catch (e) {
      if (current())
        setNotice(t("shiftScheduling.savedResultUnavailableOrNoUnique"));
    } finally {
      busy.current = false;
      if (current()) setSending(false);
    }
  }
  if (!allowed) return null;
  const inputStyle = {
    color: colors.text,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 10,
  };
  return (
    <View style={{ gap: 10 }}>
      <Text style={{ color: colors.text }}>
        {t("shiftScheduling.scheduleAMeeting")}
      </Text>
      {!attempt && !savedId && (
        <>
          {!supervisor && (
            <View style={{ flexDirection: "row", gap: 8 }}>
              <TogglePillButton
                onPress={() => {
                  setGate(false);
                  setSelected([]);
                }}
              >
                {t("shiftScheduling.standard")}
              </TogglePillButton>
              <TogglePillButton
                onPress={() => {
                  setGate(true);
                  setSelected([]);
                }}
              >
                {t("shiftScheduling.gate")}
              </TogglePillButton>
            </View>
          )}
          {gate && (
            <View style={{ gap: 8 }}>
              <Text>{t("shiftScheduling.site")}</Text>
              {sites.map((site) => (
                <TogglePillButton
                  key={site.id}
                  onPress={() => setSiteId(site.id)}
                >
                  {(site.id === siteId ? "✓ " : "") + site.name}
                </TogglePillButton>
              ))}
              <Text>{t("shiftScheduling.station")}</Text>
              {stations.map((station) => (
                <TogglePillButton
                  key={station.id}
                  onPress={() => setStationId(station.id)}
                >
                  {(station.id === stationId ? "✓ " : "") + station.name}
                </TogglePillButton>
              ))}
              <TextInput
                accessibilityLabel={t("shiftScheduling.required")}
                value={required}
                onChangeText={setRequired}
                keyboardType="number-pad"
                style={inputStyle}
              />
              <TextInput
                accessibilityLabel={t("shiftScheduling.codes")}
                value={codes}
                onChangeText={setCodes}
                placeholder={t("shiftScheduling.codes")}
                style={inputStyle}
              />
              <Text>{t("shiftScheduling.codeHelp")}</Text>
              <TogglePillButton
                onPress={() =>
                  setPolicy(policy === "on_site" ? "paid_travel" : "on_site")
                }
              >
                {t(
                  policy === "on_site"
                    ? "shiftScheduling.on_site"
                    : "shiftScheduling.paid_travel",
                )}
              </TogglePillButton>
              <Text>{t("shiftScheduling.gateLater")}</Text>
            </View>
          )}
          <TextInput
            accessibilityLabel={t("shiftScheduling.meetingTitle")}
            placeholder={t("shiftScheduling.meetingTitle")}
            value={title}
            onChangeText={setTitle}
            style={inputStyle}
          />
          <Text style={{ color: colors.text }}>
            {t("shiftScheduling.startDateYearmonthday")}
          </Text>
          <TextInput
            accessibilityLabel={t("shiftScheduling.startDate")}
            placeholder="YYYY-MM-DD"
            value={start}
            onChangeText={setStart}
            style={inputStyle}
          />
          <Text style={{ color: colors.text }}>
            {t("shiftScheduling.endDateYearmonthday")}
          </Text>
          <TextInput
            accessibilityLabel={t("shiftScheduling.endDate")}
            placeholder="YYYY-MM-DD"
            value={end}
            onChangeText={setEnd}
            style={inputStyle}
          />
          <Text style={{ color: colors.text }}>
            {t("shiftScheduling.startTimeHourClock")}
          </Text>
          <TextInput
            accessibilityLabel={t("shiftScheduling.startTime")}
            placeholder="HH:mm"
            value={startTime}
            onChangeText={setStartTime}
            style={inputStyle}
          />
          <Text style={{ color: colors.text }}>
            {t("shiftScheduling.endTimeHourClock")}
          </Text>
          <TextInput
            accessibilityLabel={t("shiftScheduling.endTime")}
            placeholder="HH:mm"
            value={endTime}
            onChangeText={setEndTime}
            style={inputStyle}
          />
          <Text style={{ color: colors.text }}>
            {t("shiftScheduling.yourDeviceTimeZone")}: {timezone}
          </Text>
          <Text style={{ color: colors.text }}>
            {!gate ? t("shiftScheduling.youAreTheHostSelectCompany") : ""}
          </Text>
          {!gate &&
            people.map((p) => (
              <TogglePillButton
                key={p.id}
                color="brand"
                onPress={() =>
                  setSelected((v) =>
                    v.includes(p.id)
                      ? v.filter((id) => id !== p.id)
                      : [...v, p.id],
                  )
                }
              >{`${selected.includes(p.id) ? "✓ " : ""}${p.displayName}`}</TogglePillButton>
            ))}
          <TogglePillButton
            color="brand"
            disabled={sending || !ready}
            onPress={() => void review()}
          >
            {t("shiftScheduling.reviewMeeting")}
          </TogglePillButton>
        </>
      )}
      {attempt && (
        <>
          <Text style={{ color: colors.text }}>
            {attempt.body.payload.title}
            {"\n"}
            {new Date(attempt.body.payload.startsAt).toLocaleString(
              spanish ? "es" : "en",
              { timeZone: attempt.body.payload.timezone },
            )}{" "}
            →{" "}
            {new Date(attempt.body.payload.endsAt).toLocaleString(
              spanish ? "es" : "en",
              { timeZone: attempt.body.payload.timezone },
            )}
            {"\n"}
            {attempt.body.payload.timezone}
            {"\n"}
            {gate && (
              <Text>
                {
                  sites.find(
                    (x) => x.id === attempt.body.payload.siteLocationId,
                  )?.name
                }{" "}
                ·{" "}
                {
                  stations.find(
                    (x) => x.id === attempt.body.payload.gateStationId,
                  )?.name
                }{" "}
                · {attempt.body.payload.requiredStaffCount} ·{" "}
                {attempt.body.payload.qualificationCodes.join(", ")}
              </Text>
            )}
            {t("shiftScheduling.participants")}{" "}
            {attempt.body.payload.assigneeUserIds
              .map(
                (id) =>
                  people.find((p) => p.id === id)?.displayName ?? String(id),
              )
              .join(", ") || t("shiftScheduling.hostOnly")}
          </Text>
          {reviewed ? (
            <>
              <TogglePillButton
                color="brand"
                disabled={sending}
                onPress={() => void save()}
              >
                {t("shiftScheduling.saveReviewedMeeting")}
              </TogglePillButton>
              <TogglePillButton
                color="brand"
                disabled={sending}
                onPress={() => {
                  setAttempt(null);
                  setReviewed(false);
                }}
              >
                {t("shiftScheduling.editReview")}
              </TogglePillButton>
            </>
          ) : (
            <TogglePillButton
              color="brand"
              disabled={sending}
              onPress={() => void check()}
            >
              {t("shiftScheduling.checkSavedMeetings")}
            </TogglePillButton>
          )}
        </>
      )}
      <Text accessibilityLiveRegion="polite" style={{ color: colors.text }}>
        {notice}
      </Text>
      <Text style={{ color: colors.text }}>
        {t("shiftScheduling.schedulingDoesNotJoinAudioAuthorize")}
      </Text>
      {savedId && (
        <>
          <Text>{t("shiftScheduling.recordingOnly")}</Text>
          {gate && (
            <GateShiftAssignments
              shiftId={savedId}
              onSaved={onSaved}
              onPendingChange={setAssignmentPending}
            />
          )}
          <TogglePillButton
            disabled={assignmentPending}
            onPress={() => {
              if (assignmentPending) return;
              setSavedId(null);
              setTitle("");
              setSelected([]);
            }}
          >
            {t("shiftScheduling.newShift")}
          </TogglePillButton>
        </>
      )}
    </View>
  );
}
