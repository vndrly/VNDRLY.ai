import { ModalTextInput as TextInput } from "@/components/ModalDraft";
import React, { useState } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import ProfileMiniCardButton from "@/components/ProfileMiniCardButton";
import { useColors } from "@/hooks/useColors";
import { ImplementationASurface } from "./Surface";

export function SafetyResponse() {
  const { t } = useTranslation();
  const colors = useColors();
  const [draft, setDraft] = useState(false);
  const [textMode, setTextMode] = useState(false);
  return <ImplementationASurface description="Stress-aware incident reporting and acknowledged escalation.">
    {draft ? <View accessibilityLiveRegion="assertive" style={{ borderWidth: 1, borderColor: colors.primary, borderRadius: 12, padding: 14, gap: 6 }}><Text style={{ color: colors.text, fontWeight: "700" }}>Incident draft ready</Text><Text style={{ color: colors.mutedForeground }}>Ask V will check immediate safety before notifying the configured chain.</Text></View> : <ProfileMiniCardButton borderColor={colors.primary} accessibilityLabel="Report a safety incident" onPress={() => setDraft(true)}>Report an incident</ProfileMiniCardButton>}
    <ProfileMiniCardButton borderColor={colors.primary} selected={textMode} onPress={() => setTextMode((value) => !value)}>{t("implementationAOperations.textFallback")}</ProfileMiniCardButton>
    {textMode ? <TextInput autoFocus multiline accessibilityLabel="Describe the safety incident by text" placeholder="Describe what happened" placeholderTextColor={colors.mutedForeground} style={{ minHeight: 112, color: colors.text, borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: 14, textAlignVertical: "top" }} /> : null}
  </ImplementationASurface>;
}
