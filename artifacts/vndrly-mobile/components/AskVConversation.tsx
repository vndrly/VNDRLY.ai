import { ModalPressable as Pressable, ModalTextInput as TextInput } from "@/components/ModalDraft";
import { pageBack } from "@/lib/page-back";
import AuthedImage from "@/components/AuthedImage";
import { getApiBase } from "@/lib/api";
import { askVPhotoPaths } from "@/lib/askv-photo-paths";
import * as ImagePicker from "expo-image-picker";
import { uploadAsset } from "@/lib/photos";
import { captureAuthScope, isAuthScopeCurrent } from "@/lib/auth";
import DismissibleModal from "@/components/DismissibleModal";
import { Feather } from "@expo/vector-icons";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Linking,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  type TextStyle,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import ActiveOrgIndicator from "@/components/ActiveOrgIndicator";
import AskVVoiceIndicator from "@/components/AskVVoiceIndicator";
import AssistantMarkdown from "@/components/AssistantMarkdown";
import CooperativeVContext from "@/components/CooperativeVContext";
import AssistantSendToModal, {
  type AssistantShareContext,
} from "@/components/AssistantSendToModal";
import LayeredPillButton from "@/components/LayeredPillButton";
import BrandTitleRow from "@/components/BrandTitleRow";
import SphereBackButton from "@/components/SphereBackButton";
import { useAskVVoiceSession } from "@/hooks/use-askv-voice-session";
import { useAuth } from "@/hooks/use-auth";
import {
  type AssistantMessage,
} from "@/hooks/use-assistant";
import { useBrand } from "@/hooks/use-brand";
import WorkHubMiniCardButton from "@/components/work-hub/WorkHubMiniCardButton";
import { useColors } from "@/hooks/useColors";
import {
  rankQuickActions,
  readQuickActionUsage,
  recordQuickActionUsage,
  type QuickActionUsage,
} from "@/lib/askv-quick-action-usage";
import { quickActionsForUser } from "@/lib/assistant-quick-actions";
import { isAskVSpeaking, speakAskV, stopAskVSpeech } from "@/lib/askv-speech";
import { readAskVTextOnly } from "@/lib/askvVoicePreferences";
import { shareAssistantTranscript } from "@/lib/assistant-transcript";
import { readInitialAskVPromptParam } from "@/lib/assistant-ticket-actions";
import { isForemanEmployeeUser } from "@/lib/mobile-viewer";
import { buildAssistantShareMailtoUrl } from "@/lib/notification-mailto";
import { SCREEN_SUBTITLE_TEXT } from "@/lib/pill-doctrine";
import { registerAskVControlAliases } from "@/lib/askv-client-tools";
import { nativeAskVContextPath } from "@/lib/askv-context-path";
import { iosPageLayout } from "@/lib/ios-page-layout";
import { screenTopPadding } from "@/lib/screen-insets";
import { shouldOfferAskVVisualResult } from "@workspace/api-client-react/askv-visual-results";
import AskVRevenueChart from "@/components/AskVRevenueChart";

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

