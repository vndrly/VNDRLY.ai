import { useTranslation } from "react-i18next";
import ImagePill, { type ImagePillColor } from "@/components/image-pill";
import { brandImagePillSrc } from "@/components/png-pill-rollover";
import { useBrand } from "@/hooks/use-brand";
import { PILL_IDLE } from "@/lib/pill-palette-assets";
import { PILL_HEIGHT_PX } from "@/lib/pill-doctrine";

const roleConfig: Record<
  string,
  { labelKey: string; fallback: string; color: ImagePillColor; isRest?: boolean }
> = {
  admin: { labelKey: "roles.admin", fallback: "Admin", color: "amber" },
  office: { labelKey: "roles.office", fallback: "Office", color: "blue" },
  field: { labelKey: "roles.field", fallback: "Field", color: "grey", isRest: true },
  both: { labelKey: "roles.both", fallback: "Both", color: "green" },
  foreman: { labelKey: "roles.foreman", fallback: "Foreman", color: "amber" },
  gatekeeper: { labelKey: "roles.gatekeeper", fallback: "Gatekeeper", color: "blue" },
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
export default function RoleBadge({ role, className, height = PILL_HEIGHT_PX, "data-testid": dataTestId }: RoleBadgeProps) {
  const { t } = useTranslation();
  const brand = useBrand();
  const cfg = roleConfig[role || "field"] || roleConfig.field;
  // Admin remains an amber authority marker. All other roles follow the
  // active company, including the field/office wrappers and team menus.
  const isAdmin = role === "admin";
  const brandSrc = brandImagePillSrc(brand.primary, brand.name);
  const label = t(cfg.labelKey, { defaultValue: cfg.fallback });
  return (
    <ImagePill
      color={isAdmin ? cfg.color : brandSrc === PILL_IDLE ? "grey" : "blue"}
      activeSrc={isAdmin ? undefined : brandSrc}
      height={height}
      className={className}
      data-testid={dataTestId ?? `employee-role-pill-${(cfg.fallback || "").toLowerCase()}`}
    >
      {label}
    </ImagePill>
  );
}
