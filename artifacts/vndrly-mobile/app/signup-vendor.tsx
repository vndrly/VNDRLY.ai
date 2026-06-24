import { router } from "expo-router";
import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import ScreenSafeArea from "@/components/ScreenSafeArea";

import AmberButton from "@/components/AmberButton";
import LanguageToggle from "@/components/LanguageToggle";
import { useColors } from "@/hooks/useColors";
import { apiFetch } from "@/lib/api";
import { translateApiError } from "@/lib/apiErrors";

type FormState = {
  name: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  password: string;
  confirm: string;
};

const EMPTY: FormState = {
  name: "",
  contactName: "",
  contactEmail: "",
  contactPhone: "",
  password: "",
  confirm: "",
};

// Mirrors the server's CreateVendorOnboardingBody schema in
// lib/api-zod (see createVendorOnboardingBodyPasswordMin = 8).
const PASSWORD_MIN = 8;

type CheckNameMatch = { name: string; score: number };

export default function SignupVendorScreen() {
  const colors = useColors();
  const { t } = useTranslation();
  const [form, setForm] = useState<FormState>(EMPTY);
  const [busy, setBusy] = useState(false);

  // Fuzzy duplicate check via the public /vendors/check-name endpoint.
  const [matches, setMatches] = useState<CheckNameMatch[]>([]);
  const [matchesLoading, setMatchesLoading] = useState(false);
  const [checkedName, setCheckedName] = useState<string | null>(null);
  const [confirmDifferent, setConfirmDifferent] = useState(false);

  const update = (field: keyof FormState, value: string) =>
    setForm((prev) => ({ ...prev, [field]: value }));

  // Debounced fuzzy lookup; AbortController prevents stale responses
  // from overwriting state for a newer name.
  useEffect(() => {
    const trimmed = form.name.trim();
    setConfirmDifferent(false);
    if (trimmed.length < 3) {
      setMatches([]);
      setMatchesLoading(false);
      setCheckedName(trimmed);
      return;
    }
    setCheckedName(null);
    setMatchesLoading(true);
    const controller = new AbortController();
    const handle = setTimeout(async () => {
      try {
        const res = await apiFetch<{ matches: CheckNameMatch[] }>(
          `/api/vendors/check-name?name=${encodeURIComponent(trimmed)}`,
          { signal: controller.signal },
        );
        if (controller.signal.aborted) return;
        setMatches(res.matches);
        setCheckedName(trimmed);
      } catch (err) {
        if (
          controller.signal.aborted ||
          (err instanceof Error && err.name === "AbortError")
        ) {
          return;
        }
        setMatches([]);
        setCheckedName(null);
      } finally {
        if (!controller.signal.aborted) setMatchesLoading(false);
      }
    }, 300);
    return () => {
      clearTimeout(handle);
      controller.abort();
    };
  }, [form.name]);

  const isValid =
    form.name.trim().length > 0 &&
    form.contactName.trim().length > 0 &&
    /\S+@\S+\.\S+/.test(form.contactEmail.trim()) &&
    form.contactPhone.trim().length > 0 &&
    form.password.length >= PASSWORD_MIN &&
    form.password === form.confirm;

  const trimmedName = form.name.trim();
  const checkPending =
    trimmedName.length >= 3 &&
    (matchesLoading || checkedName !== trimmedName);
  // A score of 1 means the proposed name canonicalizes (NFKD-fold,
  // lowercase, strip punctuation, drop generic suffixes like "Inc"/"LLC")
  // to an existing vendor's name — exactly the rule the server uses to
  // 409 in POST /onboarding/vendor. Surface those as a hard, inline
  // error before submit instead of waiting for the post-submit alert.
  // Use >= 0.999 defensively in case the server ever rounds the score.
  const hardMatches = matches.filter((m) => m.score >= 0.999);
  const nearMatches = matches.filter((m) => m.score < 0.999);
  const hasHardDuplicate = hardMatches.length > 0;
  const blockedByDuplicate =
    hasHardDuplicate || (nearMatches.length > 0 && !confirmDifferent);

  const onSubmit = async () => {
    if (!isValid) {
      // Surface a more specific message for the password-related cases
      // so the user knows what to fix; otherwise fall back to the
      // generic "fill in the required fields" message.
      if (
        form.password.length > 0 &&
        form.password.length < PASSWORD_MIN
      ) {
        Alert.alert(t("vendorSignup.error"), t("vendorSignup.passwordTooShort"));
        return;
      }
      if (form.password.length > 0 && form.password !== form.confirm) {
        Alert.alert(t("vendorSignup.error"), t("vendorSignup.passwordMismatch"));
        return;
      }
      Alert.alert(t("vendorSignup.error"), t("vendorSignup.requireFields"));
      return;
    }
    if (checkPending) {
      Alert.alert(t("vendorSignup.duplicateChecking"));
      return;
    }
    if (hasHardDuplicate) {
      // Should not be reachable because the submit button is disabled,
      // but guard against fast Enter presses / programmatic submits.
      Alert.alert(
        t("vendorSignup.duplicateHardWarningTitle", {
          name: hardMatches[0].name,
        }),
      );
      return;
    }
    if (blockedByDuplicate) {
      Alert.alert(t("vendorSignup.duplicateConfirmRequired"));
      return;
    }
    setBusy(true);
    try {
      // Public self-signup endpoint. Mirrors the web onboarding wizard's
      // step 1 (artifacts/vndrly/src/pages/onboarding-vendor.tsx →
      // onboardingApi.startVendor → POST /api/onboarding/vendor).
      // The admin-only POST /api/vendors route this screen used to call
      // requires an authenticated admin session and 401s for the
      // logged-out user this screen is meant for. The public route
      // creates the vendor org + admin user and (on web) sets a
      // session cookie. The mobile client uses bearer tokens, so the
      // cookie is ignored here and the user is sent to the login
      // screen to obtain a token.
      await apiFetch("/api/onboarding/vendor", {
        method: "POST",
        body: JSON.stringify({
          name: form.name.trim(),
          contactName: form.contactName.trim(),
          contactEmail: form.contactEmail.trim(),
          contactPhone: form.contactPhone.trim(),
          password: form.password,
        }),
      });
      Alert.alert(
        t("vendorSignup.successTitle"),
        t("vendorSignup.successBody"),
        [{ text: t("common.ok"), onPress: () => router.replace("/login") }],
      );
    } catch (e) {
      // Task #458: surface a localized message when the server returns
      // a structured error (e.g. `vendor.duplicate_name` for an exact
      // canonical-name duplicate, or `auth.email_taken` if the email
      // is already registered). translateApiError() looks up
      // `errors.<code>` and forwards `err.data.details` into i18next
      // as interpolation values so EN/ES copy can render `{{name}}`.
      // Falls back to the generic sign-up error for unexpected failures
      // so the user is never shown a raw English server message.
      Alert.alert(
        t("vendorSignup.error"),
        translateApiError(e, t, t("vendorSignup.error")),
      );
    } finally {
      setBusy(false);
    }
  };

  const inputStyle = [
    styles.input,
    {
      borderColor: colors.border,
      color: colors.foreground,
      backgroundColor: colors.card,
    },
  ];
  const labelStyle = [styles.label, { color: colors.foreground }];

  return (
    <ScreenSafeArea style={[styles.flex, { backgroundColor: colors.pageBackground }]}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.container}
          keyboardShouldPersistTaps="handled"
        >
          {/* Signed-out language switcher mirrors the mobile login screen
              (artifacts/vndrly-mobile/app/login.tsx). Pinned to the
              top-right so Spanish-speaking vendors can switch between
              EN and ES before signing up; the choice persists via
              AsyncStorage in lib/i18n.ts. */}
          <View style={styles.languageToggleRow}>
            <LanguageToggle />
          </View>

          <Text style={[styles.title, { color: colors.foreground }]}>
            {t("vendorSignup.title")}
          </Text>
          <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
            {t("vendorSignup.subtitle")}
          </Text>

          <Text style={labelStyle}>{t("vendorSignup.companyName")} *</Text>
          <TextInput
            testID="vendor-signup-name"
            value={form.name}
            onChangeText={(v) => update("name", v)}
            style={inputStyle}
            placeholder={t("vendorSignup.companyNamePlaceholder")}
            placeholderTextColor={colors.mutedForeground}
          />

          {hasHardDuplicate ? (
            // Hard (exact-canonical) duplicate: server will 409 on
            // submit, so no "I confirm" override. Use the red error
            // style instead of the amber warning so it reads as a
            // blocker, not a soft hint.
            <View
              testID="vendor-signup-duplicate-hard"
              style={styles.errorCard}
              accessibilityRole="alert"
            >
              <Text style={styles.errorTitle}>
                {t("vendorSignup.duplicateHardWarningTitle", {
                  name: hardMatches[0].name,
                })}
              </Text>
              <Text style={styles.errorBody}>
                {t("vendorSignup.duplicateHardWarningBody")}
              </Text>
            </View>
          ) : nearMatches.length > 0 ? (
            <View
              testID="vendor-signup-duplicate-warning"
              style={styles.warningCard}
            >
              <Text style={styles.warningTitle}>
                {t("vendorSignup.duplicateWarningTitle")}
              </Text>
              <Text style={styles.warningSuggestion}>
                {t("vendorSignup.duplicateWarningSuggestion")}
                {nearMatches.map((m) => m.name).join(", ")}
              </Text>
              <TouchableOpacity
                testID="vendor-signup-confirm-different"
                style={styles.confirmRow}
                onPress={() => setConfirmDifferent((v) => !v)}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: confirmDifferent }}
              >
                <View
                  style={[
                    styles.checkbox,
                    confirmDifferent && styles.checkboxChecked,
                  ]}
                >
                  {confirmDifferent ? (
                    <Text style={styles.checkboxMark}>✓</Text>
                  ) : null}
                </View>
                <Text style={styles.confirmLabel}>
                  {t("vendorSignup.duplicateConfirmLabel")}
                </Text>
              </TouchableOpacity>
            </View>
          ) : null}

          <Text style={labelStyle}>{t("vendorSignup.contactName")} *</Text>
          <TextInput
            testID="vendor-signup-contact-name"
            value={form.contactName}
            onChangeText={(v) => update("contactName", v)}
            style={inputStyle}
            placeholderTextColor={colors.mutedForeground}
          />

          <Text style={labelStyle}>{t("vendorSignup.contactEmail")} *</Text>
          <TextInput
            testID="vendor-signup-contact-email"
            value={form.contactEmail}
            onChangeText={(v) => update("contactEmail", v)}
            keyboardType="email-address"
            autoCapitalize="none"
            style={inputStyle}
            placeholder="email@company.com"
            placeholderTextColor={colors.mutedForeground}
          />

          <Text style={labelStyle}>{t("vendorSignup.contactPhone")} *</Text>
          <TextInput
            testID="vendor-signup-contact-phone"
            value={form.contactPhone}
            onChangeText={(v) => update("contactPhone", v)}
            keyboardType="phone-pad"
            style={inputStyle}
            placeholder="(555) 123-4567"
            placeholderTextColor={colors.mutedForeground}
          />

          <Text style={labelStyle}>{t("vendorSignup.password")} *</Text>
          <TextInput
            testID="vendor-signup-password"
            value={form.password}
            onChangeText={(v) => update("password", v)}
            secureTextEntry
            autoCapitalize="none"
            autoComplete="password-new"
            style={inputStyle}
            placeholder={t("vendorSignup.passwordPlaceholder")}
            placeholderTextColor={colors.mutedForeground}
          />

          <Text style={labelStyle}>
            {t("vendorSignup.passwordConfirm")} *
          </Text>
          <TextInput
            testID="vendor-signup-password-confirm"
            value={form.confirm}
            onChangeText={(v) => update("confirm", v)}
            secureTextEntry
            autoCapitalize="none"
            autoComplete="password-new"
            style={inputStyle}
            placeholderTextColor={colors.mutedForeground}
          />

          <AmberButton
            testID="vendor-signup-submit"
            onPress={onSubmit}
            loading={busy}
            disabled={busy || !isValid || checkPending || blockedByDuplicate}
            height={50}
            style={styles.submit}
          >
            {t("vendorSignup.submit")}
          </AmberButton>

          <TouchableOpacity
            onPress={() => router.replace("/login")}
            style={styles.cancelLink}
          >
            <Text style={[styles.cancelText, { color: colors.mutedForeground }]}>
              {t("common.cancel")}
            </Text>
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
  label: {
    fontFamily: "Inter_500Medium",
    fontSize: 13,
    marginTop: 12,
    marginBottom: 6,
  },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontFamily: "Inter_400Regular",
    fontSize: 16,
  },
  warningCard: {
    marginTop: 10,
    borderWidth: 1,
    borderColor: "#1a1d23",
    backgroundColor: "#f4f4f5",
    borderRadius: 10,
    padding: 12,
  },
  errorCard: {
    marginTop: 10,
    borderWidth: 1,
    borderColor: "#DC2626",
    backgroundColor: "#FEF2F2",
    borderRadius: 10,
    padding: 12,
  },
  errorTitle: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 14,
    color: "#991B1B",
    marginBottom: 4,
  },
  errorBody: {
    fontFamily: "Inter_400Regular",
    fontSize: 13,
    color: "#7F1D1D",
  },
  warningTitle: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 14,
    color: "#1a1d23",
    marginBottom: 4,
  },
  warningSuggestion: {
    fontFamily: "Inter_400Regular",
    fontSize: 13,
    color: "#374151",
    marginBottom: 10,
  },
  confirmRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 4,
    borderWidth: 1.5,
    borderColor: "#1a1d23",
    backgroundColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 8,
  },
  checkboxChecked: {
    backgroundColor: "#1a1d23",
    borderColor: "#1a1d23",
  },
  checkboxMark: {
    color: "#fff",
    fontSize: 14,
    fontFamily: "Inter_700Bold",
    lineHeight: 16,
  },
  confirmLabel: {
    flex: 1,
    fontFamily: "Inter_500Medium",
    fontSize: 13,
    color: "#1a1d23",
  },
  submit: {
    marginTop: 20,
    height: 50,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  cancelLink: { marginTop: 14, alignItems: "center" },
  cancelText: { fontFamily: "Inter_500Medium", fontSize: 14 },
});
