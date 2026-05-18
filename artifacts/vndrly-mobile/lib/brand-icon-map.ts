export type BrandIconName = "vndrly" | "mach" | "baker";

export function resolveBrandIcon(orgName: string | null | undefined): BrandIconName {
  if (!orgName) return "vndrly";
  const lower = orgName.toLowerCase();
  if (lower.includes("mach")) return "mach";
  if (lower.includes("baker")) return "baker";
  return "vndrly";
}
