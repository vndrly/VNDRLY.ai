import { ModalPressable as Pressable, ModalTextInput as TextInput } from "@/components/ModalDraft";
import DismissibleModal from "@/components/DismissibleModal";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  AppState,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Audio } from "expo-av";
import { randomUUID } from "expo-crypto";
import { Ionicons } from "@expo/vector-icons";
import * as FileSystem from "expo-file-system/legacy";
import { apiFetch, getApiBase } from "@/lib/api";
import { getToken } from "@/lib/auth";
import { useColors } from "@/hooks/useColors";
import { nativeWorkHubDeviceIdentity } from "@/hooks/use-work-hub-device-presence";
import TogglePillButton from "@/components/TogglePillButton";
import { closeInternalCallAudio } from "@/lib/call-audio-control";
import WorkHubCallPolicy from "@/components/WorkHubCallPolicy";
import WorkHubCallTranscript from "@/components/WorkHubCallTranscript";
import WorkHubAudioRoom from "@/components/WorkHubAudioRoom";
import WorkHubDeviceSettings from "@/components/WorkHubDeviceSettings";
import { useNativeCallCompanion } from "@/components/NativeCallCompanion";
import { useTranslation } from "react-i18next";
import { loadIncomingCall, type WorkHubCall as Call } from "@/lib/notification-destination";
type Mail = {
  id: string;
  senderUserId?: number;
  senderName: string;
  createdAt: string;
  readAt: string | null;
  transcript: string | null;
  transcriptionState?: string;
  durationMs: number;
};
type Person = { id: number; displayName: string; organizationName?: string; role?: string; operationalRole?: string };
type Settings = { available: boolean; speedDial: number[] };
type LogEntry = {
  id: string;
  name: string;
  contactId?: number;
  createdAt: string;
  label: "Outgoing" | "Incoming" | "Missed" | "Voicemail";
  call?: Call;
  voicemail?: Mail;
};
const unavailable = ["missed", "declined", "busy", "unavailable"];
type IconName = React.ComponentProps<typeof Ionicons>["name"];
const directoryRoles: Record<string, string> = {
  admin: "Administrative Team Member",
  member: "Staff",
  field_employee: "Gatekeeper",
  gatekeeper: "Gatekeeper",
  gate_supervisor: "Gate Supervisor",
  office: "Administrative Team Member",
};
function normalizeSearch(value: string) {
  return value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim();
}
function playbackClock(milliseconds: number) {
  const seconds = Math.floor(milliseconds / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
export default function WorkHubCalls({ incomingCall }: { incomingCall?: Call }) {
  const colors = useColors();
  const { t } = useTranslation();
  const callCompanion = useNativeCallCompanion();
  const incomingCallId = incomingCall?.id;
  const [calls, setCalls] = useState<Call[]>(incomingCall ? [incomingCall] : []),
    [mail, setMail] = useState<Mail[]>([]),
    [people, setPeople] = useState<Person[]>([]),
    [settings, setSettings] = useState<Settings>({
      available: true,
      speedDial: [],
    });
  const [loading, setLoading] = useState(!incomingCall),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [transcriptCall, setTranscriptCall] = useState<string | null>(null);
  const [directoryOpen, setDirectoryOpen] = useState(false);
  const [devicesOpen, setDevicesOpen] = useState(false);
  const [devicesFullScreen, setDevicesFullScreen] = useState(false);
  const [contact, setContact] = useState<Person | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [selectedMail, setSelectedMail] = useState<string | null>(null);
  const [search, setSearch] = useState(""),
    [selected, setSelected] = useState<string | null>(null),
    [voicemailCall, setVoicemailCall] = useState<string | null>(null);
  const [recording, setRecording] = useState(false),
    [clip, setClip] = useState<{
      uri: string;
      durationMs: number;
      id: string;
      callId: string;
    } | null>(null),
    [playing, setPlaying] = useState<string | null>(null);
  const [playbackPosition, setPlaybackPosition] = useState(0);
  const [playbackVolume, setPlaybackVolume] = useState(1);
  const [seekWidth, setSeekWidth] = useState(0);
  const microphone = useRef<Audio.Recording | null>(null),
    sound = useRef<Audio.Sound | null>(null),
    recordingTimer = useRef<ReturnType<typeof setTimeout> | null>(null),
    mounted = useRef(true),
    polling = useRef(false),
    eventPolling = useRef(false),
    eventCursor = useRef(0),
    clipUri = useRef<string | null>(null);
  const recordingCall = useRef("");
  const loadedMail = useRef<string | null>(null);
  const startedAt = useRef(0),
    dialAttempt = useRef<{
      recipientUserId: number;
      operationId: string;
    } | null>(null);
  const load = useCallback(async () => {
    if (polling.current) return;
    polling.current = true;
    try {
      if (incomingCallId) {
        const call = await loadIncomingCall(incomingCallId);
        if (mounted.current) setCalls(call ? [call] : []);
        return;
      }
      const [history, voicemail, preferences] = await Promise.all([
        apiFetch<Call[]>("/api/work-hub/calls"),
        apiFetch<Mail[]>("/api/work-hub/voicemail"),
        apiFetch<Settings>("/api/work-hub/calls/settings"),
      ]);
      if (mounted.current) {
        setCalls(history);
        setMail(voicemail);
        setSettings(preferences);
      }
    } finally {
      polling.current = false;
      if (mounted.current) setLoading(false);
    }
  }, [incomingCallId]);
  const report = (cause: unknown) => {
    if (mounted.current)
      setError(
        cause instanceof Error
          ? cause.message
          : "Call operation failed. Please retry.",
      );
  };
  const pollCallEvents = useCallback(async () => {
    if (eventPolling.current) return;
    eventPolling.current = true;
    try {
      const page = await apiFetch<{
        gap: boolean;
        latestSequence: number | null;
        events: Array<{
          sequence: number;
          type: string;
          payload: {
            subject?: { type?: unknown; id?: unknown };
          };
        }>;
      }>(
        `/api/work-hub/events?transport=poll&after=${eventCursor.current}`,
      );
      if (typeof page.latestSequence === "number")
        eventCursor.current = Math.max(
          eventCursor.current,
          page.latestSequence,
        );
      const transitions = new Map<string, string>();
      let voicemailChanged = false;
      for (const event of page.events) {
        eventCursor.current = Math.max(eventCursor.current, event.sequence);
        const subject = event.payload.subject;
        if (subject?.type === "work_hub_voicemail") {
          voicemailChanged = true;
          continue;
        }
        if (
          subject?.type !== "work_hub_call" ||
          typeof subject.id !== "string"
        )
          continue;
        const status =
          event.type === "work_hub.call.answered"
            ? "active"
            : event.type === "work_hub.call.declined"
              ? "declined"
              : event.type === "work_hub.call.missed"
                ? "missed"
                : event.type === "work_hub.call.ended"
                  ? "ended"
                  : null;
        if (status) transitions.set(subject.id, status);
      }
      if (page.gap || voicemailChanged || transitions.size > 0) {
        if (transitions.size > 0 && mounted.current)
          setCalls((rows) =>
            rows.map((call) =>
              transitions.has(call.id)
                ? { ...call, status: transitions.get(call.id)! }
                : call,
            ),
          );
        await load();
      }
    } finally {
      eventPolling.current = false;
    }
  }, [load]);
  const stopRecording = async () => {
    if (recordingTimer.current) clearTimeout(recordingTimer.current);
    recordingTimer.current = null;
    const recorder = microphone.current;
    microphone.current = null;
    if (!recorder) return;
    try {
      await recorder.stopAndUnloadAsync();
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        playsInSilentModeIOS: true,
      });
      const uri = recorder.getURI();
      if (uri && mounted.current) {
        clipUri.current = uri;
        setClip({
          uri,
          durationMs: Math.max(
            1,
            Math.min(120000, Date.now() - startedAt.current),
          ),
          id: randomUUID(),
          callId: recordingCall.current,
        });
      }
    } catch (cause) {
      report(cause);
    } finally {
      if (mounted.current) setRecording(false);
    }
  };
  useEffect(() => {
    mounted.current = true;
    void load().then(pollCallEvents).catch(report);
    const interval = setInterval(() => {
      if (AppState.currentState === "active") void load().catch(report);
    }, 4000);
    const eventInterval = setInterval(() => {
      if (AppState.currentState === "active")
        void pollCallEvents().catch(report);
    }, 1000);
    const subscription = AppState.addEventListener("change", (next) => {
      if (next !== "active") void stopRecording();
      else void load().catch(report);
    });
    return () => {
      mounted.current = false;
      clearInterval(interval);
      clearInterval(eventInterval);
      subscription.remove();
      if (recordingTimer.current) clearTimeout(recordingTimer.current);
      void microphone.current?.stopAndUnloadAsync().catch(() => undefined);
      microphone.current = null;
      void sound.current?.unloadAsync().catch(() => undefined);
      sound.current = null;
      void Audio.setAudioModeAsync({ allowsRecordingIOS: false }).catch(
        () => undefined,
      );
      if (clipUri.current)
        void FileSystem.deleteAsync(clipUri.current, {
          idempotent: true,
        }).catch(() => undefined);
    };
  }, [load, pollCallEvents]);
  useEffect(() => {
    if (incomingCallId || !directoryOpen) return;
    let current = true;
    const timer = setTimeout(() => {
      void apiFetch<Person[]>(
        "/api/work-hub/people?directory=calls",
      )
        .then((rows) => {
          if (current) setPeople(rows);
        })
        .catch(report);
    }, 250);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [directoryOpen, incomingCallId]);
  const action = async (path: string, body?: unknown, method = "POST") => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await apiFetch(path, {
        method,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      await load();
    } catch (cause) {
      report(cause);
    } finally {
      if (mounted.current) setBusy(false);
    }
  };
  const dial = async (recipientUserId: number) => {
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      if (dialAttempt.current?.recipientUserId !== recipientUserId)
        dialAttempt.current = { recipientUserId, operationId: randomUUID() };
      const call = await apiFetch<Call>("/api/work-hub/calls", {
        method: "POST",
        body: JSON.stringify(dialAttempt.current),
      });
      dialAttempt.current = null;
      setDirectoryOpen(false);
      setSelected(call.id);
      setExpanded(`call-${call.id}`);
      setSelectedMail(null);
      setCalls(current => [call, ...current.filter(entry => entry.id !== call.id)]);
      callCompanion?.track(call);
      setVoicemailCall(unavailable.includes(call.status) ? call.id : null);
      await load();
    } catch (cause) {
      report(cause);
    } finally {
      setBusy(false);
    }
  };
  const respond = async (call: Call, response: string) => {
    if (callCompanion && (response === "accept" || response === "decline" || response === "end")) {
      callCompanion.respond(call, response);
      return;
    }
    try {
      if (response === "end") await closeInternalCallAudio(call.id);
      setSelected(call.id);
      setVoicemailCall(null);
      const identity = response === "accept" ? await nativeWorkHubDeviceIdentity() : null;
      await action(`/api/work-hub/calls/${call.id}/respond`, { action: response, ...(identity ?? {}) });
    } catch (cause) {
      report(cause);
    }
  };
  const saveSettings = (next: Settings) =>
    action("/api/work-hub/calls/settings", next, "PUT");
  const startRecording = async () => {
    if (busy || recording || !voicemailCall) return;
    setBusy(true);
    setError("");
    try {
      await sound.current?.unloadAsync();
      sound.current = null;
      loadedMail.current = null;
      setPlaying(null);
      const permission = await Audio.requestPermissionsAsync();
      if (permission.status !== "granted")
        throw new Error("Allow microphone access to record a voicemail.");
      if (!mounted.current) return;
      if (clipUri.current) {
        await FileSystem.deleteAsync(clipUri.current, { idempotent: true });
        clipUri.current = null;
      }
      setClip(null);
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
        staysActiveInBackground: false,
      });
      const recorder = new Audio.Recording();
      microphone.current = recorder;
      await recorder.prepareToRecordAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY,
      );
      await recorder.startAsync();
      if (!mounted.current) {
        await recorder.stopAndUnloadAsync();
        return;
      }
      recordingCall.current = voicemailCall;
      microphone.current = recorder;
      startedAt.current = Date.now();
      setRecording(true);
      recordingTimer.current = setTimeout(() => void stopRecording(), 120000);
    } catch (cause) {
      await microphone.current?.stopAndUnloadAsync().catch(() => undefined);
      microphone.current = null;
      await Audio.setAudioModeAsync({ allowsRecordingIOS: false }).catch(
        () => undefined,
      );
      report(cause);
    } finally {
      if (mounted.current) setBusy(false);
    }
  };
  const sendVoicemail = async () => {
    if (!clip || !voicemailCall || clip.callId !== voicemailCall || busy)
      return;
    setBusy(true);
    setError("");
    try {
      const token = await getToken();
      if (!token) throw new Error("Sign in again to send your voicemail.");
      const info = await FileSystem.getInfoAsync(clip.uri);
      if (!info.exists || (info.size ?? 0) > 4 * 1024 * 1024)
        throw new Error("Record a shorter message under 4 MB.");
      const uploaded = await FileSystem.uploadAsync(
        `${getApiBase()}/api/work-hub/calls/${voicemailCall}/voicemail`,
        clip.uri,
        {
          httpMethod: "POST",
          uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
          headers: {
            Authorization: `Bearer ${token}`,
            "x-vndrly-client": "ios",
            "Content-Type": "audio/mp4",
            "x-operation-id": clip.id,
            "x-duration-ms": String(clip.durationMs),
          },
        },
      );
      if (uploaded.status < 200 || uploaded.status >= 300) {
        let message =
          "Voicemail could not be sent. Retry your saved recording.";
        try {
          const result = JSON.parse(uploaded.body);
          message = result.error?.message ?? result.message ?? message;
        } catch {
          /* preserve retry message */
        }
        throw new Error(message);
      }
      await FileSystem.deleteAsync(clip.uri, { idempotent: true });
      clipUri.current = null;
      setClip(null);
      setVoicemailCall(null);
      setNotice("Private voicemail sent.");
      await load();
    } catch (cause) {
      report(cause);
    } finally {
      setBusy(false);
    }
  };
  const play = async (item: Mail) => {
    if (busy || recording) return;
    setBusy(true);
    setError("");
    try {
      if (playing === item.id) {
        await sound.current?.pauseAsync();
        setPlaying(null);
        return;
      }
      if (loadedMail.current === item.id && sound.current) {
        await sound.current.playAsync();
        setPlaying(item.id);
        return;
      }
      await sound.current?.unloadAsync();
      sound.current = null;
      loadedMail.current = null;
      setPlaybackPosition(0);
      const token = await getToken();
      if (!token) throw new Error("Sign in again to listen.");
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        playsInSilentModeIOS: true,
      });
      const source = {
        uri: `${getApiBase()}/api/work-hub/voicemail/${item.id}/audio`,
        headers: { Authorization: `Bearer ${token}`, "x-vndrly-client": "ios" },
      };
      const result = await Audio.Sound.createAsync(source);
      sound.current = result.sound;
      loadedMail.current = item.id;
      if (playbackVolume !== 1) await result.sound.setVolumeAsync(playbackVolume);
      await result.sound.playAsync();
      setPlaying(item.id);
      result.sound.setOnPlaybackStatusUpdate((status) => {
        if (status.isLoaded) {
          setPlaybackPosition(status.didJustFinish ? 0 : (status.positionMillis ?? 0));
          if (status.didJustFinish) {
            setPlaying(null);
            void result.sound.setPositionAsync(0).catch(report);
          }
        }
      });
      await load();
    } catch (cause) {
      report(cause);
      setPlaying(null);
    } finally {
      if (mounted.current) setBusy(false);
    }
  };
  const removeMail = async (item: Mail) => {
    if (loadedMail.current === item.id) {
      await sound.current?.unloadAsync();
      sound.current = null;
      loadedMail.current = null;
      setPlaying(null);
    }
    await action(`/api/work-hub/voicemail/${item.id}`, undefined, "DELETE");
  };
  const stopPlayback = () => {
    const audio = sound.current;
    sound.current = null;
    loadedMail.current = null;
    setPlaying(null);
    setPlaybackPosition(0);
    void audio?.unloadAsync().catch(report);
  };
  const button = (
    label: string,
    onPress: () => void,
    disabled = busy || recording,
  ) => (
    <TogglePillButton color={/^(Delete|Decline|End|Remove)/.test(label) ? "red" : "brand"} compactOnTablet accessibilityLabel={label} disabled={disabled} onPress={onPress}>{label}</TogglePillButton>
  );
  const active = calls.find((c) => c.id === (incomingCallId ?? selected)) ?? calls.find((c) => c.status === "active");
  const box = {
    borderWidth: 1,
    borderColor: colors.primary,
    backgroundColor: colors.card,
    borderRadius: 14,
    padding: 14,
    gap: 12,
  };
  const callDetails = active && !(active.incoming && active.status === "ringing") && (
        <View style={box}>
          <Text style={{ color: colors.text, fontWeight: "700" }}>
            {active.incoming ? active.callerName : active.recipientName} ·{" "}
            {active.status}
          </Text>
          {active.status === "active" && (
            <View style={{gap:12}}><WorkHubAudioRoom occurrenceId={active.occurrenceId} callId={active.id} /><WorkHubCallTranscript callId={active.id} live /></View>
          )}
          {["ringing", "active"].includes(active.status) &&
            button("End call", () => respond(active, "end"))}
          {!active.incoming &&
            unavailable.includes(active.status) &&
            button("Leave voicemail", () => setVoicemailCall(active.id))}
        </View>
      );
  const incomingBanner = (call: Call) => (
    <View key={call.id} style={box}>
      <Text style={{ color: colors.text, fontWeight: "700" }}>
        {call.callerName} is calling
      </Text>
      <View style={{ flexDirection: "row", gap: 12 }}>
        {button("Accept", () => respond(call, "accept"))}
        {button("Decline", () => respond(call, "decline"))}
      </View>
    </View>
  );
  if (incomingCallId)
    return (
      <View style={{ gap: 12 }}>
        {error ? <Text accessibilityRole="alert" style={{ color: colors.destructive }}>{error}</Text> : null}
        {active?.status === "ringing" ? incomingBanner(active) : active?.id !== callCompanion?.trackedId ? callDetails : null}
        {!active && !error && (
          <Text accessibilityRole="alert" style={{ color: colors.mutedForeground }}>
            {t("notifications.destinationUnavailable", { defaultValue: "This notification's destination is no longer available." })}
          </Text>
        )}
      </View>
    );
  const log: LogEntry[] = [
    ...calls.map((call): LogEntry => ({
      id: "call-" + call.id, call,
      name: (call.incoming ? call.callerName : call.recipientName) ?? "Unknown contact",
      contactId: call.incoming ? call.callerUserId : call.recipientUserId,
      createdAt: call.createdAt,
      label: !call.incoming ? "Outgoing" : unavailable.includes(call.status) ? "Missed" : "Incoming",
    })),
    ...mail.map((voicemail): LogEntry => ({
      id: "mail-" + voicemail.id, voicemail, name: voicemail.senderName,
      contactId: voicemail.senderUserId, createdAt: voicemail.createdAt, label: "Voicemail",
    })),
  ].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  const words = normalizeSearch(search).split(/\s+/).filter(Boolean);
  const contacts = people.map(person => {
    const detail = [person.organizationName, directoryRoles[person.operationalRole ?? person.role ?? ""]].filter(Boolean).join(" · ");
    return { person, detail, match: normalizeSearch(person.displayName + " " + detail), saved: settings.speedDial.includes(person.id) };
  }).filter(({ match }) => words.every(word => match.includes(word) || (word.length > 3 && word.endsWith("s") && match.includes(word.slice(0, -1)))))
    .sort((a, b) => Number(b.saved) - Number(a.saved));
  const iconButton = (label: string, icon: IconName, onPress: () => void, disabled = false, size = 36) => (
    <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }} disabled={disabled}
      onPress={onPress} style={{ width: size, height: size, alignItems: "center", justifyContent: "center", opacity: disabled ? 0.45 : 1 }}>
      <Ionicons name={icon} size={size >= 36 ? 19 : 15} color={colors.primary} />
    </Pressable>
  );
  const listenIn = (entryId: string, item: Mail) => {
    setExpanded(entryId);
    setSelectedMail(item.id);
    void play(item);
  };
  const audioBusy = busy || recording || active?.status === "active";
  const playback = (item: Mail) => {
    const position = loadedMail.current === item.id ? playbackPosition : 0;
    const fraction = item.durationMs > 0 ? Math.min(1, position / item.durationMs) : 0;
    const seconds = Math.round(item.durationMs / 1000);
    const seek = (value: number) => {
      if (loadedMail.current === item.id) void sound.current?.setPositionAsync(Math.min(item.durationMs, Math.max(0, value))).catch(report);
    };
    return (
      <View style={{ gap: 4 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          {iconButton(playing === item.id ? "Pause voicemail" : "Play voicemail", playing === item.id ? "pause" : "play-outline", () => void play(item), audioBusy)}
          <Text style={{ color: colors.text, fontVariant: ["tabular-nums"] }}>{playbackClock(position)}</Text>
          <Pressable accessibilityRole="adjustable" accessibilityLabel="Voicemail position"
            accessibilityValue={{ min: 0, max: Math.max(1, seconds), now: Math.floor(position / 1000) }}
            accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
            onAccessibilityAction={event => seek(position + (event.nativeEvent.actionName === "increment" ? 1000 : -1000))}
            onLayout={event => setSeekWidth(event.nativeEvent.layout.width)}
            onPress={event => { if (seekWidth > 0) seek(Math.round(item.durationMs * event.nativeEvent.locationX / seekWidth)); }}
            style={{ flex: 1, maxWidth: 156, minHeight: 28, justifyContent: "center" }}>
            <View pointerEvents="none" style={{ height: 4, backgroundColor: colors.border, borderRadius: 4 }}>
              <View style={{ width: seekWidth * fraction, height: 4, borderRadius: 4, backgroundColor: colors.primary }} />
            </View>
          </Pressable>
          {iconButton(playbackVolume ? "Mute voicemail" : "Unmute voicemail", playbackVolume ? "volume-medium-outline" : "volume-mute-outline", () => {
            const volume = playbackVolume ? 0 : 1;
            setPlaybackVolume(volume);
            void sound.current?.setVolumeAsync(volume).catch(report);
          })}
          <Pressable accessibilityRole="button" accessibilityLabel="Delete voicemail" disabled={busy || recording}
            onPress={() => void removeMail(item)} style={{ marginLeft: "auto", flexDirection: "row", alignItems: "center", gap: 5, minHeight: 36 }}>
            <Text style={{ color: colors.text }}>Delete</Text><Ionicons name="trash-outline" size={15} color={colors.primary} />
          </Pressable>
        </View>
        <View style={{ flexDirection: "row", alignItems: "baseline", gap: 7 }}>
          <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>{seconds} {seconds === 1 ? "second" : "seconds"}</Text>
          <Text selectable style={{ color: colors.text, flex: 1 }}>
            {item.transcript ?? (["processing", "pending", "retry"].includes(item.transcriptionState ?? "")
              ? "Transcribing voicemail…" : item.transcriptionState === "no_speech" ? "No speech detected." : "Transcript unavailable.")}
          </Text>
        </View>
      </View>
    );
  };
  const backdrop = { flex: 1, backgroundColor: "rgba(0,0,0,0.65)", alignItems: "center", padding: 16, paddingTop: 76 } as const;
  const modalCard = { ...box, width: "100%", maxWidth: 540, maxHeight: "85%" } as const;
  const closeDevices = () => { setDevicesFullScreen(false); setDevicesOpen(false); };
  const devicePanel = <View style={{ gap: 12 }}>
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
      <Text style={{ color: colors.text, fontWeight: "700", flex: 1 }}>Devices and audio backup</Text>
      {iconButton(devicesFullScreen ? "Restore devices flyout" : "Expand devices", devicesFullScreen ? "contract-outline" : "expand-outline", () => setDevicesFullScreen(value => !value))}
      {iconButton("Close devices", "close-outline", closeDevices)}
    </View>
    <WorkHubDeviceSettings embedded onExit={closeDevices} /><WorkHubCallPolicy />
  </View>;
  return (
    <View style={{ ...box, padding: 0, gap: 0 }}>
      <View style={{ flexDirection: "row", paddingHorizontal: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.border }}>
        {iconButton("New call", "call-outline", () => { setSearch(""); setContact(null); setError(""); setDirectoryOpen(true); })}
        {iconButton("Devices and audio backup", "laptop-outline", () => setDevicesOpen(true))}
      </View>
      {devicesOpen && devicesFullScreen && <View style={{ padding: 14 }}>{devicePanel}</View>}
      <View style={{ padding: 14, gap: 8, display: devicesOpen && devicesFullScreen ? "none" : "flex" }}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          <Text style={{ color: colors.text, fontSize: 17, fontWeight: "700" }}>Call log</Text>
          <Pressable accessibilityRole="switch" accessibilityLabel="Available for internal calls"
            accessibilityState={{ checked: settings.available, disabled: busy || loading }}
            disabled={busy || loading} onPress={() => void saveSettings({ ...settings, available: !settings.available })}
            style={{ flexDirection: "row", alignItems: "center", gap: 6, minHeight: 36 }}>
            <Text style={{ color: settings.available ? colors.primary : colors.mutedForeground }}>{settings.available ? "Available" : "Away"}</Text>
            <Ionicons name="call-outline" color={settings.available ? colors.primary : colors.mutedForeground} size={15} />
          </Pressable>
        </View>
        {!!error && !directoryOpen && <Text accessibilityRole="alert" style={{ color: colors.destructive }}>{error}</Text>}
        {!!notice && <Text accessibilityLiveRegion="polite" style={{ color: colors.primary }}>{notice}</Text>}
        {loading && <ActivityIndicator color={colors.primary} />}
        {!callCompanion && calls.filter(call => call.incoming && call.status === "ringing").map(incomingBanner)}
        {!loading && !log.length && <Text style={{ color: colors.mutedForeground }}>No calls or voicemail yet.</Text>}
        {log.map(entry => {
          const call = entry.call;
          const open = expanded === entry.id;
          const live = !!call && call.id === active?.id && call.id !== callCompanion?.trackedId && (call.status === "active" || (!call.incoming && call.status === "ringing"));
          const inProgress = !!call && (call.status === "active" || call.status === "ringing");
          const canRecord = !!call && !call.incoming && unavailable.includes(call.status);
          const recorder = !!call && voicemailCall === call.id;
          const currentMail = open ? mail.find(item => item.id === selectedMail) ?? entry.voicemail : undefined;
          const history = open ? log.filter(item => Number.isInteger(entry.contactId) ? item.contactId === entry.contactId : item.id === entry.id) : [];
          return (
            <View key={entry.id} style={{ borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.border }}>
              <View style={{ flexDirection: "row", alignItems: "center", minHeight: 50, gap: 6 }}>
                <Text style={{ width: 66, color: colors.text, fontSize: 12, fontWeight: "600" }}>{entry.label}</Text>
                <Pressable accessibilityRole="button" accessibilityLabel={entry.name} accessibilityState={{ expanded: open, disabled: busy }} disabled={busy}
                  onPress={() => { stopPlayback(); setSelectedMail(null); setExpanded(open ? null : entry.id); }}
                  style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 6, minHeight: 44 }}>
                  <Ionicons name={settings.speedDial.includes(entry.contactId ?? -1) ? "star" : "star-outline"} size={14} color={colors.primary} />
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: colors.text }}>{entry.name}</Text>
                    <Text style={{ color: colors.mutedForeground, fontSize: 11 }}>{new Date(entry.createdAt).toLocaleString()}</Text>
                  </View>
                </Pressable>
                {entry.voicemail && iconButton("Listen to voicemail from " + entry.name, "play-outline", () => listenIn(entry.id, entry.voicemail!), audioBusy)}
                {iconButton("Call back " + entry.name, "call-outline", () => void dial(entry.contactId!), busy || recording || inProgress || !Number.isInteger(entry.contactId))}
              </View>
              {(open || live || recorder) && (
                <View style={{ paddingHorizontal: 8, paddingBottom: 8, gap: 6 }}>
                  {currentMail && playback(currentMail)}
                  {live && call?.status === "ringing" && <Text style={{ color: colors.mutedForeground }}>Calling…</Text>}
                  {live && call?.status === "active" && (
                    <View style={{ gap: 8 }}><WorkHubAudioRoom occurrenceId={call.occurrenceId} callId={call.id} /><WorkHubCallTranscript callId={call.id} live /></View>
                  )}
                  {live && call && button("End call", () => void respond(call, "end"))}
                  {open && canRecord && <View style={{ alignItems: "flex-end" }}>{button("Leave voicemail", () => setVoicemailCall(call!.id))}</View>}
                  {recorder && (
                    <View style={{ gap: 6 }}>
                      <Text style={{ color: colors.mutedForeground }}>Only the recipient can play this message. Up to two minutes.</Text>
                      {recording ? button("Stop recording", () => void stopRecording(), false)
                        : button(clip ? "Record again" : "Record message", () => void startRecording())}
                      {clip?.callId === voicemailCall && button("Send voicemail", () => void sendVoicemail())}
                    </View>
                  )}
                  {open && (
                    <View accessibilityLabel={"Call history with " + entry.name}>
                      {history.map(item => (
                        <View key={item.id} style={{ minHeight: 32, flexDirection: "row", alignItems: "center", gap: 6, borderTopWidth: StyleSheet.hairlineWidth, borderColor: colors.border }}>
                          <Text style={{ flex: 1, color: colors.text }}>{item.label}</Text>
                          {item.voicemail && iconButton("Listen to history voicemail from " + item.name, "play-outline", () => listenIn(entry.id, item.voicemail!), audioBusy, 28)}
                          <Text style={{ color: colors.mutedForeground, fontSize: 11 }}>{new Date(item.createdAt).toLocaleString()}</Text>
                        </View>
                      ))}
                    </View>
                  )}
                  {open && call?.transcriptAvailable && button("View transcript", () => setTranscriptCall(call.id))}
                </View>
              )}
            </View>
          );
        })}
      </View>
      <DismissibleModal contentHasCloseControl dismissLabel="close" visible={directoryOpen} transparent animationType="fade" onRequestClose={() => setDirectoryOpen(false)}>
        <View style={backdrop}><View style={modalCard}>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
            <Text style={{ color: colors.text, fontWeight: "700" }}>Start a call</Text>
            {iconButton("Close contacts", "close-outline", () => setDirectoryOpen(false))}
          </View>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <TextInput accessibilityLabel="Find a contact" placeholder="Search by name, company, or role"
              placeholderTextColor={colors.mutedForeground} value={search}
              onChangeText={value => { setSearch(value); setContact(null); }}
              style={{ flex: 1, minHeight: 38, color: colors.text, borderWidth: 1, borderColor: colors.primary, borderRadius: 20, paddingHorizontal: 12 }} />
            {button("Call", () => { if (contact) void dial(contact.id); }, !contact || busy || recording)}
          </View>
          {!!error && <Text accessibilityRole="alert" style={{ color: colors.destructive }}>{error}</Text>}
          <ScrollView keyboardShouldPersistTaps="handled" style={{ maxHeight: 260 }}>
            {contacts.map(({ person, saved, detail }) => (
              <View key={person.id} style={{ flexDirection: "row", alignItems: "center", minHeight: 42, backgroundColor: contact?.id === person.id ? colors.muted : undefined }}>
                {iconButton((saved ? "Remove " : "Add ") + person.displayName + (saved ? " from speed dial" : " to speed dial"), saved ? "star" : "star-outline",
                  () => void action("/api/work-hub/calls/settings", { speedDialContact: { id: person.id, saved: !saved } }, "PUT"), busy)}
                <Pressable accessibilityRole="button" accessibilityLabel={person.displayName}
                  onPress={() => { setContact(person); setSearch(person.displayName); }} style={{ flex: 1, paddingVertical: 6 }}>
                  <Text style={{ color: colors.text, fontWeight: "600" }}>{person.displayName}</Text>
                  {!!detail && <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>{detail}</Text>}
                </Pressable>
              </View>
            ))}
            {!contacts.length && <Text style={{ color: colors.mutedForeground }}>No matching contacts.</Text>}
          </ScrollView>
        </View></View>
      </DismissibleModal>
      <DismissibleModal contentHasCloseControl dismissLabel="close" visible={devicesOpen && !devicesFullScreen} transparent animationType="fade" onRequestClose={closeDevices}>
        <View style={backdrop}><View style={modalCard}>
          <ScrollView>{devicePanel}</ScrollView>
        </View></View>
      </DismissibleModal>
      <DismissibleModal dismissLabel="close" visible={!!transcriptCall} transparent onRequestClose={() => setTranscriptCall(null)}>
        <View style={backdrop}><View style={modalCard}>
          {button("Close transcript", () => setTranscriptCall(null))}
          {transcriptCall && <WorkHubCallTranscript callId={transcriptCall} />}
        </View></View>
      </DismissibleModal>
    </View>
  );
}
