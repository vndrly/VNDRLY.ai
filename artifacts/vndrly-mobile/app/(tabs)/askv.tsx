import { Feather } from "@expo/vector-icons";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import ActiveOrgIndicator from "@/components/ActiveOrgIndicator";
import AssistantMarkdown from "@/components/AssistantMarkdown";
import AssistantSendToModal, {
  type AssistantShareContext,
} from "@/components/AssistantSendToModal";
import InPageHeader from "@/components/InPageHeader";
import LayeredPillButton from "@/components/LayeredPillButton";
import { useAskVVoiceSession } from "@/hooks/use-askv-voice-session";
import { useAskVRecording } from "@/hooks/use-askv-recording";
import { useAuth } from "@/hooks/use-auth";
import {
  type AssistantMessage,
} from "@/hooks/use-assistant";
import { useBrand } from "@/hooks/use-brand";
import { useColors } from "@/hooks/useColors";
import { quickActionsForUser } from "@/lib/assistant-quick-actions";
import { isAskVSpeaking, speakAskV, stopAskVSpeech } from "@/lib/askv-speech";
import { readAskVTextOnly, writeAskVTextOnly } from "@/lib/askvVoicePreferences";
import { shareAssistantTranscript } from "@/lib/assistant-transcript";
import { readInitialAskVPromptParam } from "@/lib/assistant-ticket-actions";
import { PttMicPermissionError } from "@/lib/ptt";
import { isForemanEmployeeUser } from "@/lib/mobile-viewer";
import { buildAssistantShareMailtoUrl } from "@/lib/notification-mailto";
import { SCREEN_SUBTITLE_TEXT, SCREEN_TITLE_TEXT } from "@/lib/pill-doctrine";
import { registerAskVControl } from "@/lib/askv-client-tools";

