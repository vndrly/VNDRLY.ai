import React, { useEffect, useRef, useState } from "react";
import { AppState, Image, Switch, Text, View } from "react-native";
import * as Location from "expo-location";
import { GateRow, gateStyle, useGateCopy } from "@/components/gate/GateChrome";
import ProfileMiniCardButton from "@/components/ProfileMiniCardButton";
import { useColors } from "@/hooks/useColors";
import { apiFetch } from "@/lib/api";
import { captureAuthScope, isAuthScopeCurrent } from "@/lib/auth";
import { acceptConsent, getDeviceConsentStatus, isConsentDeclined, revokeConsent, setConsentDeclined } from "@/lib/locationConsent";
import { readNativeOperations, updateNativeConsent } from "@/lib/native-operations";
import { startLiveLocationReporter, stopLiveLocationReporter } from "@/lib/liveLocationReporter";

export default function ProfileLocationSharing({ open, onOpenChange, header, vendorContext, agreementVersion, agreementAccepted=false, onSaved }: {
  open: "location" | "stop" | null;
  onOpenChange: (panel: "location" | "stop" | null) => void;
  header: (title: string) => React.ReactNode;
  vendorContext: boolean;
  agreementVersion?: string;
  agreementAccepted?:boolean;
  onSaved: () => Promise<unknown>;
}) {
  const c = useGateCopy(), colors = useColors();
  const [sharing, setSharing] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [background, setBackground] = useState(false);
  const mounted = useRef(true), saving = useRef(false);
  const stoppedLocally = useRef(false);
  const locationLabel = c("Location Sharing Agreement", "Acuerdo para compartir la ubicación");
  const stopLabel = c("Stop sharing live location", "Dejar de compartir ubicación");

  async function refresh() {
    const [consent, permission, declined, native, backgroundPermission] = await Promise.all([
      getDeviceConsentStatus(), Location.getForegroundPermissionsAsync(), isConsentDeclined(),
      vendorContext ? readNativeOperations() : Promise.resolve(null),
      Location.getBackgroundPermissionsAsync().catch(() => null),
    ]);
    if (!mounted.current || saving.current) return;
    if (consent === "unavailable") throw new Error(c("Could not check saved location consent.", "No se pudo consultar el consentimiento de ubicación."));
    setSharing(!stoppedLocally.current && consent === "accepted" && permission.status === "granted" && !declined && (!native || native.consent.locationSharing));
    setBackground(backgroundPermission?.status === "granted");
  }

  useEffect(() => {
    mounted.current = true;
    const load = () => { void refresh().catch(cause => { if (mounted.current) setError(cause instanceof Error ? cause.message : String(cause)); }); };
    load();
    const listener = AppState.addEventListener("change", state => { if (state === "active") load(); });
    return () => { mounted.current = false; listener.remove(); };
  }, [vendorContext]);

  async function changeSharing(enabled: boolean) {
    if (saving.current) return;
    saving.current = true; setBusy(true); setError("");
    const scope = captureAuthScope();
    const current = () => { if (!isAuthScopeCurrent(scope)) throw new Error(c("Your account changed. Reopen Profile.", "Su cuenta cambió. Vuelva a abrir Perfil.")); };
    try {
      if (enabled) {
        let permission = await Location.getForegroundPermissionsAsync(); current();
        if (permission.status !== "granted") { permission = await Location.requestForegroundPermissionsAsync(); current(); }
        if (permission.status !== "granted") throw new Error(c("Allow location access in iPhone Settings to turn sharing on.", "Permita el acceso a la ubicación en Ajustes del iPhone para activarlo."));
        let backgroundAllowed = false;
        try { backgroundAllowed = (await Location.requestBackgroundPermissionsAsync()).status === "granted"; } catch { /* Foreground sharing remains available. */ }
        current();
        await acceptConsent(); current();
        if (vendorContext) { await updateNativeConsent(true); current(); }
        await setConsentDeclined(false); current();
        if (agreementVersion) {
          await apiFetch("/api/personal-agreements", { method: "POST", body: JSON.stringify({ document: "location_sharing", version: agreementVersion, accepted: true }) }, scope); current();
        }
        await startLiveLocationReporter(); current();
        stoppedLocally.current = false;
        if (mounted.current) { setSharing(true); setBackground(backgroundAllowed); }
      } else {
        // Stop this phone locally immediately, including while the server is unavailable.
        stoppedLocally.current = true;
        const stopped = stopLiveLocationReporter();
        if (mounted.current) setSharing(false);
        const results = await Promise.allSettled([
          stopped, setConsentDeclined(true), revokeConsent(),
          vendorContext ? updateNativeConsent(false) : Promise.resolve(),
        ]);
        current();
        const failed = results.find(result => result.status === "rejected");
        if (failed?.status === "rejected") throw failed.reason;
      }
      await onSaved();
    } catch (cause) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      saving.current = false;
      if (mounted.current) { setBusy(false); void refresh().catch(() => undefined); }
    }
  }

  return <>
    {(["location", "stop"] as const).map(panel => {
      const expanded = open === panel, stopping = panel === "stop", label = stopping ? stopLabel : locationLabel;
      return <React.Fragment key={panel}>
        <GateRow label={label} icon={expanded ? "chevron-down" : "chevron-right"} expanded={expanded}
          onPress={() => { setError(""); onOpenChange(expanded ? null : panel); }}
          trailing={!stopping?(agreementAccepted?<Image source={require('../../assets/images/agreement-accepted.png')} accessibilityLabel="Accepted" style={{width:24,height:24}} resizeMode="contain"/>:undefined):<Switch accessibilityLabel={label} value={sharing === false} disabled={busy}
            trackColor={{ false: "#6b7280", true: colors.primary }}
            onValueChange={value => { onOpenChange(panel); void changeSharing(stopping ? !value : value); }} />} />
        {expanded && <View testID={`profile-${panel}-details`} style={{ borderWidth: 1, borderColor: colors.primary, borderRadius: 12, padding: 16, gap: 16 }}>
          {header(label)}
          <View testID={stopping ? undefined : "profile-location-permission-card"} style={{ gap: 16 }}>
          {!stopping && <Text accessibilityRole="header" style={{ ...gateStyle.text, fontWeight: "700" }}>{c("Location permission and consent", "Permiso y consentimiento de ubicación")}</Text>}
          <Text selectable style={gateStyle.text}>{stopping
            ? c("Turning this on stops live location reporting from this phone. Turn it off to allow sharing again during active work.", "Al activarlo, se detiene el envío de ubicación desde este teléfono. Desactívelo para permitir compartir durante el trabajo activo.")
            : c("Turn on to consent to sharing this phone’s work location with authorized operations staff during active work. VNDRLY uses location for site arrivals, departures and work activity, including in the background when iOS permits it. Turn off to stop sharing from this phone.", "Active para consentir compartir la ubicación laboral de este teléfono con personal de operaciones autorizado durante el trabajo activo. VNDRLY usa la ubicación para llegadas, salidas y actividad laboral, incluso en segundo plano cuando iOS lo permite. Desactive para dejar de compartir desde este teléfono.")}</Text>
          <Text accessibilityLiveRegion="polite" style={gateStyle.text}>{sharing === null
            ? c("Checking this phone’s location consent…", "Consultando el consentimiento de ubicación de este teléfono…")
            : sharing ? background ? c("Sharing allowed during active work, including in the background.", "Se permite compartir durante el trabajo activo, incluso en segundo plano.") : c("Sharing allowed while the app is open during active work.", "Se permite compartir con la aplicación abierta durante el trabajo activo.")
            : c("Location sharing is stopped on this phone.", "La ubicación compartida está desactivada en este teléfono.")}</Text>
          {error ? <Text accessibilityRole="alert" style={gateStyle.text}>{error}</Text> : null}
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
            <ProfileMiniCardButton borderColor={colors.primary} disabled={busy} loading={busy} onPress={() => void changeSharing(stopping ? false : sharing !== true)}>
              {stopping ? c("Stop sharing on this device", "Dejar de compartir en este dispositivo") : sharing ? c("Turn sharing off", "Desactivar ubicación compartida") : c("Turn sharing on", "Activar ubicación compartida")}
            </ProfileMiniCardButton>
            <ProfileMiniCardButton borderColor={colors.primary} onPress={() => onOpenChange(null)}>{c("Close", "Cerrar")}</ProfileMiniCardButton>
          </View>
          </View>
        </View>}
      </React.Fragment>;
    })}
  </>;
}
