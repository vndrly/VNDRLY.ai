import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useLocation } from "wouter";
import { Award, FileText, Settings, User } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import ContentPaneBackLink from "@/components/content-pane-back-link";
import { ProfileCard, ProfileRow, profileRequest } from "@/components/gate-profile-chrome";
import { FIELD_OPS_PAGE_CLASS } from "@/lib/field-ops-content-pane";
import FieldEditProfile from "./field-edit-profile";
import GateProfileAgreements from "@/components/gate-profile-agreements";
import { OnboardingProgressBanner } from "@/components/finish-setup-widget";
import ProfileCredentials from "@/components/profile-credentials";
import ProfileSubscriptions from "@/components/profile-subscriptions";
import "./gate-profile.css";

export default function GateProfile() {
  const { user } = useAuth();
  return <ProfileContents key={`${user?.userId}:${user?.activeMembershipId}`} />;
}

function ProfileContents() {
  const { user, logout, switchContext } = useAuth();
  const { i18n } = useTranslation();
  const c = (en: string, es: string) => i18n.language.startsWith("es") ? es : en;
  const [, navigate] = useLocation();
  const cache = useQueryClient();
  const [edit, setEdit] = useState(false), [adminOpen, setAdminOpen] = useState(false);
  const [complianceOpen, setComplianceOpen] = useState(false);
  const [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const membership = user?.availableMemberships.find(m => m.id === user.activeMembershipId);
  const me = useQuery({ queryKey: ["gate-profile", user?.userId, user?.activeMembershipId], enabled: Boolean(user),
    queryFn: ({ signal }) => profileRequest<{ employeeId: number | null; firstName: string; lastName: string; email: string; vendorName?: string; jobTitle?: string; profilePhotoPath?: string | null; photoUrl?: string | null }>("/field/me", { signal }) });
  const roles: Record<string,string> = { admin: c("Administrative Team", "Equipo administrativo"), office: c("Office Staff", "Personal de oficina"), gate_supervisor: c("Gate Supervisor", "Supervisor de acceso"), gatekeeper: c("Gatekeeper", "Guardia de acceso") };
  const role = user?.role === "admin" ? "admin" : user?.vendorRole || membership?.role || "";
  const manager = ["admin", "office", "both", "gate_supervisor"].includes(role) || membership?.role === "admin";
  async function run(action: () => Promise<unknown>) {
    setError(""); setBusy(true);
    try { await action(); } catch (e) { setError(e instanceof Error ? e.message : "Could not save."); } finally { setBusy(false); }
  }
  return <div className={`${FIELD_OPS_PAGE_CLASS} gate-profile-page space-y-3`} data-testid="gate-profile">
    <div className="flex items-center gap-3 mb-4"><ContentPaneBackLink href="/gate" ariaLabel={c("Back", "Atrás")} /><h1 className="text-xl font-bold">{c("My Profile", "Mi perfil")}</h1></div>
    <OnboardingProgressBanner />
    {(error || me.error) && <p role="alert">{error || me.error?.message}<button className="ml-3 underline" onClick={() => void me.refetch()}>{c("Retry", "Reintentar")}</button></p>}
    <ProfileCard title={c("Profile & Password Settings", "Configuración de perfil y contraseña")} icon={User} className="gate-profile-identity-card">
      <FieldEditProfile inline expanded={edit} onSaved={() => void cache.invalidateQueries({ queryKey: ["gate-profile"] })}
        summary={<div className="gate-profile-identity-summary min-w-0 flex-1 space-y-1 text-sm" data-testid="profile-user-info">
          <p>{me.data ? [me.data.firstName, me.data.lastName].filter(Boolean).join(" ") : user?.displayName}</p>
          <p className="text-muted-foreground break-all">{me.data?.email}</p>
          <p className="text-muted-foreground">{membership?.orgName || me.data?.vendorName}</p>
          <p className="text-muted-foreground">{roles[role] || role}</p>
        </div>}
        editToggle={<ProfileRow label={c("Edit Profile & Update Password", "Editar perfil y actualizar contraseña")} open={edit} onClick={() => setEdit(!edit)} />}
      />
      <ProfileRow label={c("My credentials and compliance card", "Mis credenciales y tarjeta de cumplimiento")} icon={Award} open={complianceOpen} onClick={() => setComplianceOpen(!complianceOpen)}>
        {me.isPending ? <p>{c("Loading credentials…", "Cargando credenciales…")}</p>
          : me.error ? <p role="alert">{c("Could not load your credentials.", "No se pudieron cargar tus credenciales.")}</p>
          : me.data?.employeeId ? <ProfileCredentials employeeId={me.data.employeeId} />
          : <p>{c("No credentials are linked to this profile yet.", "Todavía no hay credenciales vinculadas a este perfil.")}</p>}
      </ProfileRow>
      <ProfileSubscriptions />
      {(user?.availableMemberships.length ?? 0) > 1 && user?.availableMemberships.map(m => <ProfileRow key={m.id} label={`${m.id === user.activeMembershipId ? "✓ " : ""}${m.orgName}`} disabled={busy || m.id === user.activeMembershipId} onClick={() => void run(async () => { await switchContext(m.id); navigate("/gate/change-over"); })} />)}
    </ProfileCard>
    {manager && <ProfileCard title={c("Gate Administration", "Administración de acceso")} icon={Settings}>
      <ProfileRow label={c("Gate Settings", "Configuración de acceso")} open={adminOpen} onClick={() => setAdminOpen(!adminOpen)}>
        <div>
        <ProfileRow label={c("Staff and site access", "Personal y acceso a sitios")} onClick={() => navigate("/work-hub/workforce")} />
        <ProfileRow label={c("Schedule shifts", "Programar turnos")} onClick={() => navigate("/work-hub/calendar")} />
        <ProfileRow label={c("Watch coverage and recovery", "Cobertura y recuperación de guardia")} onClick={() => navigate("/gate/map")} />
        <ProfileRow label={c("Handoff follow-ups", "Seguimientos de relevo")} onClick={() => navigate("/gate/shift-notes")} />
        {user?.role === "admin" && <ProfileRow label={c("Site setup and linked gates", "Sitios y accesos vinculados")} onClick={() => navigate("/mapping")} />}
        {role !== "gate_supervisor" && <ProfileRow label={c("Gate billing and daily review", "Facturación y revisión diaria")} onClick={() => navigate("/gate/history/billing")} />}
        </div>
      </ProfileRow>
    </ProfileCard>}
    <ProfileCard title={c("Platform Agreements and Settings", "Acuerdos y configuración de la plataforma")} icon={FileText}>
      {user?.role === "admin" && <ProfileRow label={c("VNDRLY logo, icon and branding", "Logotipo, icono y marca de VNDRLY")} icon={Settings} onClick={() => navigate("/admin/vndrly")} />}
      <GateProfileAgreements name={me.data ? `${me.data.firstName} ${me.data.lastName}`.trim() : user?.displayName || ""}
        hasProfilePhoto={Boolean(me.data?.profilePhotoPath || me.data?.photoUrl)} profileLoading={me.isPending}
        onOpenPhoto={() => document.querySelector(".gate-profile-photo")?.scrollIntoView({ behavior: "smooth", block: "center" })} />
    </ProfileCard>
    <button type="button" className="vendor-mini-card-button" disabled={busy} onClick={() => void run(async () => { await logout(); navigate("/"); })}>{c("Sign Out", "Cerrar sesión")}</button>
  </div>;
}