function truncateSharePreview(text: string, max: number) {
  const trimmed = text.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 1)}…`;
}

function BubbleIconButton({
  name,
  onPress,
  disabled,
  pressed,
  color,
  activeColor,
  testID,
}: {
  name: React.ComponentProps<typeof Feather>["name"];
  onPress?: () => void;
  disabled?: boolean;
  pressed?: boolean;
  color: string;
  activeColor: string;
  testID?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      hitSlop={8}
      testID={testID}
      style={styles.bubbleIconBtn}
    >
      <Feather name={name} size={16} color={pressed ? activeColor : color} />
    </Pressable>
  );
}

export default function AskVScreen() {
  const colors = useColors();
  const brand = useBrand();
  const { t } = useTranslation();
  const { user } = useAuth();
  const voiceSession = useAskVVoiceSession();
  const sessionRef = useRef(voiceSession);
  const cancelRecordingRef = useRef(() => {});
  sessionRef.current = voiceSession;
  useFocusEffect(useCallback(() => {
    if (voiceSession.preferencesReady && !sessionRef.current.muted) {
      void voiceSession.startConversation("open AskV", "/askv");
    }
    return () => {
      stopAskVSpeech();
      cancelRecordingRef.current();
      if (!sessionRef.current.acrossVndrly) void sessionRef.current.stop();
    };
  }, [voiceSession.preferencesReady, voiceSession.startConversation]));
  const insets = useSafeAreaInsets();
  const scrollRef = useRef<ScrollView>(null);
  const params = useLocalSearchParams<{ prompt?: string | string[] }>();
  const autoPromptRef = useRef<string | null>(null);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<TextInput>(null);
  useEffect(() => registerAskVControl("/askv", "message", () => {
    if (!inputRef.current) return false; inputRef.current.focus(); return true;
  }), []);
  const [readAloud, setReadAloud] = useState(true);
  const readAloudRef = useRef(readAloud);
  readAloudRef.current = readAloud;
  const [speakingMessageId, setSpeakingMessageId] = useState<string | null>(null);
  const [feedbackPendingId, setFeedbackPendingId] = useState<number | null>(null);
  const [assistantShare, setAssistantShare] = useState<AssistantShareContext | null>(null);
  const askVUserId = typeof user?.id === "number" ? user.id : null;

  const {
    messages,
    streaming,
    activeTool,
    error,
    send,
    clear,
    startNew,
    loadLatest,
    submitFeedback,
  } = voiceSession.assistant;

  useEffect(() => voiceSession.subscribeReplies((text) => {
      if (!readAloudRef.current || sessionRef.current.muted) return;
      setSpeakingMessageId("auto");
      speakAskV(text);
  }), [voiceSession.subscribeReplies]);

  useEffect(() => {
    return () => {
      stopAskVSpeech();
      cancelRecordingRef.current();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (askVUserId == null) {
      setReadAloud(true);
      return;
    }
    void readAskVTextOnly(askVUserId).then((textOnly) => {
      if (!cancelled) setReadAloud(!textOnly);
    });
    return () => {
      cancelled = true;
    };
  }, [askVUserId]);

  useEffect(() => {
    if (!speakingMessageId) return;
    const timer = setInterval(() => {
      void isAskVSpeaking().then((speaking) => {
        if (!speaking) {
          setSpeakingMessageId(null);
        }
      });
    }, 400);
    return () => clearInterval(timer);
  }, [speakingMessageId]);

  useEffect(() => {
    void loadLatest();
  }, [loadLatest]);

  useEffect(() => {
    const initialPrompt = readInitialAskVPromptParam(params.prompt);
    if (!initialPrompt || autoPromptRef.current === initialPrompt) return;
    autoPromptRef.current = initialPrompt;
    void send(initialPrompt);
  }, [params.prompt, send]);

  const quickActions = useMemo(() => quickActionsForUser(user), [user]);

  const greeting = useMemo(() => {
    const name = user?.displayName?.split(" ")[0] ?? t("askv.greetingFallback");
    if (user?.role === "field_employee" && isForemanEmployeeUser(user)) {
      return t("askv.greetingForeman", { name });
    }
    if (user?.role === "partner") return t("askv.greetingPartner", { name });
    if (user?.role === "vendor") return t("askv.greetingVendor", { name });
    if (user?.role === "admin") return t("askv.greetingAdmin", { name });
    return t("askv.greetingField", { name });
  }, [user, t]);

  const userName = user?.displayName?.split(" ")[0] ?? t("askv.greetingFallback");

  const onSend = () => {
    const text = draft.trim();
    if (!text) return;
    setDraft("");
    void send(text);
  };

  const toggleReadAloud = () => {
    setReadAloud((prev) => {
      const next = !prev;
      if (!next) {
        stopAskVSpeech();
      }
      if (askVUserId != null) void writeAskVTextOnly(askVUserId, !next);
      return next;
    });
    setSpeakingMessageId(null);
  };

  const onSpeakMessage = (message: AssistantMessage) => {
    if (!message.content.trim() || voiceSession.muted) return;
    if (speakingMessageId === message.id) {
      stopAskVSpeech();
      setSpeakingMessageId(null);
      return;
    }
    void voiceSession.stop().then(() => {
      if (sessionRef.current.muted) return;
      setSpeakingMessageId(message.id);
      speakAskV(message.content);
    });
  };

  const recordingFallback = useAskVRecording({
    enabled: !voiceSession.muted && !streaming,
    beforeStart: async () => {
      await voiceSession.stop();
      stopAskVSpeech();
      setSpeakingMessageId(null);
    },
    onTranscript: send,
    onError: err => {
      if (err instanceof PttMicPermissionError) {
        Alert.alert(
          t("foremanHome.pttMicDeniedTitle"),
          t("foremanHome.pttMicDeniedBody"),
        );
        return;
      }
      Alert.alert(t("common.error"), t("askv.transcribeFailed"));
    },
  });
  cancelRecordingRef.current = recordingFallback.cancel;
  const { recording: voiceRecording, transcribing, pressIn: onVoicePressIn, pressOut: onVoicePressOut } = recordingFallback;

  const onClear = () => {
    Alert.alert(t("askv.clearTitle"), t("askv.clearBody"), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("askv.clearConfirm"),
        style: "destructive",
        onPress: () => void clear(),
      },
    ]);
  };

  const onExport = () => {
    void shareAssistantTranscript(messages, userName, t).catch(() => {
      Alert.alert(t("askv.transcriptErrorTitle"), t("askv.transcriptShareUnavailable"));
    });
  };

  const handleFeedback = async (
    messageId: number,
    rating: "helpful" | "unhelpful",
  ) => {
    if (feedbackPendingId != null) return;
    setFeedbackPendingId(messageId);
    try {
      await submitFeedback(messageId, rating);
    } finally {
      setFeedbackPendingId(null);
    }
  };

  const resolveAssistantShareParts = (messageIndex: number, message: AssistantMessage) => {
    let priorQuestion = t("askv.sharedAnswerFallback");
    for (let i = messageIndex - 1; i >= 0; i -= 1) {
      const prior = messages[i];
      if (prior?.role === "user" && prior.content.trim()) {
        priorQuestion = prior.content.trim();
        break;
      }
    }
    return {
      question: priorQuestion,
      answer: message.content.trim(),
      pagePath: "/mobile/askv",
      previewTitle: truncateSharePreview(`AskV — ${priorQuestion}`, 200),
      previewBody: truncateSharePreview(message.content, 500),
    };
  };

  const openSendToForMessage = (messageIndex: number, message: AssistantMessage) => {
    if (message.serverId == null || !message.content.trim()) return;
    const parts = resolveAssistantShareParts(messageIndex, message);
    setAssistantShare({
      messageId: message.serverId,
      previewTitle: parts.previewTitle,
      previewBody: parts.previewBody,
      ticketId: null,
      pagePath: parts.pagePath,
    });
  };

  const openMailto = async (messageIndex: number, message: AssistantMessage) => {
    const url = buildAssistantShareMailtoUrl({
      ...resolveAssistantShareParts(messageIndex, message),
      typeLabel: t("notifications.sendToAskVPreviewLabel"),
    });
    try {
      const canOpen = await Linking.canOpenURL(url);
      if (!canOpen) {
        Alert.alert(t("common.error"), t("notifications.shareUnavailable"));
        return;
      }
      await Linking.openURL(url);
    } catch {
      Alert.alert(t("common.error"), t("notifications.shareUnavailable"));
    }
  };

  const fallbackAvailable = ["stopped", "error", "interrupted"].includes(voiceSession.state);
  const voiceStatusLabel = t(`askv.voiceState.${voiceSession.muted ? "muted" : voiceSession.state}`);

  const headerIcons = (
    <View style={styles.headerIcons}>
      <Pressable
        onPress={() => { cancelRecordingRef.current(); voiceSession.setMuted(!voiceSession.muted); }}
        accessibilityLabel={t(voiceSession.muted ? "askv.unmute" : "askv.mute")}
        hitSlop={8}
        testID="askv-mute"
      >
        <Feather
          name={voiceSession.muted ? "mic-off" : "mic"}
          size={18}
          color={voiceSession.muted ? colors.mutedForeground : brand.primary}
        />
      </Pressable>
      <Pressable
        onPress={toggleReadAloud}
        hitSlop={8}
        testID="askv-read-aloud"
      >
        <Feather
          name={readAloud ? "volume-2" : "volume-x"}
          size={18}
          color={readAloud ? brand.primary : colors.mutedForeground}
        />
      </Pressable>
      {messages.length > 0 ? (
        <>
          <Pressable
            onPress={() => startNew()}
            disabled={streaming}
            hitSlop={8}
            testID="askv-new-chat"
          >
            <Feather name="plus" size={18} color={colors.mutedForeground} />
          </Pressable>
          <Pressable
            onPress={onExport}
            disabled={streaming}
            hitSlop={8}
            testID="askv-download-transcript"
          >
            <Feather name="download" size={18} color={colors.mutedForeground} />
          </Pressable>
          <Pressable
            onPress={onClear}
            disabled={streaming || messages.length === 0}
            hitSlop={8}
            testID="askv-clear-chat"
          >
            <Feather name="trash-2" size={18} color={colors.mutedForeground} />
          </Pressable>
        </>
      ) : null}
      <Pressable
        onPress={() => router.push("/(tabs)" as never)}
        hitSlop={8}
        testID="askv-close"
      >
        <Feather name="x" size={18} color={colors.mutedForeground} />
      </Pressable>
      <ActiveOrgIndicator />
    </View>
  );

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={Platform.OS === "ios" ? 88 : 0}
    >
      <View style={styles.headerWrap}>
        <InPageHeader
          title={t("askv.title")}
          onBack={() => router.push("/(tabs)" as never)}
          right={headerIcons}
          testID="askv-header"
        />
        <Text style={[styles.subtitle, { color: colors.mutedForeground }, SCREEN_SUBTITLE_TEXT]}>
          {t("askv.subtitle")}
        </Text>
        {voiceStatusLabel ? (
          <Text testID="askv-status-indicator" style={[styles.subtitle, { color: brand.primary }]}>
            {voiceStatusLabel}
          </Text>
        ) : null}
        <Pressable
          accessibilityRole="switch"
          accessibilityState={{ checked: voiceSession.acrossVndrly }}
          onPress={() => voiceSession.setAcrossVndrly(!voiceSession.acrossVndrly)}
          testID="askv-across-vndrly"
        >
          <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
            {t(voiceSession.acrossVndrly ? "askv.acrossOn" : "askv.acrossOff")}
          </Text>
        </Pressable>
        {voiceSession.acrossVndrly && !voiceSession.wakeSupported ? (
          <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>{t("askv.wakeUnavailable")}</Text>
        ) : null}
      </View>

      <ScrollView
        ref={scrollRef}
        style={styles.flex}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
      >
        <View
          style={[
            styles.greetingCard,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
        >
          <View style={styles.greetingRow}>
            <Feather name="zap" size={20} color={brand.primary} />
            <Text style={[styles.greetingTitle, { color: colors.foreground }, SCREEN_TITLE_TEXT]}>
              AskV
            </Text>
          </View>
          <Text style={[styles.greetingBody, { color: colors.mutedForeground }]}>
            {voiceSession.greeting ?? greeting}
          </Text>
        </View>

        {messages.length === 0 && quickActions.length > 0 ? (
          <View style={styles.chips}>
            <Text style={[styles.chipsLabel, { color: colors.mutedForeground }]}>
              {t("askv.quickActionsLabel")}
            </Text>
            {quickActions.map((chip) => (
              <Pressable
                key={chip.labelKey}
                onPress={() => void send(chip.prompt)}
                disabled={streaming}
                style={[
                  styles.chip,
                  { borderColor: colors.border, backgroundColor: colors.card },
                ]}
                testID={`askv-chip-${chip.labelKey}`}
              >
                <Text style={[styles.chipText, { color: colors.foreground }]}>
                  {t(chip.labelKey)}
                </Text>
              </Pressable>
            ))}
          </View>
        ) : null}

        {messages.map((m, messageIndex) => (
          <View
            key={m.id}
            style={[
              styles.bubble,
              m.role === "user" ? styles.userBubble : styles.assistantBubble,
              {
                backgroundColor:
                  m.role === "user" ? brand.primary : colors.card,
                borderColor: colors.border,
              },
            ]}
            testID={`askv-msg-${m.role}`}
          >
            {m.role === "assistant" && m.pending && !m.content ? (
              <View style={styles.thinkingRow}>
                <ActivityIndicator size="small" color={colors.primary} />
                <Text style={{ color: colors.mutedForeground, marginLeft: 8 }}>
                  {activeTool
                    ? t("askv.usingTool", { tool: activeTool })
                    : t("askv.thinking")}
                </Text>
              </View>
            ) : m.role === "assistant" ? (
              <>
                <AssistantMarkdown text={m.content || (m.pending ? "…" : "")} />
                {!m.pending &&
                  m.serverId != null &&
                  m.content.trim().length > 0 && (
                    <View
                      style={[styles.messageActions, { borderTopColor: colors.border }]}
                      testID={`askv-msg-feedback-${m.serverId}`}
                    >
                      <BubbleIconButton
                        name={speakingMessageId === m.id ? "square" : "volume-2"}
                        onPress={() => onSpeakMessage(m)}
                        color={colors.mutedForeground}
                        activeColor={brand.primary}
                        pressed={speakingMessageId === m.id}
                        testID={`askv-speak-${m.serverId ?? m.id}`}
                      />
                      <BubbleIconButton
                        name="thumbs-up"
                        onPress={() => void handleFeedback(m.serverId!, "helpful")}
                        disabled={feedbackPendingId != null}
                        pressed={m.feedbackRating === "helpful"}
                        color={colors.mutedForeground}
                        activeColor={brand.primary}
                        testID={`askv-feedback-helpful-${m.serverId}`}
                      />
                      <BubbleIconButton
                        name="thumbs-down"
                        onPress={() => void handleFeedback(m.serverId!, "unhelpful")}
                        disabled={feedbackPendingId != null}
                        pressed={m.feedbackRating === "unhelpful"}
                        color={colors.mutedForeground}
                        activeColor={brand.primary}
                        testID={`askv-feedback-unhelpful-${m.serverId}`}
                      />
                      <BubbleIconButton
                        name="send"
                        onPress={() => openSendToForMessage(messageIndex, m)}
                        color={colors.mutedForeground}
                        activeColor={brand.primary}
                        testID={`askv-send-to-${m.serverId}`}
                      />
                      <BubbleIconButton
                        name="mail"
                        onPress={() => void openMailto(messageIndex, m)}
                        color={colors.mutedForeground}
                        activeColor={brand.primary}
                        testID={`askv-share-email-${m.serverId}`}
                      />
                    </View>
                  )}
              </>
            ) : (
              <Text style={[styles.userText, { color: "#ffffff" }]}>{m.content}</Text>
            )}
          </View>
        ))}

        {error || voiceSession.error ? (
          <Text style={[styles.errorText, { color: "#dc2626" }]}>
            {t(error ?? voiceSession.error ?? "askv.errorGeneric", { defaultValue: t("askv.voiceFailed") })}
          </Text>
        ) : null}
        {fallbackAvailable ? (
          <Text
            style={[styles.handsFreeStatus, { color: colors.mutedForeground }]}
            testID="askv-recording-fallback"
          >
            {t("askv.recordingFallback")}
          </Text>
        ) : null}
      </ScrollView>

      <View
        style={[
          styles.composer,
          {
            borderTopColor: colors.border,
            backgroundColor: colors.background,
            paddingBottom: Math.max(insets.bottom, 8),
          },
        ]}
      >
        <View style={styles.composerRow}>
          <Pressable
            onPressIn={onVoicePressIn}
            onPressOut={onVoicePressOut}
            disabled={streaming || transcribing || voiceSession.muted || !fallbackAvailable}
            accessibilityLabel={t("askv.recordingFallback")}
            style={[
              styles.micBtn,
              {
                borderColor: colors.border,
                backgroundColor: voiceRecording ? brand.primary : colors.card,
              },
            ]}
            testID="askv-voice"
          >
            {transcribing ? (
              <ActivityIndicator size="small" color={brand.primary} />
            ) : (
              <Feather
                name="mic"
                size={18}
                color={voiceRecording ? "#ffffff" : colors.foreground}
              />
            )}
          </Pressable>
          <TextInput
            ref={inputRef}
            value={draft}
            onChangeText={setDraft}
            placeholder={t("askv.inputPlaceholder")}
            placeholderTextColor={colors.mutedForeground}
            multiline
            style={[
              styles.input,
              {
                color: colors.foreground,
                borderColor: colors.border,
                backgroundColor: colors.card,
              },
            ]}
            editable={!streaming && !transcribing}
            testID="askv-input"
          />
          <LayeredPillButton
            onPress={onSend}
            disabled={streaming || !draft.trim() || transcribing}
            height={44}
            style={styles.sendBtn}
            testID="askv-send"
          >
            {streaming ? (
              <ActivityIndicator size="small" color="#ffffff" />
            ) : (
              <Feather name="message-circle" size={18} color="#ffffff" />
            )}
          </LayeredPillButton>
        </View>
      </View>

      <AssistantSendToModal
        visible={assistantShare !== null}
        share={assistantShare}
        onClose={() => setAssistantShare(null)}
      />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  headerWrap: { paddingHorizontal: 16 },
  headerIcons: { flexDirection: "row", alignItems: "center", gap: 12 },
  subtitle: { fontSize: 13, lineHeight: 18, marginTop: -4, marginBottom: 8 },
  scrollContent: { paddingHorizontal: 16, paddingBottom: 16, gap: 12 },
  greetingCard: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    gap: 8,
  },
  greetingRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  greetingTitle: { fontSize: 18 },
  greetingBody: { fontSize: 14, lineHeight: 20 },
  chips: { gap: 8 },
  chipsLabel: { fontSize: 12, fontFamily: "Inter_500Medium", textTransform: "uppercase" },
  chip: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  chipText: { fontSize: 14, lineHeight: 20 },
  bubble: {
    borderRadius: 12,
    padding: 12,
    maxWidth: "92%",
  },
  userBubble: { alignSelf: "flex-end" },
  assistantBubble: {
    alignSelf: "flex-start",
    borderWidth: 1,
    maxWidth: "96%",
  },
  userText: { fontSize: 15, lineHeight: 22, fontFamily: "Inter_400Regular" },
  thinkingRow: { flexDirection: "row", alignItems: "center" },
  messageActions: {
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 2,
  },
  bubbleIconBtn: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
  },
  errorText: { fontSize: 13, lineHeight: 18 },
  handsFreeStatus: {
    fontSize: 12,
    lineHeight: 18,
    fontFamily: "Inter_500Medium",
    textAlign: "center",
  },
  composer: {
    borderTopWidth: 1,
    paddingHorizontal: 12,
    paddingTop: 10,
  },
  composerRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 8,
  },
  input: {
    flex: 1,
    minHeight: 44,
    maxHeight: 120,
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 15,
    fontFamily: "Inter_400Regular",
  },
  sendBtn: { minWidth: 44, width: 44, paddingHorizontal: 0 },
  micBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
});
