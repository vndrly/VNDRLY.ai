import { router, useLocalSearchParams } from "expo-router";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Alert, ScrollView, Switch, Text, TextInput, TouchableOpacity, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useColors } from "@/hooks/useColors";
import { apiFetch } from "@/lib/api";
import InPageHeader from "@/components/InPageHeader";
import LayeredPillButton from "@/components/LayeredPillButton";
import { readAskVSafetyDraft, registerAskVControl } from "@/lib/askv-client-tools";

const EVENT_TYPES = [
  "near_miss",
  "unsafe_condition",
  "unsafe_act",
  "injury",
  "property_damage",
  "observation",
] as const;

export default function SafetyReportScreen() {
  const { t } = useTranslation();
  const colors = useColors();
  const params = useLocalSearchParams<{ siteLocationId?: string; ticketId?: string; title?: string; description?: string; eventType?: string; askvDraftId?: string }>();
  const initialDraft = useMemo(() => {
    try { return readAskVSafetyDraft(params); } catch { return {}; }
  }, [params.askvDraftId]);
  const [eventType, setEventType] = useState<(typeof EVENT_TYPES)[number]>((initialDraft.eventType ?? "near_miss") as (typeof EVENT_TYPES)[number]);
  const [title, setTitle] = useState(initialDraft.title ?? "");
  const [description, setDescription] = useState(initialDraft.description ?? "");
  const [siteLocationId, setSiteLocationId] = useState(params.siteLocationId ?? "");
  const [isAnonymous, setIsAnonymous] = useState(false);
  const [isStopWork, setIsStopWork] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const titleRef = useRef<TextInput>(null);
  const descriptionRef = useRef<TextInput>(null);
  const siteRef = useRef<TextInput>(null);
  const lastDraft = useRef(params.askvDraftId);
  useEffect(() => {
    if (!params.askvDraftId || params.askvDraftId === lastDraft.current) return;
    lastDraft.current = params.askvDraftId;
    setTitle(initialDraft.title ?? ""); setDescription(initialDraft.description ?? "");
    setSiteLocationId(initialDraft.siteLocationId ?? "");
    setEventType((initialDraft.eventType ?? "near_miss") as (typeof EVENT_TYPES)[number]);
  }, [params.askvDraftId, initialDraft]);
  useEffect(() => {
    const registrations = [["title", titleRef], ["description", descriptionRef], ["siteLocationId", siteRef]] as const;
    const remove = registrations.map(([id, ref]) => registerAskVControl("/safety-report", id, () => {
      if (!ref.current) return false; ref.current.focus(); return true;
    }));
    return () => remove.forEach(unregister => unregister());
  }, []);

  const submit = async () => {
    if (!title.trim() || !siteLocationId) {
      Alert.alert(t("safety.reportErrorTitle"), t("safety.reportRequired"));
      return;
    }
    setSubmitting(true);
    try {
      await apiFetch("/api/safety/events", {
        method: "POST",
        body: JSON.stringify({
          eventType,
          title: title.trim(),
          description: description.trim() || undefined,
          siteLocationId: Number(siteLocationId),
          ticketId: params.ticketId ? Number(params.ticketId) : undefined,
          isAnonymous,
          isStopWork,
        }),
      });
      Alert.alert(t("safety.reportSuccessTitle"), t("safety.reportSuccessBody"), [
        { text: "OK", onPress: () => router.replace("/safety-my-reports") },
      ]);
    } catch (e) {
      Alert.alert(t("safety.reportErrorTitle"), String(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <View style={{ flex: 1 }}>
      <InPageHeader title={t("safety.reportTitle")} onBack={() => router.back()} />
      <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
        <Text style={{ color: colors.mutedForeground }}>{t("safety.reportSubtitle")}</Text>
        <TextInput
          ref={siteRef}
          testID="safety-site"
          placeholder={t("safety.siteIdPlaceholder")}
          value={siteLocationId}
          onChangeText={setSiteLocationId}
          keyboardType="number-pad"
          style={{ borderWidth: 1, borderColor: colors.border, padding: 10, borderRadius: 8, color: colors.text }}
        />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
          {EVENT_TYPES.map((type) => (
            <TouchableOpacity
              key={type}
              onPress={() => setEventType(type)}
              style={{
                paddingHorizontal: 12,
                paddingVertical: 8,
                borderRadius: 20,
                backgroundColor: eventType === type ? colors.primary : colors.card,
              }}
            >
              <Text style={{ color: eventType === type ? "#fff" : colors.text }}>{type.replace(/_/g, " ")}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
        <TextInput
          ref={titleRef}
          testID="safety-title"
          placeholder={t("safety.titlePlaceholder")}
          value={title}
          onChangeText={setTitle}
          style={{ borderWidth: 1, borderColor: colors.border, padding: 10, borderRadius: 8, color: colors.text }}
        />
        <TextInput
          ref={descriptionRef}
          testID="safety-description"
          placeholder={t("safety.descriptionPlaceholder")}
          value={description}
          onChangeText={setDescription}
          multiline
          numberOfLines={4}
          style={{
            borderWidth: 1,
            borderColor: colors.border,
            padding: 10,
            borderRadius: 8,
            minHeight: 100,
            color: colors.text,
            textAlignVertical: "top",
          }}
        />
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          <Text style={{ color: colors.text }}>{t("safety.anonymous")}</Text>
          <Switch value={isAnonymous} onValueChange={setIsAnonymous} />
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          <Text style={{ color: colors.text }}>{t("safety.stopWork")}</Text>
          <Switch value={isStopWork} onValueChange={setIsStopWork} />
        </View>
        <LayeredPillButton onPress={submit} disabled={submitting}>
          <Text style={{ color: "#ffffff" }}>
            {submitting ? t("common.loading") : t("safety.submit")}
          </Text>
        </LayeredPillButton>
      </ScrollView>
    </View>
  );
}
