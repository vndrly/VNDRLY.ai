import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useFocusEffect } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ActivityIndicator,
  Alert,
  AppState,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import LayeredPillButton from "@/components/LayeredPillButton";
import { useBrand } from "@/hooks/use-brand";
import { useColors } from "@/hooks/useColors";
import { apiFetch } from "@/lib/api";
import { subscribeAskVAppState } from "@/lib/askv-audio-session";
import {
  createPttRecorder,
  isBackgroundAudioSessionError,
  isPttComment,
  isRecordingBusyError,
  playPttUri,
  postPttMessage,
  pttAttachmentPlayUri,
  PttMicPermissionError,
  pttDurationLabel,
  warmUpPttSession,
  type PttRecorder,
} from "@/lib/ptt";

type Comment = {
  id: number;
  content: string;
  attachments: string[] | null;
  createdAt: string;
  createdByName: string | null;
};

type Props = {
  ticketId: number;
  ticketLabel: string;
};

export default function PushToTalkPanel({ ticketId, ticketLabel }: Props) {
  const colors = useColors();
  const brand = useBrand();
  const { t } = useTranslation();
  const [messages, setMessages] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(true);
  const [recording, setRecording] = useState(false);
  const [sending, setSending] = useState(false);
  const [playingId, setPlayingId] = useState<number | null>(null);
  const [micReady, setMicReady] = useState(false);
  const [appForegrounded, setAppForegrounded] = useState(
    () => AppState.currentState === "active",
  );
  const recorderRef = useRef<PttRecorder | null>(null);

  const mountedRef = useRef(true);
  const generationRef = useRef(0);
  const phaseRef = useRef<"idle" | "starting" | "recording" | "sending">("idle");
  const cancelRecording = useCallback(() => {
    generationRef.current += 1;
    phaseRef.current = "idle";
    const recorder = recorderRef.current; recorderRef.current = null;
    void recorder?.dispose().catch(() => undefined);
    if (mountedRef.current) { setRecording(false); setSending(false); }
  }, []);

  useEffect(() => {
    const sub = subscribeAskVAppState(
      () => setAppForegrounded(true),
      () => { setAppForegrounded(false); cancelRecording(); },
    );
    return () => sub.remove();
  }, [cancelRecording]);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      setMicReady(false);
      void (async () => {
        try {
          await warmUpPttSession();
          if (!cancelled) setMicReady(true);
        } catch {
          if (!cancelled) setMicReady(false);
        }
      })();
      return () => {
        cancelled = true;
        cancelRecording();
      };
    }, [cancelRecording]),
  );

  const load = useCallback(async () => {
    try {
      const rows = await apiFetch<Comment[]>(
        `/api/tickets/${ticketId}/comments`,
      );
      setMessages(
        (rows ?? []).filter(
          (c) =>
            isPttComment(c.content) ||
            (c.attachments?.length &&
              c.attachments.some((a) => /audio|\.m4a|\.mp3/i.test(a))),
        ),
      );
    } catch {
      setMessages([]);
    } finally {
      setLoading(false);
    }
  }, [ticketId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; cancelRecording(); };
  }, [cancelRecording]);
  useEffect(() => () => cancelRecording(), [ticketId, cancelRecording]);

  const onPressIn = async () => {
    if (phaseRef.current !== "idle" || !appForegrounded) return;
    phaseRef.current = "starting";
    const current = ++generationRef.current;
    const valid = () => mountedRef.current && generationRef.current === current;
    let recorder: PttRecorder | null = null;
    try {
      if (!micReady) {
        await warmUpPttSession();
        if (!valid()) return;
        setMicReady(true);
      }
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      if (!valid()) return;
      recorder = await createPttRecorder({ deleteOnDispose: true });
      if (!valid()) { await recorder.dispose(); return; }
      recorderRef.current = recorder;
      await recorder.start();
      if (!valid() || recorderRef.current !== recorder) { await recorder.dispose(); return; }
      phaseRef.current = "recording";
      setRecording(true);
    } catch (e) {
      if (recorderRef.current === recorder) recorderRef.current = null;
      await recorder?.dispose().catch(() => undefined);
      if (!valid()) return;
      phaseRef.current = "idle";
      setRecording(false);
      if (e instanceof Error && e.name === "AbortError") return;
      if (e instanceof PttMicPermissionError) {
        Alert.alert(t("foremanHome.pttMicDeniedTitle"), t("foremanHome.pttMicDeniedBody"));
      } else if (isBackgroundAudioSessionError(e)) {
        Alert.alert(t("foremanHome.pttNotReadyTitle"), t("foremanHome.pttNotReadyBody"));
      } else if (isRecordingBusyError(e)) {
        Alert.alert(t("foremanHome.pttMicDeniedTitle"), t("foremanHome.pttBusyBody", {
          defaultValue: "Microphone is busy. Wait a moment and try again.",
        }));
      } else {
        Alert.alert(t("foremanHome.pttMicDeniedTitle"), e instanceof Error ? e.message : t("foremanHome.pttMicDeniedBody"));
      }
    }
  };

  const onPressOut = async () => {
    if (phaseRef.current === "starting") { cancelRecording(); return; }
    if (phaseRef.current !== "recording" || !recorderRef.current) return;
    const recorder = recorderRef.current; recorderRef.current = null;
    const current = generationRef.current;
    const valid = () => mountedRef.current && generationRef.current === current;
    phaseRef.current = "sending";
    setRecording(false);
    setSending(true);
    try {
      const { uri, durationSeconds } = await recorder.stop();
      if (!valid()) return;
      await postPttMessage(ticketId, uri, durationSeconds);
      if (!valid()) return;
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      if (valid()) await load();
    } catch (e) {
      if (valid()) Alert.alert(t("common.error"), e instanceof Error ? e.message : t("foremanHome.pttSendFailed"));
    } finally {
      await recorder.dispose();
      if (valid()) { phaseRef.current = "idle"; setSending(false); }
    }
  };

  const playMessage = async (msg: Comment) => {
    const url = msg.attachments?.[0];
    if (!url) return;
    setPlayingId(msg.id);
    try {
      await playPttUri(pttAttachmentPlayUri(url));
    } catch {
      Alert.alert(t("foremanHome.pttPlayFailed"));
    } finally {
      setPlayingId(null);
    }
  };

  return (
    <View style={[styles.panel, { borderColor: colors.border, backgroundColor: colors.card }]}>
      <Text style={[styles.ticketLabel, { color: colors.foreground }]}>
        {ticketLabel}
      </Text>
      <Text style={[styles.hint, { color: colors.mutedForeground }]}>
        {t("foremanHome.pttHoldHint")}
      </Text>

      <Pressable
        onPressIn={() => void onPressIn()}
        onPressOut={() => void onPressOut()}
        disabled={sending || !appForegrounded}
        style={({ pressed }) => [
          styles.pttButton,
          {
            backgroundColor: recording ? "#dc2626" : brand.primary,
            opacity: pressed || sending ? 0.85 : 1,
            transform: [{ scale: recording ? 1.06 : 1 }],
          },
        ]}
        testID="button-ptt-hold"
        accessibilityRole="button"
        accessibilityLabel={t("foremanHome.pttHoldA11y")}
      >
        {sending ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <>
            <Feather name="mic" size={32} color="#fff" />
            <Text style={styles.pttLabel}>
              {recording ? t("foremanHome.pttRecording") : t("foremanHome.pttHold")}
            </Text>
          </>
        )}
      </Pressable>

      <View style={styles.threadHeader}>
        <Text style={[styles.threadTitle, { color: colors.foreground }]}>
          {t("foremanHome.pttRecent")}
        </Text>
        <LayeredPillButton
          height={32}
          onPress={() => void load()}
          style={styles.refreshPill}
          testID="button-ptt-refresh"
        >
          <Feather name="refresh-cw" size={14} color="#fff" />
        </LayeredPillButton>
      </View>

      {loading ? (
        <ActivityIndicator color={brand.primary} style={{ marginVertical: 12 }} />
      ) : messages.length === 0 ? (
        <Text style={[styles.empty, { color: colors.mutedForeground }]}>
          {t("foremanHome.pttEmpty")}
        </Text>
      ) : (
        <ScrollView style={styles.thread} nestedScrollEnabled>
          {messages.map((msg) => (
            <Pressable
              key={msg.id}
              onPress={() => void playMessage(msg)}
              style={[styles.msgRow, { borderColor: colors.border }]}
              testID={`ptt-message-${msg.id}`}
            >
              <View
                style={[
                  styles.playCircle,
                  { backgroundColor: `${brand.primary}33` },
                ]}
              >
                {playingId === msg.id ? (
                  <ActivityIndicator size="small" color={brand.primary} />
                ) : (
                  <Feather name="play" size={16} color={brand.primary} />
                )}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.msgAuthor, { color: colors.foreground }]}>
                  {msg.createdByName ?? t("foremanHome.pttUnknownSender")}
                </Text>
                <Text style={[styles.msgMeta, { color: colors.mutedForeground }]}>
                  {pttDurationLabel(msg.content) ?? t("foremanHome.pttVoice")}
                </Text>
              </View>
            </Pressable>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    borderWidth: 1,
    borderRadius: 16,
    padding: 16,
    marginTop: 8,
  },
  ticketLabel: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 16,
  },
  hint: {
    fontFamily: "Inter_400Regular",
    fontSize: 13,
    marginTop: 4,
    marginBottom: 16,
  },
  pttButton: {
    alignSelf: "center",
    width: 140,
    height: 140,
    borderRadius: 70,
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    marginBottom: 16,
  },
  pttLabel: {
    color: "#fff",
    fontFamily: "Inter_600SemiBold",
    fontSize: 12,
    textAlign: "center",
  },
  threadHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  threadTitle: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 14,
  },
  refreshPill: {
    paddingHorizontal: 10,
    minWidth: 44,
  },
  thread: {
    maxHeight: 220,
  },
  empty: {
    fontFamily: "Inter_400Regular",
    fontSize: 13,
    textAlign: "center",
    paddingVertical: 12,
  },
  msgRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  playCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  msgAuthor: {
    fontFamily: "Inter_500Medium",
    fontSize: 14,
  },
  msgMeta: {
    fontFamily: "Inter_400Regular",
    fontSize: 12,
    marginTop: 2,
  },
});
