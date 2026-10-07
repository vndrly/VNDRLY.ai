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
import {
  localMeetingTime,
  makeMeetingAttempt,
  meetingCalendarPath,
  meetingIds,
  matchingMeeting,
  createdMeetingId,
  type MeetingAttempt,
} from "@/lib/meeting-scheduling";
const peopleSchema = z.array(
  z.object({
    id: z.number().int().positive(),
    displayName: z.string(),
    sameCompany: z.boolean(),
  }),
);
export default function MeetingScheduling({
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
    !!owner && (user?.role === "admin" || active?.role === "admin");
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
    [attempt, setAttempt] = useState<MeetingAttempt | null>(null),
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
                "meetingScheduling.participantChoicesUnavailableRefreshThisScreen",
              ),
            );
        });
    return () => {
      mounted.current = false;
      a();
      b();
    };
  }, []);
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
        participantUserIds: selected,
        recordingAllowed: false as const,
      };
      const candidate = makeMeetingAttempt(
        user.id,
        owner,
        input,
        crypto.randomUUID(),
        [],
      );
      const rows = await apiFetch(
        meetingCalendarPath(input.startsAt, input.endsAt),
        undefined,
        scope.current,
      );
      if (!current()) return;
      candidate.baseline = meetingIds(rows);
      setAttempt(candidate);
      setReviewed(true);
      setNotice("");
    } catch (e) {
      if (current())
        setNotice(t("meetingScheduling.reviewUnavailableCheckTheDateTime"));
    } finally {
      busy.current = false;
      if (current()) setSending(false);
    }
  }
  async function inspect(a: MeetingAttempt, id?: string) {
    const ids = id
      ? [id]
      : meetingIds(
          await apiFetch(
            meetingCalendarPath(a.body.payload.startsAt, a.body.payload.endsAt),
            undefined,
            scope.current,
          ),
        ).filter((x) => !a.baseline.includes(x));
    if (!current()) throw new Error(t("meetingScheduling.accountChanged"));
    const matches: string[] = [];
    for (const candidate of ids.slice(0, 100)) {
      const snapshot = await apiFetch(
        `/api/work-hub/calendar-response/${candidate}/snapshot`,
        undefined,
        scope.current,
      );
      if (!current()) throw new Error(t("meetingScheduling.accountChanged"));
      try {
        matches.push(matchingMeeting(snapshot, a));
      } catch {}
    }
    if (matches.length !== 1)
      throw new Error(t("meetingScheduling.noUniqueMatchingSavedMeetingFound"));
    return matches[0];
  }
  async function save() {
    if (!attempt || !reviewed || busy.current || !current()) return;
    busy.current = true;
    setSending(true);
    setReviewed(false);
    let responseReceived = false;
    try {
      const raw = await apiFetch(
        "/api/work-hub/meetings",
        { method: "POST", body: JSON.stringify(attempt.body) },
        scope.current,
      );
      if (!current()) return;
      responseReceived = true;
      await inspect(attempt, createdMeetingId(raw, attempt));
      if (!current()) return;
      setNotice(t("meetingScheduling.meetingSavedForTheReviewedSchedule"));
      setAttempt(null);
      try {
        await onSaved?.();
      } catch {
        if (current())
          setNotice(t("meetingScheduling.meetingSavedRefreshTheMeetingList"));
      }
    } catch (e) {
      if (
        current() &&
        !responseReceived &&
        (e as { status?: number; code?: string })?.status === 409 &&
        (e as { code?: string })?.code === "work_hub.scheduling_conflict"
      ) {
        setAttempt(null);
        setNotice(t("meetingScheduling.theSelectedTimeConflictsWithA"));
      } else if (current())
        setNotice(t("meetingScheduling.resultUncertainOrRefusedCheckSaved"));
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
      const id = await inspect(attempt);
      if (current()) {
        setNotice(t("meetingScheduling.matchingRecorded", { id }));
        setAttempt(null);
        await onSaved?.();
      }
    } catch (e) {
      if (current())
        setNotice(t("meetingScheduling.savedResultUnavailableOrNoUnique"));
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
        {t("meetingScheduling.scheduleAMeeting")}
      </Text>
      {!attempt && (
        <>
          <TextInput
            accessibilityLabel={t("meetingScheduling.meetingTitle")}
            placeholder={t("meetingScheduling.meetingTitle")}
            value={title}
            onChangeText={setTitle}
            style={inputStyle}
          />
          <Text style={{ color: colors.text }}>
            {t("meetingScheduling.startDateYearmonthday")}
          </Text>
          <TextInput
            accessibilityLabel={t("meetingScheduling.startDate")}
            placeholder="YYYY-MM-DD"
            value={start}
            onChangeText={setStart}
            style={inputStyle}
          />
          <Text style={{ color: colors.text }}>
            {t("meetingScheduling.endDateYearmonthday")}
          </Text>
          <TextInput
            accessibilityLabel={t("meetingScheduling.endDate")}
            placeholder="YYYY-MM-DD"
            value={end}
            onChangeText={setEnd}
            style={inputStyle}
          />
          <Text style={{ color: colors.text }}>
            {t("meetingScheduling.startTimeHourClock")}
          </Text>
          <TextInput
            accessibilityLabel={t("meetingScheduling.startTime")}
            placeholder="HH:mm"
            value={startTime}
            onChangeText={setStartTime}
            style={inputStyle}
          />
          <Text style={{ color: colors.text }}>
            {t("meetingScheduling.endTimeHourClock")}
          </Text>
          <TextInput
            accessibilityLabel={t("meetingScheduling.endTime")}
            placeholder="HH:mm"
            value={endTime}
            onChangeText={setEndTime}
            style={inputStyle}
          />
          <Text style={{ color: colors.text }}>
            {t("meetingScheduling.yourDeviceTimeZone")}: {timezone}
          </Text>
          <Text style={{ color: colors.text }}>
            {t("meetingScheduling.youAreTheHostSelectCompany")}
          </Text>
          {people.map((p) => (
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
            {t("meetingScheduling.reviewMeeting")}
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
            {t("meetingScheduling.participants")}{" "}
            {attempt.body.payload.participantUserIds
              .map(
                (id) =>
                  people.find((p) => p.id === id)?.displayName ?? String(id),
              )
              .join(", ") || t("meetingScheduling.hostOnly")}
          </Text>
          {reviewed ? (
            <>
              <TogglePillButton
                color="brand"
                disabled={sending}
                onPress={() => void save()}
              >
                {t("meetingScheduling.saveReviewedMeeting")}
              </TogglePillButton>
              <TogglePillButton
                color="brand"
                disabled={sending}
                onPress={() => {
                  setAttempt(null);
                  setReviewed(false);
                }}
              >
                {t("meetingScheduling.editReview")}
              </TogglePillButton>
            </>
          ) : (
            <TogglePillButton
              color="brand"
              disabled={sending}
              onPress={() => void check()}
            >
              {t("meetingScheduling.checkSavedMeetings")}
            </TogglePillButton>
          )}
        </>
      )}
      <Text accessibilityLiveRegion="polite" style={{ color: colors.text }}>
        {notice}
      </Text>
      <Text style={{ color: colors.text }}>
        {t("meetingScheduling.schedulingDoesNotJoinAudioAuthorize")}
      </Text>
    </View>
  );
}
