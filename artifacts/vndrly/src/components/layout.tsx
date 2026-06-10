import { Link, useLocation } from "wouter";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard,
  Building2,
  Handshake,
  Users,
  UserCheck,
  MapPin,
  FileText,
  Map as MapIcon,
  Menu,
  LogOut,
  ShoppingCart,
  BarChart3,
  UserPlus,
  Receipt,
  Wallet,
  ScrollText,
  BookOpen,
  Gauge,
  GitMerge,
  MessageSquareOff,
} from "lucide-react";
import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { PngPillButton as PillButton } from "@/components/png-pill-rollover";
import { useAuth } from "@/hooks/use-auth";
import LanguageToggle from "@/components/language-toggle";
import DarkLightToggle from "@/components/dark-light-toggle";
import { useTheme } from "@/hooks/use-theme";
import { useGetVendor, useGetPartner, useGetVendorRatings, getGetVendorRatingsQueryKey, getGetVendorQueryKey, getGetPartnerQueryKey } from "@workspace/api-client-react";
import StarRating from "@/components/star-rating";
import SidebarButton from "@/components/sidebar-button";
import ContextSwitcher from "@/components/context-switcher";
import ReferToVndrlyDialog from "@/components/refer-to-vndrly-dialog";
import { PoweredByVndrly } from "@/components/powered-by-vndrly";
import { VNDRLY_LOGO_SQUARE as vndrlyLogo } from "@/lib/vndrly-brand-assets";
import NotificationsBell from "@/components/notifications-bell";
import sidebarBg from "@assets/VNDRLY_Header_Blur_4_1776220762025.png";

import logoUnderlay from "@assets/logo-underrlay_1778217900673.png";
import logoOverlay from "@assets/logo-overlay_1778217860263.png";
import { useBrand, brandStyleVars } from "@/hooks/use-brand";
import {
  portalDisplayLogo,
  shouldUseLayeredPortalLogo,
} from "@/lib/portal-branding";
import { AssistantLauncher } from "@/components/assistant-panel";

function useNavItems(user: { role: string; vendorId: number | null; partnerId: number | null } | null) {
  const { t } = useTranslation();
  const baseNavItems = [
    { href: "/", label: t("nav.dashboard"), icon: LayoutDashboard, key: "dashboard" },
    { href: "/partners", label: t("nav.partners"), icon: Handshake, key: "partners" },
    { href: "/vendors", label: t("nav.vendors"), icon: Users, key: "vendors" },
    { href: "/field-employees", label: t("nav.employees"), icon: UserCheck, key: "employees" },
    { href: "/site-locations", label: t("nav.siteLocations"), icon: MapPin, key: "site-locations" },
    { href: "/tickets", label: t("nav.tracking"), icon: FileText, key: "tracking" },
  ];
  // Crew Map is only meaningful for vendor + admin (server returns 403 for partners).
  const crewMapItem = { href: "/crew-map", label: t("nav.crewMap"), icon: MapIcon, key: "crew-map" };
  const visitorsItem = { href: "/visitors", label: t("nav.visitors"), icon: UserPlus, key: "visitors" };
  const invoicesItem = { href: "/invoices", label: t("nav.invoices"), icon: Receipt, key: "invoices" };
  const statementsItem = { href: "/statement", label: t("nav.statements"), icon: ScrollText, key: "statements" };
  const billsItem = { href: "/bills-to-pay", label: t("nav.billsToPay"), icon: Wallet, key: "bills-to-pay" };
  const reportsItem = { href: "/reports", label: t("nav.reports"), icon: BookOpen, key: "reports" };
  if (!user) return [...baseNavItems, crewMapItem];
  if (user.role === "vendor" && user.vendorId) {
    return [
      ...baseNavItems.map((item) =>
        item.href === "/vendors" ? { ...item, href: `/vendors/${user.vendorId}`, label: t("nav.vendor") } : item
      ),
      crewMapItem,
      visitorsItem,
      invoicesItem,
      statementsItem,
      reportsItem,
      { href: "/vendor-catalog", label: t("nav.vendorCatalog"), icon: ShoppingCart, key: "vendor-catalog" },
      { href: `/analytics/vendor/${user.vendorId}`, label: t("nav.analytics"), icon: BarChart3, key: "analytics" },
    ];
  }
  if (user.role === "partner" && user.partnerId) {
    return [
      ...baseNavItems.map((item) =>
        item.href === "/partners" ? { ...item, href: `/partners/${user.partnerId}`, label: t("nav.partner") } : item
      ),
      // Site Map mirrors Crew Map but is partner-scoped: shows employees
      // currently within a quarter mile of one of the partner's own sites.
      { href: "/site-map", label: t("nav.siteMap"), icon: MapIcon, key: "site-map" },
      visitorsItem,
      billsItem,
      statementsItem,
      reportsItem,
      { href: `/analytics/partner/${user.partnerId}`, label: t("nav.analytics"), icon: BarChart3, key: "analytics" },
    ];
  }
  if (user.role === "admin") {
    return [
      ...baseNavItems,
      crewMapItem,
      visitorsItem,
      invoicesItem,
      statementsItem,
      reportsItem,
      { href: "/catalog", label: t("nav.catalog"), icon: ShoppingCart, key: "catalog" },
      // VNDRLY self-management page — only shown to system admins.
      // Lets them edit the platform's own company info, branding, and
      // manage other system administrators.
      { href: "/admin/vndrly", label: "VNDRLY", icon: Building2, key: "admin-vndrly" },
      // Per-resource throttle budgets readout (Task #709). Lets a
      // system admin confirm any `<PREFIX>_RATE_LIMIT_MAX_<ROLE>`
      // override took effect after rolling the API process,
      // without grepping logs or tripping a 429.
      { href: "/admin/rate-limits", label: "Rate limits", icon: Gauge, key: "admin-rate-limits" },
      // Vendor merge audit history (Task #453). Surfaces every
      // successful "Merge into another vendor…" so support can
      // investigate "what happened to vendor #X?" without psql.
      { href: "/admin/vendor-merges", label: "Vendor merges", icon: GitMerge, key: "admin-vendor-merges" },
      // Soft-deleted ticket + hotlist comments audit (Task #52). Lets
      // admins see who removed a comment, view the original content,
      // and (from the parent record's comments panel) restore it.
      { href: "/admin/removed-comments", label: "Removed comments", icon: MessageSquareOff, key: "admin-removed-comments" },
      // Edits the singleton fire_transmitter_settings row used as the
      // T-record source on every IRS 1099 FIRE submission. See
      // artifacts/api-server/src/routes/fireTransmitterSettings.ts.
      { href: "/admin/1099-transmitter", label: "1099 transmitter", icon: FileText, key: "admin-1099-transmitter" },
    ];
  }
  return baseNavItems;
}

