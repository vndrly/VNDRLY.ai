import { router, useFocusEffect, Stack } from "expo-router";
import React, { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import ScreenSafeArea from "@/components/ScreenSafeArea";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";

import ActiveOrgIndicator from "@/components/ActiveOrgIndicator";
import AmberButton from "@/components/AmberButton";
import InPageHeader from "@/components/InPageHeader";
import { useColors } from "@/hooks/useColors";
import { screenTopPadding } from "@/lib/screen-insets";

// `expo-camera` ships a native view manager. On a host build that wasn't
// rebuilt after the dependency was added (Expo Go, an old dev client) the
// native module is missing and *importing* the package throws synchronously
// — before any React component mounts, so an ErrorBoundary inside the
// component tree can't help. Require it defensively so a missing module
// just disables the camera path instead of red-screening the tab.
let CameraModule: typeof import("expo-camera") | null = null;
let cameraImportError: unknown = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  CameraModule = require("expo-camera") as typeof import("expo-camera");
} catch (err) {
  cameraImportError = err;
}

// Runtime fallback for the case where expo-camera *did* import but its
// native view manager still isn't registered (the symptom is a red-screen
// "View config getter callback for component
// ViewManagerAdapter_ExpoCamera_… must be a function (received `undefined`)"
// the moment <CameraView> mounts). We catch that in an ErrorBoundary so
// the screen degrades to a manual site-code entry form instead of crashing
// the whole tab.
class CameraBoundary extends React.Component<
  { fallback: React.ReactNode; children: React.ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch() {
    // swallow — we render the fallback below
  }
  render() {
    if (this.state.failed) return this.props.fallback;
    return <View style={styles.cameraStage}>{this.props.children}</View>;
  }
}

function extractSiteCode(raw: string): string | null {
  const trimmed = raw.trim();
  try {
    const url = new URL(trimmed);
    const parts = url.pathname.split("/").filter(Boolean);
    const idx = parts.indexOf("portal");
    if (idx >= 0 && parts[idx + 1]) return decodeURIComponent(parts[idx + 1]);
  } catch {
    // not a URL — treat the entire string as a site code
  }
  return /^[A-Za-z0-9_-]+$/.test(trimmed) ? trimmed : null;
}

/** Bottom inset so permission CTAs clear the tab bar. */
function useTabBarClearance(): number {
  const insets = useSafeAreaInsets();
  // Tab bar (~49) + home indicator; InPageHeader already handles top inset.
  return Math.max(insets.bottom, 12) + 56;
}

function ScanPermissionPanel({
  colors,
  t,
  message,
  onGrant,
  loading,
}: {
  colors: ReturnType<typeof useColors>;
  t: ReturnType<typeof useTranslation>["t"];
  message: string;
  onGrant?: () => void;
  loading?: boolean;
}) {
  const tabClearance = useTabBarClearance();
  return (
    <ScreenSafeArea
      style={[styles.flex, { backgroundColor: colors.pageBackground }]}
      edges={["left", "right"]}
      includeTopGap={false}
    >
      <Stack.Screen options={{ headerShown: false }} />
      <InPageHeader
        title={t("tabs.scan")}
        onBack={() => router.push("/(tabs)" as never)}
        right={<ActiveOrgIndicator />}
      />
      <ScrollView
        contentContainerStyle={[
          styles.permissionScroll,
          { paddingBottom: tabClearance },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.permissionBody}>
          <Feather name="camera" size={40} color={colors.primary} />
          <Text style={[styles.msg, { color: colors.foreground }]}>{message}</Text>
          {loading ? (
            <ActivityIndicator color={colors.primary} style={{ marginTop: 8 }} />
          ) : onGrant ? (
            <AmberButton
              onPress={onGrant}
              style={styles.grantBtn}
              testID="button-grant-camera-permission"
            >
              {t("scanScreen.grantPermission")}
            </AmberButton>
          ) : null}
        </View>
      </ScrollView>
    </ScreenSafeArea>
  );
}

export default function ScanScreen() {
  const colors = useColors();
  const { t } = useTranslation();

  if (!CameraModule) {
    return (
      <ScreenSafeArea
        style={[styles.flex, { backgroundColor: colors.pageBackground }]}
        edges={["left", "right"]}
        includeTopGap={false}
      >
        <Stack.Screen options={{ headerShown: false }} />
        <InPageHeader
          title={t("tabs.scan")}
          onBack={() => router.push("/(tabs)" as never)}
          right={<ActiveOrgIndicator />}
        />
        <ManualSiteCodeFallback
          colors={colors}
          t={t}
          onSubmit={(code) =>
            router.push({ pathname: "/new-ticket", params: { siteCode: code } })
          }
        />
      </ScreenSafeArea>
    );
  }

  return (
    <ScanScreenWithCamera
      colors={colors}
      t={t}
      CameraView={CameraModule.CameraView}
      useCameraPermissions={CameraModule.useCameraPermissions}
    />
  );
}

// Split out so the camera hooks only run when the native module is present
// — calling `useCameraPermissions()` against a missing module throws.
function ScanScreenWithCamera({
  colors,
  t,
  CameraView,
  useCameraPermissions,
}: {
  colors: ReturnType<typeof useColors>;
  t: ReturnType<typeof useTranslation>["t"];
  CameraView: NonNullable<typeof CameraModule>["CameraView"];
  useCameraPermissions: NonNullable<typeof CameraModule>["useCameraPermissions"];
}) {
  const insets = useSafeAreaInsets();
  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState(false);

  useFocusEffect(
    useCallback(() => {
      setScanned(false);
    }, []),
  );

  if (!permission) {
    return (
      <ScanPermissionPanel
        colors={colors}
        t={t}
        message={t("scanScreen.loadingPermission", {
          defaultValue: "Checking camera access…",
        })}
        loading
      />
    );
  }

  if (!permission.granted) {
    return (
      <ScanPermissionPanel
        colors={colors}
        t={t}
        message={t("scanScreen.cameraDenied")}
        onGrant={requestPermission}
      />
    );
  }

  const onScanned = ({ data }: { data: string }) => {
    if (scanned) return;
    setScanned(true);
    const code = extractSiteCode(data);
    if (!code) {
      Alert.alert(
        t("scanScreen.invalidQrTitle"),
        t("scanScreen.invalidQrBody", { data }),
        [{ text: t("scanScreen.ok"), onPress: () => setScanned(false) }],
      );
      return;
    }
    router.push({ pathname: "/new-ticket", params: { siteCode: code } });
  };

  return (
    <View style={styles.flex}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.cameraRoot}>
        <CameraBoundary
          fallback={
            <ManualSiteCodeFallback
              colors={colors}
              t={t}
              onSubmit={(code) =>
                router.push({ pathname: "/new-ticket", params: { siteCode: code } })
              }
            />
          }
        >
          <CameraView
            style={styles.cameraFill}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
            onBarcodeScanned={scanned ? undefined : onScanned}
          />
          <View style={styles.scanOverlay} pointerEvents="box-none">
            <View
              style={[
                styles.headerOverlay,
                { paddingTop: screenTopPadding(insets.top), backgroundColor: colors.background },
              ]}
            >
              <InPageHeader
                title={t("tabs.scan")}
                onBack={() => router.push("/(tabs)" as never)}
                right={<ActiveOrgIndicator />}
                suppressTopInset
                style={{ backgroundColor: "transparent" }}
              />
            </View>
            <View style={styles.overlayCenter} pointerEvents="none">
              <View style={[styles.frame, { borderColor: colors.primary }]} />
              <Text style={styles.hint}>{t("tickets.newTicket")}</Text>
            </View>
          </View>
        </CameraBoundary>
      </View>
    </View>
  );
}

