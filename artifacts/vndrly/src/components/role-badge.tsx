import { useTranslation } from "react-i18next";
import ImagePill, { type ImagePillColor } from "@/components/image-pill";

const roleConfig: Record<
  string,
  { labelKey: string; fallback: string; color: ImagePillColor; isRest?: boolean }
> = {
  admin: { labelKey: "roles.admin", fallback: "Admin", color: "amber" },
  office: { labelKey: "roles.office", fallback: "Office", color: "blue" },
  field: { labelKey: "roles.field", fallback: "Field", color: "grey", isRest: true },
  both: { labelKey: "roles.both", fallback: "Both", color: "green" },
  foreman: { labelKey: "roles.foreman", fallback: "Foreman", color: "amber" },
  // Org-membership roles (Administrative Team Members card) mapped onto
  // the same PNG palette so the role column reads consistently across
  // every surface — see Employees page for the canonical treatment.
  member: { labelKey: "roles.member", fallback: "Member", color: "blue" },
  ap: { labelKey: "roles.ap", fallback: "Accounts Payable", color: "green" },
  field_employee: { labelKey: "roles.field", fallback: "Field", color: "grey", isRest: true },
};

interface RoleBadgeProps {
  role?: string | null;
  className?: string;
  height?: number;
  "data-testid"?: string;
}

/**
 * Read-only user-role chip rendered with the canonical PNG image
 * pills — matches the Employees page treatment exactly.
 */
export default function RoleBadge({ role, className, height = 24, "data-testid": dataTestId }: RoleBadgeProps) {
  const { t } = useTranslation();
  const cfg = roleConfig[role || "field"] || roleConfig.field;
  const label = t(cfg.labelKey, { defaultValue: cfg.fallback });
  return (
    <ImagePill
      color={cfg.color}
      rest={cfg.isRest}
      height={height}
      className={className}
      data-testid={dataTestId ?? `employee-role-pill-${(cfg.fallback || "").toLowerCase()}`}
    >
      {label}
    </ImagePill>
  );
}
