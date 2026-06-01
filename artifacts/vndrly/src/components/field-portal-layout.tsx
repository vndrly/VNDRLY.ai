import { type ReactNode } from "react";
import { Home, Calendar, QrCode, User } from "lucide-react";
import { ThemeProvider } from "@/hooks/use-theme";
import { PortalBaseProvider } from "@/lib/portal-base";
import { FieldOpsPortalShell, type FieldOpsTabDef } from "@/components/field-ops-portal-shell";

const TABS: FieldOpsTabDef[] = [
  { href: "/field", icon: Home, labelKey: "fieldNav.home", testId: "tab-field-home", match: (p) => p === "/field" || p === "/" },
  { href: "/field/schedule", icon: Calendar, labelKey: "fieldNav.schedule", testId: "tab-field-schedule", match: (p) => p.startsWith("/field/schedule") },
  { href: "/field/scan", icon: QrCode, labelKey: "fieldNav.scan", testId: "tab-field-scan", match: (p) => p.startsWith("/field/scan") || p.startsWith("/field/new-ticket") },
  { href: "/field/profile", icon: User, labelKey: "fieldNav.profile", testId: "tab-field-profile", match: (p) => p.startsWith("/field/profile") || p.startsWith("/field/compliance") || p.startsWith("/field/crew") },
];

export function FieldPortalLayout({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider>
      <PortalBaseProvider base="/field">
        <FieldOpsPortalShell
          tabs={TABS}
          portalLabelKey="fieldHome.portal"
          navAriaKey="fieldNav.aria"
        >
          {children}
        </FieldOpsPortalShell>
      </PortalBaseProvider>
    </ThemeProvider>
  );
}

export default FieldPortalLayout;