/** Set to `false` to revert: whole page scrolls (legacy layout). */
const FIXED_APP_CHROME = true;

export default function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const { user, logout } = useAuth();
  const { t } = useTranslation();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const navItems = useNavItems(user);
  const { data: vendor } = useGetVendor(user?.vendorId ?? 0, { query: { enabled: user?.role === "vendor" && !!user.vendorId, queryKey: getGetVendorQueryKey(user?.vendorId ?? 0) } });
  const { data: partner } = useGetPartner(user?.partnerId ?? 0, { query: { enabled: user?.role === "partner" && !!user.partnerId, queryKey: getGetPartnerQueryKey(user?.partnerId ?? 0) } });
  const { data: vendorRatings } = useGetVendorRatings(user?.vendorId ?? 0, {
    query: { enabled: user?.role === "vendor" && !!user.vendorId, queryKey: getGetVendorRatingsQueryKey(user?.vendorId ?? 0) },
  });
  // For admins there's no partner/vendor org to surface, so we show the
  // VNDRLY brand name in that slot — they're admins of the VNDRLY platform.
  const orgName =
    user?.role === "vendor"
      ? vendor?.name
      : user?.role === "partner"
        ? partner?.name
        : user?.role === "admin"
          ? "VNDRLY"
          : null;
  const recentRatings = (vendorRatings?.items ?? []).slice(0, 20);
  const recentAvg = recentRatings.length > 0 ? recentRatings.reduce((s, r) => s + r.rating, 0) / recentRatings.length : null;
  const brand = useBrand();
  const branded = brand.isOrgBranded;
  const { resolved: themeResolved, setMode: setThemeMode } = useTheme();
  const isDarkTheme = themeResolved === "dark";
  // Sidebar prefers the dedicated square logo (rendered at 64x64). If the
  // partner hasn't uploaded a square one yet, fall back to the main logo so
  // they aren't visually downgraded — and finally to the VNDRLY mark. We use
  // truthy checks (not `??`) so that any blank/empty string in the DB
  // doesn't latch and defeat the fallback. (use-brand also normalizes empty
  // strings to null, but defense-in-depth is cheap here.)
  const sidebarLogoUrl = brand.logoSquareUrl || brand.logoUrl || null;
  const displayLogo = portalDisplayLogo(brand, vndrlyLogo);
  const usingSquareLogo = shouldUseLayeredPortalLogo(brand);
  // AskV pane: horizontal chrome above the content area for every
  // authenticated admin / partner / vendor viewer. Uses the same
  // nav-pane background as the left sidebar; hosts Ask V + powered-by.
  const showAskVPane = !!user;
  const navPaneStyle = { backgroundColor: "#3a3d42" } as const;

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
        <div className="relative z-10 px-4 pt-4 pb-1 border-b border-sidebar-border">
        <div className="flex items-start gap-3">
          {usingSquareLogo ? (
            // Same three-layer wrapper used on the login page (vdark): grey
            // radial-vignette underlay PNG @ 50%, partner logo in the
            // middle, white glossy highlight overlay on top. The partner
            // logo is shrunk with extra padding so the vignette frame is
            // visible around it.
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
                branded && sidebarLogoUrl
                  ? "h-10 w-auto max-w-[80px] object-contain bg-white/10 p-1"
                  : "w-10 h-10",
              )}
              draggable={false}
              data-testid="img-sidebar-logo"
            />
          )}
          {/* Right column hugs the bottom edge of the 64px logo so the
              portal label (and the optional vendor star rating) sit
              flush with the bottom of the logo and the top-right
              notification bell never overlaps them. The company name
              has moved out of this row and is rendered full-width
              underneath the logo so it can read the full sidebar
              width. */}
          <div className="flex-1 min-w-0 self-end">
            <p className="text-xs text-sidebar-foreground/60 leading-tight">
              {user?.role === "admin" ? t("nav.adminPortal") : user?.role === "partner" ? t("nav.partnerPortal") : user?.role === "vendor" ? t("nav.vendorPortal") : t("nav.fieldOps")}
            </p>
            {user?.role === "vendor" && recentAvg !== null && (
              <div className="flex items-center gap-1 mt-0.5" data-testid="sidebar-vendor-rating">
                <StarRating value={Math.round(recentAvg)} size={12} readOnly />
                <span className="text-xs text-sidebar-foreground/80">
                  {recentAvg.toFixed(1)} <span className="text-sidebar-foreground/60">({recentRatings.length})</span>
                </span>
              </div>
            )}
          </div>
          <NotificationsBell />
        </div>
        {/* Company / org name now sits in its own row beneath the logo,
            left-aligned and free to use the full sidebar width. */}
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
        {user && (
          <p
            className="mt-1 text-xs text-sidebar-foreground/60 truncate text-left"
            data-testid="text-user-name"
          >
            {user.displayName}
          </p>
        )}
        </div>
        <nav
          className={cn(
            "relative z-10 flex-1 p-3 space-y-[5px]",
            FIXED_APP_CHROME && "min-h-0 overflow-y-auto",
          )}
        >
          {navItems.map((item) => {
            const isActive = location === item.href || (item.href !== "/" && location.startsWith(item.href));
            return (
              <React.Fragment key={item.href}>
                <Link href={item.href} onClick={() => setSidebarOpen(false)}>
                  <SidebarButton isActive={isActive} testId={`nav-${item.key}`} branded={branded} brandPrimary={brand.primary} brandAccent={brand.accent}>
                    <item.icon className="w-4 h-4" />
                    {item.label}
                  </SidebarButton>
                </Link>
              </React.Fragment>
            );
          })}
          {/* Theme + language toggles. Previously rendered conditionally
              after the `analytics` nav item, which meant admins (whose
              nav has no analytics entry) never saw them. Render once
              after the nav loop so every role — admin / vendor /
              partner / field — gets the same toggles in the sidebar. */}
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
                  logout();
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
        <div className="fixed inset-0 bg-black/50 z-40 md:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      <div
        className={cn(
          "flex min-w-0 flex-1 flex-col",
          FIXED_APP_CHROME && "h-screen md:ml-64 md:border-l-2 md:border-[var(--brand-primary)]",
        )}
      >
        {showAskVPane && (
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
        )}
        <header className="flex shrink-0 items-center gap-3 border-b bg-card px-4 py-3 md:hidden">
          <PillButton color="image" className="min-w-[28px] px-0" onClick={() => setSidebarOpen(true)} data-testid="button-menu">
            <Menu className="w-5 h-5" />
          </PillButton>
          <span className="font-bold">VNDRLY</span>
        </header>
        <main
          className={cn(
            "flex-1 p-6",
            FIXED_APP_CHROME ? "min-h-0 overflow-y-auto" : "overflow-auto",
          )}
        >
          {children}
        </main>
      </div>
    </div>
  );
}
