import { createContext, useContext, useEffect, useMemo, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  useGetPartner,
  getGetPartnerQueryKey,
  useGetVendor,
  getGetVendorQueryKey,
  useGetPlatformSettings,
  getGetPlatformSettingsQueryKey,
  useGetPublicPlatformBrand,
  getGetPublicPlatformBrandQueryKey,
} from "@workspace/api-client-react";
import { useAuth } from "@/hooks/use-auth";

// Neutral dark fallback used ONLY when no brand color has been
// configured anywhere in the chain (no partner, no vendor, no
// platform_settings.brandPrimaryColor). Default is the VNDRLY brand
// gold `#e6ac00` so unbranded surfaces (login, public pages) still
// reflect VNDRLY identity. Partner/vendor/platform colors override.
export const DEFAULT_BRAND_PRIMARY = "#e6ac00";
export const DEFAULT_BRAND_ACCENT = "#616161";

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

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

export const DEFAULT_BRAND: Brand = {
  primary: DEFAULT_BRAND_PRIMARY,
  accent: DEFAULT_BRAND_ACCENT,
  logoUrl: null,
  logoSquareUrl: null,
  name: null,
  isOrgBranded: false,
};

function isPublicSignupPath(): boolean {
  if (typeof window === "undefined") return false;
  const path = window.location.pathname.replace(/\/$/, "") || "/";
  return path === "/signup" || path.startsWith("/signup/");
}

const BrandContext = createContext<Brand>(DEFAULT_BRAND);

type PublicLoginBrandResponse = {
  name: string | null;
  brandPrimaryColor: string | null;
  brandAccentColor: string | null;
  logoUrl: string | null;
  logoSquareUrl: string | null;
  isOrgBranded: boolean;
};

// Normalize URL-shaped strings: treat null/undefined and any
// blank/whitespace-only string as "no value". This prevents downstream
// `??` fallbacks (e.g. logoSquareUrl ?? logoUrl) from latching onto an
// empty string in the DB and skipping the real fallback.
function normalizeUrl(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function loginBrandQueryFromLocation(): string {
  if (typeof window === "undefined") return "";
  return window.location.search.replace(/^\?/, "").trim();
}

async function fetchPublicLoginBrand(): Promise<PublicLoginBrandResponse> {
  const query = loginBrandQueryFromLocation();
  const url = query
    ? `${API_BASE}/api/public/login-brand?${query}`
    : `${API_BASE}/api/public/login-brand`;
  const res = await fetch(url, {
    credentials: "include",
  });
  if (!res.ok) {
    throw new Error("Failed to load login brand");
  }
  return (await res.json()) as PublicLoginBrandResponse;
}

function brandFromPublicOrgPayload(payload: PublicLoginBrandResponse): Brand {
  const logoUrl = normalizeUrl(payload.logoUrl);
  const logoSquareUrl = normalizeUrl(payload.logoSquareUrl);
  const primary = payload.brandPrimaryColor || DEFAULT_BRAND_PRIMARY;
  const accent = payload.brandAccentColor || primary;
  return {
    primary,
    accent,
    logoUrl,
    logoSquareUrl,
    name: payload.name ?? null,
    isOrgBranded: payload.isOrgBranded,
  };
}

export function BrandProvider({ children }: { children: ReactNode }) {
  const { user, isLoading: authLoading } = useAuth();
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
  const { data: platformSettings } = useGetPlatformSettings({
    query: {
      enabled: !!user && !partnerId && !vendorId,
      queryKey: getGetPlatformSettingsQueryKey(),
    },
  });
  // Pre-auth surfaces load org branding from Supabase/Postgres. After
  // sign-out the URL carries ?vendorId= or ?partnerId=; logo URLs always
  // come from the database on each request.
  const loginBrandQuery = loginBrandQueryFromLocation();
  const { data: loginBrand } = useQuery({
    queryKey: ["public-login-brand", loginBrandQuery],
    queryFn: fetchPublicLoginBrand,
    enabled: !user && !authLoading && !!loginBrandQuery,
    staleTime: 0,
    refetchOnMount: "always",
    retry: 2,
  });
  const { data: publicPlatformBrand } = useGetPublicPlatformBrand({
    query: {
      enabled: !user,
      queryKey: getGetPublicPlatformBrandQueryKey(),
      staleTime: 5 * 60 * 1000,
    },
  });

  const brand: Brand = useMemo(() => {
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
      // Signup / onboarding flows start on VNDRLY branding; org colours
      // and logos preview locally on the wizard pages once entered.
      if (isPublicSignupPath()) {
        return DEFAULT_BRAND;
      }
      if (loginBrand?.isOrgBranded) {
        return brandFromPublicOrgPayload(loginBrand);
      }
      if (publicPlatformBrand) {
        const logoUrl = normalizeUrl(publicPlatformBrand.logoUrl);
        const logoSquareUrl = normalizeUrl(publicPlatformBrand.logoSquareUrl);
        const primaryRaw = publicPlatformBrand.brandPrimaryColor || null;
        const accentRaw = publicPlatformBrand.brandAccentColor || null;
        const hasCustomBrand = !!(primaryRaw || logoUrl || logoSquareUrl);
        if (hasCustomBrand) {
          const primary = primaryRaw || DEFAULT_BRAND_PRIMARY;
          const accent = accentRaw || primary;
          return {
            primary,
            accent,
            logoUrl,
            logoSquareUrl,
            name: publicPlatformBrand.name ?? null,
            isOrgBranded: false,
          };
        }
      }
      return DEFAULT_BRAND;
    }
    return DEFAULT_BRAND;
  }, [partner, vendor, platformSettings, user, loginBrand, publicPlatformBrand]);

  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--brand-primary", brand.primary);
    root.style.setProperty("--brand-accent", brand.accent);
  }, [brand.primary, brand.accent]);

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
