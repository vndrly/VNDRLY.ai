import { router, useFocusEffect } from "expo-router";
import React, { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Alert,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";

import AmberButton from "@/components/AmberButton";
import { useColors } from "@/hooks/useColors";

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
    return this.state.failed ? this.props.fallback : this.props.children;
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

export default function ScanScreen() {
  const colors = useColors();
  const { t } = useTranslation();

  if (!CameraModule) {
    return (
      <View style={styles.container}>
        <ManualSiteCodeFallback
          colors={colors}
          t={t}
          onSubmit={(code) =>
            router.push({ pathname: "/new-ticket", params: { siteCode: code } })
          }
        />
      </View>
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
  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState(false);

  useFocusEffect(
    useCallback(() => {
      setScanned(false);
    }, []),
  );

  if (!permission) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]} />
    );
  }
  if (!permission.granted) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <Text style={[styles.msg, { color: colors.foreground }]}>
          {t("scanScreen.cameraDenied")}
        </Text>
        <AmberButton
          onPress={requestPermission}
          height={44}
          style={styles.btn}
          textStyle={styles.btnText}
        >
          {t("scanScreen.grantPermission")}
        </AmberButton>
      </View>
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
    <View style={styles.container}>
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
          style={StyleSheet.absoluteFill}
          facing="back"
          barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
          onBarcodeScanned={scanned ? undefined : onScanned}
        />
        <View style={styles.overlay} pointerEvents="none">
          <View style={[styles.frame, { borderColor: colors.primary }]} />
          <Text style={styles.hint}>{t("tickets.newTicket")}</Text>
        </View>
      </CameraBoundary>
    </View>
  );
}

// Manual site-code entry shown when the native camera module is missing.
// Mirrors the existing permission-denied layout so the screen stays visually
// consistent with the rest of the scan tab.
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
  const trimmed = value.trim();
  const valid = /^[A-Za-z0-9_-]+$/.test(trimmed);
  return (
    <View style={[styles.center, { backgroundColor: colors.background }]}>
      <Text style={[styles.msg, { color: colors.foreground }]}>
        Camera unavailable in this build. Enter the site code from the QR
        poster instead.
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
        height={44}
        style={styles.btn}
        textStyle={styles.btnText}
      >
        {t("tickets.newTicket")}
      </AmberButton>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#000" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  msg: {
    fontFamily: "Inter_500Medium",
    fontSize: 15,
    marginBottom: 16,
    textAlign: "center",
  },
  btn: {
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: 10,
  },
  btnText: { fontFamily: "Inter_600SemiBold", fontSize: 14 },
  input: {
    width: "100%",
    maxWidth: 320,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontFamily: "Inter_500Medium",
    fontSize: 15,
    marginBottom: 16,
    textAlign: "center",
  },
  overlay: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
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
