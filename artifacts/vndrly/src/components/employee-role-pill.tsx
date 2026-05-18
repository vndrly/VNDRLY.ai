import { cn } from "@/lib/utils";
import PillBg from "@/components/pill-bg";
import amberPill from "@assets/900x229_Amber_Pill_v4_1778504507024.png";
import bluePill from "@assets/NewPillPallet_0001s_0017_900x229_blue_Pill.png";
import greenPill from "@assets/NewPillPallet_0001s_0051_900x229_green_Pill_v3.png";
// Idle-grey chrome must MATCH the PEC "None" pill exactly: shared
// pillBase + diagonal pillGloss pair from the new Pill family
// (pill.tsx).
import pillBase from "@assets/Vndrly_900x229_Light_Grey_Pill1_1777664658767.png";
import pillGloss from "@assets/900x229_overlay_v2_1777664185377.png";

type EmployeePillColor = "amber" | "blue" | "green" | "grey";

const COLOR_PNG: Record<EmployeePillColor, string> = {
  amber: amberPill,
  blue: bluePill,
  green: greenPill,
  grey: pillBase, // unused — grey branch renders pillBase + pillGloss inline
};

const PILL_ASPECT = 900 / 229;

const employeeRoleConfig: Record<string, { label: string; color: EmployeePillColor }> = {
  admin: { label: "Admin", color: "amber" },
  office: { label: "Office", color: "blue" },
  field: { label: "Field", color: "grey" },
  both: { label: "Both", color: "green" },
  foreman: { label: "Foreman", color: "amber" },
};

export function EmployeeRolePill({
  role,
  height = 24,
}: {
  role?: string | null;
  /** Pill height in px. Defaults to 24 (canonical content-pane size). */
  height?: number;
}) {
  const cfg = employeeRoleConfig[role || "field"] || employeeRoleConfig.field;
  const isGrey = cfg.color === "grey";
  return (
    <span
      className="group relative inline-flex items-center min-w-[70px] select-none align-middle"
      style={{ height }}
      data-testid={`employee-role-pill-${cfg.label.toLowerCase()}`}
    >
      {isGrey ? (
        // Field / grey idle: identical chrome to the PEC "None" pill —
        // pillBase @ 90% (hover→100%) + pillGloss diagonal overlay @ 60%.
        <>
          <PillBg
            src={pillBase}
            className="opacity-90 transition-opacity duration-200 group-hover:opacity-100"
          />
          <PillBg src={pillGloss} className="opacity-60" />
        </>
      ) : (
        // Colored states (amber / blue / green): non-paying-pixels
        // option — colored PNG via PillBg 3-slice (no grey base
        // underneath since the color covers it) + pillGloss overlay.
        <>
          <PillBg
            src={COLOR_PNG[cfg.color]}
            imageAspect={PILL_ASPECT}
            className="opacity-90 transition-opacity duration-200 group-hover:opacity-100"
          />
          <PillBg src={pillGloss} className="opacity-60" />
        </>
      )}
      <span
        className={cn(
          "relative z-10 flex items-center justify-center w-full h-full px-3 text-xs font-bold whitespace-nowrap",
          isGrey ? "text-gray-800" : "text-white",
        )}
        style={isGrey ? undefined : { textShadow: "0 2px 4px rgba(0,0,0,0.9)" }}
      >
        {cfg.label}
      </span>
    </span>
  );
}

export default EmployeeRolePill;
