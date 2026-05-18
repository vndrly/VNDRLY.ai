import { type ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { useTranslation } from "react-i18next";
import { Home, Calendar, QrCode, User } from "lucide-react";
import { cn } from "@/lib/utils";
import { ThemeProvider } from "@/hooks/use-theme";

interface TabDef {
  href: string;
  icon: typeof Home;
  labelKey: string;
  testId: string;
  match: (path: string) => boolean;
}

const TABS: TabDef[] = [
  { href: "/field", icon: Home, labelKey: "fieldNav.home", testId: "tab-field-home", match: (p) => p === "/field" || p === "/" },
  { href: "/field/schedule", icon: Calendar, labelKey: "fieldNav.schedule", testId: "tab-field-schedule", match: (p) => p.startsWith("/field/schedule") },
  { href: "/field/scan", icon: QrCode, labelKey: "fieldNav.scan", testId: "tab-field-scan", match: (p) => p.startsWith("/field/scan") || p.startsWith("/field/new-ticket") },
  { href: "/field/profile", icon: User, labelKey: "fieldNav.profile", testId: "tab-field-profile", match: (p) => p.startsWith("/field/profile") || p.startsWith("/field/compliance") || p.startsWith("/field/crew") },
];

export function FieldPortalShell({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const [location] = useLocation();

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      <main className="flex-1 pb-20 md:pb-0 md:pl-64">{children}</main>
      <nav
        className="fixed bottom-0 inset-x-0 z-40 md:hidden bg-card border-t border-border"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
        aria-label={t("fieldNav.aria")}
      >
        <ul className="flex items-stretch justify-around h-16">
          {TABS.map((tab) => {
            const active = tab.match(location);
            const Icon = tab.icon;
            return (
              <li key={tab.href} className="flex-1">
                <Link
                  href={tab.href}
                  data-testid={tab.testId}
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
      <aside className="hidden md:flex fixed inset-y-0 left-0 z-40 w-64 bg-sidebar text-sidebar-foreground border-r border-sidebar-border flex-col">
        <div className="px-5 py-4 border-b border-sidebar-border">
          <p className="text-sm font-bold tracking-wide">VNDRLY</p>
          <p className="text-[11px] text-sidebar-foreground/70">{t("fieldHome.portal")}</p>
        </div>
        <ul className="flex-1 p-2 space-y-1">
          {TABS.map((tab) => {
            const active = tab.match(location);
            const Icon = tab.icon;
            return (
              <li key={tab.href}>
                <Link
                  href={tab.href}
                  data-testid={`${tab.testId}-side`}
                  className={cn(
                    "flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-colors",
                    active
                      ? "bg-sidebar-accent text-[color:var(--brand-primary)]"
                      : "text-sidebar-foreground/85 hover:bg-sidebar-accent hover:text-sidebar-foreground",
                  )}
                  aria-current={active ? "page" : undefined}
                >
                  <Icon className="w-4 h-4 shrink-0" />
                  <span>{t(tab.labelKey)}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </aside>
    </div>
  );
}

export function FieldPortalLayout({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider>
      <FieldPortalShell>{children}</FieldPortalShell>
    </ThemeProvider>
  );
}

export default FieldPortalLayout;
