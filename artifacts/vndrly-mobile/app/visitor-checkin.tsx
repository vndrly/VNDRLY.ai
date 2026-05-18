import { Feather } from "@expo/vector-icons";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CameraView, useCameraPermissions } from "expo-camera";
import * as Location from "expo-location";
import { router } from "expo-router";
import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ActivityIndicator,
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
import { SafeAreaView } from "react-native-safe-area-context";

import AmberButton from "@/components/AmberButton";
import VisitorHostPicker from "@/components/VisitorHostPicker";
import { useColors } from "@/hooks/useColors";
import { setToken, setUser } from "@/lib/auth";
import { translateApiError } from "@/lib/apiErrors";
import {
  fetchActiveVisit,
  fetchSiteContext,
  guestLogout,
  visitorCheckOut,
  type SiteContext,
} from "@/lib/guest";
import {
  extractSiteCode,
  submitVisitorCheckIn,
} from "@/lib/visitorCheckin";

// Mirrors `app/(tabs)/scan.tsx`: when the host build doesn't actually have
// the expo-camera native view registered (Expo Go / un-rebuilt dev client),
// mounting <CameraView> throws "View config getter callback for component
// ViewManagerAdapter_ExpoCamera_… must be a function" and red-screens the
// entire visitor flow. Catch it, exit scan mode, and tell the user to type
// the site code instead so the front-desk iPad keeps working.
class CameraBoundary extends React.Component<
  { onFail: () => void; children: React.ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch() {
    this.props.onFail();
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

// Task #112: detect a 401 surfaced by `apiFetch` (which tags every non-OK
// response with `err.status`). Used in two places:
//   - the useEffect that watches the background queries for an expired
//     session token, so the screen can flip into the friendly
//     "session-expired" state without waiting for the visitor to tap
//     check-in/out again.
//   - the mutation catch blocks, so a 401 there bypasses the generic
//     translateApiError() Alert and routes through the same friendly UI.
function is401(e: unknown): boolean {
  return !!e && typeof e === "object" && (e as { status?: number }).status === 401;
}

export default function VisitorCheckInScreen() {
  const colors = useColors();
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [siteCode, setSiteCode] = useState("");
  const [confirmedCode, setConfirmedCode] = useState<string | null>(null);
  const [siteConfirmed, setSiteConfirmed] = useState(false);
  const [hostKey, setHostKey] = useState<string | null>(null);
  const [purpose, setPurpose] = useState("");
  const [duration, setDuration] = useState("60");
  const [busy, setBusy] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [camPerm, requestCamPerm] = useCameraPermissions();
  // Task #112: when the 24-hour guest token has lapsed, every visitor API
  // call returns 401. Instead of showing the generic translateApiError()
  // alert (which lands on the front-desk iPad as "Your session has expired
  // — please sign in again." in a system modal), flip into a dedicated
  // friendly screen with a button straight back to the visitor sign-in
  // form. Tracked here so any 401 — from queries or mutations — can flip
  // it on without prop-drilling.
  const [sessionExpired, setSessionExpired] = useState(false);

  const onScanned = ({ data }: { data: string }) => {
    if (!scanning) return;
    setScanning(false);
    const code = extractSiteCode(data);
    if (!code) {
      Alert.alert(t("visitor.error"), t("visitor.invalidQr"));
      return;
    }
    setSiteCode(code);
    setConfirmedCode(code.toUpperCase());
    setSiteConfirmed(false);
    setHostKey(null);
  };

  const openScanner = async () => {
    if (!camPerm?.granted) {
      const r = await requestCamPerm();
      if (!r.granted) {
        Alert.alert(t("visitor.error"), t("visitor.cameraDenied"));
        return;
      }
    }
    setScanning(true);
  };

  const activeQuery = useQuery({
    queryKey: ["visit-active"],
    queryFn: fetchActiveVisit,
    refetchInterval: 30000,
    // Don't keep retrying expired-session 401s — they won't recover until
    // the visitor signs back in, and every retry just delays the
    // session-expired screen.
    retry: false,
  });

  const ctxQuery = useQuery<SiteContext>({
    queryKey: ["site-context", confirmedCode],
    queryFn: () => fetchSiteContext(confirmedCode!),
    enabled: !!confirmedCode,
    retry: false,
  });

  // Background queries swallow rejected promises into `query.error`, so the
  // catch blocks on the mutations can't see them. Watch the two query
  // errors here and flip into the session-expired screen the same way a
  // mutation 401 would.
  useEffect(() => {
    if (sessionExpired) return;
    if (is401(activeQuery.error) || is401(ctxQuery.error)) {
      setSessionExpired(true);
    }
  }, [activeQuery.error, ctxQuery.error, sessionExpired]);

  const onConfirmSite = () => {
    const code = siteCode.trim().toUpperCase();
    if (!code) return;
    setConfirmedCode(code);
    setSiteConfirmed(false);
    setHostKey(null);
  };

  const onAcceptSite = () => setSiteConfirmed(true);

  const onChangeSite = () => {
    setSiteConfirmed(false);
    setConfirmedCode(null);
    setSiteCode("");
    setHostKey(null);
  };

  const onCheckIn = async () => {
    const ctx = ctxQuery.data;
    if (!ctx || !hostKey) {
      Alert.alert(t("visitor.error"), t("visitor.pickHost"));
      return;
    }
    setBusy(true);
    try {
      const result = await submitVisitorCheckIn({
        ctx,
        hostKey,
        purpose,
        durationStr: duration,
      });
      if (!result.ok) {
        if (result.reason === "no-host") {
          Alert.alert(t("visitor.error"), t("visitor.pickHost"));
        } else if (result.reason === "location-denied") {
          Alert.alert(t("visitor.error"), t("visitor.locationDenied"));
        }
        return;
      }
      await qc.invalidateQueries({ queryKey: ["visit-active"] });
    } catch (e) {
      if (is401(e)) {
        setSessionExpired(true);
        return;
      }
      Alert.alert(t("visitor.error"), translateApiError(e, t, t("tickets.errorCheckIn")));
    } finally {
      setBusy(false);
    }
  };

  const onCheckOut = async () => {
    const v = activeQuery.data;
    if (!v) return;
    setBusy(true);
    try {
      let lat: number | undefined; let lng: number | undefined;
      try {
        const perm = await Location.requestForegroundPermissionsAsync();
        if (perm.status === "granted") {
          const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
          lat = pos.coords.latitude; lng = pos.coords.longitude;
        }
      } catch {}
      await visitorCheckOut(v.id, lat, lng);
      await qc.invalidateQueries({ queryKey: ["visit-active"] });
      setConfirmedCode(null);
      setSiteCode("");
      setHostKey(null);
      setPurpose("");
    } catch (e) {
      if (is401(e)) {
        setSessionExpired(true);
        return;
      }
      Alert.alert(t("visitor.error"), translateApiError(e, t, t("tickets.errorCheckOut")));
    } finally {
      setBusy(false);
    }
  };

  const onSignOut = async () => {
    await guestLogout();
    router.replace("/login");
  };

  // Task #112: leave the session-expired screen by clearing the dead token
  // (so apiFetch stops sending it) and dropping the visitor straight on
  // the visitor sign-in form. We deliberately don't call guestLogout()
  // here — the server-side session has already expired, so the
  // /api/auth/guest/logout call would itself 401 and add latency.
  const onSignInAgain = async () => {
    await setToken(null);
    await setUser(null);
    router.replace("/guest-login");
  };

  const active = activeQuery.data;

  if (sessionExpired) {
    // Replace the whole screen — don't show the header (with its sign-out
    // link to the staff login) or any of the in-flight forms. The visitor
    // is at the front desk and just needs one obvious action.
    return (
      <SafeAreaView style={[styles.flex, { backgroundColor: colors.background }]}>
        <View style={[styles.container, styles.sessionExpiredContainer]}>
          <View
            testID="session-expired-card"
            style={[styles.card, { borderColor: colors.border, backgroundColor: colors.card }]}
          >
            <Text style={[styles.cardTitle, { color: colors.foreground }]}>
              {t("visitor.sessionExpiredTitle")}
            </Text>
            <Text style={[styles.muted, { color: colors.mutedForeground, marginTop: 8 }]}>
              {t("visitor.sessionExpiredBody")}
            </Text>
            <AmberButton
              testID="session-expired-sign-in-btn"
              onPress={onSignInAgain}
              height={48}
              style={{ marginTop: 18 }}
            >
              {t("visitor.signInAgain")}
            </AmberButton>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.flex, { backgroundColor: colors.background }]}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
          <View style={styles.header}>
            <Text style={[styles.title, { color: colors.foreground }]}>{t("visitor.headerTitle")}</Text>
            <TouchableOpacity onPress={onSignOut}>
              <Text style={[styles.signOut, { color: colors.primary }]}>{t("nav.signOut")}</Text>
            </TouchableOpacity>
          </View>

          {activeQuery.isLoading ? (
            <ActivityIndicator color={colors.primary} />
          ) : active ? (
            <View style={[styles.card, { borderColor: colors.border, backgroundColor: colors.card }]}>
              <Text style={[styles.cardTitle, { color: colors.foreground }]}>{t("visitor.activeAt")} {active.siteName}</Text>
              {active.siteAddress ? <Text style={[styles.muted, { color: colors.mutedForeground }]}>{active.siteAddress}</Text> : null}
              <Text style={[styles.muted, { color: colors.mutedForeground }]}>
                {t("visitor.host")}: {active.hostType === "partner" ? active.hostPartnerName : active.hostVendorName}
              </Text>
              {active.purpose ? <Text style={[styles.muted, { color: colors.mutedForeground }]}>{t("visitor.purpose")}: {active.purpose}</Text> : null}
              <Text style={[styles.muted, { color: colors.mutedForeground }]}>
                {t("visitor.checkedInAt")}: {new Date(active.checkInTime).toLocaleString()}
              </Text>
              <AmberButton onPress={onCheckOut} loading={busy} disabled={busy} height={48} style={{ marginTop: 14 }}>
                {t("visitor.checkOut")}
              </AmberButton>
            </View>
          ) : scanning ? (
            <View style={styles.scannerWrap}>
              <CameraBoundary
                onFail={() => {
                  setScanning(false);
                  Alert.alert(
                    t("visitor.error"),
                    "Camera unavailable in this build. Please type the site code instead.",
                  );
                }}
              >
                <CameraView
                  style={StyleSheet.absoluteFill}
                  facing="back"
                  barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
                  onBarcodeScanned={onScanned}
                />
                <View style={styles.scannerOverlay} pointerEvents="box-none">
                  <View style={[styles.scannerFrame, { borderColor: colors.primary }]} />
                  <Text style={styles.scannerHint}>{t("visitor.scanHint")}</Text>
                  <TouchableOpacity onPress={() => setScanning(false)} style={[styles.scannerCancel, { backgroundColor: colors.card }]}>
                    <Text style={[styles.scannerCancelText, { color: colors.foreground }]}>{t("visitor.cancel")}</Text>
                  </TouchableOpacity>
                </View>
              </CameraBoundary>
            </View>
          ) : (
            <View>
              <Text style={[styles.label, { color: colors.foreground }]}>{t("visitor.siteCodeLabel")}</Text>
              <View style={styles.row}>
                <TextInput
                  testID="site-code-input"
                  value={siteCode}
                  onChangeText={setSiteCode}
                  autoCapitalize="characters"
                  placeholder={t("visitor.siteCodePlaceholder")}
                  placeholderTextColor={colors.mutedForeground}
                  style={[styles.input, { flex: 1, borderColor: colors.border, color: colors.foreground, backgroundColor: colors.card }]}
                />
                <TouchableOpacity testID="site-lookup-btn" onPress={onConfirmSite} style={[styles.lookupBtn, { borderColor: colors.primary }]}>
                  <Feather name="search" size={18} color={colors.primary} />
                </TouchableOpacity>
              </View>
              <TouchableOpacity testID="open-scanner-btn" onPress={openScanner} style={[styles.scanBtn, { borderColor: colors.primary }]}>
                <Feather name="maximize" size={18} color={colors.primary} />
                <Text style={[styles.scanBtnText, { color: colors.primary }]}>{t("visitor.scanQr")}</Text>
              </TouchableOpacity>

              {ctxQuery.isLoading ? (
                <View style={{ marginTop: 16 }}><ActivityIndicator color={colors.primary} /></View>
              ) : ctxQuery.error ? (
                <Text style={[styles.error, { color: colors.destructive }]}>
                  {(ctxQuery.error as Error & { status?: number }).status === 404
                    ? t("visitor.unknownSiteCode")
                    : t("visitor.siteLookupFailed")}
                </Text>
              ) : ctxQuery.data && !siteConfirmed ? (
                <View style={[styles.card, { borderColor: colors.primary, backgroundColor: colors.card, marginTop: 16 }]}>
                  <Text style={[styles.cardTitle, { color: colors.foreground }]}>{t("visitor.confirmSiteTitle")}</Text>
                  <Text style={[styles.muted, { color: colors.mutedForeground, marginBottom: 8 }]}>{t("visitor.confirmSitePrompt")}</Text>
                  <Text style={[styles.cardTitle, { color: colors.foreground, fontSize: 16, marginTop: 6 }]}>{ctxQuery.data.site.name}</Text>
                  <Text style={[styles.muted, { color: colors.mutedForeground }]}>{ctxQuery.data.site.address}</Text>
                  <View style={{ flexDirection: "row", gap: 10, marginTop: 16 }}>
                    <TouchableOpacity testID="not-my-site-btn" onPress={onChangeSite} style={[styles.secondaryBtn, { borderColor: colors.border }]}>
                      <Text style={[styles.secondaryBtnText, { color: colors.foreground }]}>{t("visitor.notMySite")}</Text>
                    </TouchableOpacity>
                    <View style={{ flex: 1 }}>
                      <AmberButton testID="accept-site-btn" onPress={onAcceptSite} height={44}>{t("visitor.yesContinue")}</AmberButton>
                    </View>
                  </View>
                </View>
              ) : ctxQuery.data && siteConfirmed ? (
                <VisitorHostPicker
                  ctx={ctxQuery.data}
                  hostKey={hostKey}
                  onSelectHost={setHostKey}
                  purpose={purpose}
                  onPurposeChange={setPurpose}
                  duration={duration}
                  onDurationChange={setDuration}
                  busy={busy}
                  onSubmit={onCheckIn}
                  onChangeSite={onChangeSite}
                  labels={{
                    changeSite: t("visitor.changeSite"),
                    whoVisiting: t("visitor.whoVisiting"),
                    noHosts: t("visitor.noHosts"),
                    purpose: t("visitor.purpose"),
                    purposePlaceholder: t("visitor.purposePlaceholder"),
                    expectedMinutes: t("visitor.expectedMinutes"),
                    checkIn: t("visitor.checkIn"),
                    geofenceNote: t("visitor.geofenceNote"),
                  }}
                />
              ) : null}
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: { padding: 20, paddingBottom: 40 },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 18 },
  title: { fontFamily: "Inter_700Bold", fontSize: 22 },
  signOut: { fontFamily: "Inter_600SemiBold", fontSize: 14 },
  label: { fontFamily: "Inter_500Medium", fontSize: 13, marginBottom: 6 },
  row: { flexDirection: "row", gap: 8, alignItems: "center" },
  input: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, fontFamily: "Inter_400Regular", fontSize: 16 },
  lookupBtn: { borderWidth: 1.5, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12 },
  card: { borderWidth: 1, borderRadius: 12, padding: 16 },
  cardTitle: { fontFamily: "Inter_600SemiBold", fontSize: 18, marginBottom: 6 },
  muted: { fontFamily: "Inter_400Regular", fontSize: 13, marginTop: 2 },
  hostOption: { flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1, borderRadius: 10, padding: 12, marginTop: 8 },
  hostLabel: { fontFamily: "Inter_500Medium", fontSize: 14 },
  note: { fontFamily: "Inter_400Regular", fontSize: 12, marginTop: 10, textAlign: "center" },
  error: { fontFamily: "Inter_500Medium", fontSize: 13, marginTop: 12 },
  scanBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderWidth: 1.5, borderRadius: 10, paddingVertical: 12, marginTop: 10 },
  scanBtnText: { fontFamily: "Inter_600SemiBold", fontSize: 14 },
  secondaryBtn: { flex: 1, borderWidth: 1, borderRadius: 10, paddingVertical: 12, alignItems: "center", justifyContent: "center" },
  secondaryBtnText: { fontFamily: "Inter_600SemiBold", fontSize: 14 },
  scannerWrap: { height: 420, borderRadius: 14, overflow: "hidden", backgroundColor: "#000", marginTop: 6 },
  scannerOverlay: { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center" },
  scannerFrame: { width: 220, height: 220, borderWidth: 3, borderRadius: 12 },
  scannerHint: { color: "#fff", fontFamily: "Inter_500Medium", marginTop: 14, textAlign: "center", paddingHorizontal: 16 },
  scannerCancel: { position: "absolute", bottom: 18, paddingHorizontal: 22, paddingVertical: 10, borderRadius: 22 },
  scannerCancelText: { fontFamily: "Inter_600SemiBold", fontSize: 14 },
  sessionExpiredContainer: { flex: 1, justifyContent: "center" },
});
