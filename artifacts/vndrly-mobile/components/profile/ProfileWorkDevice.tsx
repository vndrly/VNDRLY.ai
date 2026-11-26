import StatusShield from "../StatusShield";
import React, { useEffect, useRef, useState } from "react";
import { AppState, Pressable, Text, View } from "react-native";
import * as Location from "expo-location";
import { GateRow, gateStyle, useGateCopy } from "@/components/gate/GateChrome";
import ProfileMiniCardButton from "@/components/ProfileMiniCardButton";
import { useColors } from "@/hooks/useColors";
import { apiFetch } from "@/lib/api";
import { registerAccountWorkDevice } from "@/lib/account-device-registration";
import { captureAuthScope, isAuthScopeCurrent } from "@/lib/auth";
import { getDeviceId } from "@/lib/deviceId";
import { acceptConsent, setConsentDeclined } from "@/lib/locationConsent";
import { startLiveLocationReporter } from "@/lib/liveLocationReporter";
import { readNativeOperations, setNativeWorkDevice, updateNativeConsent } from "@/lib/native-operations";
import type { NativeOperationsStatus } from "@/lib/native-operations-policy";

/** Profile card where a worker authorizes each device they really use for work. */
export default function ProfileWorkDevice({ header, agreementVersion, onSaved }: {
  header: (title: string) => React.ReactNode;
  agreementVersion?: string;
  onSaved: () => Promise<unknown>;
}) {
  const c = useGateCopy(), colors = useColors();
  const [expanded, setExpanded] = useState(false);
  const [status, setStatus] = useState<NativeOperationsStatus | null>(null);
  const [thisDevice, setThisDevice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  // The box shows the worker's choice while it saves, so a tap is never met with silence.
  const [choice, setChoice] = useState<boolean | null>(null);
  const mounted = useRef(true), saving = useRef(false), latestRead = useRef(0);
  const label = c("Work Device Authorization", "Autorización de dispositivo de trabajo");
  const consent = c(
    "I use this device for work and authorize VNDRLY to share its location with my company during active work.",
    "Uso este dispositivo para trabajar y autorizo a VNDRLY a compartir su ubicación con mi empresa durante el trabajo activo.",
  );

  async function refresh(afterSave = false) {
    const read = ++latestRead.current;
    const [native, deviceId] = await Promise.all([readNativeOperations(), getDeviceId()]);
    // Only the newest read may update the card; an older one finishing late would undo a saved tick.
    if (!mounted.current || read !== latestRead.current || (saving.current && !afterSave)) return;
    setStatus(native); setThisDevice(deviceId);
  }

  useEffect(() => {
    mounted.current = true;
    const load = () => { void refresh().catch(cause => { if (mounted.current) setError(cause instanceof Error ? cause.message : String(cause)); }); };
    load();
    const listener = AppState.addEventListener("change", state => { if (state === "active") load(); });
    return () => { mounted.current = false; listener.remove(); };
  }, []);

  /** Authorize this device, or remove the given device from the worker's work devices. */
  async function change(authorized: boolean, removeId?: string) {
    if (saving.current) return;
    saving.current = true; setBusy(true); setError("");
    if (!removeId || removeId === thisDevice) setChoice(authorized);
    const scope = captureAuthScope();
    const current = () => { if (!isAuthScopeCurrent(scope)) throw new Error(c("Your account changed. Reopen Profile.", "Su cuenta cambió. Vuelva a abrir Perfil.")); };
    try {
      if (authorized) {
        let permission = await Location.getForegroundPermissionsAsync(); current();
        if (permission.status !== "granted") { permission = await Location.requestForegroundPermissionsAsync(); current(); }
        if (permission.status !== "granted") throw new Error(c("Allow location access in Settings to use this device for work.", "Permita el acceso a la ubicación en Ajustes para usar este dispositivo en el trabajo."));
        try { await Location.requestBackgroundPermissionsAsync(); } catch { /* Sharing still works while the app is open. */ }
        current();
        const deviceId = await registerAccountWorkDevice(scope); current();
        await acceptConsent(); current();
        await updateNativeConsent(true); current();
        await setConsentDeclined(false); current();
        if (agreementVersion) {
          await apiFetch("/api/personal-agreements", { method: "POST", body: JSON.stringify({ document: "location_sharing", version: agreementVersion, accepted: true }) }, scope); current();
        }
        await setNativeWorkDevice(deviceId, true); current();
        await startLiveLocationReporter(); current();
      } else if (removeId) {
        await setNativeWorkDevice(removeId, false); current();
      }
      await onSaved();
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      if (mounted.current) setError(message.includes("work_phone_required")
        ? c("Only an iPhone or iPad with the VNDRLY Gate app can be a work device.", "Solo un iPhone o iPad con la aplicación VNDRLY Gate puede ser un dispositivo de trabajo.")
        : message);
    } finally {
      // Stay busy until the saved result is on screen, so another tap cannot undo it.
      if (mounted.current) await refresh(true).catch(() => undefined);
      saving.current = false;
      if (mounted.current) { setBusy(false); setChoice(null); }
    }
  }

  const authorizedIds = status?.workDeviceIds ?? [];
  const checked = !!thisDevice && authorizedIds.includes(thisDevice);
  const shown = choice ?? checked;
  const devices = (status?.devices ?? []).filter(device => authorizedIds.includes(device.id));
  return <>
    <GateRow label={label} icon={expanded ? "chevron-down" : "chevron-right"} expanded={expanded}
      onPress={() => { setError(""); setExpanded(!expanded); }}
      trailing={<StatusShield status={status === null ? "grey" : checked ? "green" : "red"} label={checked ? c("This is a work device", "Este es un dispositivo de trabajo") : c("This is not a work device", "Este no es un dispositivo de trabajo")} />} />
    {expanded && <View testID="profile-work-device-details" style={{ borderWidth: 1, borderColor: colors.primary, borderRadius: 12, padding: 16, gap: 16 }}>
      {header(label)}
      <Text selectable style={gateStyle.text}>{c(
        "Check the box on each iPhone or iPad you really use for work. Only your work devices share location with your company, and only during active work. The first device you authorize replaces any devices registered earlier. Photo and location requests go to the phone you authorized most recently.",
        "Marque la casilla en cada iPhone o iPad que realmente usa para trabajar. Solo sus dispositivos de trabajo comparten la ubicación con su empresa, y solo durante el trabajo activo. El primer dispositivo que autorice reemplaza los dispositivos registrados anteriormente. Las solicitudes de fotos y ubicación llegan al teléfono que autorizó más recientemente.",
      )}</Text>
      <Pressable accessibilityRole="checkbox" accessibilityLabel={consent}
        accessibilityState={{ checked: shown, disabled: busy || status === null, busy }} disabled={busy || status === null}
        onPress={() => void change(!checked, thisDevice ?? undefined)}
        style={{ flexDirection: "row", alignItems: "center", gap: 8, minHeight: 44, opacity: busy ? 0.6 : 1 }}>
        <Text aria-hidden style={{ color: colors.primary, fontSize: 20 }}>{shown ? "☑" : "☐"}</Text>
        <Text style={{ ...gateStyle.text, flex: 1 }}>{consent}</Text>
      </Pressable>
      {busy && <Text accessibilityLiveRegion="polite" style={gateStyle.text}>{c("Saving…", "Guardando…")}</Text>}
      {!!devices.length && <View style={{ gap: 8 }}>
        <Text style={{ ...gateStyle.text, fontWeight: "700" }}>{c("Your work devices", "Sus dispositivos de trabajo")}</Text>
        {devices.map(device => <View key={device.id} style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
          <Text style={{ ...gateStyle.text, flex: 1 }}>{device.friendlyName}{device.id === thisDevice ? ` · ${c("This device", "Este dispositivo")}` : ""}</Text>
          {device.id !== thisDevice && <ProfileMiniCardButton borderColor={colors.primary} disabled={busy} onPress={() => void change(false, device.id)}>{c("Remove", "Quitar")}</ProfileMiniCardButton>}
        </View>)}
      </View>}
      {!!error && <Text accessibilityRole="alert" style={gateStyle.text}>{error}</Text>}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
        <ProfileMiniCardButton borderColor={colors.primary} onPress={() => setExpanded(false)}>{c("Close", "Cerrar")}</ProfileMiniCardButton>
      </View>
    </View>}
  </>;
}
