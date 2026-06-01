import type { Brand } from "@/hooks/use-brand";

export function isWinchesterBrand(name: string | null | undefined): boolean {
  return !!name?.toLowerCase().includes("winchester");
}

export function isBakerBrand(name: string | null | undefined): boolean {
  return !!name?.toLowerCase().includes("baker");
}

/** Branded carve-outs (Baker, Winchester) use the layered logo frame even without a square asset. */
export function shouldUseLayeredPortalLogo(brand: Brand): boolean {
  const sidebarLogoUrl = brand.logoSquareUrl || brand.logoUrl || null;
  if (!brand.isOrgBranded || !sidebarLogoUrl) return false;
  if (brand.logoSquareUrl) return true;
  return isWinchesterBrand(brand.name) || isBakerBrand(brand.name);
}

export function portalDisplayLogo(brand: Brand, fallbackLogo: string): string {
  const sidebarLogoUrl = brand.logoSquareUrl || brand.logoUrl || null;
  return brand.isOrgBranded && sidebarLogoUrl ? sidebarLogoUrl : fallbackLogo;
}
