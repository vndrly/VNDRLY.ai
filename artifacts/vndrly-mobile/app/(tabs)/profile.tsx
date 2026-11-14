import React, { useState } from "react";
import { Text, View } from "react-native";
import { router } from "expo-router";
import { useAuth } from "@/hooks/use-auth";
import { useGateQuery } from "@/hooks/use-gate-query";
import { logout, updatePreferredLanguage } from "@/lib/api";
import { setLanguage } from "@/lib/i18n";
import { gateManager } from "@/lib/gate-release";
import {
  GatePage,
  GateCard,
  GateRow,
  GateError,
  GateLoading,
  gateStyle,
  useGateCopy,
} from "@/components/gate/GateChrome";
import ProfilePhotoImage from "@/components/ProfilePhotoImage";
import WorkHubDeviceSettings from "@/components/WorkHubDeviceSettings";
import NativeOperations from "@/components/work-hub/NativeOperations";
import TogglePillButton from "@/components/TogglePillButton";
import { revokeConsent, setConsentDeclined } from "@/lib/locationConsent";
import { updateNativeConsent } from "@/lib/native-operations";
import { stopLiveLocationReporter } from "@/lib/liveLocationReporter";
export default function GateProfile() {
  const c = useGateCopy(),
    {
      user,
      activeMembership,
      availableMemberships,
      activeMembershipId,
      switchContext,
    } = useAuth(),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState("");
  const me = useGateQuery<{
    firstName: string;
    lastName: string;
    email: string;
    phone?: string;
    profilePhotoPath: string | null;
    photoUrl?: string | null;
  }>("/api/field/me");
  const run = async (action: () => Promise<unknown>, message?: string) => {
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
      if (message) setNotice(message);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const open = (path: string) => router.push(path as never);
  return (
    <GatePage title={c("My Profile", "Mi perfil")} back>
      <GateError
        message={error || me.error?.message}
        retry={() => void me.refetch()}
      />
      {notice && (
        <Text accessibilityRole="alert" style={gateStyle.text}>
          {notice}
        </Text>
      )}
      <GateCard
        title={user?.displayName ?? c("My account", "Mi cuenta")}
        icon="user"
      >
        {me.isLoading && <GateLoading />}
        {me.data && (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
            <ProfilePhotoImage
              profilePhotoPath={me.data.profilePhotoPath}
              photoUrl={me.data.photoUrl}
              style={{ width: 72, height: 72, borderRadius: 36 }}
            />
            <View style={{ flex: 1, gap: 5 }}>
              <Text style={gateStyle.text}>
                {[me.data.firstName, me.data.lastName]
                  .filter(Boolean)
                  .join(" ")}
              </Text>
              <Text style={gateStyle.muted}>{me.data.email}</Text>
              <Text style={gateStyle.muted}>{activeMembership?.orgName}</Text>
            </View>
          </View>
        )}
        <GateRow
          label={c(
            "Edit profile, photo and password",
            "Editar perfil, foto y contraseña",
          )}
          onPress={() => open("/edit-profile")}
        />
        <GateRow
          label={c(
            "My credentials and compliance card",
            "Mis credenciales y tarjeta de cumplimiento",
          )}
          icon="award"
          onPress={() => open("/compliance")}
        />
      </GateCard>
      <GateCard title={c("Company and role", "Empresa y rol")} icon="briefcase">
        {availableMemberships.map((m) => (
          <GateRow
            key={m.id}
            disabled={busy || m.id === activeMembershipId}
            label={(m.id === activeMembershipId ? "✓ " : "") + m.orgName}
            detail={m.role}
            onPress={() =>
              void run(async () => {
                await switchContext(m.id);
                router.replace("/change-over");
              })
            }
          />
        ))}
        {gateManager(user) && (
          <GateRow
            label={c("Gate Administration", "Administración de acceso")}
            icon="settings"
            onPress={() => open("/gate-admin")}
          />
        )}
      </GateCard>
      <GateCard title={c("Language", "Idioma")} icon="globe">
        {(["en", "es"] as const).map((language) => (
          <GateRow
            key={language}
            disabled={busy}
            label={language === "en" ? "English" : "Español"}
            onPress={() =>
              void run(
                async () => {
                  await setLanguage(language);
                  await updatePreferredLanguage(language);
                },
                language === "en" ? "Language saved." : "Idioma guardado.",
              )
            }
          />
        ))}
      </GateCard>
      <GateCard
        title={c("Privacy and device", "Privacidad y dispositivo")}
        icon="smartphone"
      >
        <GateRow
          label={c(
            "Location permission and consent",
            "Permiso y consentimiento de ubicación",
          )}
          onPress={() => open("/location-consent")}
        />
        <GateRow
          label={c(
            "Stop sharing live location",
            "Dejar de compartir ubicación",
          )}
          disabled={busy}
          onPress={() =>
            void run(
              async () => {
                stopLiveLocationReporter();
                await setConsentDeclined(true);
                await Promise.all([
                  revokeConsent(),
                  updateNativeConsent(false),
                ]);
              },
              c(
                "Live location sharing stopped.",
                "Ubicación en vivo desactivada.",
              ),
            )
          }
        />
        <GateRow
          label={c(
            "Notification preferences",
            "Preferencias de notificaciones",
          )}
          icon="bell"
          onPress={() => open("/gate-notification-preferences")}
        />
        <WorkHubDeviceSettings />
        <NativeOperations settingsOnly />
      </GateCard>
      <GateCard
        title={c("Support and account", "Ayuda y cuenta")}
        icon="help-circle"
      >
        <GateRow
          label={c(
            "Privacy, support and account deletion",
            "Privacidad, ayuda y eliminación de cuenta",
          )}
          onPress={() => open("/gate-account")}
        />
        <TogglePillButton
          disabled={busy}
          onPress={() =>
            void run(async () => {
              await logout();
              router.replace("/login");
            })
          }
        >
          {c("Sign out", "Cerrar sesión")}
        </TogglePillButton>
      </GateCard>
    </GatePage>
  );
}