export default function AskVScreen({ embedded = false, onClose }: { embedded?: boolean; onClose?: () => void } = {}) {
  const colors = useColors();
  const brand = useBrand();
  const { t } = useTranslation();
  const { user } = useAuth();
  const voiceSession = useAskVVoiceSession();
  const sessionRef = useRef(voiceSession);
  sessionRef.current = voiceSession;
  useFocusEffect(useCallback(() => {
    if (embedded) return;
    if (voiceSession.preferencesReady) {
      if (!sessionRef.current.acrossVndrly) voiceSession.setAcrossVndrly(true);
      if (!sessionRef.current.muted) {
        void voiceSession.startConversation("open AskV", nativeAskVContextPath("/askv"));
      }
    }
    return () => {
      stopAskVSpeech();
      if (!sessionRef.current.acrossVndrly) void sessionRef.current.stop();
    };
  }, [embedded, voiceSession.preferencesReady, voiceSession.setAcrossVndrly, voiceSession.startConversation]));
  const insets = useSafeAreaInsets();
  const scrollRef = useRef<ScrollView>(null);
  const params = useLocalSearchParams<{ prompt?: string | string[]; taskId?: string }>();
  const autoPromptRef = useRef<string | null>(null);
  const [draft, setDraft] = useState("");
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [addMenu, setAddMenu] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [attachments, setAttachments] = useState<string[]>([]);
  useEffect(() => { setDraft(""); setAttachments([]); }, [user?.id, user?.activeMembershipId]);
  const attachPhoto = async (camera: boolean) => {
    setAddMenu(false);
    const scope = captureAuthScope();
    setUploading(true);
    try {
      const permission = camera ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!isAuthScopeCurrent(scope)) return;
      if (permission.status !== "granted") throw new Error(t("askv.photoPermission"));
      const picked = camera ? await ImagePicker.launchCameraAsync({ quality: 0.8 }) : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.8 });
      if (picked.canceled || !picked.assets?.[0] || !isAuthScopeCurrent(scope)) return;
      const uploaded = await uploadAsset(picked.assets[0], 10 * 1024 * 1024, undefined, scope);
      if (isAuthScopeCurrent(scope)) setAttachments(previous => [...previous, uploaded.objectPath]);
    } catch (error) {
      if (isAuthScopeCurrent(scope)) Alert.alert(t("askv.photoUpload"), error instanceof Error ? error.message : t("askv.errorGeneric"));
    } finally { setUploading(false); }
  };
  const inputRef = useRef<TextInput>(null);
  useEffect(() => registerAskVControlAliases(["/askv", "/work-hub/askv"], "message", () => {
    if (!inputRef.current) return false; inputRef.current.focus(); return true;
  }), []);
  const [readAloud, setReadAloud] = useState(true);
  const readAloudRef = useRef(readAloud);
  readAloudRef.current = readAloud;
  const [speakingMessageId, setSpeakingMessageId] = useState<string | null>(null);
  const [feedbackPendingId, setFeedbackPendingId] = useState<number | null>(null);
  const [assistantShare, setAssistantShare] = useState<AssistantShareContext | null>(null);
  const [visualResult, setVisualResult] = useState<AssistantMessage | null>(null);
  const [quickActionUsage, setQuickActionUsage] = useState<QuickActionUsage>({});
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
      if (embedded || !readAloudRef.current || sessionRef.current.muted) return;
      setSpeakingMessageId("auto");
      speakAskV(text);
  }), [embedded, voiceSession.subscribeReplies]);

  useEffect(() => {
    return () => {
      if (!embedded) stopAskVSpeech();
    };
  }, [embedded]);

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
    if (!embedded) void loadLatest();
  }, [loadLatest, embedded]);

  useEffect(() => {
    if (embedded) return;
    const initialPrompt = readInitialAskVPromptParam(params.prompt);
    if (!initialPrompt || autoPromptRef.current === initialPrompt) return;
    autoPromptRef.current = initialPrompt;
    void send(initialPrompt);
  }, [embedded, params.prompt, send]);

  useEffect(() => {
    let live = true;
    if (askVUserId == null) {
      setQuickActionUsage({});
      return () => { live = false; };
    }
    void readQuickActionUsage(askVUserId, user?.activeMembershipId ?? null).then((usage) => {
      if (live) setQuickActionUsage(usage);
    });
    return () => { live = false; };
  }, [askVUserId, user?.activeMembershipId]);

  const quickActions = useMemo(
    () => rankQuickActions(quickActionsForUser(user), quickActionUsage).slice(0, 3),
    [quickActionUsage, user],
  );

  const runQuickAction = (labelKey: string, prompt: string) => {
    if (askVUserId != null) {
      setQuickActionUsage((current) => ({ ...current, [labelKey]: (current[labelKey] ?? 0) + 1 }));
      void recordQuickActionUsage(askVUserId, user?.activeMembershipId ?? null, labelKey);
    }
    void send(prompt);
  };

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
    const text = [draft.trim(), ...attachments.map((path, index) => `[${t("askv.photoUpload")} ${index + 1}](${path})`)].filter(Boolean).join("\n");
    if (!text || uploading) return;
    setDraft("");
    setAttachments([]);
    void send(text);
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

  const headerIcons = (
    <View style={[styles.headerIcons, iosPageLayout && styles.compactHeaderIcons]}>
      {messages.length > 0 ? (
        <>
          <Pressable
            onPress={() => startNew()}
            disabled={streaming}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={t("askv.newChat")}
            style={iosPageLayout ? styles.headerAction : undefined}
            testID="askv-new-chat"
          >
            <Feather name="plus" size={18} color={colors.mutedForeground} />
          </Pressable>
          <Pressable
            onPress={onExport}
            disabled={streaming}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={t("askv.downloadTranscript")}
            style={iosPageLayout ? styles.headerAction : undefined}
            testID="askv-download-transcript"
          >
            <Feather name="download" size={18} color={colors.mutedForeground} />
          </Pressable>
          <Pressable
            onPress={onClear}
            disabled={streaming || messages.length === 0}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={t("askv.clearTitle")}
            style={iosPageLayout ? styles.headerAction : undefined}
            testID="askv-clear-chat"
          >
            <Feather name="trash-2" size={18} color={colors.mutedForeground} />
          </Pressable>
        </>
      ) : null}
      {!iosPageLayout && <ActiveOrgIndicator />}
    </View>
  );

  return (
    <KeyboardAvoidingView
      testID="askv-screen"
      style={[styles.flex, iosPageLayout && styles.compactScreen]}
      behavior={Platform.OS === "ios" && !embedded ? "padding" : undefined}
      keyboardVerticalOffset={Platform.OS === "ios" ? 88 : 0}
    >
      <View style={[styles.headerWrap, { paddingTop: iosPageLayout ? 4 : screenTopPadding(insets.top) + 20 }, iosPageLayout && styles.compactHeader]}>
        {!iosPageLayout && <BrandTitleRow
          subtitle="iOS Portal"
          logoTestId="askv-company-logo"
          platformLogoTestId="askv-vndrly-logo"
        />}
        <View style={styles.pageTitleRow} testID="askv-header">
          <View style={styles.pageTitleStart}>
            <SphereBackButton
              onPress={() => { if (embedded) onClose?.(); else pageBack(); }}
              size={40}
              testID="askv-page-back"
            />
            <Text numberOfLines={1} accessibilityRole="header" style={[styles.pageTitle, { color: colors.foreground }]}>
              {t("askv.title")}
            </Text>
          </View>
          {iosPageLayout ? headerIcons : <AskVVoiceIndicator inline />}
        </View>
        {!iosPageLayout && <View style={[styles.subtitleControlsRow, iosPageLayout && { marginTop: 0 }]}>
          <Text numberOfLines={iosPageLayout ? 1 : undefined} style={[styles.subtitle, styles.subtitleLineText, { color: colors.mutedForeground }, SCREEN_SUBTITLE_TEXT]}>
            {t(iosPageLayout ? "askv.compactSubtitle" : "askv.subtitle")}
          </Text>
          {!iosPageLayout && headerIcons}
        </View>}
      </View>

      <View testID="askv-chat-card" style={[styles.chatCard, { borderColor: brand.primary }, iosPageLayout && styles.compactChatCard]}>
        <ScrollView
          ref={scrollRef}
          style={styles.flex}
          testID="askv-conversation"
          contentContainerStyle={[styles.scrollContent, iosPageLayout && styles.compactConversation]}
          keyboardShouldPersistTaps="handled"
          onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
        >
          <CooperativeVContext key={voiceSession.assistant.contextEpoch ?? 0} taskId={embedded ? undefined : params.taskId} selectSavedTask={voiceSession.assistant.selectSavedTask} selectConnection={voiceSession.assistant.selectConnection} disabled={streaming} />
          {(!iosPageLayout || messages.length === 0) && <View
            style={[
              styles.greetingCard,
              { backgroundColor: colors.card, borderColor: brand.primary },
            ]}
          >
            <View style={styles.greetingContentRow}>
              <View style={styles.greetingIdentity}>
                <View style={styles.greetingAvatarFrame} testID="askv-greeting-avatar">
                  <Image
                    source={require("@/assets/images/next-steps-avatars.png")}
                    accessibilityLabel="V avatar"
                    style={styles.greetingAvatarSprite}
                  />
                  {brand.isOrgBranded && brand.logoSquareUrl ? (
                    <AuthedImage
                      uri={brand.logoSquareUrl}
                      accessibilityLabel={`${brand.name ?? "Company"} branded V avatar`}
                      resizeMode="contain"
                      style={[styles.greetingAvatarBadge, { borderColor: brand.primary }]}
                    />
                  ) : null}
                </View>
                <Text style={[styles.greetingBody, { color: colors.mutedForeground }]}>
                  {iosPageLayout ? t("askv.compactGreeting") : voiceSession.greeting ?? greeting}
                </Text>
              </View>
              {quickActions.length > 0 ? (
                <View style={styles.quickActionsColumn}>
                  <Text style={[styles.quickActionsLabel, { color: colors.mutedForeground }]}>
                    {t("askv.quickActionsLabel")}
                  </Text>
                  {quickActions.map((chip) => (
                    <WorkHubMiniCardButton
                      key={chip.labelKey}
                      onPress={() => runQuickAction(chip.labelKey, chip.prompt)}
                      disabled={streaming}
                      style={{ minHeight: 32, paddingVertical: 7, borderColor: brand.primary }}
                      testID={`askv-quick-action-${chip.labelKey}`}
                    >
                      <Text style={[styles.quickActionText, { color: colors.foreground }]} numberOfLines={1}>
                        {t(chip.labelKey)}
                      </Text>
                    </WorkHubMiniCardButton>
                  ))}
                </View>
              ) : null}
            </View>
          </View>}

          {messages.map((m, messageIndex) => (
            <View
              key={m.id}
              style={[
                styles.bubble,
                iosPageLayout && styles.compactBubble,
                m.role === "user" ? styles.userBubble : styles.assistantBubble,
                {
                  backgroundColor:
                    m.role === "user" ? brand.primary : "#303236",
                  borderColor: colors.border,
                },
              ]}
              testID={`askv-msg-${m.role}`}
            >
              {askVPhotoPaths(m.content).map(path => <Pressable key={path} accessibilityRole="button" accessibilityLabel={t("askv.photoUpload")} onPress={() => setPhotoPreview(path)}><AuthedImage uri={`${getApiBase()}/api/storage${path}`} style={{ width: 120, height: 90, borderRadius: 8 }} resizeMode="cover" fallback={<Text>{t("askv.photoUnavailable")}</Text>} /></Pressable>)}
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
                  {!m.pending && <AskVRevenueChart calls={m.toolCalls} color={brand.primary} />}
                  {m.providers?.length ? <Text style={{ color: colors.mutedForeground }}>{t("nativeCooperation.consulted", { providers: m.providers.join(", ") })}</Text> : null}
                  {m.confirmationReference && messageIndex === messages.length - 1 && !m.pending ? <View style={{ flexDirection: "row", gap: 8 }}>
                    <LayeredPillButton color={brand.primary} disabled={streaming} onPress={() => void send("Confirm", "ios_text", m.confirmationReference)} testID="askv-confirm"><Text>{t("gatekeeper.voiceConfirm")}</Text></LayeredPillButton>
                    <LayeredPillButton color={brand.primary} disabled={streaming} onPress={() => void send("Cancel", "ios_text", m.confirmationReference)} testID="askv-cancel"><Text>{t("common.cancel")}</Text></LayeredPillButton>
                  </View> : null}
                  {m.recovery ? <View style={{ gap: 6 }}>
                    {(["completed", "remaining", "needed"] as const).map(kind => m.recovery![kind].length ? <View key={kind}>
                      <Text style={{ color: colors.text, fontWeight: "700" }}>{t(`nativeCooperation.${kind}`)}</Text>
                      {m.recovery![kind].map((item, index) => <Text key={index} style={{ color: colors.text }}>{item}</Text>)}
                    </View> : null)}
                  </View> : null}
                  {!m.pending &&
                    m.serverId != null &&
                    m.content.trim().length > 0 && (
                      <View
                        style={[styles.messageActions, { borderTopColor: colors.border }]}
                        testID={`askv-msg-feedback-${m.serverId}`}
                      >
                        {shouldOfferAskVVisualResult(m.content) ? (
                          <BubbleIconButton
                            name="maximize-2"
                            onPress={() => setVisualResult(m)}
                            color={colors.mutedForeground}
                            activeColor={brand.primary}
                            testID={`askv-open-result-${m.serverId}`}
                          />
                        ) : null}
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
                <Text style={[styles.userText, { color: "#ffffff" }]}>{m.content.replace(/\[([^\]]*)\]\(\/objects\/[A-Za-z0-9/_-]+\)/g, "$1")}</Text>
              )}
            </View>
          ))}

          {error || voiceSession.error ? (
            <Text style={[styles.errorText, { color: "#dc2626" }]}>
              {t(error ?? voiceSession.error ?? "askv.errorGeneric", { defaultValue: t("askv.voiceFailed") })}
            </Text>
          ) : null}
        </ScrollView>

        <View
          testID="askv-composer"
          style={[
            styles.composer,
            {
              borderTopColor: colors.border,
              backgroundColor: "#3a3d42",
              paddingBottom: iosPageLayout ? 8 : Math.max(insets.bottom, 8),
            },
          ]}
        >
          {attachments.map((path, index) => <Pressable key={path} accessibilityRole="button" accessibilityLabel={t("askv.removePhoto")} onPress={() => setAttachments(items => items.filter(item => item !== path))}><Text style={{ color: brand.primary }}>{t("askv.photoUpload")} {index + 1} ×</Text></Pressable>)}
          <View style={[styles.composerRow, { borderWidth: 2, borderColor: brand.primary, borderRadius: 20, backgroundColor: "#303236", paddingHorizontal: 4 }]}>
            <Pressable accessibilityRole="button" accessibilityLabel={t("askv.addAttachment")} testID="askv-add" disabled={uploading || streaming} onPress={() => setAddMenu(value => !value)} style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center" }}><Feather name="plus" size={24} color={brand.primary} /></Pressable>
            <TextInput
              ref={inputRef}
              value={draft}
              onChangeText={setDraft}
              placeholder={t(iosPageLayout ? "askv.compactPlaceholder" : "askv.inputPlaceholder")}
              placeholderTextColor={colors.mutedForeground}
              multiline
              style={[
                styles.input,
                iosPageLayout && styles.compactInput,
                {
                  color: colors.foreground,
                  borderWidth: 0,
                  minHeight: 88,
                  paddingHorizontal: 10,
                  paddingBottom: 10,
                  maxHeight: 150,
                  backgroundColor: "transparent",
                },
                Platform.OS === "web" && ({ outlineStyle: "none" } as unknown as TextStyle),
              ]}
              editable={!streaming}
              testID="askv-input"
            />
            <Pressable accessibilityRole="button" accessibilityLabel={t("askv.sendMessage")} onPress={onSend} disabled={streaming || uploading || (!draft.trim() && !attachments.length)} testID="askv-send" style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center", opacity: streaming || uploading || (!draft.trim() && !attachments.length) ? 0.5 : 1 }}>
              {streaming || uploading ? <ActivityIndicator size="small" color={brand.primary} /> : <Feather name="arrow-up" size={24} color={brand.primary} />}
            </Pressable>
          </View>
          {!iosPageLayout && <Text style={styles.footerDisclaimer}>
            {t(iosPageLayout ? "askv.compactDisclaimer" : "askv.footerDisclaimer", { defaultValue: "Replies are AI-generated. Verify important details before acting on them. Help us improve AskV with feedback" })}{" "}
            {!iosPageLayout && <><Feather name="thumbs-up" size={11} color={brand.primary} />{" "}<Feather name="thumbs-down" size={11} color={brand.primary} /></>}
          </Text>}
        </View>
      </View>

      <DismissibleModal visible={photoPreview !== null} onRequestClose={() => setPhotoPreview(null)} dismissLabel="close" animationType="slide" presentationStyle="fullScreen">
        {photoPreview && <AuthedImage uri={`${getApiBase()}/api/storage${photoPreview}`} style={{ flex: 1, width: "100%" }} resizeMode="contain" fallback={<Text>{t("askv.photoUnavailable")}</Text>} />}
      </DismissibleModal>
      <DismissibleModal visible={addMenu} onRequestClose={() => setAddMenu(false)} dismissLabel="cancel" animationType="slide" presentationStyle="pageSheet">
        <View style={{ padding: 16, gap: 8 }}>
          {(["camera", "photos", "shiftNote", "reviewNotes", "calendar"] as const).map(action => <Pressable key={action} accessibilityRole="button" style={{ minHeight: 48, justifyContent: "center" }} onPress={() => {
            if (action === "calendar" || action === "shiftNote" || action === "reviewNotes") { setAddMenu(false); setDraft(t(action === "calendar" ? "askv.calendarPrompt" : action === "shiftNote" ? "askv.shiftNotePrompt" : "askv.reviewNotesPrompt")); inputRef.current?.focus(); }
            else void attachPhoto(action === "camera");
          }}><Text style={{ color: brand.primary, fontSize: 16 }}>{t(`askv.add${action}`)}</Text></Pressable>)}
        </View>
      </DismissibleModal>
      <AssistantSendToModal
        visible={assistantShare !== null}
        share={assistantShare}
        onClose={() => setAssistantShare(null)}
      />
      <DismissibleModal dismissLabel="close"
        visible={visualResult !== null}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setVisualResult(null)}
      >
        <View style={[styles.resultSurface, { backgroundColor: colors.background, paddingTop: Math.max(insets.top, 20) }]}>
          <View style={[styles.resultHeader, { borderBottomColor: colors.border }]}>
            <Text accessibilityRole="header" style={[styles.resultTitle, { color: colors.foreground }]}>
              {t("askv.resultsTitle")}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("askv.closeResults")}
              hitSlop={10}
              onPress={() => setVisualResult(null)}
              testID="askv-close-result"
            >
              <Feather name="x" size={24} color={colors.foreground} />
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={styles.resultContent}>
            <View style={[styles.resultCard, { backgroundColor: colors.card, borderColor: brand.primary }]}>
              <AssistantMarkdown text={visualResult?.content ?? ""} />
              <AskVRevenueChart calls={visualResult?.toolCalls} color={brand.primary} />
            </View>
          </ScrollView>
        </View>
      </DismissibleModal>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minHeight: 0 },
  compactScreen: { backgroundColor: "#3a3d42", overflow: "hidden" },
  compactHeader: { paddingHorizontal: 16, gap: 2, flexShrink: 0 },
  compactHeaderIcons: { gap: 0, flexShrink: 0 },
  headerAction: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  compactChatCard: { marginHorizontal: 12, marginTop: 8, marginBottom: 8 },
  compactConversation: { paddingHorizontal: 8, paddingTop: 8, paddingBottom: 8, gap: 8 },
  compactBubble: { padding: 10 },
  compactInput: { minHeight: 44, maxHeight: 96, paddingVertical: 8, borderRadius: 16 },
  headerWrap: { gap: 12, paddingHorizontal: 20 },
  pageTitleRow: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" },
  pageTitleStart: { alignItems: "center", flexDirection: "row", flexShrink: 1, gap: 8 },
  pageTitle: { flexShrink: 1, fontFamily: "Inter_700Bold", fontSize: 20 },
  headerIcons: { flexDirection: "row", alignItems: "center", gap: 12 },
  subtitleControlsRow: { alignItems: "center", flexDirection: "row", gap: 12, marginTop: -6 },
  subtitleLineText: { flex: 1, marginBottom: 0, marginTop: 0 },
  subtitle: { fontSize: 13, lineHeight: 18, marginTop: -4, marginBottom: 8 },
  scrollContent: { paddingHorizontal: 12, paddingTop: 12, paddingBottom: 16, gap: 12 },
  greetingCard: {
    borderWidth: 2,
    borderRadius: 12,
    padding: 14,
    gap: 8,
  },
  greetingContentRow: { alignItems: "stretch", flexDirection: "row", gap: 12 },
  greetingIdentity: { flex: 1, justifyContent: "center", minWidth: 0 },
  greetingAvatarFrame: { width: 63, height: 63, overflow: "hidden" },
  greetingAvatarSprite: { position: "absolute", width: 329, height: 219, left: -12, top: -31 },
  greetingAvatarBadge: { position: "absolute", left: 27, top: 33, width: 12, height: 12, borderWidth: 1, borderRadius: 2, backgroundColor: "#222" },
  greetingBody: { fontSize: 14, lineHeight: 20 },
  quickActionsColumn: { flex: 1.45, gap: 6, minWidth: 0 },
  quickActionsLabel: {
    fontSize: 10,
    fontFamily: "Inter_500Medium",
    textAlign: "right",
    textTransform: "uppercase",
  },
  quickActionText: { fontSize: 12, lineHeight: 16, textAlign: "center" },
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
  chatCard: {
    backgroundColor: "#242426",
    flex: 1,
    minHeight: 0,
    marginHorizontal: 20,
    marginVertical: 12,
    borderWidth: 2,
    borderRadius: 14,
    overflow: "hidden",
  },
  composer: {
    borderTopWidth: 1,
    paddingHorizontal: 12,
    paddingTop: 10,
  },
  composerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  input: {
    flex: 1,
    minHeight: 76,
    maxHeight: 160,
    borderWidth: 2,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 15,
    lineHeight: 20,
    fontFamily: "Inter_400Regular",
    textAlignVertical: "top",
  },
  footerDisclaimer: { marginTop: 8, fontSize: 10, fontStyle: "italic", color: "#d1d5db" },
  resultSurface: { flex: 1 },
  resultHeader: {
    alignItems: "center",
    borderBottomWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    paddingBottom: 14,
    paddingHorizontal: 20,
  },
  resultTitle: { fontFamily: "Inter_700Bold", fontSize: 20 },
  resultContent: { padding: 20 },
  resultCard: { borderRadius: 12, borderWidth: 2, padding: 16 },
});
