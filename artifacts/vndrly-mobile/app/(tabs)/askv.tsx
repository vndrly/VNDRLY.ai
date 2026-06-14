import { Feather } from "@expo/vector-icons";
import { useFocusEffect } from "expo-router";
import React, { useCallback, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
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
import InPageHeader from "@/components/InPageHeader";
import LayeredPillButton from "@/components/LayeredPillButton";
import { useAuth } from "@/hooks/use-auth";
import { useAssistant } from "@/hooks/use-assistant";
import { useBrand } from "@/hooks/use-brand";
import { useColors } from "@/hooks/useColors";
import { quickActionsForUser } from "@/lib/assistant-quick-actions";
import { isForemanEmployeeUser } from "@/lib/mobile-viewer";
import { useScreenTopPadding } from "@/lib/screen-insets";
import { SCREEN_SUBTITLE_TEXT, SCREEN_TITLE_TEXT } from "@/lib/pill-doctrine";

export default function AskVScreen() {
  const colors = useColors();
  const brand = useBrand();
  const { t } = useTranslation();
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  const topPadding = useScreenTopPadding();
  const scrollRef = useRef<ScrollView>(null);
  const [draft, setDraft] = useState("");

  const {
    messages,
    streaming,
    activeTool,
    error,
    send,
    clear,
    startNew,
    loadLatest,
  } = useAssistant();

  useFocusEffect(
    useCallback(() => {
      void loadLatest();
    }, [loadLatest]),
  );

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

  const onSend = () => {
    const text = draft.trim();
    if (!text) return;
    setDraft("");
    void send(text);
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

  return (
    <KeyboardAvoidingView
      style={[styles.flex, { backgroundColor: colors.background }]}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={Platform.OS === "ios" ? 88 : 0}
    >
      <View style={[styles.headerWrap, { paddingTop: topPadding }]}>
        <InPageHeader
          title={t("askv.title")}
          hideBack
          right={<ActiveOrgIndicator />}
          testID="askv-header"
        />
        <Text style={[styles.subtitle, { color: colors.mutedForeground }, SCREEN_SUBTITLE_TEXT]}>
          {t("askv.subtitle")}
        </Text>
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
            {greeting}
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

        {messages.map((m) => (
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
              <AssistantMarkdown text={m.content || (m.pending ? "…" : "")} />
            ) : (
              <Text style={[styles.userText, { color: "#ffffff" }]}>{m.content}</Text>
            )}
          </View>
        ))}

        {error ? (
          <Text style={[styles.errorText, { color: "#dc2626" }]}>
            {error.startsWith("askv.") ? t(error) : error}
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
        <View style={styles.composerActions}>
          <Pressable
            onPress={() => startNew()}
            disabled={streaming}
            hitSlop={8}
            testID="askv-new-chat"
          >
            <Feather name="plus-circle" size={22} color={colors.mutedForeground} />
          </Pressable>
          <Pressable
            onPress={onClear}
            disabled={streaming || messages.length === 0}
            hitSlop={8}
            testID="askv-clear-chat"
          >
            <Feather name="trash-2" size={20} color={colors.mutedForeground} />
          </Pressable>
        </View>
        <TextInput
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
          editable={!streaming}
          testID="askv-input"
        />
        <LayeredPillButton
          onPress={onSend}
          disabled={streaming || !draft.trim()}
          height={44}
          style={styles.sendBtn}
          testID="askv-send"
        >
          <Feather name="send" size={16} color="#ffffff" />
          <Text style={styles.sendText}>{t("askv.send")}</Text>
        </LayeredPillButton>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  headerWrap: { paddingHorizontal: 16 },
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
  errorText: { fontSize: 13, lineHeight: 18 },
  composer: {
    borderTopWidth: 1,
    paddingHorizontal: 12,
    paddingTop: 10,
    gap: 8,
  },
  composerActions: { flexDirection: "row", gap: 16, paddingHorizontal: 4 },
  input: {
    minHeight: 44,
    maxHeight: 120,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    fontFamily: "Inter_400Regular",
  },
  sendBtn: { alignSelf: "flex-end", minWidth: 100 },
  sendText: { color: "#ffffff", fontFamily: "Inter_600SemiBold", fontSize: 14 },
});
