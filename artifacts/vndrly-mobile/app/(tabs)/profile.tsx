import { ModalPressable as Pressable } from "@/components/ModalDraft";
import GateSettings from "@/components/gate/GateSettings";
import { Feather } from "@expo/vector-icons";
import { OnboardingInput } from "@/components/OnboardingControls";
import { NotificationPreferences } from "../notification-preferences";
import { VNDRLY_LOGO_SQUARE } from "@/lib/vndrly-brand-assets";
import { PLATFORM_EULA_TEXT, PLATFORM_EULA_TITLE, PLATFORM_EULA_VERSION } from "../../../../lib/platform-eula/src";
import { PRIVACY_POLICY_SECTIONS, TERMS_SECTIONS } from "../../../vndrly/src/lib/legal-docs";
import { PRIVACY_POLICY_SECTIONS_ES, TERMS_SECTIONS_ES } from "../../../vndrly/src/lib/legal-docs-es";
import { LEGAL_POLICY_VERSION, PUBLIC_SMS_CONSENT_DISCLOSURE, PUBLIC_SMS_CONSENT_DISCLOSURE_ES } from "@workspace/api-zod/legal-policy";
import React, { useState } from "react";
import { Image, Switch, Text, View } from "react-native";
import { router } from "expo-router";
import { useAuth } from "@/hooks/use-auth";
import { useGateQuery } from "@/hooks/use-gate-query";
import { apiFetch, logout, updatePreferredLanguage } from "@/lib/api";
import { setLanguage } from "@/lib/i18n";
import { gateManager } from "@/lib/gate-release";
import {
  GatePage,
  GateCard,
  GateField,
  GateRow,
  GateError,
  GateLoading,
  gateStyle,
  useGateCopy,
} from "@/components/gate/GateChrome";
import EditProfileForm from "@/components/EditProfileForm";
import WorkHubDeviceSettings from "@/components/WorkHubDeviceSettings";
import ProfileLocationSharing from "@/components/profile/ProfileLocationSharing";
import MySubscriptions from "@/components/profile/MySubscriptions";
import { Text as ButtonText } from "react-native";
import { useColors } from "@/hooks/useColors";
const profileLanguages = [
  { code: "en", label: "English" },
  { code: "es", label: "Español" },
] as const;

