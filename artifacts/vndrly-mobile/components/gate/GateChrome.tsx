import React from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
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
export const gateStyle = StyleSheet.create({
  body: { padding: 16, gap: 12, paddingBottom: 30 },
  card: {
    backgroundColor: "#242426",
    borderWidth: 2,
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 12,
    gap: 10,
  },
  heading: { flexDirection: "row", alignItems: "center", gap: 9 },
  title: { fontSize: 17, fontWeight: "700", color: "#ececec", flex: 1 },
  text: { color: "#ececec", fontSize: 14 },
  muted: { color: "#b3b3b3", fontSize: 12 },
  input: {
    backgroundColor: "#303034",
    borderWidth: 1,
    borderColor: "#626268",
    borderRadius: 8,
    color: "#ececec",
    paddingHorizontal: 12,
    paddingVertical: 11,
    minHeight: 44,
  },
  row: {
    minHeight: 48,
    borderTopWidth: 1,
    borderTopColor: "#3a3a3a",
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 10,
  },
  columns: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
});
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
                onPress={() =>
                  router.canGoBack()
                    ? router.back()
                    : router.replace("/(tabs)/change-over")
                }
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
export function GateCard({
  title,
  subtitle,
  icon = "grid",
  children,
}: {
  title: string;
  subtitle?: string;
  icon?: React.ComponentProps<typeof Feather>["name"];
  children: React.ReactNode;
}) {
  const colors = useColors();
  return (
    <View style={[gateStyle.card, { borderColor: colors.primary }]}>
      <View style={gateStyle.heading}>
        <Feather name={icon} size={20} color={colors.primary} />
        <Text accessibilityRole="header" style={gateStyle.title}>
          {title}
        </Text>
      </View>
      {subtitle && <Text style={gateStyle.muted}>{subtitle}</Text>}
      {children}
    </View>
  );
}
export function GateRow({
  label,
  detail,
  icon = "chevron-right",
  onPress,
  disabled = false,
}: {
  label: string;
  detail?: string;
  icon?: React.ComponentProps<typeof Feather>["name"];
  onPress: () => void;
  disabled?: boolean;
}) {
  const colors = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        gateStyle.row,
        { opacity: disabled ? 0.45 : pressed ? 0.7 : 1 },
      ]}
    >
      <Feather name={icon} size={19} color={colors.primary} />
      <View style={{ flex: 1, gap: 3 }}>
        <Text style={gateStyle.text}>{label}</Text>
        {detail && <Text style={gateStyle.muted}>{detail}</Text>}
      </View>
      <Feather name="chevron-right" color="#a3a3a3" size={18} />
    </Pressable>
  );
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
