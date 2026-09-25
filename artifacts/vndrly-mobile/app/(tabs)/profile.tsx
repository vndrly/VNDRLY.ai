import { Feather } from "@expo/vector-icons";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import * as Location from "expo-location";
import React, { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

import AmberButton from "@/components/AmberButton";
import AskVVoiceIndicator from "@/components/AskVVoiceIndicator";
import BrandTitleRow from "@/components/BrandTitleRow";
import LayeredPillButton from "@/components/LayeredPillButton";
import SafetyTrainingBanner from "@/components/SafetyTrainingBanner";
import ScreenSafeArea from "@/components/ScreenSafeArea";
import SphereBackButton from "@/components/SphereBackButton";
import ProfilePhotoImage from "@/components/ProfilePhotoImage";
import WorkHubDeviceSettings from "@/components/WorkHubDeviceSettings";
import GateLocationsCard from "@/components/profile/GateLocationsCard";
import { useAuth } from "@/hooks/use-auth";
import { useColors } from "@/hooks/useColors";
import { apiFetch, logout, updatePreferredLanguage } from "@/lib/api";
import type { MembershipSummary } from "@/lib/auth";
import { setLanguage, SUPPORTED_LANGUAGES, type SupportedLanguage } from "@/lib/i18n";
import { captureAndUploadImage, pickAndUploadImage } from "@/lib/photos";
import {
  acceptConsent,
  hasActiveConsentForThisDevice,
  revokeConsent,
  setConsentDeclined,
} from "@/lib/locationConsent";
import {
  startLiveLocationReporter,
  stopLiveLocationReporter,
} from "@/lib/liveLocationReporter";

type FieldMe = {
  viewerRole?: "field_employee" | "vendor" | "partner" | "admin";
  employeeId: number | null;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  vendorName: string | null;
  partnerName?: string | null;
  profilePhotoPath: string | null;
  photoUrl: string | null;
};

export default function ProfileScreen() {
  const colors = useColors();
  const { t, i18n } = useTranslation();
  const { openSettings } = useLocalSearchParams<{ openSettings?: string }>();
  const {
    user,
    availableMemberships,
    activeMembershipId,
    switchContext,
  } = useAuth();
  const canManageCompany =
    user?.role === "admin" ||
    (user?.role === "vendor" && ["admin", "office"].includes(user.vendorRole ?? ""));
  const [photoPath, setPhotoPath] = useState<string | null>(null);
  const [directPhotoUrl, setDirectPhotoUrl] = useState<string | null>(null);
  const [locConsent, setLocConsent] = useState<boolean | null>(null);
  const [locBusy, setLocBusy] = useState(false);
  const [switchingId, setSwitchingId] = useState<number | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [complianceEmployeeId, setComplianceEmployeeId] = useState<number | null>(null);
  // Task #838: brief confirmation toast after the user changes their
  // preferred language. `kind` distinguishes the green "Saved" state
  // from the red "Couldn't save" fallback so a network/server failure
  // surfaces visibly instead of silently being swallowed by the
  // best-effort try/catch around `updatePreferredLanguage`. The
  // localized language name is captured at toast time so the message
  // reads in the language the user just switched into.
  const [langToast, setLangToast] = useState<
    { kind: "saved"; languageName: string } | { kind: "error" } | null
  >(null);

  useEffect(() => {
    if (openSettings === "audio") setSettingsOpen(true);
  }, [openSettings]);

  useEffect(() => {
    hasActiveConsentForThisDevice().then(setLocConsent).catch(() => setLocConsent(false));
  }, []);

  useFocusEffect(
    useCallback(() => {
      hasActiveConsentForThisDevice().then(setLocConsent).catch(() => setLocConsent(false));
    }, []),
  );

  useFocusEffect(
    useCallback(() => {
      apiFetch<FieldMe>("/api/field/me")
        .then((me) => {
          setPhotoPath(me.profilePhotoPath);
          setDirectPhotoUrl(me.photoUrl);
          setComplianceEmployeeId(me.employeeId);
        })
        .catch(() => setComplianceEmployeeId(null));
    }, []),
  );

  const onPickContext = async (m: MembershipSummary) => {
    if (m.id === activeMembershipId) return;
    setSwitchingId(m.id);
    try {
      await switchContext(m.id);
    } catch (e) {
      Alert.alert(t("common.error"), e instanceof Error ? e.message : t("auth.switchFailed"));
    } finally {
      setSwitchingId(null);
    }
  };

  const onToggleLocation = async () => {
    setLocBusy(true);
    try {
      if (locConsent) {
        await revokeConsent();
        stopLiveLocationReporter();
        setLocConsent(false);
      } else {
        const perm = await Location.requestForegroundPermissionsAsync();
        if (perm.status !== "granted") {
          Alert.alert(
            t("consent.permissionNeeded"),
            t("consent.permissionMessage"),
          );
          return;
        }
        try {
          await Location.requestBackgroundPermissionsAsync();
        } catch {
          // Foreground-only is still useful while the app is open.
        }
        await acceptConsent();
        await setConsentDeclined(false);
        await startLiveLocationReporter();
        setLocConsent(true);
      }
    } catch (e) {
      Alert.alert(t("common.error"), e instanceof Error ? e.message : t("profile.couldNotUpdate"));
    } finally {
      setLocBusy(false);
    }
  };

  const uploadFrom = async (source: "camera" | "library") => {
    try {
      const result =
        source === "camera" ? await captureAndUploadImage() : await pickAndUploadImage();
      if (!result) return;
      const saved = await apiFetch<{ profilePhotoPath: string | null; photoUrl?: string | null }>(
        "/api/field/me",
        {
          method: "PATCH",
          body: JSON.stringify({ profilePhotoPath: result.objectPath }),
        },
      );
      setPhotoPath(saved.profilePhotoPath);
      setDirectPhotoUrl(saved.photoUrl ?? null);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : t("editProfile.couldNotUpload");
      Alert.alert(t("common.error"), msg);
    }
  };

  const onChangePhoto = () => {
    Alert.alert(
      t("editProfile.photoTitle"),
      t("editProfile.photoChooseSource"),
      [
        { text: t("editProfile.takePhoto"), onPress: () => uploadFrom("camera") },
        { text: t("editProfile.chooseLibrary"), onPress: () => uploadFrom("library") },
        { text: t("common.cancel"), style: "cancel" },
      ],
      { cancelable: true },
    );
  };

  const onLogout = async () => {
    await logout();
    router.replace("/login");
  };

  // Map of supported language code → translation key for its localized
  // display name. Centralized here so adding a new language is a single
  // entry update rather than scattered `=== "es"` ternaries.
  const LANGUAGE_NAME_KEYS: Record<SupportedLanguage, string> = {
    en: "language.english",
    es: "language.spanish",
  };

  const switchLang = async (lng: SupportedLanguage) => {
    await setLanguage(lng);
    // Resolve the localized language name *after* setLanguage so the
    // confirmation reads in the language the user just switched to —
    // "Guardado — English" when switching to EN from a Spanish UI, etc.
    const languageName = t(LANGUAGE_NAME_KEYS[lng]);
    try {
      await updatePreferredLanguage(lng);
      setLangToast({ kind: "saved", languageName });
    } catch {
      // Task #838: surface the rare save failure as a visible toast
      // instead of silently swallowing it, so the user knows their
      // preference may not be persisted across devices.
      setLangToast({ kind: "error" });
    }
  };

  // Task #838: auto-dismiss the language confirmation toast after ~3s.
  // Mirrors the cadence used for the manual-refresh toast on the
  // history/open-tickets screens so the cue feels consistent.
  useEffect(() => {
    if (!langToast) return;
    const handle = setTimeout(() => setLangToast(null), 3000);
    return () => clearTimeout(handle);
  }, [langToast]);

  const hasPhoto = !!(photoPath || directPhotoUrl);

  return (
    <ScreenSafeArea style={styles.flex}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
      <View style={styles.standardHeader}>
        <BrandTitleRow subtitle="iOS Portal" logoTestId="profile-company-logo" platformLogoTestId="profile-vndrly-logo" />
        <View style={styles.pageTitleRow}>
          <View style={styles.pageTitleStart}>
            <SphereBackButton
              onPress={() => {
                if (router.canGoBack()) {
                  router.back();
                }
              }}
              size={40}
              testID="profile-page-back"
            />
            <Text accessibilityRole="header" style={[styles.pageTitle, { color: colors.foreground }]}>
              {t("tabs.profile")}
            </Text>
          </View>
          <AskVVoiceIndicator inline />
        </View>
      </View>
      <SafetyTrainingBanner />
      <View style={styles.header}>
        <TouchableOpacity onPress={onChangePhoto} style={styles.avatarWrap}>
          {hasPhoto ? (
            <ProfilePhotoImage
              profilePhotoPath={photoPath}
              photoUrl={directPhotoUrl}
              style={styles.avatar}
            />
          ) : (
            <View
              style={[
                styles.avatar,
                styles.avatarPlaceholder,
                { backgroundColor: colors.accent },
              ]}
            >
              <Feather name="user" size={36} color={colors.accentForeground} />
            </View>
          )}
          <View
            style={[styles.cameraBadge, { backgroundColor: colors.primary }]}
          >
            <Feather name="camera" size={14} color={colors.primaryForeground} />
          </View>
        </TouchableOpacity>
        <Text style={[styles.name, { color: colors.foreground }]}>
          {user?.displayName || user?.username || "—"}
        </Text>
        <Text style={[styles.role, { color: colors.mutedForeground }]}>
          {user?.username}
        </Text>
        <View style={styles.profileIconActions}>
          <TouchableOpacity
            accessibilityLabel={t("profile.settings")}
            accessibilityRole="button"
            onPress={() => setSettingsOpen((open) => !open)}
            style={styles.profileIconButton}
            testID="button-profile-settings"
          >
            <Feather
              name={settingsOpen ? "x" : "settings"}
              size={20}
              color="#ffffff"
            />
          </TouchableOpacity>
          <TouchableOpacity
            accessibilityLabel={t("nav.signOut")}
            accessibilityRole="button"
            onPress={onLogout}
            style={styles.profileIconButton}
            testID="button-sign-out"
          >
            <Feather name="log-out" size={18} color="#ffffff" />
          </TouchableOpacity>
        </View>
      </View>

      {availableMemberships.length >= 2 ? (
        <View
          style={[
            styles.section,
            { borderColor: colors.border, backgroundColor: colors.card },
          ]}
          testID="section-active-org"
        >
          <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>
            {t("auth.activeOrg")}
          </Text>
          <Text
            style={{
              color: colors.mutedForeground,
              fontSize: 12,
              marginBottom: 10,
              lineHeight: 16,
            }}
          >
            {t("auth.switchOrgHelp")}
          </Text>
          {availableMemberships.map((m) => {
            const isActive = m.id === activeMembershipId;
            const busy = switchingId !== null;
            const isThisBusy = switchingId === m.id;
            const partner = m.orgType === "partner";
            return (
              <TouchableOpacity
                key={m.id}
                onPress={() => onPickContext(m)}
                disabled={busy}
                style={[
                  styles.orgRow,
                  {
                    borderColor: isActive ? colors.primary : colors.border,
                    backgroundColor: isActive ? colors.accent : "transparent",
                    opacity: busy && !isThisBusy ? 0.5 : 1,
                  },
                ]}
                testID={`button-pick-context-${m.id}`}
              >
                <View
                  style={[
                    styles.orgPill,
                    partner ? styles.orgPillPartner : styles.orgPillVendor,
                  ]}
                >
                  <Text style={styles.orgPillText}>
                    {partner ? t("auth.partner") : t("auth.vendor")}
                  </Text>
                </View>
                <Text
                  style={[styles.orgRowName, { color: colors.foreground }]}
                  numberOfLines={1}
                  ellipsizeMode="tail"
                >
                  {m.orgName}
                </Text>
                {isActive ? (
                  <Feather name="check" size={18} color={colors.primary} />
                ) : isThisBusy ? (
                  <Feather name="loader" size={18} color={colors.mutedForeground} />
                ) : null}
              </TouchableOpacity>
            );
          })}
        </View>
      ) : null}

      {settingsOpen ? (
        <View
          style={[
            styles.section,
            { borderColor: colors.border, backgroundColor: colors.card },
          ]}
          testID="profile-settings-panel"
        >
          <Text style={[styles.settingsTitle, { color: colors.foreground }]}>
            {t("profile.settings")}
          </Text>

          <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>
            {t("profile.language")}
          </Text>
          <View style={styles.row}>
            {SUPPORTED_LANGUAGES.map((lng) => {
              const active = i18n.language === lng;
              return (
                <LayeredPillButton
                  key={lng}
                  onPress={() => switchLang(lng)}
                  inactive={!active}
                  style={styles.langBtn}
                  testID={`button-lang-${lng}`}
                >
                  <Text style={[styles.langBtnText, active ? styles.pillTextShadow : null]}>
                    {t(LANGUAGE_NAME_KEYS[lng])}
                  </Text>
                </LayeredPillButton>
              );
            })}
          </View>

          <View style={[styles.settingsDivider, { backgroundColor: colors.border }]} />
          <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>
            {t("profile.locationSharing")}
          </Text>
          <Text style={{ color: colors.foreground, fontSize: 13, marginBottom: 10, lineHeight: 18 }}>
            {locConsent ? t("profile.locationOnDesc") : t("profile.locationOffDesc")}
          </Text>
          <Text style={{ color: colors.mutedForeground, fontSize: 11, marginBottom: 10, lineHeight: 16 }}>
            {t("profile.locationFinePrint")}
          </Text>
          {locConsent ? (
            <LayeredPillButton
              onPress={onToggleLocation}
              disabled={locBusy}
              color="#dc2626"
              inactive
              style={styles.locationBtn}
              testID="button-toggle-location-consent"
            >
              <Feather name="map-pin" size={16} color="#ffffff" />
              <Text style={styles.actionText}>
                {locBusy ? "…" : t("profile.stopSharing")}
              </Text>
            </LayeredPillButton>
          ) : (
            <AmberButton
              onPress={onToggleLocation}
              disabled={locConsent === null || locBusy}
              loading={locBusy}
              style={styles.locationBtn}
              textStyle={styles.locationBtnText}
              testID="button-toggle-location-consent"
            >
              {locConsent === null ? "…" : t("profile.turnOnSharing")}
            </AmberButton>
          )}
          <TouchableOpacity
            onPress={() => router.push("/location-consent")}
            style={styles.locationDetailsLink}
            testID="button-location-consent-details"
          >
            <Text style={{ color: colors.primary, fontFamily: "Inter_500Medium", fontSize: 13 }}>
              {t("profile.reviewLocationDetails")}
            </Text>
          </TouchableOpacity>

          <View style={[styles.settingsDivider, { backgroundColor: colors.border }]} />
          <WorkHubDeviceSettings />
        </View>
      ) : null}

      <LayeredPillButton
        onPress={() => router.push("/edit-profile")}
        height={40}
        style={styles.actionBtn}
        testID="button-edit-profile"
      >
        <Feather name="edit-3" size={16} color="#ffffff" style={styles.pillIconShadow} />
        <Text style={[styles.actionText, styles.pillTextShadow]}>{t("profile.editProfile")}</Text>
        <Feather name="chevron-right" size={18} color="#ffffff" style={[styles.actionChevron, styles.pillIconShadow]} />
      </LayeredPillButton>

      {user?.role !== "partner" ? (
        <LayeredPillButton
          onPress={() => router.push("/compliance")}
          height={40}
          style={styles.actionBtn}
          testID="button-compliance-card"
        >
          <Feather name="shield" size={16} color="#ffffff" style={styles.pillIconShadow} />
          <Text style={[styles.actionText, styles.pillTextShadow]}>{t("profile.complianceCard")}</Text>
          <Feather name="chevron-right" size={18} color="#ffffff" style={[styles.actionChevron, styles.pillIconShadow]} />
        </LayeredPillButton>
      ) : null}

      <GateLocationsCard key={activeMembershipId ?? "no-membership"} />

      {canManageCompany ? (
        <LayeredPillButton
          onPress={() => router.push("/employees")}
          height={40}
          style={styles.actionBtn}
          testID="button-manage-employees"
        >
          <Feather name="users" size={16} color="#ffffff" style={styles.pillIconShadow} />
          <Text style={[styles.actionText, styles.pillTextShadow]}>{t("profile.manageEmployees")}</Text>
          <Feather name="chevron-right" size={18} color="#ffffff" style={[styles.actionChevron, styles.pillIconShadow]} />
        </LayeredPillButton>
      ) : null}

      {canManageCompany ? (
        <LayeredPillButton
          onPress={() => router.push("/services")}
          height={40}
          style={styles.actionBtn}
          testID="button-company-services"
        >
          <Feather name="briefcase" size={16} color="#ffffff" style={styles.pillIconShadow} />
          <Text style={[styles.actionText, styles.pillTextShadow]}>
            {t("profile.companyServices")}
          </Text>
          <Feather name="chevron-right" size={18} color="#ffffff" style={[styles.actionChevron, styles.pillIconShadow]} />
        </LayeredPillButton>
      ) : null}

      {/* Task #838: brief language-change confirmation toast.
          Mirrors the manual-refresh toast styling used on the
          history/open-tickets screens so the visual language stays
          consistent across the field app. `pointerEvents="none"` so
          the user can keep interacting with the buttons underneath
          while the toast fades. */}
      {langToast ? (
        <View
          style={styles.langToastContainer}
          pointerEvents="none"
          testID={
            langToast.kind === "saved"
              ? "toast-language-saved"
              : "toast-language-error"
          }
        >
          <View
            style={[
              styles.langToast,
              langToast.kind === "error"
                ? { backgroundColor: colors.destructive }
                : null,
            ]}
          >
            <Feather
              name={langToast.kind === "saved" ? "check-circle" : "alert-circle"}
              size={16}
              color="#ffffff"
            />
            <Text style={styles.langToastText}>
              {langToast.kind === "saved"
                ? t("profile.languageSavedToast", {
                    language: langToast.languageName,
                  })
                : t("profile.languageSaveFailedToast")}
            </Text>
          </View>
        </View>
      ) : null}
      </ScrollView>
    </ScreenSafeArea>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  scrollContent: { paddingBottom: 32 },
  standardHeader: { gap: 14, marginBottom: 14, paddingHorizontal: 20, paddingTop: 20 },
  pageTitleRow: { alignItems: "center", flexDirection: "row", gap: 12, justifyContent: "space-between" },
  pageTitleStart: { alignItems: "center", flex: 1, flexDirection: "row", gap: 10, minWidth: 0 },
  pageTitle: { flexShrink: 1, fontFamily: "Inter_700Bold", fontSize: 20 },
  locationBtn: { alignSelf: "stretch" },
  locationBtnText: { fontFamily: "Inter_600SemiBold", fontSize: 15 },
  locationDetailsLink: { marginTop: 10, alignSelf: "center", paddingVertical: 4 },
  actionBtn: { marginHorizontal: 16, marginTop: 12, alignSelf: "stretch" },
  actionText: { color: "#ffffff", fontFamily: "Inter_600SemiBold", fontSize: 15 },
  actionChevron: { marginLeft: "auto" },
  pillTextShadow: {
    textShadowColor: "rgba(0, 0, 0, 0.63)",
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 4,
  },
  pillIconShadow: {
    textShadowColor: "rgba(0, 0, 0, 0.63)",
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 4,
  },
  header: { alignItems: "center", paddingTop: 24, paddingBottom: 16, position: "relative" },
  profileIconActions: {
    alignItems: "center",
    bottom: 26,
    flexDirection: "row",
    gap: 8,
    position: "absolute",
    right: 24,
  },
  profileIconButton: {
    alignItems: "center",
    borderRadius: 20,
    height: 40,
    justifyContent: "center",
    width: 40,
  },
  avatarWrap: { position: "relative" },
  avatar: { width: 96, height: 96, borderRadius: 48 },
  avatarPlaceholder: { alignItems: "center", justifyContent: "center" },
  cameraBadge: {
    position: "absolute",
    bottom: 0,
    right: 0,
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "#fff",
  },
  name: { fontFamily: "Inter_700Bold", fontSize: 18, marginTop: 12 },
  role: { fontFamily: "Inter_400Regular", fontSize: 13, marginTop: 2 },
  section: {
    marginHorizontal: 16,
    marginTop: 16,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
  },
  sectionTitle: {
    fontFamily: "Inter_500Medium",
    fontSize: 12,
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: 10,
  },
  settingsTitle: {
    fontFamily: "Inter_700Bold",
    fontSize: 18,
    marginBottom: 16,
  },
  settingsDivider: { height: 1, marginVertical: 16 },
  settingsActionBtn: { alignSelf: "stretch", marginTop: 12 },
  row: { flexDirection: "row", gap: 8 },
  langBtn: {
    flex: 1,
  },
  langBtnText: {
    color: "#ffffff",
    fontFamily: "Inter_600SemiBold",
    fontSize: 14,
  },
  orgRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 10,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    marginTop: 6,
  },
  orgRowName: {
    flex: 1,
    fontFamily: "Inter_600SemiBold",
    fontSize: 14,
  },
  orgPill: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  orgPillPartner: { backgroundColor: "#3b82f6" },
  orgPillVendor: { backgroundColor: "#7c3aed" },
  orgPillText: {
    fontFamily: "Inter_700Bold",
    fontSize: 9,
    letterSpacing: 0.6,
    textTransform: "uppercase",
    color: "#ffffff",
  },
  // Task #838: language-change confirmation toast. Pinned to the
  // bottom of the screen and styled the same way as the manual-
  // refresh toast on the history screen so the visual cue is
  // consistent across the field app. The "saved" pill uses the
  // success green; the "error" pill swaps in the theme's destructive
  // color inline so it adapts to dark mode.
  langToastContainer: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 32,
    alignItems: "center",
  },
  langToast: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#15803d",
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 999,
    maxWidth: "90%",
    shadowColor: "#000",
    shadowOpacity: 0.2,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  langToastText: {
    color: "#ffffff",
    fontFamily: "Inter_600SemiBold",
    fontSize: 13,
  },
});
