import { ModalPressable as Pressable, ModalTextInput as TextInput } from "@/components/ModalDraft";
import { pageBack } from "@/lib/page-back";
import { gateStyle } from "./GateCard";
export { GateCard, gateStyle } from "./GateCard";
import React from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Text,
  View,
  type TextInputProps,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import ScreenSafeArea from "@/components/ScreenSafeArea";
import BrandTitleRow from "@/components/BrandTitleRow";
import SphereBackButton from "@/components/SphereBackButton";
import { useColors } from "@/hooks/useColors";
export function useGateCopy() {
  const { i18n } = useTranslation();
  return (en: string, es: string) =>
    (i18n?.language ?? "en").startsWith("es") ? es : en;
}
export function GatePage({
  title,
  children,
  back = false,
}: {
  title: string;
  children: React.ReactNode;
  back?: boolean;
}) {
  return (
    <ScreenSafeArea>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={gateStyle.body}
        >
          <BrandTitleRow subtitle="VNDRLY Gate" logoTestId="gate-page-brand" />
          <View style={gateStyle.heading}>
            {back && (
              <SphereBackButton
                size={36}
                onPress={() => pageBack()}
              />
            )}
            <Text
              accessibilityRole="header"
              style={[gateStyle.title, { fontSize: 20 }]}
            >
              {title}
            </Text>
          </View>
          {children}
        </ScrollView>
      </KeyboardAvoidingView>
    </ScreenSafeArea>
  );
}
export function GateRow({
  label,
  detail,
  icon = "chevron-right",
  onPress,
  disabled = false,
  expanded,
  trailing,
  showDivider = true,
}: {
  label: string;
  detail?: string;
  expanded?: boolean;
  trailing?: React.ReactNode;
  showDivider?: boolean;
  icon?: React.ComponentProps<typeof Feather>["name"];
  onPress: () => void;
  disabled?: boolean;
}) {
  const colors = useColors();
  const row = (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled, expanded }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        trailing ? { flex: 1, flexDirection: "row", alignItems: "center", gap: 10, alignSelf: "stretch" } : gateStyle.row,
        !showDivider && { borderTopWidth: 0 },
        { opacity: disabled ? 0.45 : pressed ? 0.7 : 1 },
      ]}
    >
      <Feather name={icon} size={19} color={colors.primary} />
      <View style={{ flex: 1, gap: 3 }}>
        <Text style={gateStyle.text}>{label}</Text>
        {detail && <Text style={gateStyle.muted}>{detail}</Text>}
      </View>
      {!trailing && <Feather name="chevron-right" color="#a3a3a3" size={18} />}
    </Pressable>
  );
  return trailing ? <View style={[gateStyle.row, !showDivider && { borderTopWidth: 0 }]}>{row}{trailing}</View> : row;
}
export function GateField({
  label,
  ...props
}: TextInputProps & { label: string }) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={gateStyle.muted}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor="#999"
        {...props}
        style={[gateStyle.input, props.style]}
      />
    </View>
  );
}
export function GateError({
  message,
  retry,
}: {
  message?: string;
  retry?: () => void;
}) {
  const c = useGateCopy();
  return message ? (
    <View accessibilityRole="alert" style={{ gap: 8 }}>
      <Text style={{ color: "#fca5a5" }}>{message}</Text>
      {retry && (
        <GateRow
          label={c("Try again", "Reintentar")}
          icon="refresh-cw"
          onPress={retry}
        />
      )}
    </View>
  ) : null;
}
export function GateLoading() {
  const colors = useColors();
  return (
    <ActivityIndicator color={colors.primary} accessibilityLabel="Loading" />
  );
}
