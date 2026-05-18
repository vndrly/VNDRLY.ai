import { createContext, useContext, useEffect, useMemo, type ReactNode } from "react";
import {
  useGetPartner,
  getGetPartnerQueryKey,
  useGetVendor,
  getGetVendorQueryKey,
  useGetPlatformSettings,
  getGetPlatformSettingsQueryKey,
} from "@workspace/api-client-react";
import { useAuth } from "@/hooks/use-auth";

// Neutral dark fallback used ONLY when no brand color has been
// configured anywhere in the chain (no partner, no vendor, no
// platform_settings.brandPrimaryColor). Default is the VNDRLY brand
// gold `#e6ac00` so unbranded surfaces (login, public pages) still
// reflect VNDRLY identity. Partner/vendor/platform colors override.
export const DEFAULT_BRAND_PRIMARY = "#e6ac00";
export const DEFAULT_BRAND_ACCENT = "#616161";

const STORAGE_KEY = "vndrly:lastPartnerBrand";

export interface Brand {
  primary: string;
  accent: string;
  // Main logo. May be any aspect ratio. Used by modal headers and other
  // surfaces that have room for a larger/irregular logo.
  logoUrl: string | null;
  // Square (1:1) logo used in tightly-bounded badges (e.g. nav sidebar at
  // 64x64). Falls back to logoUrl when null so partners who only uploaded
  // the original logo aren't left with a blank badge.
  logoSquareUrl: string | null;
  name: string | null;
  isOrgBranded: boolean;
}

const DEFAULT_BRAND: Brand = {
  primary: DEFAULT_BRAND_PRIMARY,
  accent: DEFAULT_BRAND_ACCENT,
  logoUrl: null,
  logoSquareUrl: null,
  name: null,
  isOrgBranded: false,
};

const BrandContext = createContext<Brand>(DEFAULT_BRAND);

// Normalize URL-shaped strings: treat null/undefined and any
// blank/whitespace-only string as "no value". This prevents downstream
// `??` fallbacks (e.g. logoSquareUrl ?? logoUrl) from latching onto an
// empty string in the DB or cache and skipping the real fallback.
function normalizeUrl(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function readCachedBrand(): Brand {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_BRAND;
    const parsed = JSON.parse(raw) as Partial<Brand>;
    const logoUrl = normalizeUrl(parsed.logoUrl);
    const logoSquareUrl = normalizeUrl(parsed.logoSquareUrl);
    return {
      primary: parsed.primary || DEFAULT_BRAND_PRIMARY,
      accent: parsed.accent || parsed.primary || DEFAULT_BRAND_ACCENT,
      logoUrl,
      logoSquareUrl,
      name: parsed.name ?? null,
      isOrgBranded: !!(parsed.primary || logoUrl || logoSquareUrl),
    };
  } catch {
    return DEFAULT_BRAND;
  }
}

