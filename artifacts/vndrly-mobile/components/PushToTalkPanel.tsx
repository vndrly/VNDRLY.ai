import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useFocusEffect } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ActivityIndicator,
  Alert,
  AppState,
  type AppStateStatus,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import LayeredPillButton from "@/components/LayeredPillButton";
import { useBrand } from "@/hooks/use-brand";
import { useColors } from "@/hooks/useColors";
import { apiFetch, getApiBase } from "@/lib/api";
import {
  createPttRecorder,
  isBackgroundAudioSessionError,
  isPttComment,
  playPttUri,
  postPttMessage,
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

function attachmentPlayUri(url: string): string {
  if (url.startsWith("http")) return url;
  const base = getApiBase().replace(/\/$/, "");
  if (url.startsWith("/api/storage/")) return `${base}${url}`;
  return url;
}

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

  useEffect(() => {
    const sub = AppState.addEventListener("change", (next: AppStateStatus) => {
      setAppForegrounded(next === "active");
    });
    return () => sub.remove();
  }, []);

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
      };
    }, []),
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
    return () => {
      void recorderRef.current?.dispose();
    };
  }, []);

  const onPressIn = async () => {
    if (sending || !appForegrounded) return;
    if (!micReady) {
      try {
        await warmUpPttSession();
        setMicReady(true);
      } catch (e) {
        if (e instanceof PttMicPermissionError) {
          Alert.alert(
            t("foremanHome.pttMicDeniedTitle"),
            t("foremanHome.pttMicDeniedBody"),
          );
        } else if (isBackgroundAudioSessionError(e)) {
          Alert.alert(
            t("foremanHome.pttNotReadyTitle"),
            t("foremanHome.pttNotReadyBody"),
          );
        } else {
          Alert.alert(
            t("foremanHome.pttMicDeniedTitle"),
            e instanceof Error ? e.message : t("foremanHome.pttMicDeniedBody"),
          );
        }
        return;
      }
    }
    try {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      const rec = await createPttRecorder();
      recorderRef.current = rec;
      await rec.start();
      setRecording(true);
    } catch (e) {
      if (e instanceof PttMicPermissionError) {
        Alert.alert(
          t("foremanHome.pttMicDeniedTitle"),
          t("foremanHome.pttMicDeniedBody"),
        );
      } else if (isBackgroundAudioSessionError(e)) {
        Alert.alert(
          t("foremanHome.pttNotReadyTitle"),
          t("foremanHome.pttNotReadyBody"),
        );
      } else {
        Alert.alert(
          t("foremanHome.pttMicDeniedTitle"),
          e instanceof Error ? e.message : t("foremanHome.pttMicDeniedBody"),
        );
      }
    }
  };

  const onPressOut = async () => {
    if (!recording || !recorderRef.current) return;
    setRecording(false);
    setSending(true);
    try {
      const { uri, durationSeconds } = await recorderRef.current.stop();
      await postPttMessage(ticketId, uri, durationSeconds);
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      await load();
    } catch (e) {
      Alert.alert(
        t("common.error"),
        e instanceof Error ? e.message : t("foremanHome.pttSendFailed"),
      );
    } finally {
      setSending(false);
      await recorderRef.current?.dispose();
      recorderRef.current = null;
    }
  };

  const playMessage = async (msg: Comment) => {
    const url = msg.attachments?.[0];
    if (!url) return;
    setPlayingId(msg.id);
    try {
      await playPttUri(attachmentPlayUri(url));
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
        <LayeredPillButton height={32} onPress={() => void load()} testID="button-ptt-refresh">
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
