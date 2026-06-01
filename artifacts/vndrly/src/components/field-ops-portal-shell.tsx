import { type ReactNode, useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { useTranslation } from "react-i18next";
import { LogOut, Menu, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";
import { useTheme } from "@/hooks/use-theme";
import { useBrand, brandStyleVars } from "@/hooks/use-brand";
import LanguageToggle from "@/components/language-toggle";
import DarkLightToggle from "@/components/dark-light-toggle";
import NotificationsBell from "@/components/notifications-bell";
import SidebarButton from "@/components/sidebar-button";
import ReferToVndrlyDialog from "@/components/refer-to-vndrly-dialog";
import { PoweredByVndrly } from "@/components/powered-by-vndrly";
import ContextSwitcher from "@/components/context-switcher";
import { PngPillButton as PillButton } from "@/components/png-pill-rollover";
import {
  portalDisplayLogo,
  shouldUseLayeredPortalLogo,
} from "@/lib/portal-branding";
import { VNDRLY_LOGO_SQUARE as vndrlyLogo } from "@/lib/vndrly-brand-assets";
import sidebarBg from "@assets/VNDRLY_Header_Blur_4_1776220762025.png";

import logoUnderlay from "@assets/logo-underrlay_1778217900673.png";
import logoOverlay from "@assets/logo-overlay_1778217860263.png";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export interface FieldOpsTabDef {
  href: string;
  icon: LucideIcon;
  labelKey: string;
  testId: string;
  match: (path: string) => boolean;
}

interface FieldOpsPortalShellProps {
  children: ReactNode;
  tabs: FieldOpsTabDef[];
  portalLabelKey: string;
  navAriaKey: string;
}

export function FieldOpsPortalShell({
  children,
  tabs,
  portalLabelKey,
  navAriaKey,
}: FieldOpsPortalShellProps) {
  const { t } = useTranslation();
  const [location] = useLocation();
  const { user, logout } = useAuth();
  const brand = useBrand();
  const branded = brand.isOrgBranded;
  const { resolved: themeResolved, setMode: setThemeMode } = useTheme();
  const isDarkTheme = themeResolved === "dark";
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [vendorName, setVendorName] = useState<string | null>(null);
  const [employeeName, setEmployeeName] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`${BASE}/api/field/me`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((me) => {
        if (cancelled || !me) return;
        if (typeof me.vendorName === "string" && me.vendorName.trim()) {
          setVendorName(me.vendorName.trim());
        }
        const first = typeof me.firstName === "string" ? me.firstName.trim() : "";
        const last = typeof me.lastName === "string" ? me.lastName.trim() : "";
        const full = `${first} ${last}`.trim();
        if (full) setEmployeeName(full);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const displayLogo = portalDisplayLogo(brand, vndrlyLogo);
  const useLayeredLogo = shouldUseLayeredPortalLogo(brand);
  const orgName = brand.name || vendorName;
  const displayUserName = user?.displayName?.trim() || employeeName;

  const logoNode = useLayeredLogo ? (
    <div className="relative w-16 h-16 shrink-0 mt-[2px] rounded-lg overflow-hidden">
      <img
        src={logoUnderlay}
        alt=""
        aria-hidden="true"
        className="absolute inset-0 w-full h-full object-cover pointer-events-none"
        style={{ opacity: 0.5 }}
        draggable={false}
      />
      <img
        src={logoOverlay}
        alt=""
        aria-hidden="true"
        className="absolute inset-0 w-full h-full object-cover pointer-events-none"
        style={{ opacity: 0.7 }}
        draggable={false}
      />
      <img
        src={displayLogo}
        alt={brand.name ? `${brand.name} Logo` : "Partner Logo"}
        className="absolute inset-0 w-full h-full object-contain p-2"
        draggable={false}
        data-testid="img-field-portal-logo"
      />
    </div>
  ) : (
    <img
      src={displayLogo}
      alt={branded && brand.name ? `${brand.name} Logo` : "VNDRLY Logo"}
      className={cn(
        "rounded-lg shrink-0 mt-[2px]",
        branded && (brand.logoSquareUrl || brand.logoUrl)
          ? "h-10 w-auto max-w-[80px] object-contain bg-white/10 p-1"
          : "w-10 h-10",
      )}
      draggable={false}
      data-testid="img-field-portal-logo"
    />
  );

  const sidebarHeader = (
    <div className="relative z-10 px-4 pt-4 pb-1 border-b border-sidebar-border">
      <div className="flex items-start gap-3">
        {logoNode}
        <div className="flex-1 min-w-0 self-end">
          <p className="text-xs text-sidebar-foreground/60 leading-tight">
            {t(portalLabelKey)}
          </p>
        </div>
        <NotificationsBell />
      </div>
      {user && user.availableMemberships.length >= 2 ? (
        <div className="mt-1">
          <ContextSwitcher fallbackOrgName={orgName ?? null} />
        </div>
      ) : (
        orgName && (
          <p className="mt-1 text-base font-semibold text-sidebar-foreground/90 leading-tight truncate text-left">
            {orgName}
          </p>
        )
      )}
      {displayUserName && (
        <p
          className="mt-1 text-xs text-sidebar-foreground/60 truncate text-left"
          data-testid="text-field-portal-user-name"
        >
          {displayUserName}
        </p>
      )}
    </div>
  );

  const sidebarNav = (
    <nav className="relative z-10 flex-1 p-3 space-y-[5px] overflow-y-auto">
      {tabs.map((tab) => {
        const isActive = tab.match(location);
        const Icon = tab.icon;
        return (
          <Link key={tab.href} href={tab.href} onClick={() => setSidebarOpen(false)}>
            <SidebarButton
              isActive={isActive}
              testId={tab.testId}
              branded={branded}
              brandPrimary={brand.primary}
              brandAccent={brand.accent}
            >
              <Icon className="w-4 h-4" />
              {t(tab.labelKey)}
            </SidebarButton>
          </Link>
        );
      })}
      <div className="pt-6 pb-1 px-1 flex justify-between items-center gap-2 md:hidden">
        <DarkLightToggle
          mode={isDarkTheme ? "dark" : "light"}
          onChange={(m) => setThemeMode(m)}
          variant="light"
        />
        <LanguageToggle variant="light" />
      </div>
    </nav>
  );

  return (
    <div className="min-h-screen flex" style={brandStyleVars(brand)}>
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 w-64 bg-sidebar text-sidebar-foreground flex flex-col transition-transform overflow-hidden",
          sidebarOpen ? "translate-x-0" : "-translate-x-full",
          "md:translate-x-0 md:static",
        )}
      >
        <div
          className="absolute top-0 left-0 right-0 pointer-events-none z-0"
          style={{
            backgroundImage: `url(${sidebarBg})`,
            backgroundSize: "cover",
            backgroundPosition: "center top",
            opacity: 0.85,
            height: "200px",
            maskImage: "linear-gradient(to bottom, black 0%, transparent 100%)",
            WebkitMaskImage: "linear-gradient(to bottom, black 0%, transparent 100%)",
          }}
        />
        {sidebarHeader}
        {sidebarNav}
      </aside>

      <div
        className="hidden md:block w-[2px] shrink-0"
        style={{ backgroundColor: "var(--brand-primary)" }}
      />

      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 md:hidden"
          onClick={() => setSidebarOpen(false)}
          aria-hidden="true"
        />
      )}

      <div className="flex-1 flex flex-col min-w-0">
        <div className="bg-sidebar text-sidebar-foreground border-b border-sidebar-border px-3 py-2 flex items-center justify-between gap-2 shrink-0">
          <ReferToVndrlyDialog
            trigger={
              <button
                type="button"
                className="hidden sm:flex items-center gap-2 text-sm text-sidebar-foreground/80 leading-relaxed cursor-pointer transition-colors hover:[color:var(--brand-primary)] focus-visible:[color:var(--brand-primary)] focus:outline-none bg-transparent border-0 p-0"
                data-testid="button-field-portal-refer"
              >
                <PoweredByVndrly textClassName="text-sidebar-foreground/80" />
              </button>
            }
          />
          <div className="flex items-center gap-2 ml-auto">
            <div className="hidden md:flex items-center gap-2">
              <DarkLightToggle
                mode={isDarkTheme ? "dark" : "light"}
                onChange={(m) => setThemeMode(m)}
                variant="light"
              />
              <LanguageToggle variant="light" />
            </div>
            <div className="[&>*]:!h-[28px]">
              <SidebarButton
                isActive={false}
                activeOnHover
                onClick={() => { void logout(); }}
                testId="nav-field-portal-sign-out"
                branded={branded}
                brandPrimary={brand.primary}
                brandAccent={brand.accent}
              >
                <LogOut className="w-4 h-4" />
                <span className="hidden sm:inline">{t("nav.signOut")}</span>
              </SidebarButton>
            </div>
          </div>
        </div>

        <header className="border-b bg-card px-4 py-3 flex items-center gap-3 md:hidden">
          <PillButton color="image" className="min-w-[28px] px-0" onClick={() => setSidebarOpen(true)} data-testid="button-field-portal-menu">
            <Menu className="w-5 h-5" />
          </PillButton>
          <span className="font-bold truncate flex-1">{orgName ?? "VNDRLY"}</span>
        </header>

        <main
          className="flex-1 overflow-auto pb-20 md:pb-0"
          style={isDarkTheme ? { backgroundColor: "#E6E6E7" } : undefined}
        >
          {children}
        </main>

        <nav
          className="fixed bottom-0 inset-x-0 z-40 md:hidden bg-card border-t border-border"
          style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
          aria-label={t(navAriaKey)}
        >
          <ul className="flex items-stretch justify-around h-16">
            {tabs.map((tab) => {
              const active = tab.match(location);
              const Icon = tab.icon;
              return (
                <li key={tab.href} className="flex-1">
                  <Link
                    href={tab.href}
                    data-testid={`${tab.testId}-mobile`}
                    className={cn(
                      "flex flex-col items-center justify-center gap-0.5 h-full text-[10px] font-medium transition-colors",
                      active ? "text-[color:var(--brand-primary)]" : "text-muted-foreground hover:text-foreground",
                    )}
                    aria-current={active ? "page" : undefined}
                  >
                    <Icon className={cn("w-5 h-5", active && "stroke-[2.4]")} />
                    <span>{t(tab.labelKey)}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      </div>
    </div>
  );
}
