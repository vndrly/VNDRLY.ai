import { type ReactNode } from "react";
import { BriefcaseBusiness, History, Mic, Shield } from "lucide-react";
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
    href: "/gate",
    icon: Shield,
    labelKey: "gateNav.gate",
    testId: "tab-gate-home",
    match: (p) => p === "/gate" || p === "/",
  },
  {
    href: "/gate/history",
    icon: History,
    labelKey: "gateNav.history",
    testId: "tab-gate-history",
    match: (p) => p === "/gate/history" || p.startsWith("/gate/history/"),
  },
  {
    href: "/work-hub",
    icon: BriefcaseBusiness,
    labelKey: "managedSubcontractors.workHub",
    testId: "tab-gate-work-hub",
    match: (p) => p.startsWith("/work-hub"),
  },
];

export function GatePortalLayout({ children }: { children: ReactNode }) {
  return (
    <FieldOpsPortalShell
      tabs={GATE_PORTAL_TABS}
      portalLabelKey="gatekeeper.portal"
      navAriaKey="gateNav.aria"
    >
      {children}
    </FieldOpsPortalShell>
  );
}

export default GatePortalLayout;
