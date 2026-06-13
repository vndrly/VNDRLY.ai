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
import StarRating from "@/components/star-rating";
import { AssistantLauncher } from "@/components/assistant-panel";
import { PngPillButton as PillButton } from "@/components/png-pill-rollover";
import {
  portalDisplayLogo,
  shouldUseLayeredPortalLogo,
} from "@/lib/portal-branding";
import { VNDRLY_LOGO_SQUARE as vndrlyLogo } from "@/lib/vndrly-brand-assets";
import {
  useGetVendor,
  useGetVendorRatings,
  getGetVendorQueryKey,
  getGetVendorRatingsQueryKey,
} from "@workspace/api-client-react";
import { NAV_PANE_DARK_BG } from "@/components/nav-pane-tokens";
import { NavPaneHalftoneBackground } from "@/components/nav-pane-halftone-background";
import { NavPaneHeaderBlur } from "@/components/nav-pane-header-blur";

import logoUnderlay from "@assets/logo-underrlay_1778217900673.png";
import logoOverlay from "@assets/logo-overlay_1778217860263.png";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

/** Matches main Layout — fixed sidebar + AskV pane; only main scrolls. */
const FIXED_APP_CHROME = true;

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

  const vendorId = user?.vendorId ?? null;
  const { data: vendor } = useGetVendor(vendorId ?? 0, {
    query: {
      enabled: !!vendorId,
      queryKey: getGetVendorQueryKey(vendorId ?? 0),
    },
  });
  const { data: vendorRatings } = useGetVendorRatings(vendorId ?? 0, {
    query: {
      enabled: !!vendorId,
      queryKey: getGetVendorRatingsQueryKey(vendorId ?? 0),
    },
  });
  const recentRatings = (vendorRatings?.items ?? []).slice(0, 20);
  const recentAvg =
    recentRatings.length > 0
      ? recentRatings.reduce((s, r) => s + r.rating, 0) / recentRatings.length
      : null;

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
  const orgName = brand.name || vendor?.name || vendorName;
  const displayUserName = user?.displayName?.trim() || employeeName;
  const navPaneStyle = { backgroundColor: NAV_PANE_DARK_BG } as const;

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
        data-testid="img-sidebar-logo"
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
      data-testid="img-sidebar-logo"
    />
  );

  return (
    <div
      className={cn("flex", FIXED_APP_CHROME ? "h-screen overflow-hidden" : "min-h-screen")}
      style={brandStyleVars(brand)}
    >
      <aside
        style={navPaneStyle}
        className={cn(
          "fixed inset-y-0 left-0 z-50 w-64 flex flex-col transition-transform overflow-hidden",
          FIXED_APP_CHROME ? "md:translate-x-0" : "md:static md:translate-x-0",
          sidebarOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <NavPaneHalftoneBackground variant="sidebar" />
        <NavPaneHeaderBlur />
        <div className="relative z-10 px-4 pt-4 pb-1 border-b border-sidebar-border">
          <div className="flex items-start gap-3">
            {logoNode}
            <div className="flex-1 min-w-0 self-end">
              <p className="text-xs text-sidebar-foreground/60 leading-tight">
                {t(portalLabelKey)}
              </p>
              {recentAvg !== null && (
                <div className="flex items-center gap-1 mt-0.5" data-testid="sidebar-vendor-rating">
                  <StarRating value={Math.round(recentAvg)} size={12} readOnly />
                  <span className="text-xs text-sidebar-foreground/80">
                    {recentAvg.toFixed(1)}{" "}
                    <span className="text-sidebar-foreground/60">({recentRatings.length})</span>
                  </span>
                </div>
              )}
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
              data-testid="text-user-name"
            >
              {displayUserName}
            </p>
          )}
        </div>
        <nav
          className={cn(
            "relative z-10 flex-1 p-3 space-y-[5px]",
            FIXED_APP_CHROME && "min-h-0 overflow-y-auto",
          )}
        >
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
          <div className="pt-6 pb-1 px-1 flex justify-between items-center gap-2">
            <DarkLightToggle
              mode={isDarkTheme ? "dark" : "light"}
              onChange={(m) => setThemeMode(m)}
              variant={isDarkTheme ? "dark" : "light"}
            />
            <LanguageToggle variant={isDarkTheme ? "dark" : "light"} />
          </div>
          {user && (
            <div className="pt-3">
              <SidebarButton
                isActive={false}
                activeOnHover
                onClick={() => {
                  void logout();
                }}
                testId="nav-sign-out-sidebar"
                branded={branded}
                brandPrimary={brand.primary}
                brandAccent={brand.accent}
              >
                <LogOut className="w-4 h-4" />
                {t("nav.signOut")}
              </SidebarButton>
            </div>
          )}
        </nav>
      </aside>

      {!FIXED_APP_CHROME && (
        <div
          className="hidden md:block w-[2px] shrink-0"
          style={{ backgroundColor: "var(--brand-primary)" }}
        />
      )}

      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 md:hidden"
          onClick={() => setSidebarOpen(false)}
          aria-hidden="true"
        />
      )}

      <div
        className={cn(
          "flex min-w-0 flex-1 flex-col",
          FIXED_APP_CHROME && "h-screen md:ml-64 md:border-l-2 md:border-[var(--brand-primary)]",
        )}
      >
        <div
          style={navPaneStyle}
          className="flex min-h-[48px] shrink-0 items-center justify-end gap-4 overflow-visible px-4 py-2"
          data-testid="askv-pane"
        >
          <div className="flex items-center overflow-visible">
            <AssistantLauncher placement="askv-pane" />
          </div>
          <ReferToVndrlyDialog
            trigger={
              <button
                type="button"
                className="flex items-center gap-2 text-sm text-sidebar-foreground/80 leading-relaxed cursor-pointer transition-colors hover:[color:var(--brand-primary)] focus-visible:[color:var(--brand-primary)] focus:outline-none bg-transparent border-0 p-0"
                data-testid="button-askv-pane-refer-to-vndrly"
              >
                <PoweredByVndrly textClassName="text-sidebar-foreground/80" />
              </button>
            }
          />
        </div>

        <header className="flex shrink-0 items-center gap-3 border-b bg-card px-4 py-3 md:hidden">
          <PillButton
            color="image"
            className="min-w-[28px] px-0"
            onClick={() => setSidebarOpen(true)}
            data-testid="button-menu"
          >
            <Menu className="w-5 h-5" />
          </PillButton>
          <span className="font-bold truncate">{orgName ?? "VNDRLY"}</span>
        </header>

        <main
          className={cn(
            "flex-1 p-6 pb-24 md:pb-6",
            FIXED_APP_CHROME ? "min-h-0 overflow-y-auto" : "overflow-auto",
          )}
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
                      active
                        ? "text-[color:var(--brand-primary)]"
                        : "text-muted-foreground hover:text-foreground",
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
