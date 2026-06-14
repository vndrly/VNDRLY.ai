import { type ReactNode } from "react";
import { Home, Calendar, Users, QrCode, User, MapPin, BarChart3 } from "lucide-react";
import { ThemeProvider } from "@/hooks/use-theme";
import { PortalBaseProvider } from "@/lib/portal-base";
import { FieldOpsPortalShell, type FieldOpsTabDef } from "@/components/field-ops-portal-shell";

const TABS: FieldOpsTabDef[] = [
  { href: "/foreman", icon: Home, labelKey: "foremanNav.home", testId: "tab-foreman-home", match: (p) => p === "/foreman" || p === "/" },
  { href: "/foreman/schedule", icon: Calendar, labelKey: "foremanNav.schedule", testId: "tab-foreman-schedule", match: (p) => p.startsWith("/foreman/schedule") },
  { href: "/foreman/map", icon: MapPin, labelKey: "foremanNav.map", testId: "tab-foreman-map", match: (p) => p.startsWith("/foreman/map") },
  { href: "/foreman/crews", icon: Users, labelKey: "foremanNav.crews", testId: "tab-foreman-crews", match: (p) => p.startsWith("/foreman/crews") },
  { href: "/foreman/analytics", icon: BarChart3, labelKey: "foremanNav.analytics", testId: "tab-foreman-analytics", match: (p) => p.startsWith("/foreman/analytics") },
  { href: "/foreman/scan", icon: QrCode, labelKey: "foremanNav.scan", testId: "tab-foreman-scan", match: (p) => p.startsWith("/foreman/scan") || p.startsWith("/foreman/new-ticket") },
  { href: "/foreman/profile", icon: User, labelKey: "foremanNav.profile", testId: "tab-foreman-profile", match: (p) => p.startsWith("/foreman/profile") || p.startsWith("/foreman/compliance") || p.startsWith("/foreman/crew") },
];

export function ForemanPortalLayout({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider>
      <PortalBaseProvider base="/foreman">
        <FieldOpsPortalShell
          tabs={TABS}
          portalLabelKey="foremanHome.portal"
          navAriaKey="foremanNav.aria"
        >
          {children}
        </FieldOpsPortalShell>
      </PortalBaseProvider>
    </ThemeProvider>
  );
}

export default ForemanPortalLayout;