// Manual site-code entry shown when the native camera module is missing.
function ManualSiteCodeFallback({
  colors,
  t,
  onSubmit,
}: {
  colors: ReturnType<typeof useColors>;
  t: (k: string) => string;
  onSubmit: (code: string) => void;
}) {
  const [value, setValue] = useState("");
  const tabClearance = useTabBarClearance();
  const trimmed = value.trim();
  const valid = /^[A-Za-z0-9_-]+$/.test(trimmed);
  return (
    <ScrollView
      contentContainerStyle={[
        styles.permissionScroll,
        { paddingBottom: tabClearance },
      ]}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.permissionBody}>
        <Text style={[styles.msg, { color: colors.foreground }]}>
          Camera unavailable in this build. Enter the site code from the QR poster instead.
        </Text>
        <TextInput
          value={value}
          onChangeText={setValue}
          autoCapitalize="characters"
          autoCorrect={false}
          placeholder="SITE-XXXXXXXX"
          placeholderTextColor={colors.mutedForeground}
          style={[
            styles.input,
            {
              color: colors.foreground,
              borderColor: colors.border,
              backgroundColor: colors.card,
            },
          ]}
        />
        <AmberButton
          onPress={() => valid && onSubmit(trimmed)}
          disabled={!valid}
          style={styles.grantBtn}
        >
          {t("tickets.newTicket")}
        </AmberButton>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  cameraRoot: { flex: 1, backgroundColor: "#000" },
  cameraStage: { flex: 1, overflow: "hidden" },
  cameraFill: { flex: 1, width: "100%" },
  scanOverlay: {
    ...StyleSheet.absoluteFillObject,
  },
  headerOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    zIndex: 2,
  },
  permissionScroll: {
    flexGrow: 1,
    justifyContent: "center",
    paddingHorizontal: 24,
  },
  permissionBody: {
    alignItems: "center",
    gap: 16,
  },
  overlayCenter: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  msg: {
    fontFamily: "Inter_500Medium",
    fontSize: 15,
    textAlign: "center",
  },
  grantBtn: {
    alignSelf: "stretch",
    maxWidth: 320,
  },
  input: {
    width: "100%",
    maxWidth: 320,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontFamily: "Inter_500Medium",
    fontSize: 15,
    textAlign: "center",
  },
  frame: {
    width: 240,
    height: 240,
    borderWidth: 3,
    borderRadius: 16,
  },
  hint: {
    color: "#fff",
    marginTop: 18,
    fontFamily: "Inter_500Medium",
    fontSize: 14,
  },
});

// Keep the unused-locals lint quiet about the imported `cameraImportError`;
// it's surfaced only via the `if (!CameraModule)` branch above. We retain
// the variable so future debugging can surface the original failure.
void cameraImportError;