export default function GateProfile() {
  const buttonColors = useColors();
  const [gateSettingsOpen, setGateSettingsOpen] = useState(false);
  const [editProfileOpen, setEditProfileOpen] = useState(false);
  const [languageMenuOpen, setLanguageMenuOpen] = useState(false);
  const [languageOpen, setLanguageOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [locationPanel, setLocationPanel] = useState<"location" | "stop" | null>(null);
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
  const [deletionOpen, setDeletionOpen] = useState(false);
  const [deletionChecked, setDeletionChecked] = useState(false);
  const [deletionPassword, setDeletionPassword] = useState("");
  const deletion = useGateQuery<{ request: { id: string } | null }>(
    "/api/account/deletion-request", deletionOpen,
  );
  const [policy, setPolicy] = useState<"privacy" | "terms" | "sms" | "work_phone" | "location_sharing" | "askv_microphone" | null>(null);
  const [smsPhone, setSmsPhone] = useState("");
  const [policyBusy, setPolicyBusy] = useState(false);
  const [policyMessage, setPolicyMessage] = useState("");
  const spanish = c("en", "es") === "es";
  const privacy = spanish ? PRIVACY_POLICY_SECTIONS_ES : PRIVACY_POLICY_SECTIONS;
  const terms = spanish ? TERMS_SECTIONS_ES : TERMS_SECTIONS;
  const [eulaOpen, setEulaOpen] = useState(false);
  const [eulaSaving, setEulaSaving] = useState(false);
  const [eulaError, setEulaError] = useState("");
  const agreements = useGateQuery<{
    smsEnrolled: boolean;
    versions: Record<string, string>;
    accepted: { document: string; version: string }[];
  }>("/api/personal-agreements");
  const eulaAccepted = agreements.data?.accepted.some(
    (row) => row.document === "eula" && row.version === PLATFORM_EULA_VERSION,
  ) ?? false;

  async function acceptEula(accepted: boolean) {
    setEulaSaving(true);
    setEulaError("");
    try {
      const saved = await apiFetch<{ document: string; version: string }>(
        "/api/personal-agreements",
        { method: "POST", body: JSON.stringify({ document: "eula", version: PLATFORM_EULA_VERSION, accepted }) },
      );
      await agreements.refetch({ throwOnError: true });
      if (saved.version !== PLATFORM_EULA_VERSION) throw new Error();
    } catch {
      setEulaError(c("Could not save your agreement.", "No se pudo guardar tu acuerdo."));
    } finally {
      setEulaSaving(false);
    }
  }

  async function savePolicy(document: "privacy" | "terms" | "sms" | "work_phone" | "location_sharing" | "askv_microphone", accepted: boolean) {
    setPolicyBusy(true);
    setPolicyMessage("");
    try {
      if (document === "sms") {
        await apiFetch("/api/notifications/sms-consent", {
          method: "POST",
          body: JSON.stringify({ phone: smsPhone, consent: accepted ? "yes" : "no", policyVersion: LEGAL_POLICY_VERSION, language: spanish ? "es" : "en" }),
        });

      } else {
        const version = agreements.data?.versions[document];
        if (!version) throw new Error(c("Could not load the agreement version.", "No se pudo cargar la versión del acuerdo."));
        await apiFetch("/api/personal-agreements", {
          method: "POST",
          body: JSON.stringify({ document, version, accepted }),
        });
      }
      await agreements.refetch({ throwOnError: true });
    } catch (error) {
      setPolicyMessage(error instanceof Error ? error.message : c("Could not save.", "No se pudo guardar."));
    } finally {
      setPolicyBusy(false);
    }
  }

  const agreementSwitch = (label: string, value: boolean, busy: boolean, onValueChange: (value: boolean) => void) => (
    <Switch accessibilityLabel={label} value={value} disabled={busy}
      trackColor={{ false: "#6b7280", true: buttonColors.primary }} onValueChange={onValueChange} />
  );

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
  const profilePanelHeader = (title: string) => (
    <View testID="profile-panel-header" style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
      <Image source={VNDRLY_LOGO_SQUARE} style={{ width: 44, height: 44 }} resizeMode="contain" accessibilityLabel="VNDRLY" />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={{ ...gateStyle.text, color: buttonColors.primary, fontWeight: "700" }}>
          <Text style={{ color: "#ffffff" }}>{c("for", "para")} </Text>{[me.data?.firstName, me.data?.lastName].filter(Boolean).join(" ") || user?.displayName}
        </Text>
        <Text selectable accessibilityRole="header" style={gateStyle.text}>{title}</Text>
      </View>
    </View>
  );

  const agreementCards = ([
          { id: "privacy", label: c("Privacy Policy", "Política de privacidad"), sections: privacy },
          { id: "terms", label: c("Terms & Conditions", "Términos y condiciones"), sections: terms },
          { id: "sms", label: c("SMS Enrollment", "Inscripción por SMS"), sections: [...privacy.slice(5, 6), ...terms.slice(4, 5)] },
          {
            id: "work_phone",
            label: c("Use this as Work Phone", "Usar este dispositivo como teléfono de trabajo"),
            sections: [{
              title: c("Work Phone Usage Agreement", "Acuerdo de uso del teléfono de trabajo"),
              body: [
                c("Designating this device as your work phone makes it your primary device for VNDRLY work features. Keep it secured, protect access to work information, and report loss or unauthorized access to your supervisor. Use the device for work communications and site activity in accordance with your company’s policies.",
                  "Designar este dispositivo como teléfono de trabajo lo convierte en su dispositivo principal para las funciones laborales de VNDRLY. Protéjalo, controle el acceso a la información laboral e informe a su supervisor si se pierde o alguien accede sin autorización. Úselo para comunicaciones de trabajo y actividades en el sitio conforme a las políticas de su empresa."),
                c("Use the work phone switch to designate this device. Accepting this agreement does not change your device settings.",
                  "Use el interruptor de teléfono de trabajo para designar este dispositivo. Aceptar este acuerdo no cambia la configuración del dispositivo."),
              ],
            }],
          },
          {
            id: "askv_microphone",
            label: c("Allow AskV to use this device’s microphone", "Permitir que AskV use el micrófono de este dispositivo"),
            sections: [{
              title: c("AskV Microphone Usage Agreement", "Acuerdo de uso del micrófono de AskV"),
              body: [
                c("By agreeing, you authorize AskV to capture and process microphone audio when you use its voice features on this device, such as voice conversations and voice input. Audio may be transcribed to understand your request and respond. Avoid sharing confidential or personal information you are not authorized to disclose.",
                  "Al aceptar, autoriza a AskV a capturar y procesar el audio del micrófono cuando use sus funciones de voz en este dispositivo, como conversaciones y entrada por voz. El audio puede transcribirse para comprender su solicitud y responder. Evite compartir información confidencial o personal que no esté autorizado a divulgar."),
                c("The microphone control and your device permissions govern access. You can turn off microphone access in your device settings.",
                  "El control del micrófono y los permisos del dispositivo determinan el acceso. Puede desactivar el acceso al micrófono en los ajustes del dispositivo."),
              ],
            }],
          },
        ] as const).map(({ id, label, sections }) => {
          const microphone = id === "askv_microphone";
          const expanded = microphone || policy === id;
          const checked = id === "sms" ? Boolean(agreements.data?.smsEnrolled) : Boolean(agreements.data?.accepted.some(
            (row) => row.document === id && row.version === agreements.data?.versions[id],
          ));
          return { id, content: <React.Fragment key={id}>
            {!microphone && <GateRow label={label} icon={expanded ? "chevron-down" : "chevron-right"} expanded={expanded}
              trailing={agreementSwitch(label, checked, policyBusy, (value) => {
                setPolicy(id);
                if (id === "sms" && value) return;
                void savePolicy(id, value);
              })}
              onPress={() => { setPolicyMessage(""); setPolicy(expanded ? null : id); }} />}
            {expanded && (
              <View style={microphone ? { gap: 16 } : { borderWidth: 1, borderColor: buttonColors.primary, borderRadius: 12, padding: 16, gap: 16 }}>
                {!microphone && profilePanelHeader(label)}
                {sections.map(({ title, body }) => (
                  <View key={title} style={{ gap: 8 }}>
                    <Text style={{ ...gateStyle.text, fontWeight: "700" }}>{title}</Text>
                    {body.map((paragraph, index) => <Text key={index} selectable style={gateStyle.text}>{paragraph}</Text>)}
                  </View>
                ))}
                {id === "sms" && <>
                  <Text style={gateStyle.text}>{spanish ? PUBLIC_SMS_CONSENT_DISCLOSURE_ES : PUBLIC_SMS_CONSENT_DISCLOSURE}</Text>
                  <GateField label={c("10-digit mobile number", "Número móvil de 10 dígitos")}
                    value={smsPhone} keyboardType="phone-pad" onChangeText={setSmsPhone} editable={!checked} />
                </>}
                <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
                  <Pressable accessibilityRole="checkbox"
                  accessibilityState={{ checked, disabled: policyBusy }}
                  disabled={policyBusy} onPress={() => void savePolicy(id, !checked)}
                  style={{ flexDirection: "row", alignItems: "center", gap: 8, minHeight: 44 }}>
                  <Text aria-hidden style={{ color: buttonColors.primary, fontSize: 20 }}>{checked ? "☑" : "☐"}</Text>
                  <Text style={gateStyle.text}>{id === "sms" ? (checked ? c("Unsubscribe from SMS", "Cancelar la inscripción por SMS") : c("Enroll in SMS", "Inscribirme por SMS")) : c("I agree", "Acepto")}</Text>
                </Pressable>
                  {!microphone && <Pressable accessibilityRole="button" onPress={() => setPolicy(null)}
              style={{ alignSelf: "flex-start", minHeight: 44, justifyContent: "center", paddingHorizontal: 10, borderWidth: 1, borderRadius: 8, borderColor: buttonColors.primary, backgroundColor: "#2b2b2f" }}>
              <ButtonText style={{ color: "#ececec", fontSize: 12, fontWeight: "600" }}>{c("Close", "Cerrar")}</ButtonText>
            </Pressable>}
                </View>
                {policyMessage ? <Text accessibilityRole="alert" style={gateStyle.text}>{policyMessage}</Text> : null}
              </View>
            )}
          </React.Fragment> };
  });

  const roleLabels: Record<string, string> = {
    admin: c("Administrative Team", "Equipo administrativo"),
    office: c("Office Staff", "Personal de oficina"),
    gate_supervisor: c("Gate Supervisor", "Supervisor de acceso"),
    gatekeeper: c("Gatekeeper", "Guardia de acceso"),
  };
  const roleLabel = (role: string) => roleLabels[role] ?? role;

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
        title={c("Profile & Password Settings", "Configuración de perfil y contraseña")}
        icon="user"
        testID="profile-identity-card"
        headerAction={<View style={{ width: 112 }} />}
      >
        {me.isLoading && <GateLoading />}
        {me.data && (
          <View style={{ minHeight: 100, paddingRight: 112, flexDirection: "row", alignItems: "flex-start", gap: 14 }}>
            <View testID="profile-user-info" style={{ flex: 1, minWidth: 0, gap: 5 }}>
              <Text style={gateStyle.text}>
                {[me.data.firstName, me.data.lastName]
                  .filter(Boolean)
                  .join(" ")}
              </Text>
              <Text style={gateStyle.muted}>{me.data.email}</Text>
              <Text style={gateStyle.muted}>{activeMembership?.orgName}</Text>
              {activeMembership && (
                <Text style={gateStyle.muted}>{roleLabel(activeMembership.role)}</Text>
              )}
            </View>
          </View>
        )}
        <EditProfileForm
          inline
          fieldsExpanded={editProfileOpen}
          onProfileChanged={() => void me.refetch()}
          onPhotoChanged={() => void me.refetch()}
          editToggle={
            <GateRow
              label={c("Edit Profile & Update Password", "Editar perfil y actualizar contraseña")}
              icon={editProfileOpen ? "chevron-down" : "chevron-right"}
              expanded={editProfileOpen}
              onPress={() => setEditProfileOpen(open => !open)}
            />
          }
        />
        <GateRow
          label={c(
            "My credentials and compliance card",
            "Mis credenciales y tarjeta de cumplimiento",
          )}
          icon="award"
          onPress={() => open("/compliance")}
        />
        <MySubscriptions />
        {availableMemberships.length > 1 && (
          <>
            {availableMemberships.map((m) => (
              <GateRow
                key={m.id}
                disabled={busy || m.id === activeMembershipId}
                label={(m.id === activeMembershipId ? "✓ " : "") + m.orgName}
                detail={roleLabel(m.role)}
                onPress={() =>
                  void run(async () => {
                    await switchContext(m.id);
                    router.replace("/change-over");
                  })
                }
              />
            ))}
          </>
        )}
      </GateCard>
      {gateManager(user) && (
        <GateCard title={c("Gate Administration", "Administración de acceso")} icon="settings">
          <GateRow
            label={c("Gate Settings", "Configuración de acceso")}
            icon={gateSettingsOpen ? "chevron-down" : "chevron-right"}
            expanded={gateSettingsOpen}
            onPress={() => setGateSettingsOpen(open => !open)}
          />
          {gateSettingsOpen && <GateSettings embedded />}
        </GateCard>
      )}
      <GateCard title={c("Platform Agreements and Settings", "Acuerdos y configuración de la plataforma")} icon="file-text">
        <View style={gateStyle.row}>
          <Text accessibilityRole="header" style={[gateStyle.text, { fontSize: 16 }]}>
            {c("Read and accept platform agreements", "Leer y aceptar los acuerdos de la plataforma")}
          </Text>
        </View>
        <GateRow
          label="EULA"
          icon={eulaOpen ? "chevron-down" : "chevron-right"}
          expanded={eulaOpen}
          trailing={agreementSwitch("EULA", eulaAccepted, eulaSaving, (value) => {
            setEulaOpen(true);
            void acceptEula(value);
          })}
          onPress={() => setEulaOpen((open) => !open)}
        />
        {eulaOpen && (
          <View style={{ borderWidth: 1, borderColor: buttonColors.primary, borderRadius: 12, padding: 16, gap: 16 }}>
            {profilePanelHeader(PLATFORM_EULA_TITLE)}
            <Text selectable style={gateStyle.text}>{PLATFORM_EULA_TEXT.slice(PLATFORM_EULA_TITLE.length).trimStart()}</Text>
            <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
              <Pressable
              accessibilityRole="checkbox"
              accessibilityState={{ checked: eulaAccepted, disabled: eulaSaving }}
              disabled={eulaSaving}
              onPress={() => void acceptEula(!eulaAccepted)}
              style={{ flexDirection: "row", alignItems: "center", gap: 8, minHeight: 44 }}
            >
              <Text aria-hidden style={{ color: buttonColors.primary, fontSize: 20 }}>{eulaAccepted ? "☑" : "☐"}</Text>
              <Text style={gateStyle.text}>{c("I agree", "Acepto")}</Text>
            </Pressable>
              <Pressable accessibilityRole="button" onPress={() => setEulaOpen(false)}
              style={{ alignSelf: "flex-start", minHeight: 44, justifyContent: "center", paddingHorizontal: 10, borderWidth: 1, borderRadius: 8, borderColor: buttonColors.primary, backgroundColor: "#2b2b2f" }}>
              <ButtonText style={{ color: "#ececec", fontSize: 12, fontWeight: "600" }}>{c("Close", "Cerrar")}</ButtonText>
            </Pressable>
            </View>
            {eulaError ? <Text accessibilityRole="alert" style={gateStyle.text}>{eulaError}</Text> : null}
          </View>
        )}
        {agreementCards.filter(({ id }) => id !== "askv_microphone").map(({ content }) => content)}
        <ProfileLocationSharing key={`${user?.id}:${activeMembershipId}`}
          open={locationPanel} onOpenChange={setLocationPanel} header={profilePanelHeader}
          vendorContext={!!user?.vendorId} agreementVersion={agreements.data?.versions.location_sharing}
          onSaved={() => agreements.refetch({ throwOnError: true })} />
        <GateRow
          label={c(
            "Notification preferences",
            "Preferencias de notificaciones",
          )}
          icon={notificationsOpen ? "chevron-down" : "chevron-right"}
          expanded={notificationsOpen}
          onPress={() => setNotificationsOpen((open) => !open)}
        />
        {notificationsOpen && <View style={{ gap: 16 }}>
          {profilePanelHeader(c("Notification preferences", "Preferencias de notificaciones"))}
          <NotificationPreferences inline />
        </View>}
        <GateRow label={c("Language", "Idioma")} expanded={languageOpen}
          icon={languageOpen ? "chevron-down" : "chevron-right"}
          onPress={() => { setLanguageMenuOpen(false); setLanguageOpen((open) => !open); }} />
        {languageOpen && (
          <View style={{ borderWidth: 1, borderColor: buttonColors.primary, borderRadius: 12, padding: 16, gap: 16 }}>
            {profilePanelHeader(c("Language", "Idioma"))}
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12, alignItems: "flex-start" }}>
              <Text style={[gateStyle.text, { minHeight: 44, textAlignVertical: "center", paddingVertical: 12 }]}>
                {c("Change your app language preference", "Cambia tu preferencia de idioma")}
              </Text>
              <View style={{ minWidth: 132, marginStart: "auto" }}>
                <Pressable accessibilityRole="combobox" accessibilityState={{ expanded: languageMenuOpen, disabled: busy }}
                  accessibilityLabel={c("App language", "Idioma de la aplicación")}
                  disabled={busy} onPress={() => setLanguageMenuOpen((open) => !open)}
                  style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8, minHeight: 44, paddingHorizontal: 12, borderWidth: 1, borderColor: buttonColors.primary, borderRadius: 9999, backgroundColor: "#303034" }}>
                  <Text style={gateStyle.text}>{c("English", "Español")}</Text>
                  <Feather name={languageMenuOpen ? "chevron-up" : "chevron-down"} size={16} color={buttonColors.primary} />
                </Pressable>
                {languageMenuOpen && (
                  <View role="list" style={{ marginTop: 4, borderWidth: 1, borderColor: buttonColors.primary, borderRadius: 8, backgroundColor: "#303034", paddingHorizontal: 12 }}>
                    {profileLanguages.map(({ code, label }) => (
                      <Pressable key={code} accessibilityRole="button" accessibilityState={{ selected: c("en", "es") === code }}
                        style={{ minHeight: 44, justifyContent: "center" }}
                        onPress={() => {
                          setLanguageMenuOpen(false);
                          if (c("en", "es") === code) return;
                          void run(async () => {
                            await setLanguage(code);
                            await updatePreferredLanguage(code);
                          }, code === "en" ? "Language saved." : "Idioma guardado.");
                        }}>
                        <Text style={gateStyle.text}>{label}</Text>
                      </Pressable>
                    ))}
                  </View>
                )}
              </View>
            </View>
          </View>
        )}
        <WorkHubDeviceSettings>
          {profilePanelHeader(c("Audio and Backup Devices", "Audio y dispositivos de respaldo"))}
          {agreementCards.find(({ id }) => id === "askv_microphone")?.content}
        </WorkHubDeviceSettings>
        <GateRow
          label={c("Request account deletion", "Solicitar eliminación de cuenta")}
          icon={deletionOpen ? "chevron-down" : "chevron-right"}
          expanded={deletionOpen}
          onPress={() => {
            setDeletionOpen(!deletionOpen);
            setDeletionChecked(false);
            setDeletionPassword("");
          }}
        />
        {deletionOpen && (
          <View style={{ borderWidth: 1, borderColor: buttonColors.primary, borderRadius: 12, padding: 16, gap: 16 }}>
            {profilePanelHeader(c("Request account deletion", "Solicitar eliminación de cuenta"))}
            <Text style={gateStyle.text}>
              {c(
                "Deleting your personal VNDRLY account ends your ability to sign in and access your profile, settings, and work through this account. VNDRLY reviews the request and may retain company records such as tickets and shift logs, along with records it is required to keep. Enter your current password below to confirm your deletion request.",
                "Eliminar tu cuenta personal de VNDRLY impide que vuelvas a iniciar sesión y acceder a tu perfil, configuración y trabajo desde esta cuenta. VNDRLY revisa la solicitud y puede conservar registros de la empresa, como tickets y registros de turnos, además de los registros que deba conservar. Ingresa tu contraseña actual abajo para confirmar tu solicitud de eliminación.",
              )}
            </Text>
            {deletion.isPending && <GateLoading />}
            <GateError message={deletion.error?.message} retry={() => void deletion.refetch()} />
            {deletion.data?.request ? (
              <Text style={gateStyle.text}>{c("Your deletion request is awaiting processing.", "Tu solicitud de eliminación está pendiente.")}</Text>
            ) : deletion.data && (
              <>
                <Text style={gateStyle.text}>{c("Current password", "Contraseña actual")}</Text>
                <OnboardingInput accessibilityLabel={c("Current password", "Contraseña actual")}
                  secureTextEntry value={deletionPassword} onChangeText={setDeletionPassword}
                  editable={!busy}
                  style={{ backgroundColor: "#303034", color: "#ececec", borderColor: buttonColors.primary, borderRadius: 9999, paddingHorizontal: 12 }} />
                {deletionChecked && (
                    <Text style={gateStyle.text}>{c("Are you sure you want to request deletion of your account?", "¿Seguro que quieres solicitar la eliminación de tu cuenta?")}</Text>
                )}
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
                <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: deletionChecked }}
                  disabled={busy} onPress={() => setDeletionChecked(!deletionChecked)}
                  style={{ flexDirection: "row", alignItems: "center", gap: 8, minHeight: 44 }}>
                  <Text aria-hidden style={{ color: buttonColors.primary, fontSize: 20 }}>{deletionChecked ? "☑" : "☐"}</Text>
                  <Text style={gateStyle.text}>{c("I want to request deletion of my account", "Quiero solicitar la eliminación de mi cuenta")}</Text>
                </Pressable>
                    <Pressable accessibilityRole="button"
                      style={{ marginLeft: "auto", minHeight: 44, justifyContent: "center", paddingHorizontal: 10, borderWidth: 1, borderRadius: 8, borderColor: buttonColors.primary, backgroundColor: "#2b2b2f", opacity: busy || !deletionChecked || !deletionPassword ? 0.5 : 1 }}
                      disabled={busy || !deletionChecked || !deletionPassword}
                      onPress={() => void run(async () => {
                        await apiFetch("/api/account/deletion-request", {
                          method: "POST",
                          body: JSON.stringify({ password: deletionPassword, confirmation: "DELETE" }),
                        });
                        setDeletionPassword("");
                        setDeletionChecked(false);
                        await deletion.refetch();
                      })}>
                      <Text style={{ color: "#ececec", fontSize: 12, fontWeight: "600" }}>{c("Confirm deletion request", "Confirmar solicitud de eliminación")}</Text>
                    </Pressable>
                </View>
              </>
            )}
          </View>
        )}
      </GateCard>
      <Pressable accessibilityRole="button" style={{ alignSelf: "flex-start", minHeight: 44, justifyContent: "center", paddingHorizontal: 10, borderWidth: 1, borderRadius: 8, borderColor: buttonColors.primary, backgroundColor: "#2b2b2f" }}
        disabled={busy}
        onPress={() =>
          void run(async () => {
            await logout();
            router.replace("/login");
          })
        }
      >
        <ButtonText style={{ color: "#ececec", fontSize: 12, fontWeight: "600" }}>{c("Sign out", "Cerrar sesión")}</ButtonText>
      </Pressable>
    </GatePage>
  );
}
