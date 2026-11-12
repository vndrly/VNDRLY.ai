import { useGateOperatingContext } from "@/hooks/use-gate-operating-context";
import BrandPillButton from "@/components/brand-pill-button";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/hooks/use-auth";
import { canUseOfficeNavigation } from "@/lib/office-navigation";
import "./gate-portal-workspace.css";
import { type ReactNode } from "react";
import { useLocation } from "wouter";
import { ArrowLeft, History, MapPin, Mic, Shield } from "lucide-react";
import {
  FieldOpsPortalShell,
  type FieldOpsTabDef,
} from "@/components/field-ops-portal-shell";

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
  {
    href: "/gate/shift-notes",
    icon: History,
    labelKey: "changeOver.shiftNotes",
    testId: "tab-gate-shift-notes",
    match: (p) => p === "/gate/shift-notes",
  },
];

export function GatePortalLayout({
  children,
  returnToAdmin = false,
}: {
  children: ReactNode;
  returnToAdmin?: boolean;
}) {
  const [location] = useLocation();
  const context = useGateOperatingContext();
  const { t } = useTranslation();
  const { user } = useAuth();
  const pageTabs =
    location === "/gate" || location === "/"
      ? GATE_PORTAL_TABS
      : GATE_PORTAL_TABS.filter((tab) => !tab.voiceEntry);
  const tabs =
    returnToAdmin && canUseOfficeNavigation(user)
      ? [
          ...pageTabs,
          {
            href: "/",
            icon: ArrowLeft,
            labelKey: "gateNav.returnToAdmin",
            testId: "tab-gate-return-admin",
            match: () => false,
          },
        ]
      : pageTabs;
  return (
    <FieldOpsPortalShell
      tabs={tabs}
      portalLabelKey="gatekeeper.portal"
      navAriaKey="gateNav.aria"
    >
      <div className="gate-portal-workspace">
        <div
          role="status"
          className="flex flex-wrap items-center gap-3 p-3 text-sm"
        >
          {context.isError ? (
            t("gateOperating.unavailable")
          ) : context.operating ? (
            <>
              {t("gateOperating.operating", {
                site: context.operating.siteName,
                gate: context.operating.gateName,
              })}{" "}
              <BrandPillButton tone="blue" onClick={context.myGate}>
                {t("gateOperating.myGate")}
              </BrandPillButton>
              {context.viewing?.stationId !== context.operating.stationId && (
                <span>Browsing another gate — recording disabled.</span>
              )}
            </>
          ) : (
            t("gateOperating.noWatch")
          )}
        </div>
        {children}
      </div>
    </FieldOpsPortalShell>
  );
}

export default GatePortalLayout;
