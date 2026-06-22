type BrandLike = {
  isOrgBranded: boolean;
  logoSquareUrl?: string | null;
  logoUrl?: string | null;
  name?: string | null;
};

function isWinchesterBrand(name: string | null | undefined): boolean {
  return !!name?.toLowerCase().includes("winchester");
}

function isBakerBrand(name: string | null | undefined): boolean {
  return !!name?.toLowerCase().includes("baker");
}

/** Matches web `shouldUseLayeredPortalLogo` — square asset or Baker/Winchester carve-out. */
export function shouldUseLayeredPortalLogo(brand: BrandLike): boolean {
  const sidebarLogoUrl = brand.logoSquareUrl || brand.logoUrl || null;
  if (!brand.isOrgBranded || !sidebarLogoUrl) return false;
  if (brand.logoSquareUrl) return true;
  return isWinchesterBrand(brand.name) || isBakerBrand(brand.name);
}