export function BrandProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  // Branding inheritance rules:
  //   - Any user with a partnerId set (active membership is a partner org)
  //     → that partner's brand. This covers role=partner, role=admin acting
  //     at a partner org (e.g. an Exxon admin), and field employees on a
  //     partner-side membership.
  //   - Any user with a vendorId set (active membership is a vendor org)
  //     → that vendor's brand.
  // We treat any non-zero ID as "fetch this org's brand"; the auth payload
  // already collapses partnerId/vendorId to whichever org the user is
  // currently acting as via active membership, so we don't have to reason
  // about role separately. Earlier code gated this on role being partner /
  // field_employee, which silently dropped admin-role partner users back
  // to the amber default brand.
  const partnerId = user?.partnerId ?? 0;
  const vendorId = user?.vendorId ?? 0;
  const { data: partner } = useGetPartner(partnerId, {
    query: {
      enabled: !!partnerId,
      queryKey: getGetPartnerQueryKey(partnerId),
    },
  });
  const { data: vendor } = useGetVendor(vendorId, {
    query: {
      enabled: !!vendorId,
      queryKey: getGetVendorQueryKey(vendorId),
    },
  });
  // VNDRLY-level branding (the platform_settings singleton). Used as the
  // fallback when the viewer has no partner or vendor org of their own —
  // i.e. system admins, the auth team, etc. Without this, an admin who
  // uploaded a square logo via /admin/vndrly would see the change in the
  // settings preview but their own sidebar would keep showing the bundled
  // amber asset, which is the bug surfaced by the e2e test on 2026-04-30.
  // GET /platform-settings is auth-gated but role-agnostic, so we can
  // safely fetch it whenever the viewer is signed in but unaffiliated
  // with a partner or vendor org.
  const { data: platformSettings } = useGetPlatformSettings({
    query: {
      enabled: !!user && !partnerId && !vendorId,
      queryKey: getGetPlatformSettingsQueryKey(),
    },
  });

  const brand: Brand = useMemo(() => {
    // Partner brand wins when both partner and vendor are present (e.g. a
    // field employee who belongs to a vendor that is currently working at a
    // partner site). Partner branding tends to be the customer-facing one.
    if (partner) {
      const primary = partner.brandPrimaryColor || DEFAULT_BRAND_PRIMARY;
      const accent = partner.brandAccentColor || primary;
      const logoUrl = normalizeUrl(partner.logoUrl);
      const logoSquareUrl = normalizeUrl(partner.logoSquareUrl);
      const isBranded = !!(partner.brandPrimaryColor || logoUrl || logoSquareUrl);
      return {
        primary,
        accent,
        logoUrl,
        logoSquareUrl,
        name: partner.name ?? null,
        isOrgBranded: isBranded,
      };
    }
    if (vendor) {
      const primary = vendor.brandPrimaryColor || DEFAULT_BRAND_PRIMARY;
      const accent = vendor.brandAccentColor || primary;
      const logoUrl = normalizeUrl(vendor.logoUrl);
      // Vendors gained their own logo_square_url column to mirror partners;
      // surface it so the sidebar's 64×64 badge gets the square asset
      // instead of always letterboxing the main wordmark.
      const logoSquareUrl = normalizeUrl(vendor.logoSquareUrl);
      const isBranded = !!(vendor.brandPrimaryColor || logoUrl || logoSquareUrl);
      return {
        primary,
        accent,
        logoUrl,
        logoSquareUrl,
        name: vendor.name ?? null,
        isOrgBranded: isBranded,
      };
    }
    // VNDRLY-level fallback for users with no partner/vendor org. We only
    // treat the platform brand as "branded" when an admin has actually
    // uploaded a logo or set a custom color — otherwise we fall through to
    // DEFAULT_BRAND so the layout's hard-coded vndrlyLogo asset wins and
    // we don't render a `null` URL into an `<img>` tag.
    if (platformSettings) {
      const logoUrl = normalizeUrl(platformSettings.logoUrl);
      const logoSquareUrl = normalizeUrl(platformSettings.logoSquareUrl);
      const primaryRaw = platformSettings.brandPrimaryColor || null;
      const accentRaw = platformSettings.brandAccentColor || null;
      const hasCustomBrand = !!(primaryRaw || logoUrl || logoSquareUrl);
      if (hasCustomBrand) {
        const primary = primaryRaw || DEFAULT_BRAND_PRIMARY;
        const accent = accentRaw || primary;
        return {
          primary,
          accent,
          logoUrl,
          logoSquareUrl,
          name: platformSettings.name ?? null,
          isOrgBranded: true,
        };
      }
    }
    if (!user) {
      return readCachedBrand();
    }
    return DEFAULT_BRAND;
  }, [partner, vendor, platformSettings, user]);

  // Apply the active brand as CSS custom properties on <html> so every
  // `var(--brand-primary)` / `var(--brand-accent)` reference in the app
  // (icons, hover states, the sphere back button mask, etc.) resolves to
  // the partner/vendor's color. Without this the variables were unset and
  // every call site silently fell back to its own hard-coded default
  // (amber #f59e0b in most places), which is why Exxon partners were
  // seeing amber back buttons instead of red.
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--brand-primary", brand.primary);
    root.style.setProperty("--brand-accent", brand.accent);
  }, [brand.primary, brand.accent]);

  useEffect(() => {
    // Cache the most recently active branded experience so that the next
    // page load (e.g. the login screen after sign-out) shows the right
    // colors and logo before any user object is re-hydrated.
    //
    // We persist whenever the resolved `brand` is branded — this covers
    // partner, vendor, AND platform-branded sources, and it also self-heals
    // when the cache is read back as the live brand (no-op write). The
    // previous implementation only wrote on `partner ?? vendor` data ticks,
    // which meant the logo could "disappear" on the next login screen if
    // the partner/vendor request hadn't completed before logout, or if the
    // active brand came from platform_settings.
    if (brand.isOrgBranded) {
      try {
        localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify({
            primary: brand.primary,
            accent: brand.accent,
            logoUrl: brand.logoUrl,
            logoSquareUrl: brand.logoSquareUrl,
            name: brand.name,
          }),
        );
      } catch {
        /* ignore */
      }
    }
  }, [brand]);

  return <BrandContext.Provider value={brand}>{children}</BrandContext.Provider>;
}

export function useBrand(): Brand {
  return useContext(BrandContext);
}

export function brandStyleVars(brand: Brand): React.CSSProperties {
  return {
    ["--brand-primary" as any]: brand.primary,
    ["--brand-accent" as any]: brand.accent,
  };
}
