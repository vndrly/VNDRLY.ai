import { type ReactNode } from "react";
import { ArrowLeft, BriefcaseBusiness, History, Mic, Shield } from "lucide-react";
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
    href: "/gate/change-over",
    icon: Shield,
    labelKey: "changeOver.title",
    testId: "tab-gate-change-over",
    match: (p) => p === "/gate/change-over",
  },
  {
    href: "/work-hub",
    icon: BriefcaseBusiness,
    labelKey: "managedSubcontractors.workHub",
    testId: "tab-gate-work-hub",
    match: (p) => p.startsWith("/work-hub"),
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
  { href: "/gate/shift-notes", icon: History, labelKey: "changeOver.shiftNotes", testId: "tab-gate-shift-notes", match: p => p === "/gate/shift-notes" },
];

export function GatePortalLayout({ children, returnToAdmin = false }: { children: ReactNode; returnToAdmin?: boolean }) {
  const tabs = returnToAdmin ? [
    ...GATE_PORTAL_TABS,
    { href: "/", icon: ArrowLeft, labelKey: "gateNav.returnToAdmin", testId: "tab-gate-return-admin", match: () => false },
  ] : GATE_PORTAL_TABS;
  return (
    <FieldOpsPortalShell
      tabs={tabs}
      portalLabelKey="gatekeeper.portal"
      navAriaKey="gateNav.aria"
    >
      {children}
    </FieldOpsPortalShell>
  );
}

export default GatePortalLayout;
