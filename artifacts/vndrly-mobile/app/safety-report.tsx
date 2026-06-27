import { router, useLocalSearchParams } from "expo-router";
import React, { useState } from "react";
import { Alert, ScrollView, Switch, Text, TextInput, TouchableOpacity, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useColors } from "@/hooks/useColors";
import { apiFetch } from "@/lib/api";
import InPageHeader from "@/components/InPageHeader";
import LayeredPillButton from "@/components/LayeredPillButton";

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
  const params = useLocalSearchParams<{ siteLocationId?: string; ticketId?: string }>();
  const [eventType, setEventType] = useState<(typeof EVENT_TYPES)[number]>("near_miss");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [siteLocationId, setSiteLocationId] = useState(params.siteLocationId ?? "");
  const [isAnonymous, setIsAnonymous] = useState(false);
  const [isStopWork, setIsStopWork] = useState(false);
  const [submitting, setSubmitting] = useState(false);

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
          placeholder={t("safety.titlePlaceholder")}
          value={title}
          onChangeText={setTitle}
          style={{ borderWidth: 1, borderColor: colors.border, padding: 10, borderRadius: 8, color: colors.text }}
        />
        <TextInput
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
