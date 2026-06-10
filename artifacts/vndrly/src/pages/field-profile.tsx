import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useTranslation } from "react-i18next";
import { ChevronRight, User as UserIcon, Edit3, Shield, Users, LogOut, Sun, Moon, Monitor, Check } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useTheme } from "@/hooks/use-theme";
import PngPill, { PngPillButton } from "@/components/png-pill-rollover";
import LanguageToggle from "@/components/language-toggle";
import { cn } from "@/lib/utils";
import { usePortalBase } from "@/lib/portal-base";
import ContentPaneBackLink from "@/components/content-pane-back-link";
import { FIELD_OPS_PAGE_CLASS } from "@/lib/field-ops-content-pane";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface FieldMe {
  employeeId: number;
  firstName: string;
  lastName: string;
  email: string;
  vendorName: string | null;
  jobTitle: string | null;
  vendorLogoUrl: string | null;
  profilePhotoPath: string | null;
  photoUrl?: string | null;
}

function resolveUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  if (path.startsWith("http")) return path;
  const normalized = path.startsWith("/") ? path : `/${path}`;
  if (normalized.startsWith("/api/")) return `${BASE}${normalized}`;
  return `${BASE}/api/storage${normalized}`;
}

export default function FieldProfile() {
  const { t } = useTranslation();
  const [, navigate] = useLocation();
  const portalBase = usePortalBase();
  const { user, logout, switchContext } = useAuth();
  const availableMemberships = user?.availableMemberships ?? [];
  const activeMembershipId = user?.activeMembershipId ?? null;
  const { mode, setMode } = useTheme();
  const [me, setMe] = useState<FieldMe | null>(null);
  const [switchingId, setSwitchingId] = useState<number | null>(null);

  useEffect(() => {
    fetch(`${BASE}/api/field/me`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((m) => setMe(m as FieldMe | null))
      .catch(() => setMe(null));
  }, []);

  const photoUrl = resolveUrl(me?.photoUrl ?? me?.profilePhotoPath ?? null);

  const onPickContext = async (id: number) => {
    if (id === activeMembershipId) return;
    setSwitchingId(id);
    try {
      await switchContext(id);
    } finally {
      setSwitchingId(null);
    }
  };

  const onLogout = async () => {
    await logout();
    navigate("/");
  };

  return (
    <div className={FIELD_OPS_PAGE_CLASS} data-testid="field-profile">
      <div className="mb-4">
        <ContentPaneBackLink href={portalBase} ariaLabel={t("common.back")} />
      </div>
      <div className="flex flex-col items-center pt-2 pb-6">
        <div className="relative">
          {photoUrl ? (
            <img src={photoUrl} alt="" className="w-24 h-24 rounded-full object-cover border-2 border-border" />
          ) : (
            <div className="w-24 h-24 rounded-full bg-muted flex items-center justify-center border-2 border-border">
              <UserIcon className="w-10 h-10 text-muted-foreground" />
            </div>
          )}
        </div>
        <h1 className="text-xl font-bold mt-3">
          {me ? `${me.firstName} ${me.lastName}` : user?.displayName || "—"}
        </h1>
        {me?.jobTitle ? <p className="text-sm text-muted-foreground">{me.jobTitle}</p> : null}
        {me?.vendorName ? <p className="text-sm font-semibold text-[color:var(--brand-primary)] mt-1">{me.vendorName}</p> : null}
      </div>

      {availableMemberships.length >= 2 ? (
        <section
          className="rounded-xl border border-border bg-card p-4 mb-4"
          data-testid="section-active-org"
        >
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
            {t("auth.activeOrg")}
          </h2>
          <ul className="space-y-2">
            {availableMemberships.map((m) => {
              const isActive = m.id === activeMembershipId;
              const busy = switchingId !== null;
              const partner = m.orgType === "partner";
              return (
                <li key={m.id}>
                  <button
                    type="button"
                    onClick={() => void onPickContext(m.id)}
                    disabled={busy}
                    className={cn(
                      "w-full flex items-center gap-2 px-3 py-2 rounded-lg border text-left transition-colors",
                      isActive
                        ? "border-[color:var(--brand-primary)] bg-accent"
                        : "border-border hover:bg-muted",
                      busy && switchingId !== m.id && "opacity-50",
                    )}
                    data-testid={`button-pick-context-${m.id}`}
                  >
                    <span
                      className={cn(
                        "px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider text-white",
                        partner ? "bg-blue-600" : "bg-purple-600",
                      )}
                    >
                      {partner ? t("auth.partner") : t("auth.vendor")}
                    </span>
                    <span className="flex-1 truncate text-sm font-semibold">{m.orgName}</span>
                    {isActive ? <Check className="w-4 h-4 text-[color:var(--brand-primary)]" /> : null}
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      <section className="rounded-xl border border-border bg-card p-4 mb-4">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
          {t("fieldProfile.appearance")}
        </h2>
        <div className="grid grid-cols-3 gap-2">
          {([
            { value: "light", icon: Sun, labelKey: "fieldProfile.themeLight" },
            { value: "dark", icon: Moon, labelKey: "fieldProfile.themeDark" },
            { value: "system", icon: Monitor, labelKey: "fieldProfile.themeSystem" },
          ] as const).map((opt) => {
            const Icon = opt.icon;
            const active = mode === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => setMode(opt.value)}
                aria-pressed={active}
                data-testid={`button-theme-${opt.value}`}
                className={cn(
                  "flex flex-col items-center gap-1 py-2.5 rounded-lg border text-xs font-medium transition-colors",
                  active
                    ? "border-[color:var(--brand-primary)] bg-accent text-foreground"
                    : "border-border text-muted-foreground hover:bg-muted",
                )}
              >
                <Icon className="w-4 h-4" />
                <span>{t(opt.labelKey)}</span>
              </button>
            );
          })}
        </div>
      </section>

      <section className="rounded-xl border border-border bg-card p-4 mb-4">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
          {t("profile.language")}
        </h2>
        <div className="flex justify-start">
          <LanguageToggle />
        </div>
      </section>

      <div className="space-y-2">
        <PngPillButton
          color="blue"
          onClick={() => navigate(`${portalBase}/profile/edit`)}
          className="w-full h-11 text-sm"
          data-testid="button-edit-profile"
        >
          <Edit3 className="w-4 h-4 mr-2" />
          {t("profile.editProfile")}
          <ChevronRight className="w-4 h-4 ml-auto" />
        </PngPillButton>
        <PngPillButton
          color="brand"
          onClick={() => navigate(`${portalBase}/compliance`)}
          className="w-full h-11 text-sm"
          data-testid="button-compliance-card"
        >
          <Shield className="w-4 h-4 mr-2" />
          {t("profile.complianceCard")}
          <ChevronRight className="w-4 h-4 ml-auto" />
        </PngPillButton>
        <PngPillButton
          color="brand"
          onClick={() => navigate(`${portalBase}/crew`)}
          className="w-full h-11 text-sm"
          data-testid="button-crew-changes"
        >
          <Users className="w-4 h-4 mr-2" />
          {t("profile.crewChanges")}
          <ChevronRight className="w-4 h-4 ml-auto" />
        </PngPillButton>
        <PngPillButton
          color="red"
          onClick={() => void onLogout()}
          className="w-full h-11 text-sm"
          data-testid="button-sign-out"
        >
          <LogOut className="w-4 h-4 mr-2" />
          {t("nav.signOut")}
        </PngPillButton>
      </div>
    </div>
  );
}
