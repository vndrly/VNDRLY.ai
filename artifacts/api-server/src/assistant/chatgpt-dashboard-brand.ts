/** Organization branding is selected by the authorized session, never by widget input. */
export function dashboardBrand(brand: { name: string; primaryColor: string | null; logoUrl: string | null; logoSquareUrl: string | null }, issuer: string) {
  const result: { name: string; primaryColor?: string; logoUrl?: string } = { name: brand.name };
  if (/^#[0-9a-f]{6}$/i.test(brand.primaryColor ?? "")) result.primaryColor = brand.primaryColor!;
  for (const candidate of [brand.logoSquareUrl, brand.logoUrl]) {
    if (!candidate) continue;
    try {
      const logo = new URL(candidate, issuer);
      if (["https://vndrly.ai", "https://bihjmgbdzbhcnsuhzzwo.supabase.co"].includes(logo.origin) && !logo.username && !logo.password) {
        result.logoUrl = logo.href;
        break;
      }
    } catch { /* A bad saved logo must not prevent authorized workday reads. */ }
  }
  return result;
}
