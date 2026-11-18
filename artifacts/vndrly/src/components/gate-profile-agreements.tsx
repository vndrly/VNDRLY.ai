import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { PLATFORM_EULA_TEXT, PLATFORM_EULA_VERSION } from "@workspace/platform-eula";
import { LEGAL_POLICY_VERSION, PUBLIC_SMS_CONSENT_DISCLOSURE, PUBLIC_SMS_CONSENT_DISCLOSURE_ES } from "@workspace/api-zod/legal-policy";
import { PRIVACY_POLICY_SECTIONS, TERMS_SECTIONS } from "@/lib/legal-docs";
import { PRIVACY_POLICY_SECTIONS_ES, TERMS_SECTIONS_ES } from "@/lib/legal-docs-es";
import { useAuth } from "@/hooks/use-auth";
import { Switch } from "@/components/ui/switch";
import { BrandedInput, BrandedSelect } from "@/components/work-hub/chrome";
import GateProfileNotifications, { GateProfileNotificationSummary, notificationPreferenceState, useProfileNotificationPreferences } from "./gate-profile-notifications";
import GateProfileDevices from "./gate-profile-devices";
import ProfileSetupSummary, { type ProfileSetupStep } from "./profile-setup-summary";
import { ProfilePanelHeader, ProfileRow, profileRequest } from "./gate-profile-chrome";

type Agreements = { smsEnrolled: boolean; versions: Record<string,string>; accepted: { document: string; version: string }[] };
type Document = "eula" | "privacy" | "terms" | "sms" | "work_phone" | "location_sharing" | "askv_microphone";

