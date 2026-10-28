import { useAuth } from "@/hooks/use-auth";
import { canUseOfficeNavigation } from "@/lib/office-navigation";
import "./gate-portal-workspace.css";
import { type ReactNode, useState } from "react";
import { useLocation } from "wouter";
import { ReturnToAdminPinDialog } from "@/components/return-to-admin-pin-dialog";
import { ArrowLeft, History, MapPin, Mic, Shield } from "lucide-react";
import { FieldOpsPortalShell, type FieldOpsTabDef } from "@/components/field-ops-portal-shell";

export const GATE_PORTAL_TABS: FieldOpsTabDef[] = [
  {
    href: "/gate",
    icon: Mic,
    labelKey: "gateNav.voice",
    testId: "button-gate-voice",
    voiceEntry: true,
    match: () => false,
  },
  {
    href: "/work-hub",
    icon: ArrowLeft,
    labelKey: "gateNav.goToWorkHub",
    testId: "tab-gate-work-hub",
    match: (p) => p.startsWith("/work-hub"),
  },
  {
    href: "/gate/change-over",
    icon: Shield,
    labelKey: "changeOver.title",
    testId: "tab-gate-change-over",
    match: (p) => p === "/gate/change-over",
  },
  {
    href: "/gate",
    icon: Shield,
    labelKey: "gateNav.gate",
    testId: "tab-gate-home",
    match: (p) => p === "/gate" || p === "/",
  },
  {
    href: "/gate/map",
    icon: MapPin,
    labelKey: "gateNav.map",
    testId: "tab-gate-map",
    match: (p) => p === "/gate/map",
  },
  {
    href: "/gate/history",
    icon: History,
    labelKey: "gateNav.history",
    testId: "tab-gate-history",
    match: (p) => p === "/gate/history" || p.startsWith("/gate/history/"),
  },
  { href: "/gate/shift-notes", icon: History, labelKey: "changeOver.shiftNotes", testId: "tab-gate-shift-notes", match: p => p === "/gate/shift-notes" },
];

export function GatePortalLayout({ children, returnToAdmin = false }: { children: ReactNode; returnToAdmin?: boolean }) {
  const [location] = useLocation();
  const { user } = useAuth();
  const [pinOpen, setPinOpen] = useState(false);
  const pageTabs = location === "/gate" || location === "/"
    ? GATE_PORTAL_TABS
    : GATE_PORTAL_TABS.filter(tab => !tab.voiceEntry);
  const tabs = returnToAdmin && canUseOfficeNavigation(user) ? [
    ...pageTabs,
    { href: "/", icon: ArrowLeft, labelKey: "gateNav.returnToAdmin", testId: "tab-gate-return-admin", match: () => false,
      ...(location === "/gate/change-over" ? { onSelect: () => { setPinOpen(true); } } : {}),
    },
  ] : pageTabs;
  return (
    <FieldOpsPortalShell
      tabs={tabs}
      portalLabelKey="gatekeeper.portal"
      navAriaKey="gateNav.aria"
    >
      <div className="gate-portal-workspace">{children}</div>
      <ReturnToAdminPinDialog open={pinOpen} onOpenChange={setPinOpen} />
    </FieldOpsPortalShell>
  );
}

export default GatePortalLayout;
