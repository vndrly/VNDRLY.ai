import { cn } from "@/lib/utils";
import { PillColorLayer, PillGlossOverlay } from "@/components/png-pill-chrome";
import amberPill from "@assets/900x229_Amber_Pill_v4_1778504507024.png";
import bluePill from "@assets/NewPillPallet_0001s_0017_900x229_blue_Pill.png";
import greenPill from "@assets/NewPillPallet_0001s_0051_900x229_green_Pill_v3.png";
import pillBase from "@assets/Vndrly_900x229_Light_Grey_Pill1_1777664658767.png";
import {
  PILL_HEIGHT_CLASS,
  PILL_HEIGHT_PX,
  PILL_LABEL_CLASS,
  PILL_TEXT_SHADOW,
  PILL_WRAPPER_CLASS,
} from "@/lib/pill-doctrine";

type EmployeePillColor = "amber" | "blue" | "green" | "grey";

const COLOR_PNG: Record<EmployeePillColor, string> = {
  amber: amberPill,
  blue: bluePill,
  green: greenPill,
  grey: pillBase,
};

const employeeRoleConfig: Record<string, { label: string; color: EmployeePillColor }> = {
  admin: { label: "Admin", color: "amber" },
  office: { label: "Office", color: "blue" },
  field: { label: "Field", color: "grey" },
  both: { label: "Both", color: "green" },
  foreman: { label: "Foreman", color: "amber" },
};

export function EmployeeRolePill({
  role,
  height = PILL_HEIGHT_PX,
}: {
  role?: string | null;
  height?: number;
}) {
  const cfg = employeeRoleConfig[role || "field"] || employeeRoleConfig.field;
  const isGrey = cfg.color === "grey";

  return (
    <span
      className={cn(
        PILL_WRAPPER_CLASS,
        PILL_HEIGHT_CLASS,
        "pointer-events-none min-w-[70px]",
      )}
      style={{ height }}
      data-testid={`employee-role-pill-${cfg.label.toLowerCase()}`}
    >
      <PillColorLayer src={isGrey ? pillBase : COLOR_PNG[cfg.color]} />
      <PillGlossOverlay />
      <span
        className={cn(
          PILL_LABEL_CLASS,
          "h-full",
          isGrey ? "text-gray-800" : "text-white",
        )}
        style={isGrey ? undefined : { textShadow: PILL_TEXT_SHADOW }}
      >
        {cfg.label}
      </span>
    </span>
  );
}

export default EmployeeRolePill;