export default function GateProfileAgreements({ name, hasProfilePhoto, profileLoading, onOpenPhoto }: {
  name: string; hasProfilePhoto: boolean; profileLoading: boolean; onOpenPhoto: () => void;
}) {
  const { user, setPreferredLanguage } = useAuth(), { i18n } = useTranslation();
  const spanish = i18n.language.startsWith("es"), c = (en: string, es: string) => spanish ? es : en;
  const [open, setOpen] = useState<string | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [phone, setPhone] = useState("");
  const reviewKey = `vndrly.profile-setup.${user?.userId ?? 0}.${user?.activeMembershipId ?? 0}`;
  const [reviewed, setReviewed] = useState<Record<string, string>>(() => {
    try { return JSON.parse(localStorage.getItem(reviewKey) ?? "{}"); } catch { return {}; }
  });
  function markReviewed(id: string) {
    const next = { ...reviewed, [id]: agreements.data?.versions[id] ?? (id === "sms" ? LEGAL_POLICY_VERSION : "reviewed") };
    setReviewed(next);
    try { localStorage.setItem(reviewKey, JSON.stringify(next)); } catch { /* Keep the current session's choice. */ }
  }
  const agreements = useQuery({ queryKey: ["personal-agreements", user?.userId], queryFn: ({ signal }) => profileRequest<Agreements>("/personal-agreements", { signal }) });
  const notificationPreferences = useProfileNotificationPreferences();
  const toggle = (id: string) => { setError(""); setOpen(open === id ? null : id); };
  function openSetupSection(id: string) {
    if (id === "profile_photo") { onOpenPhoto(); return; }
    setOpen(id);
    requestAnimationFrame(() => document.getElementById(`profile-setting-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }
  const checked = (id: Document) => id === "sms" ? Boolean(agreements.data?.smsEnrolled) : Boolean(agreements.data?.accepted.some(a => a.document === id && a.version === agreements.data?.versions[id]));
  async function run(action: () => Promise<unknown>) {
    if (busy) return;
    setBusy(true); setError("");
    try { await action(); } catch (e) { setError(e instanceof Error ? e.message : c("Could not save.", "No se pudo guardar.")); } finally { setBusy(false); }
  }
  async function save(id: Document, accepted: boolean) {
    await run(async () => {
      if (id === "sms") await profileRequest("/notifications/sms-consent", { method: "POST", body: JSON.stringify({ phone, consent: accepted ? "yes" : "no", policyVersion: LEGAL_POLICY_VERSION, language: spanish ? "es" : "en" }) });
      else {
        const version = agreements.data?.versions[id];
        if (!version || (id === "eula" && version !== PLATFORM_EULA_VERSION)) throw Error(c("Could not load the agreement version.", "No se pudo cargar la versión del acuerdo."));
        await profileRequest("/personal-agreements", { method: "POST", body: JSON.stringify({ document: id, version, accepted }) });
      }
      await agreements.refetch({ throwOnError: true });
      markReviewed(id);
    });
  }
  const documents: { id: Document; label: string; sections: { title: string; body: readonly string[] }[] }[] = [
    { id: "eula", label: "EULA", sections: [{ title: "", body: [PLATFORM_EULA_TEXT] }] },
    { id: "privacy", label: c("Privacy Policy", "Política de privacidad"), sections: spanish ? PRIVACY_POLICY_SECTIONS_ES : PRIVACY_POLICY_SECTIONS },
    { id: "terms", label: c("Terms & Conditions", "Términos y condiciones"), sections: spanish ? TERMS_SECTIONS_ES : TERMS_SECTIONS },
    { id: "sms", label: c("SMS Enrollment", "Inscripción por SMS"), sections: [{ title: "", body: [spanish ? PUBLIC_SMS_CONSENT_DISCLOSURE_ES : PUBLIC_SMS_CONSENT_DISCLOSURE] }] },
    { id: "work_phone", label: c("Use this as Work Phone", "Usar este dispositivo como teléfono de trabajo"), sections: [{ title: c("Work Phone Usage Agreement", "Acuerdo de uso del teléfono de trabajo"), body: [
      c("Designating this device as your work phone makes it your primary device for VNDRLY work features. Keep it secured, protect access to work information, and report loss or unauthorized access to your supervisor. Use the device for work communications and site activity in accordance with your company's policies.", "Designar este dispositivo como su teléfono de trabajo lo convierte en su dispositivo principal para las funciones laborales de VNDRLY. Protéjalo, controle el acceso a la información laboral e informe a su supervisor si se pierde o alguien accede sin autorización. Úselo conforme a las políticas de su empresa."),
      c("Accepting this agreement does not change your device settings.", "Aceptar este acuerdo no cambia la configuración del dispositivo."),
    ] }] },
    { id: "location_sharing", label: c("Location Sharing Agreement", "Acuerdo para compartir la ubicación"), sections: [{ title: c("On-duty location and notifications", "Ubicación y notificaciones durante el turno"), body: [
      c("VNDRLY uses your location during active work to record site arrivals and departures, verify site activity, and share your work location with authorized operations staff. Browser location permissions control access on this device.", "VNDRLY usa su ubicación durante el trabajo activo para registrar llegadas y salidas, verificar la actividad en el sitio y compartir su ubicación laboral con personal autorizado. Los permisos del navegador controlan el acceso en este dispositivo."),
      c("Accepting this agreement does not turn on location sharing, change notification settings, or enroll you in SMS.", "Aceptar este acuerdo no activa el uso compartido de ubicación, cambia las notificaciones ni lo inscribe en SMS."),
    ] }] },
    { id: "askv_microphone", label: c("Allow AskV to use this device's microphone", "Permitir que AskV use el micrófono de este dispositivo"), sections: [{ title: c("AskV Microphone Usage Agreement", "Acuerdo de uso del micrófono de AskV"), body: [
      c("By agreeing, you authorize AskV to capture and process microphone audio when you use its voice features on this device, such as voice conversations and voice input. Audio may be transcribed to understand your request and respond. Avoid sharing confidential or personal information you are not authorized to disclose.", "Al aceptar, autoriza a AskV a capturar y procesar el audio del micrófono cuando use sus funciones de voz en este dispositivo. El audio puede transcribirse para comprender su solicitud y responder. Evite compartir información que no esté autorizado a divulgar."),
      c("The microphone control and your device permissions govern access. You can turn off microphone access in your device settings.", "El control del micrófono y los permisos del dispositivo determinan el acceso. Puede desactivar el acceso al micrófono en los ajustes del dispositivo."),
    ] }] },
  ];
  const optional = new Set<Document>(["sms", "work_phone", "location_sharing", "askv_microphone"]);
  const decisionMade = (id: Document) => checked(id) || (optional.has(id) && reviewed[id] === (agreements.data?.versions[id] ?? (id === "sms" ? LEGAL_POLICY_VERSION : "reviewed")));
  const setupSteps: ProfileSetupStep[] = [
    { id: "language", label: c("Language", "Idioma"), complete: Boolean(user?.preferredLanguage) },
    { id: "profile_photo", label: c("Profile photo", "Foto de perfil"), complete: hasProfilePhoto || Boolean(reviewed.profile_photo), optional: true, optionalActionLabel: c("Skip photo", "Omitir foto") },
    ...documents.filter(doc => doc.id !== "askv_microphone").map(doc => ({ id: doc.id, label: doc.label, complete: decisionMade(doc.id), optional: optional.has(doc.id) })),
    { id: "notifications", label: c("Notification preferences", "Preferencias de notificaciones"), complete: Boolean(notificationPreferences.data && notificationPreferenceState(notificationPreferences.data) === "all") || Boolean(reviewed.notifications) },
    { id: "devices", label: c("Audio and Backup Devices", "Audio y dispositivos de respaldo"), complete: decisionMade("askv_microphone"), optional: true },
  ];
  function content(doc: typeof documents[number], showHeader = true) { return <>
    {showHeader && <ProfilePanelHeader name={name} title={doc.label} />}
    {doc.sections.map((section, index) => <div key={index} className="space-y-2">{section.title && <h3 className="font-bold">{section.title}</h3>}{section.body.map((text, i) => <p key={i} className="whitespace-pre-wrap">{text}</p>)}</div>)}
    {doc.id === "sms" && <label className="space-y-2 text-sm">{c("10-digit mobile number", "Número móvil de 10 dígitos")}<BrandedInput aria-label={c("10-digit mobile number", "Número móvil de 10 dígitos")} type="tel" autoComplete="tel-national" placeholder="(405) 555-1234" value={phone} onChange={e => setPhone(e.target.value)} disabled={busy || checked("sms")} /></label>}
    <div className="flex flex-wrap items-center gap-4"><label className="flex items-center gap-2 text-sm min-h-11"><input type="checkbox" checked={checked(doc.id)} disabled={busy || !agreements.data} onChange={e => void save(doc.id, e.target.checked)} className="accent-[var(--brand-primary)]" />{doc.id === "sms" ? checked("sms") ? c("Unsubscribe from SMS", "Cancelar la inscripción por SMS") : c("Enroll in SMS", "Inscribirme por SMS") : c("I agree", "Acepto")}</label></div>
  </>; }
  return <>
    <ProfileSetupSummary steps={setupSteps} loading={profileLoading || !agreements.data || notificationPreferences.isPending} onOpen={openSetupSection} onKeepOff={id => markReviewed(id === "devices" ? "askv_microphone" : id)} />
    <p className="py-2">{c("Read and accept platform agreements", "Leer y aceptar los acuerdos de la plataforma")}</p>
    {(error || agreements.error) && <p role="alert" className="pb-3">{error || agreements.error?.message}</p>}
    {documents.filter(d => d.id !== "askv_microphone").map(doc => <div key={doc.id}>
      <ProfileRow anchorId={`profile-setting-${doc.id}`} label={doc.label} open={open === doc.id} onClick={() => toggle(doc.id)} trailing={<Switch aria-label={doc.label} checked={checked(doc.id)} disabled={busy || !agreements.data} onCheckedChange={value => { setOpen(doc.id); if (doc.id !== "sms" || !value) void save(doc.id, value); }} />}>{content(doc)}</ProfileRow>
      {doc.id === "location_sharing" && open === doc.id && <section className="gate-profile-panel" data-testid="location-permission-consent-card">
        <ProfilePanelHeader name={name} title={c("Location permission and consent", "Permiso y consentimiento de ubicación")} />
        <ProfileLocation />
      </section>}
    </div>)}
    <ProfileRow anchorId="profile-setting-notifications" label={c("Notification preferences", "Preferencias de notificaciones")} unframed open={open === "notifications"} onClick={() => toggle("notifications")} trailing={<GateProfileNotificationSummary onReview={() => setOpen("notifications")} />}><ProfilePanelHeader name={name} title={c("Notification preferences", "Preferencias de notificaciones")} /><GateProfileNotifications onSaved={() => markReviewed("notifications")} /></ProfileRow>
    <ProfileRow anchorId="profile-setting-language" label={c("Language", "Idioma")} open={open === "language"} onClick={() => toggle("language")} trailing={<span className="shrink-0 text-sm text-muted-foreground">{spanish ? "Español" : "English"}</span>}>
      <ProfilePanelHeader name={name} title={c("Language", "Idioma")} />
      <label className="flex flex-wrap items-center justify-between gap-3 text-sm">{c("Change your app language preference", "Cambia tu preferencia de idioma")}<BrandedSelect aria-label={c("App language", "Idioma de la aplicación")} value={spanish ? "es" : "en"} disabled={busy} onChange={e => { const language = e.target.value as "en" | "es"; void run(async () => { await profileRequest("/auth/me/language", { method: "PATCH", body: JSON.stringify({ language }) }); setPreferredLanguage(language); await i18n.changeLanguage(language); }); }}><option value="en">English</option><option value="es">Español</option></BrandedSelect></label>
    </ProfileRow>
    <ProfileRow anchorId="profile-setting-devices" label={c("Audio and Backup Devices", "Audio y dispositivos de respaldo")} open={open === "devices"} onClick={() => toggle("devices")} trailing={<Switch aria-label={c("Audio and Backup Devices", "Audio y dispositivos de respaldo")} checked={checked("askv_microphone")} disabled={busy || !agreements.data} onCheckedChange={value => { setOpen("devices"); void save("askv_microphone", value); }} />}><ProfilePanelHeader name={name} title={c("Audio and Backup Devices", "Audio y dispositivos de respaldo")} />{content(documents.find(d => d.id === "askv_microphone")!, false)}<GateProfileDevices /></ProfileRow>
    <ProfileRow label={c("Request account deletion", "Solicitar eliminación de cuenta")} open={open === "deletion"} onClick={() => toggle("deletion")}><ProfilePanelHeader name={name} title={c("Request account deletion", "Solicitar eliminación de cuenta")} /><ProfileDeletion /></ProfileRow>
  </>;
}

function ProfileLocation() {
  const { user } = useAuth(), { i18n } = useTranslation();
  const c = (en: string, es: string) => i18n.language.startsWith("es") ? es : en;
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const consents = useQuery({ queryKey: ["profile-location", user?.userId], queryFn: ({ signal }) => profileRequest<{ consents: { id: number; deviceId: string; acceptedAt: string; revokedAt: string | null }[] }>("/location-consents/me", { signal }) });
  const active = consents.data?.consents.filter(r => !r.revokedAt) ?? [];
  async function revoke(deviceId?: string) {
    setBusy(true); setError("");
    try { await profileRequest(`/location-consents${deviceId ? `?deviceId=${encodeURIComponent(deviceId)}` : ""}`, { method: "DELETE" }); await consents.refetch({ throwOnError: true }); } catch (e) { setError(e instanceof Error ? e.message : "Could not save."); } finally { setBusy(false); }
  }
  return <>
    <p>{c("Manage location sharing for your signed-in devices. You can change this browser's location permission in its site settings.", "Administre la ubicación compartida por sus dispositivos. Puede cambiar el permiso de ubicación de este navegador en la configuración del sitio.")}</p>
    {(error || consents.error) && <p role="alert">{error || consents.error?.message}</p>}
    {active.map(row => <div key={row.id} className="flex flex-wrap items-center justify-between gap-3 text-sm"><span>{row.deviceId.slice(0, 16)} · {new Date(row.acceptedAt).toLocaleDateString()}</span><button type="button" className="vendor-mini-card-button" disabled={busy} onClick={() => void revoke(row.deviceId)}>{c("Stop sharing", "Dejar de compartir")}</button></div>)}
    {!active.length && !consents.isPending && !consents.isError && <p>{c("No devices are sharing location.", "Ningún dispositivo comparte ubicación.")}</p>}
    <button type="button" className="vendor-mini-card-button justify-self-start" disabled={busy || !active.length} onClick={() => void revoke()}>{c("Stop sharing live location", "Dejar de compartir ubicación en vivo")}</button>
  </>;
}

function ProfileDeletion() {
  const { user } = useAuth(), { i18n } = useTranslation();
  const c = (en: string, es: string) => i18n.language.startsWith("es") ? es : en;
  const [checked, setChecked] = useState(false), [password, setPassword] = useState(""), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const request = useQuery({ queryKey: ["profile-deletion", user?.userId], queryFn: ({ signal }) => profileRequest<{ request: { id: string } | null }>("/account/deletion-request", { signal }) });
  async function submit() {
    if (!checked || !password || busy) return;
    setBusy(true); setError("");
    try { await profileRequest("/account/deletion-request", { method: "POST", body: JSON.stringify({ password, confirmation: "DELETE" }) }); setPassword(""); setChecked(false); await request.refetch({ throwOnError: true }); } catch (e) { setError(e instanceof Error ? e.message : "Could not save."); } finally { setBusy(false); }
  }
  return <>
    <p>{c("Deleting your personal VNDRLY account ends your ability to sign in and access your profile, settings, and work through this account. VNDRLY reviews the request and may retain company records such as tickets and shift logs, along with records it is required to keep. Enter your current password below to confirm your deletion request.", "Eliminar su cuenta personal de VNDRLY impide que vuelva a iniciar sesión y acceder a su perfil, configuración y trabajo. VNDRLY revisa la solicitud y puede conservar registros de la empresa, como tickets y registros de turnos, además de los registros que deba conservar. Ingrese su contraseña actual para confirmar la solicitud.")}</p>
    {(error || request.error) && <p role="alert">{error || request.error?.message}</p>}
    {request.data?.request ? <p>{c("Your deletion request is awaiting processing.", "Su solicitud de eliminación está pendiente.")}</p> : request.data && <>
      <label>{c("Current password", "Contraseña actual")}<BrandedInput type="password" autoComplete="current-password" aria-label={c("Current password", "Contraseña actual")} value={password} onChange={e => setPassword(e.target.value)} disabled={busy} /></label>
      <label className="flex gap-2 items-center text-sm"><input type="checkbox" checked={checked} disabled={busy} onChange={e => setChecked(e.target.checked)} />{c("I want to request deletion of my account", "Quiero solicitar la eliminación de mi cuenta")}</label>
      {checked && <p>{c("Are you sure you want to request deletion of your account?", "¿Seguro que quiere solicitar la eliminación de su cuenta?")}</p>}
      <button type="button" className="vendor-mini-card-button justify-self-end" disabled={busy || !checked || !password} onClick={() => void submit()}>{c("Confirm deletion request", "Confirmar solicitud de eliminación")}</button>
    </>}
  </>;
}
