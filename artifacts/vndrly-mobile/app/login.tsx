import { router } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Alert,
  Image,
  KeyboardAvoidingView,
  Linking,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import AmberButton from "@/components/AmberButton";
import LanguageToggle from "@/components/LanguageToggle";
import { useColors } from "@/hooks/useColors";
import { login } from "@/lib/api";
import { translateApiError } from "@/lib/apiErrors";
import {
  authenticateWithBiometrics,
  clearBiometricCredentials,
  getBiometricCapability,
  getBiometricCredentials,
  isBiometricLoginEnabled,
  saveBiometricCredentials,
  type BiometricCapability,
} from "@/lib/biometrics";

export default function LoginScreen() {
  const colors = useColors();
  const { t } = useTranslation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [capability, setCapability] = useState<BiometricCapability | null>(null);
  const [biometricEnabled, setBiometricEnabled] = useState(false);
  const autoPromptedRef = useRef(false);
  const formReady = email.trim().length > 0 && password.length > 0;

  const performLogin = async (
    emailVal: string,
    passwordVal: string,
    options: { offerEnable?: boolean; fromBiometric?: boolean } = {},
  ) => {
    setBusy(true);
    try {
      await login(emailVal.trim(), passwordVal);
      if (options.offerEnable && capability?.available && capability.enrolled && !biometricEnabled) {
        Alert.alert(
          t("login.biometricEnableTitle", { label: capability.label }),
          t("login.biometricEnableBody", { label: capability.label }),
          [
            { text: t("login.notNow"), style: "cancel", onPress: () => router.replace("/(tabs)") },
            {
              text: t("login.enable"),
              onPress: async () => {
                await saveBiometricCredentials(emailVal.trim(), passwordVal);
                router.replace("/(tabs)");
              },
            },
          ],
        );
      } else {
        router.replace("/(tabs)");
      }
    } catch (e: unknown) {
      // If the saved biometric credentials no longer work (password
      // rotated, account deactivated, server-side session_version bump,
      // etc.), wipe them so the auto-prompt doesn't fire again on the
      // next mount and trap the user in a Face ID / passcode loop.
      // The user can re-enable biometric login after a successful
      // manual sign-in via the offerEnable prompt above.
      if (options.fromBiometric) {
        await clearBiometricCredentials();
        setBiometricEnabled(false);
      }
      Alert.alert(t("login.loginFailed"), translateApiError(e, t));
    } finally {
      setBusy(false);
    }
  };

  const onSubmit = async () => {
    if (!email || !password) return;
    await performLogin(email, password, { offerEnable: true });
  };

  const onBiometricPress = async () => {
    if (!capability?.available || !capability.enrolled) return;
    const creds = await getBiometricCredentials();
    if (!creds) return;
    const ok = await authenticateWithBiometrics(t("login.signInWith", { label: capability.label }));
    if (!ok) return;
    await performLogin(creds.email, creds.password, { fromBiometric: true });
  };

  // On mount: detect biometrics, auto-prompt if enabled and credentials saved
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const cap = await getBiometricCapability();
      const enabled = await isBiometricLoginEnabled();
      const creds = enabled ? await getBiometricCredentials() : null;
      if (cancelled) return;
      setCapability(cap);
      setBiometricEnabled(enabled && !!creds);
      if (
        !autoPromptedRef.current &&
        enabled &&
        creds &&
        cap.available &&
        cap.enrolled &&
        Platform.OS !== "web"
      ) {
        autoPromptedRef.current = true;
        const ok = await authenticateWithBiometrics(t("login.signInWith", { label: cap.label }));
        if (!cancelled && ok) {
          await performLogin(creds.email, creds.password, { fromBiometric: true });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const showBiometricButton =
    !!capability?.available && capability.enrolled && biometricEnabled && Platform.OS !== "web";

  return (
    <SafeAreaView style={[styles.flex, { backgroundColor: colors.background }]}>
      {/* Decorative header background — a blurred field-ops photo
          anchored to the top of the screen, fading from 80% opacity
          at the very top to 0% over roughly the top two inches
          (~200pt) so it dissolves into the dark login chrome.
          `pointerEvents="none"` + first-child render order means
          the form sits visually OVER it but never blocks taps and
          the image itself can never receive touches. */}
      <View pointerEvents="none" style={styles.headerBgWrap}>
        <Image
          source={require("@/assets/images/login-header-bg.png")}
          style={styles.headerBgImage}
          resizeMode="cover"
        />
        <View
          pointerEvents="none"
          style={[StyleSheet.absoluteFill, { backgroundColor: colors.background, opacity: 0.6 }]}
        />
      </View>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.container}
          keyboardShouldPersistTaps="handled"
        >
          {/* Signed-out language switcher mirrors the web login screen
              (artifacts/vndrly/src/components/language-toggle.tsx). Pinned
              to the top-right so Spanish-speaking field employees and
              testers can switch between EN and ES before signing in;
              the choice persists via AsyncStorage in lib/i18n.ts. */}
          <View style={styles.topBar}>
            <View
              style={[
                styles.topBarLogo,
                {
                  backgroundColor: colors.primary,
                  borderRadius: 10,
                  alignItems: "center",
                  justifyContent: "center",
                },
              ]}
              accessibilityLabel="VNDRLY"
            >
              <Text style={{ color: "#ffffff", fontFamily: "Inter_700Bold", fontSize: 18 }}>V</Text>
            </View>
            <LanguageToggle />
          </View>

          <View style={styles.brand}>
            <View
              style={[
                styles.logoImage,
                {
                  backgroundColor: colors.primary,
                  borderRadius: 20,
                  alignItems: "center",
                  justifyContent: "center",
                },
              ]}
            >
              <Text style={{ color: "#ffffff", fontFamily: "Inter_700Bold", fontSize: 56 }}>V</Text>
            </View>
            <Text style={[styles.title, { color: colors.foreground }]}>VNDRLY</Text>
            <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
              {t("login.title")}
            </Text>
          </View>

          <View style={styles.form}>
            <Text style={[styles.label, { color: colors.foreground }]}>
              {t("login.emailLabel")}
            </Text>
            <TextInput
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              autoComplete="email"
              keyboardType="email-address"
              placeholder={t("login.emailPlaceholder")}
              placeholderTextColor={colors.mutedForeground}
              style={[
                styles.input,
                {
                  borderColor: colors.border,
                  color: colors.foreground,
                  backgroundColor: colors.card,
                },
              ]}
            />

            <Text style={[styles.label, { color: colors.foreground, marginTop: 12 }]}>
              {t("login.passwordLabel")}
            </Text>
            <TextInput
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              placeholder={t("login.passwordPlaceholder")}
              placeholderTextColor={colors.mutedForeground}
              style={[
                styles.input,
                {
                  borderColor: colors.border,
                  color: colors.foreground,
                  backgroundColor: colors.card,
                },
              ]}
            />

            {/* Primary CTA — canonical TogglePill colored state at rest
                (solid brand fill + 50% white top-half gloss + black/10
                hairline border + white drop-shadow text) so it reads as
                an action, not a form-not-ready chip. The form-not-ready
                signal is the standard `disabled` 50% opacity dim — no
                more `inactive` grey-sprite lock, which on mobile (no
                hover) made the CTA look like a permanently-grey pill. */}
            <AmberButton
              onPress={onSubmit}
              loading={busy}
              disabled={busy || !formReady}
              height={38}
              style={styles.button}
              textStyle={styles.buttonText}
            >
              {t("login.signIn")}
            </AmberButton>

            {showBiometricButton && (
              <>
                <TouchableOpacity
                  onPress={onBiometricPress}
                  disabled={busy}
                  style={[
                    styles.biometricButton,
                    {
                      borderColor: colors.primary,
                      opacity: busy ? 0.7 : 1,
                    },
                  ]}
                >
                  <Text style={[styles.biometricText, { color: colors.primary }]}>
                    {t("login.signInWith", { label: capability?.label ?? "" })}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={async () => {
                    await clearBiometricCredentials();
                    setBiometricEnabled(false);
                  }}
                  style={styles.linkButton}
                >
                  <Text style={[styles.linkText, { color: colors.mutedForeground }]}>
                    {t("login.forget", { label: capability?.label ?? "" })}
                  </Text>
                </TouchableOpacity>
              </>
            )}

            <Text style={[styles.helper, { color: colors.mutedForeground }]}>
              {t("login.fieldEmployeesNote")}
            </Text>

            <View style={[styles.divider, { backgroundColor: colors.border }]} />
            <AmberButton
              onPress={() => router.push("/guest-login")}
              disabled={busy}
              height={38}
              style={styles.button}
              textStyle={styles.buttonText}
              testID="button-continue-as-visitor"
            >
              {t("visitor.continueAsVisitor")}
            </AmberButton>

            <TouchableOpacity
              onPress={() => router.push("/signup-vendor")}
              disabled={busy}
              style={styles.linkButton}
              testID="button-signup-vendor"
            >
              <Text style={[styles.linkText, { color: colors.primary }]}>
                {t("vendorSignup.signUpAsVendor")}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => void Linking.openURL("https://vndrly.ai/legal/eula")}
              disabled={busy}
              style={styles.linkButton}
              testID="link-platform-eula"
            >
              <Text style={[styles.linkText, { color: colors.mutedForeground }]}>
                {t("login.eulaLink")}
              </Text>
            </TouchableOpacity>

            {/* Demo password reset button intentionally removed — passwords
                are managed via the DEMO_PASSWORD_OVERRIDE secret on the API
                server so the dev/prod databases stay in sync and never
                revert to the legacy `vndrly123` demo password. */}

          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  // ~200pt ≈ "top two inches" on a typical phone. Absolute so it sits
  // behind every later sibling in z-order and the form can scroll
  // freely on top of it.
  headerBgWrap: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: 200,
    overflow: "hidden",
  },
  headerBgImage: {
    width: "100%",
    height: "100%",
    opacity: 0.8,
  },
  container: { flexGrow: 1, padding: 24, justifyContent: "center" },
  languageToggleRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
    marginBottom: 16,
  },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 16,
  },
  topBarLogo: {
    width: 36,
    height: 36,
  },
  brand: { alignItems: "center", marginBottom: 32 },
  logoImage: {
    width: 96,
    height: 96,
    marginBottom: 16,
  },
  title: { fontFamily: "Inter_700Bold", fontSize: 28, letterSpacing: 2 },
  subtitle: { fontFamily: "Inter_400Regular", fontSize: 14, marginTop: 4 },
  form: { width: "100%" },
  label: { fontFamily: "Inter_500Medium", fontSize: 13, marginBottom: 6 },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontFamily: "Inter_400Regular",
    fontSize: 16,
  },
  // Layout-only style for the two AmberButton CTAs ("Sign in to
  // Portal", "Continue as Visitor"). The pill shape, gloss, and
  // colored background come from TogglePillButton's sliced sprite
  // chrome — do NOT add `borderRadius` or `backgroundColor` here
  // or it will fight the sprite and produce a square-ish flat
  // rectangle behind the pill. Just spacing.
  button: {
    marginTop: 20,
  },
  buttonText: { fontFamily: "Inter_600SemiBold", fontSize: 16 },
  buttonTextInactive: { color: "#d1d5db" },
  biometricButton: {
    marginTop: 12,
    height: 50,
    borderRadius: 10,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "transparent",
  },
  biometricText: { fontFamily: "Inter_600SemiBold", fontSize: 15 },
  linkButton: { marginTop: 10, alignItems: "center" },
  linkText: { fontFamily: "Inter_400Regular", fontSize: 12 },
  divider: { height: 1, marginVertical: 16, opacity: 0.5 },
  helper: {
    marginTop: 16,
    fontFamily: "Inter_400Regular",
    fontSize: 12,
    textAlign: "center",
    lineHeight: 18,
  },
});
