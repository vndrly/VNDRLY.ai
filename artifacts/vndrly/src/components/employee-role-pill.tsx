import RoleBadge from "@/components/role-badge";
import { PILL_HEIGHT_PX } from "@/lib/pill-doctrine";

/** Vendor employee role chip — canonical RoleBadge treatment. */
export function EmployeeRolePill({
  role,
  height = PILL_HEIGHT_PX,
}: {
  role?: string | null;
  height?: number;
}) {
  return <RoleBadge role={role} height={height} />;
}

export default EmployeeRolePill;
