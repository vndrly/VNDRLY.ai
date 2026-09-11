import React, { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { Audio } from "expo-av";
import { useTranslation } from "react-i18next";
import type { MeetingSnapshot } from "@workspace/api-client-react/meeting-workspace";

import TogglePillButton from "@/components/TogglePillButton";
import { useBrand } from "@/hooks/use-brand";
import { apiFetch, getApiBase } from "@/lib/api";
import { captureAuthScope, getToken, isAuthScopeCurrent } from "@/lib/auth";
import { downloadAndShareMeetingReplayFile } from "@/lib/meeting-files";

type ReplayEvent = {
  key: string;
  type: "transcript" | "message" | "file" | "askv_answer" | "gap";
  offsetMs: number;
  endOffsetMs: number | null;
  payload: Record<string, unknown>;
};

type ReplayManifest = {
  schemaVersion: number;
  rendererVersion: number;
  status: "complete" | "incomplete";
  complete: boolean;
  occurrence: { startedAt: string; durationMs: number };
  audio: Array<{ sequence: number; startsAtMs: number; endsAtMs: number; downloadPath: string }>;
  gaps: Array<{ startsAtMs: number; endsAtMs: number; reason: string }>;
  events: ReplayEvent[];
};

type ReplayAssignment = {
  id: string;
  assigneeUserId: number;
  requirement: "optional" | "required";
  dueAt: string | null;
  status: "not_started" | "in_progress" | "completed";
  watchedMs: number;
  lastPositionMs: number;
  completedAt: string | null;
};

const PANEL = "#50545a";
const SURFACE = "#3a3d42";
const VERSION_HEADERS = {
  "x-replay-renderer-version": "1",
  "x-replay-schema-version": "2",
};

export function replayEventsAt(events: ReplayEvent[], playheadMs: number) {
  return events.filter((event) => event.offsetMs <= playheadMs && !["speaker", "activity"].includes(event.type));
}

function clock(ms: number) {
  const seconds = Math.max(0, Math.floor(ms / 1_000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function absoluteUrl(path: string) {
  return path.startsWith("http") ? path : `${getApiBase()}${path}`;
}

export default function MeetingReplayWorkspace({ occurrenceId, meeting }: { occurrenceId: string; meeting: MeetingSnapshot }) {
  const { t } = useTranslation();
  const brand = useBrand();
  const [manifest, setManifest] = useState<ReplayManifest | null>(null);
  const [assignments, setAssignments] = useState<ReplayAssignment[]>([]);
  const [viewerToken, setViewerToken] = useState<string | null>(null);
  const [myAssignment, setMyAssignment] = useState<ReplayAssignment | null>(null);
  const [playhead, setPlayhead] = useState(0);
  const playheadRef = useRef(0);
  const [playing, setPlaying] = useState(false);
  const playingRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [assignee, setAssignee] = useState<number | null>(null);
  const [requirement, setRequirement] = useState<"optional" | "required">("required");
  const [dueAt, setDueAt] = useState("");
  const soundRef = useRef<Audio.Sound | null>(null);
  const loadedSequenceRef = useRef<number | null>(null);

  useEffect(() => { playheadRef.current = playhead; }, [playhead]);
  useEffect(() => { playingRef.current = playing; }, [playing]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      apiFetch<ReplayManifest>(`/api/work-hub/meetings/${occurrenceId}/replay`, { headers: VERSION_HEADERS }),
      apiFetch<{ assignments: ReplayAssignment[] }>(`/api/work-hub/meetings/${occurrenceId}/replay/assignments`),
      apiFetch<{ assignment: ReplayAssignment | null; viewerSessionId: string | null }>(`/api/work-hub/meetings/${occurrenceId}/replay/watch/session`, { method: "POST", body: "{}" }),
    ]).then(([nextManifest, listed, watch]) => {
      if (cancelled) return;
      setManifest(nextManifest);
      setAssignments(listed.assignments);
      setMyAssignment(watch.assignment);
      setViewerToken(watch.viewerSessionId);
      setPlayhead(watch.assignment?.lastPositionMs ?? 0);
    }).catch((cause) => {
      if (!cancelled) setError(cause instanceof Error ? cause.message : t("meetingReplay.unavailable", { defaultValue: "Meeting replay is unavailable." }));
    });
    return () => {
      cancelled = true;
      const sound = soundRef.current;
      soundRef.current = null;
      loadedSequenceRef.current = null;
      if (sound) void sound.unloadAsync();
    };
  }, [occurrenceId, t]);

  const chunk = useMemo(
    () => manifest?.audio.find((item) => playhead >= item.startsAtMs && playhead < item.endsAtMs) ?? null,
    [manifest, playhead],
  );

  useEffect(() => {
    if (!playing || !manifest) return;
    if (!chunk) {
      const timer = setInterval(() => setPlayhead((value) => Math.min(manifest.occurrence.durationMs, value + 250)), 250);
      return () => clearInterval(timer);
    }
    let cancelled = false;
    void (async () => {
      if (loadedSequenceRef.current !== chunk.sequence) {
        const previous = soundRef.current;
        soundRef.current = null;
        loadedSequenceRef.current = null;
        if (previous) await previous.unloadAsync();
        const token = await getToken();
        if (!token) throw new Error(t("meetingReplay.signInRequired", { defaultValue: "Sign in again to play this meeting." }));
        const result = await Audio.Sound.createAsync(
          { uri: absoluteUrl(chunk.downloadPath), headers: { authorization: `Bearer ${token}`, ...VERSION_HEADERS } },
          { shouldPlay: false },
          (status) => {
            if (!status.isLoaded) return;
            if (typeof status.positionMillis === "number") setPlayhead(Math.min(chunk.endsAtMs, chunk.startsAtMs + status.positionMillis));
            if (status.didJustFinish) setPlayhead(chunk.endsAtMs);
          },
        );
        if (cancelled) { await result.sound.unloadAsync(); return; }
        soundRef.current = result.sound;
        loadedSequenceRef.current = chunk.sequence;
        await result.sound.setPositionAsync(Math.max(0, playheadRef.current - chunk.startsAtMs));
      }
      if (playingRef.current) await soundRef.current?.playAsync();
    })().catch((cause) => {
      if (!cancelled) {
        setPlaying(false);
        setError(cause instanceof Error ? cause.message : t("meetingReplay.unavailable", { defaultValue: "Meeting replay is unavailable." }));
      }
    });
    return () => { cancelled = true; };
  }, [chunk, manifest, playing, t]);

  useEffect(() => {
    if (!manifest || playhead < manifest.occurrence.durationMs) return;
    setPlaying(false);
  }, [manifest, playhead]);

  useEffect(() => {
    if (!playing || !viewerToken) return;
    const send = () => apiFetch<{ assignment: ReplayAssignment }>(`/api/work-hub/meetings/${occurrenceId}/replay/watch/progress`, {
      method: "POST",
      headers: { "x-replay-view-session": viewerToken },
      body: JSON.stringify({ playheadMs: Math.round(playheadRef.current) }),
    }).then((result) => {
      setMyAssignment(result.assignment);
      setAssignments((rows) => rows.map((row) => row.id === result.assignment.id ? result.assignment : row));
    }).catch(() => undefined);
    const timer = setInterval(() => void send(), 5_000);
    return () => { clearInterval(timer); void send(); };
  }, [occurrenceId, playing, viewerToken]);

  async function togglePlayback() {
    if (playing) {
      setPlaying(false);
      await soundRef.current?.pauseAsync();
      return;
    }
    setError(null);
    setPlaying(true);
  }

  async function assign() {
    if (assignee === null) return;
    try {
      const result = await apiFetch<{ assignment: ReplayAssignment }>(`/api/work-hub/meetings/${occurrenceId}/replay/assignments`, {
        method: "POST",
        body: JSON.stringify({ assigneeUserId: assignee, requirement, dueAt: dueAt ? new Date(dueAt).toISOString() : null }),
      });
      setAssignments((rows) => [...rows.filter((row) => row.id !== result.assignment.id), result.assignment]);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("meetingReplay.assignFailed", { defaultValue: "Catch-up could not be assigned." }));
    }
  }

  async function openReplayFile(event: ReplayEvent) {
    const fileName = event.payload.fileName;
    const contentType = event.payload.contentType;
    const byteSize = event.payload.byteSize;
    if (event.type !== "file" || typeof event.payload.downloadPath !== "string" || typeof fileName !== "string" || typeof contentType !== "string" || typeof byteSize !== "number") return;
    const authScope = captureAuthScope();
    const assertCurrent = () => {
      if (!isAuthScopeCurrent(authScope)) throw Object.assign(new Error("Request authorization changed"), { name: "AbortError" });
    };
    try {
      await downloadAndShareMeetingReplayFile({ occurrenceId, replayEventId: event.key, fileName, contentType, byteSize, authScope, assertCurrent });
      setError(null);
    } catch (cause) {
      if ((cause as Error | undefined)?.name !== "AbortError") setError(t("meetingReplay.fileOpenFailed", { defaultValue: "The shared file could not be opened." }));
    }
  }

  if (error && !manifest) return <Text accessibilityRole="alert" style={{ color: "#ffffff" }}>{error}</Text>;
  if (!manifest) return <Text accessibilityLiveRegion="polite" style={{ color: "#ffffff" }}>{t("meetingReplay.loading", { defaultValue: "Loading timed replay…" })}</Text>;

  const visibleEvents = replayEventsAt(manifest.events, playhead);
  const progress = myAssignment ? Math.min(100, Math.round(myAssignment.watchedMs / manifest.occurrence.durationMs * 100)) : null;
  const inGap = manifest.gaps.some((gap) => playhead >= gap.startsAtMs && playhead < gap.endsAtMs);

  return <View accessibilityLabel={t("meetingReplay.label", { defaultValue: "Timed meeting replay" })} style={{ gap: 12, backgroundColor: SURFACE }}>
    <View style={{ backgroundColor: PANEL, borderColor: brand.primary, borderWidth: 1, borderRadius: 14, padding: 12, gap: 8 }}>
      <Text accessibilityRole="header" selectable style={{ color: "#ffffff", fontWeight: "800", fontSize: 18 }}>{t("meetingReplay.title", { defaultValue: "Watch meeting replay" })}</Text>
      <Text selectable style={{ color: "#ffffff" }}>{manifest.complete ? t("meetingReplay.completeRecording", { defaultValue: "Complete recording" }) : t("meetingReplay.hasGaps", { defaultValue: "Replay includes clearly marked gaps" })}</Text>
      {myAssignment && <Text selectable style={{ color: "#ffffff", fontWeight: "700" }}>{myAssignment.requirement === "required" ? t("meetingReplay.required", { defaultValue: "Required" }) : t("meetingReplay.optional", { defaultValue: "Optional" })} · {myAssignment.status === "completed" ? t("meetingReplay.completed", { defaultValue: "Completed" }) : `${progress}%`}</Text>}
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        <TogglePillButton color="brand" solid accessibilityLabel={playing ? t("meetingReplay.pause", { defaultValue: "Pause" }) : t("meetingReplay.play", { defaultValue: "Play" })} onPress={() => void togglePlayback()} style={{ flex: 0 }}>
          {playing ? t("meetingReplay.pause", { defaultValue: "Pause" }) : t("meetingReplay.play", { defaultValue: "Play" })}
        </TogglePillButton>
        <Text selectable style={{ color: "#ffffff", fontVariant: ["tabular-nums"] }}>{clock(playhead)} / {clock(manifest.occurrence.durationMs)}</Text>
      </View>
      <View accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: manifest.occurrence.durationMs, now: playhead }} style={{ height: 8, borderRadius: 4, backgroundColor: "#27292d", overflow: "hidden" }}>
        <View style={{ height: "100%", width: `${Math.min(100, playhead / manifest.occurrence.durationMs * 100)}%`, backgroundColor: brand.primary }} />
      </View>
      {inGap && <Text accessibilityLiveRegion="polite" selectable style={{ color: "#ffffff" }}>{t("meetingReplay.gap", { defaultValue: "This portion of the meeting has no recorded audio." })}</Text>}
      {!!error && <Text accessibilityRole="alert" selectable style={{ color: "#ffffff" }}>{error}</Text>}
    </View>

    <ScrollView accessibilityLabel={t("meetingReplay.events", { defaultValue: "Meeting replay events" })} style={{ maxHeight: 360 }} contentContainerStyle={{ gap: 8 }}>
      {visibleEvents.map((event) => {
        const name = String(event.payload.displayName ?? (event.type === "askv_answer" ? "V" : t("meetingReplay.attendee", { defaultValue: "Attendee" })));
        const text = String(event.payload.text ?? event.payload.body ?? event.payload.fileName ?? event.payload.reason ?? "");
        return <View key={event.key} style={{ backgroundColor: PANEL, borderRadius: 12, padding: 10, gap: 4 }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 8 }}><Text selectable style={{ color: name === "V" ? "#ffffff" : brand.primary, fontWeight: "800" }}>{name}</Text><Text selectable style={{ color: "#ffffff" }}>{clock(event.offsetMs)}</Text></View>
          <Text selectable style={{ color: "#ffffff" }}>{text}</Text>
          {event.type === "file" && typeof event.payload.downloadPath === "string" && <TogglePillButton color="brand" accessibilityLabel={t("meetingReplay.openFile", { defaultValue: "Open shared file" })} onPress={() => void openReplayFile(event)}>{t("meetingReplay.openFile", { defaultValue: "Open shared file" })}</TogglePillButton>}
        </View>;
      })}
    </ScrollView>

    {meeting.canManage && <View style={{ backgroundColor: PANEL, borderRadius: 14, padding: 12, gap: 10 }}>
      <Text accessibilityRole="header" selectable style={{ color: "#ffffff", fontWeight: "800" }}>{t("meetingReplay.assignCatchUp", { defaultValue: "Assign catch-up" })}</Text>
      {meeting.participants.filter((person) => person.role !== "host" && !person.removedAt).map((person) => <Pressable key={person.userId} accessibilityRole="button" accessibilityLabel={t("meetingReplay.selectAttendee", { defaultValue: "Select {{name}}", name: person.displayName })} accessibilityState={{ selected: assignee === person.userId }} onPress={() => setAssignee(person.userId)} style={{ minHeight: 44, justifyContent: "center" }}><Text style={{ color: assignee === person.userId ? brand.primary : "#ffffff", fontWeight: "700" }}>{person.displayName}</Text></Pressable>)}
      <View style={{ flexDirection: "row", gap: 8 }}>
        {(["required", "optional"] as const).map((value) => <TogglePillButton key={value} color="brand" solid={requirement === value} accessibilityLabel={value === "required" ? t("meetingReplay.required", { defaultValue: "Required" }) : t("meetingReplay.optional", { defaultValue: "Optional" })} accessibilityState={{ selected: requirement === value }} onPress={() => setRequirement(value)} style={{ flex: 1 }}>{value === "required" ? t("meetingReplay.required", { defaultValue: "Required" }) : t("meetingReplay.optional", { defaultValue: "Optional" })}</TogglePillButton>)}
      </View>
      <TextInput accessibilityLabel={t("meetingReplay.dueDate", { defaultValue: "Due date" })} value={dueAt} onChangeText={setDueAt} placeholder="YYYY-MM-DD HH:mm" placeholderTextColor="#c7cbd1" style={{ color: "#ffffff", backgroundColor: SURFACE, borderRadius: 10, padding: 12 }} />
      <TogglePillButton color="brand" solid accessibilityLabel={t("meetingReplay.assign", { defaultValue: "Assign" })} disabled={assignee === null} onPress={() => void assign()}>{t("meetingReplay.assign", { defaultValue: "Assign" })}</TogglePillButton>
      {assignments.map((row) => <Text key={row.id} selectable style={{ color: "#ffffff" }}>{meeting.participants.find((person) => person.userId === row.assigneeUserId)?.displayName ?? t("meetingReplay.attendee", { defaultValue: "Attendee" })} · {row.requirement} · {row.status}</Text>)}
    </View>}
  </View>;
}
