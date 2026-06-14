import { router } from "expo-router";
import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import ScreenSafeArea from "@/components/ScreenSafeArea";

import AmberButton from "@/components/AmberButton";
import LanguageToggle from "@/components/LanguageToggle";
import { useColors } from "@/hooks/useColors";
import { translateApiError } from "@/lib/apiErrors";
import { startGuestSession } from "@/lib/guest";

export default function GuestLoginScreen() {
  const colors = useColors();
  const { t } = useTranslation();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [company, setCompany] = useState("");
  const [vehiclePlate, setVehiclePlate] = useState("");
  const [purpose, setPurpose] = useState("");
  const [safety, setSafety] = useState(false);
  const [busy, setBusy] = useState(false);

  // Track which required fields the visitor has interacted with so we can
  // surface inline hints without yelling "Required" at someone who hasn't
  // even tried to fill the form yet. `attemptedSubmit` flips on the first
  // tap of the submit button so we can also flag the safety toggle (which
  // has no real "blur" event on a Switch) and any still-empty inputs.
  const [firstNameTouched, setFirstNameTouched] = useState(false);
  const [lastNameTouched, setLastNameTouched] = useState(false);
  const [attemptedSubmit, setAttemptedSubmit] = useState(false);

  const firstNameMissing = firstName.trim().length === 0;
  const lastNameMissing = lastName.trim().length === 0;
  const safetyMissing = !safety;
  const isValid = !firstNameMissing && !lastNameMissing && !safetyMissing;

  const showFirstNameHint =
    firstNameMissing && (firstNameTouched || attemptedSubmit);
  const showLastNameHint =
    lastNameMissing && (lastNameTouched || attemptedSubmit);
  const showSafetyHint = safetyMissing && attemptedSubmit;

  const onSubmit = async () => {
    if (!isValid) {
      // Surface inline hints next to every required field that's still
      // missing instead of bouncing the visitor with an Alert. This is the
      // friendlier mobile pattern called out in Task #113.
      setAttemptedSubmit(true);
      setFirstNameTouched(true);
      setLastNameTouched(true);
      return;
    }
    setBusy(true);
    try {
      await startGuestSession({
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        phone: phone.trim() || undefined,
        email: email.trim() || undefined,
        company: company.trim() || undefined,
        vehiclePlate: vehiclePlate.trim() || undefined,
        purpose: purpose.trim() || undefined,
        safetyAcknowledged: safety,
      });
      router.replace("/visitor-checkin");
    } catch (e) {
      Alert.alert(t("visitor.error"), translateApiError(e, t));
    } finally {
      setBusy(false);
    }
  };

  const inputStyle = [
    styles.input,
    { borderColor: colors.border, color: colors.foreground, backgroundColor: colors.card },
  ];
  const invalidInputStyle = [
    styles.input,
    { borderColor: colors.destructive, color: colors.foreground, backgroundColor: colors.card },
  ];
  const labelStyle = [styles.label, { color: colors.foreground }];
  const hintStyle = [styles.hint, { color: colors.destructive }];

  return (
    <ScreenSafeArea style={[styles.flex, { backgroundColor: colors.background }]}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
          {/* Signed-out language switcher mirrors the mobile login screen
              (artifacts/vndrly-mobile/app/login.tsx). Pinned to the
              top-right so Spanish-speaking visitors can switch between
              EN and ES before signing in; the choice persists via
              AsyncStorage in lib/i18n.ts. */}
          <View style={styles.languageToggleRow}>
            <LanguageToggle />
          </View>

          <Text style={[styles.title, { color: colors.foreground }]}>{t("visitor.signInTitle")}</Text>
          <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>{t("visitor.signInSubtitle")}</Text>

          <Text style={labelStyle}>{t("visitor.firstName")} *</Text>
          <TextInput
            testID="guest-first-name"
            value={firstName}
            onChangeText={setFirstName}
            onBlur={() => setFirstNameTouched(true)}
            style={showFirstNameHint ? invalidInputStyle : inputStyle}
            placeholderTextColor={colors.mutedForeground}
          />
          {showFirstNameHint ? (
            <Text testID="guest-first-name-hint" style={hintStyle}>
              {t("common.required")}
            </Text>
          ) : null}

          <Text style={labelStyle}>{t("visitor.lastName")} *</Text>
          <TextInput
            testID="guest-last-name"
            value={lastName}
            onChangeText={setLastName}
            onBlur={() => setLastNameTouched(true)}
            style={showLastNameHint ? invalidInputStyle : inputStyle}
            placeholderTextColor={colors.mutedForeground}
          />
          {showLastNameHint ? (
            <Text testID="guest-last-name-hint" style={hintStyle}>
              {t("common.required")}
            </Text>
          ) : null}

          <Text style={labelStyle}>{t("visitor.phone")}</Text>
          <TextInput testID="guest-phone" value={phone} onChangeText={setPhone} keyboardType="phone-pad" style={inputStyle} placeholderTextColor={colors.mutedForeground} />

          <Text style={labelStyle}>{t("visitor.email")}</Text>
          <TextInput testID="guest-email" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" style={inputStyle} placeholderTextColor={colors.mutedForeground} />

          <Text style={labelStyle}>{t("visitor.company")}</Text>
          <TextInput testID="guest-company" value={company} onChangeText={setCompany} style={inputStyle} placeholderTextColor={colors.mutedForeground} />

          <Text style={labelStyle}>{t("visitor.vehiclePlate")}</Text>
          <TextInput testID="guest-vehicle-plate" value={vehiclePlate} onChangeText={setVehiclePlate} autoCapitalize="characters" style={inputStyle} placeholderTextColor={colors.mutedForeground} />

          <Text style={labelStyle}>{t("visitor.purpose")}</Text>
          <TextInput testID="guest-purpose" value={purpose} onChangeText={setPurpose} style={inputStyle} placeholder={t("visitor.purposePlaceholder")} placeholderTextColor={colors.mutedForeground} />

          <View
            style={[
              styles.safetyRow,
              {
                borderColor: showSafetyHint ? colors.destructive : colors.border,
                backgroundColor: colors.card,
              },
            ]}
          >
            <Switch testID="guest-safety-switch" value={safety} onValueChange={setSafety} />
            <Text style={[styles.safetyText, { color: colors.foreground }]}>{t("visitor.safetyAck")}</Text>
          </View>
          {showSafetyHint ? (
            <Text testID="guest-safety-hint" style={hintStyle}>
              {t("visitor.requireSafety")}
            </Text>
          ) : null}

          <AmberButton testID="guest-submit-btn" onPress={onSubmit} loading={busy} disabled={busy} height={50} style={styles.submit}>
            {t("visitor.continue")}
          </AmberButton>

          <TouchableOpacity onPress={() => router.replace("/login")} style={styles.cancelLink}>
            <Text style={[styles.cancelText, { color: colors.mutedForeground }]}>{t("common.cancel")}</Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </ScreenSafeArea>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: { padding: 24, paddingBottom: 48 },
  languageToggleRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
    marginBottom: 16,
  },
  title: { fontFamily: "Inter_700Bold", fontSize: 24, marginBottom: 6 },
  subtitle: { fontFamily: "Inter_400Regular", fontSize: 14, marginBottom: 18 },
  label: { fontFamily: "Inter_500Medium", fontSize: 13, marginTop: 12, marginBottom: 6 },
  input: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, fontFamily: "Inter_400Regular", fontSize: 16 },
  hint: { fontFamily: "Inter_500Medium", fontSize: 12, marginTop: 6 },
  safetyRow: { flexDirection: "row", alignItems: "center", borderWidth: 1, borderRadius: 10, padding: 12, marginTop: 18, gap: 12 },
  safetyText: { flex: 1, fontFamily: "Inter_400Regular", fontSize: 13 },
  submit: { marginTop: 20, height: 50, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  cancelLink: { marginTop: 14, alignItems: "center" },
  cancelText: { fontFamily: "Inter_500Medium", fontSize: 14 },
});
