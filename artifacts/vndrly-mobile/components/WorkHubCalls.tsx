import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  AppState,
  Pressable,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { Audio } from "expo-av";
import * as FileSystem from "expo-file-system/legacy";
import { apiFetch, getApiBase } from "@/lib/api";
import { getToken } from "@/lib/auth";
import { useColors } from "@/hooks/useColors";
import WorkHubAudioRoom from "@/components/WorkHubAudioRoom";
type Call = {
  id: string;
  occurrenceId: string;
  incoming: boolean;
  callerUserId: number;
  recipientUserId: number;
  callerName: string;
  recipientName: string;
  status: string;
  createdAt: string;
};
type Mail = {
  id: string;
  senderName: string;
  createdAt: string;
  readAt: string | null;
  transcript: string | null;
  durationMs: number;
};
type Person = { id: number; displayName: string; email: string | null };
type Settings = { available: boolean; speedDial: number[] };
const unavailable = ["missed", "declined", "busy", "unavailable"];
export default function WorkHubCalls() {
  const colors = useColors();
  const [calls, setCalls] = useState<Call[]>([]),
    [mail, setMail] = useState<Mail[]>([]),
    [people, setPeople] = useState<Person[]>([]),
    [settings, setSettings] = useState<Settings>({
      available: true,
      speedDial: [],
    });
  const [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [filter, setFilter] = useState("all"),
    [search, setSearch] = useState(""),
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
  const microphone = useRef<Audio.Recording | null>(null),
    sound = useRef<Audio.Sound | null>(null),
    recordingTimer = useRef<ReturnType<typeof setTimeout> | null>(null),
    mounted = useRef(true),
    polling = useRef(false),
    clipUri = useRef<string | null>(null);
  const recordingCall = useRef("");
  const startedAt = useRef(0),
    dialAttempt = useRef<{
      recipientUserId: number;
      operationId: string;
    } | null>(null);
  const load = useCallback(async () => {
    if (polling.current) return;
    polling.current = true;
    try {
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
  }, []);
  const report = (cause: unknown) => {
    if (mounted.current)
      setError(
        cause instanceof Error
          ? cause.message
          : "Call operation failed. Please retry.",
      );
  };
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
          id: crypto.randomUUID(),
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
    void load().catch(report);
    const interval = setInterval(() => {
      if (AppState.currentState === "active") void load().catch(report);
    }, 4000);
    const subscription = AppState.addEventListener("change", (next) => {
      if (next !== "active") void stopRecording();
      else void load().catch(report);
    });
    return () => {
      mounted.current = false;
      clearInterval(interval);
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
  }, [load]);
  useEffect(() => {
    let current = true;
    const timer = setTimeout(() => {
      void apiFetch<Person[]>(
        `/api/work-hub/people?search=${encodeURIComponent(search)}`,
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
  }, [search]);
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
    if (dialAttempt.current?.recipientUserId !== recipientUserId)
      dialAttempt.current = {
        recipientUserId,
        operationId: crypto.randomUUID(),
      };
    try {
      const call = await apiFetch<Call>("/api/work-hub/calls", {
        method: "POST",
        body: JSON.stringify(dialAttempt.current),
      });
      dialAttempt.current = null;
      setSelected(call.id);
      setVoicemailCall(unavailable.includes(call.status) ? call.id : null);
      await load();
    } catch (cause) {
      report(cause);
    } finally {
      setBusy(false);
    }
  };
  const respond = (call: Call, response: string) => {
    setSelected(call.id);
    setVoicemailCall(null);
    void action(`/api/work-hub/calls/${call.id}/respond`, { action: response });
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
      await sound.current?.unloadAsync();
      sound.current = null;
      if (playing === item.id) {
        setPlaying(null);
        return;
      }
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
      await result.sound.playAsync();
      sound.current = result.sound;
      setPlaying(item.id);
      result.sound.setOnPlaybackStatusUpdate((status) => {
        if (status.isLoaded && status.didJustFinish) setPlaying(null);
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
    if (playing === item.id) {
      await sound.current?.unloadAsync();
      sound.current = null;
      setPlaying(null);
    }
    await action(`/api/work-hub/voicemail/${item.id}`, undefined, "DELETE");
  };
  const button = (
    label: string,
    onPress: () => void,
    disabled = busy || recording,
  ) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      style={{
        borderWidth: 1,
        borderColor: colors.border,
        padding: 10,
        borderRadius: 8,
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <Text style={{ color: colors.primary, fontWeight: "600" }}>{label}</Text>
    </Pressable>
  );
  const active = calls.find((c) => c.id === selected),
    filtered = calls.filter(
      (c) =>
        filter === "all" ||
        (filter === "incoming" && c.incoming) ||
        (filter === "outgoing" && !c.incoming) ||
        (filter === "missed" && c.incoming && unavailable.includes(c.status)),
    );
  const box = {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: 14,
    gap: 12,
  };
  return (
    <View style={{ gap: 18 }}>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <Text style={{ color: colors.text }}>Available for internal calls</Text>
        <Switch
          accessibilityLabel="Available for internal calls"
          disabled={busy || loading}
          value={settings.available}
          onValueChange={(available) =>
            void saveSettings({ ...settings, available })
          }
        />
      </View>
      {!!error && (
        <Text accessibilityRole="alert" style={{ color: colors.destructive }}>
          {error}
        </Text>
      )}
      {!!notice && (
        <Text
          accessibilityLiveRegion="polite"
          style={{ color: colors.primary }}
        >
          {notice}
        </Text>
      )}
      {loading && <ActivityIndicator color={colors.primary} />}
      {calls
        .filter((c) => c.incoming && c.status === "ringing")
        .map((c) => (
          <View key={c.id} style={box}>
            <Text style={{ color: colors.text, fontWeight: "700" }}>
              {c.callerName} is calling
            </Text>
            <View style={{ flexDirection: "row", gap: 12 }}>
              {button("Accept", () => respond(c, "accept"))}
              {button("Decline", () => respond(c, "decline"))}
            </View>
          </View>
        ))}
      {active && (
        <View style={box}>
          <Text style={{ color: colors.text, fontWeight: "700" }}>
            {active.incoming ? active.callerName : active.recipientName} ·{" "}
            {active.status}
          </Text>
          {active.status === "active" && (
            <WorkHubAudioRoom occurrenceId={active.occurrenceId} />
          )}
          {["ringing", "active"].includes(active.status) &&
            button("End call", () => respond(active, "end"))}
          {!active.incoming &&
            unavailable.includes(active.status) &&
            button("Leave voicemail", () => setVoicemailCall(active.id))}
        </View>
      )}
      {voicemailCall && (
        <View style={box}>
          <Text style={{ color: colors.text, fontWeight: "700" }}>
            Private voicemail
          </Text>
          <Text style={{ color: colors.mutedForeground }}>
            Only the recipient can play this message. Up to two minutes.
          </Text>
          {recording
            ? button("Stop recording", () => void stopRecording(), false)
            : button(
                clip ? "Record again" : "Record message",
                () => void startRecording(),
              )}
          {clip?.callId === voicemailCall &&
            button("Send voicemail", () => void sendVoicemail())}
        </View>
      )}
      <View style={box}>
        <Text style={{ color: colors.text, fontWeight: "700" }}>
          Speed dial
        </Text>
        {settings.speedDial.length === 0 && (
          <Text style={{ color: colors.mutedForeground }}>
            Save a contact below.
          </Text>
        )}
        {settings.speedDial.map((id) => (
          <View key={id} style={{ gap: 8 }}>
            <Text style={{ color: colors.text }}>
              {people.find((p) => p.id === id)?.displayName ?? "Saved contact"}
            </Text>
            <View style={{ flexDirection: "row", gap: 8 }}>
              {button("Call saved contact", () => void dial(id))}
              {button(
                "Remove speed dial",
                () =>
                  void saveSettings({
                    ...settings,
                    speedDial: settings.speedDial.filter((x) => x !== id),
                  }),
              )}
            </View>
          </View>
        ))}
        <TextInput
          accessibilityLabel="Find a contact"
          placeholder="Find a contact"
          placeholderTextColor={colors.mutedForeground}
          value={search}
          onChangeText={setSearch}
          style={{
            borderWidth: 1,
            borderColor: colors.border,
            borderRadius: 8,
            padding: 12,
            color: colors.text,
          }}
        />
        {people.slice(0, search ? 20 : 5).map((p) => (
          <View key={p.id} style={{ gap: 6 }}>
            <Text style={{ color: colors.text }}>{p.displayName}</Text>
            <View style={{ flexDirection: "row", gap: 8 }}>
              {button(`Call ${p.displayName}`, () => void dial(p.id))}
              {!settings.speedDial.includes(p.id) &&
                button(
                  `Save ${p.displayName}`,
                  () =>
                    void saveSettings({
                      ...settings,
                      speedDial: [...settings.speedDial, p.id],
                    }),
                )}
            </View>
          </View>
        ))}
      </View>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {["all", "incoming", "outgoing", "missed", "voicemail"].map((f) => (
          <Pressable
            key={f}
            accessibilityRole="button"
            accessibilityState={{ selected: f === filter }}
            onPress={() => setFilter(f)}
            style={{
              padding: 10,
              borderBottomWidth: f === filter ? 2 : 0,
              borderColor: colors.primary,
            }}
          >
            <Text
              style={{ color: colors.primary, textTransform: "capitalize" }}
            >
              {f}
            </Text>
          </Pressable>
        ))}
      </View>
      {filter === "voicemail" ? (
        <View style={{ gap: 12 }}>
          {mail.length === 0 && (
            <Text style={{ color: colors.mutedForeground }}>No voicemail.</Text>
          )}
          {mail.map((item) => (
            <View key={item.id} style={box}>
              <Text style={{ color: colors.text, fontWeight: "700" }}>
                {item.senderName}
                {!item.readAt ? " · New" : ""}
              </Text>
              <Text style={{ color: colors.mutedForeground }}>
                {new Date(item.createdAt).toLocaleString()} ·{" "}
                {Math.round(item.durationMs / 1000)} seconds
              </Text>
              {button(
                playing === item.id ? "Stop playback" : "Play voicemail",
                () => void play(item),
                busy || recording || active?.status === "active",
              )}
              {item.transcript && (
                <Text style={{ color: colors.text }}>{item.transcript}</Text>
              )}
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                {!item.transcript &&
                  button(
                    "Transcribe",
                    () =>
                      void action(
                        `/api/work-hub/voicemail/${item.id}/transcribe`,
                        {},
                      ),
                  )}
                {button("Delete voicemail", () => void removeMail(item))}
              </View>
            </View>
          ))}
        </View>
      ) : (
        <View style={{ gap: 12 }}>
          {!loading && !filtered.length && (
            <Text style={{ color: colors.mutedForeground }}>
              No calls in this view.
            </Text>
          )}
          {filtered.map((c) => (
            <Pressable
              key={c.id}
              accessibilityRole="button"
              onPress={() => setSelected(c.id)}
              style={box}
            >
              <Text style={{ color: colors.text, fontWeight: "600" }}>
                {c.incoming ? c.callerName : c.recipientName} · {c.status}
              </Text>
              <Text style={{ color: colors.mutedForeground }}>
                {c.incoming ? "Incoming" : "Outgoing"} ·{" "}
                {new Date(c.createdAt).toLocaleString()}
              </Text>
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}
