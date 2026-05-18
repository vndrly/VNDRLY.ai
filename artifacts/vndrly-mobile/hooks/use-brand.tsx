import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import { useQueryClient } from "@tanstack/react-query";

import {
  useGetPartner,
  getGetPartnerQueryKey,
  useGetVendor,
  getGetVendorQueryKey,
  useGetPublicPlatformBrand,
  getGetPublicPlatformBrandQueryKey,
} from "@workspace/api-client-react";

import { useAuth } from "@/hooks/use-auth";
import { applyAppIcon } from "@/lib/dynamic-app-icon";
import { resolveBrandIcon, type BrandIconName } from "@/lib/brand-icon-map";

// Neutral dark fallback used ONLY when no brand color has been
// configured anywhere in the chain (no partner, no vendor, no
// platform_settings.brandPrimaryColor). The mobile app must never
// render amber. Default is a neutral VNDRLY blue so unbranded
// surfaces (login, splash, pre-auth) have a non-amber identity.
// Once the admin or a partner/vendor sets their own color it
// overrides this via brand.primary.
export const DEFAULT_BRAND_PRIMARY = "#2563eb";
export const DEFAULT_BRAND_ACCENT = "#1e3a8a";
const STORAGE_KEY = "vndrly.lastBrand";

export interface Brand {
  primary: string;
  accent: string;
  logoUrl: string | null;
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

let cachedBrand: Brand = DEFAULT_BRAND;
let cachedBrandLoaded = false;
const cacheListeners = new Set<(brand: Brand) => void>();

// Hard purge of any legacy amber/gold values that exist anywhere
// in the brand chain — persisted localStorage, the platform-brand
// admin row, etc. Anything matching is dropped so the chain falls
// back to the new neutral blue default.
function isLegacyAmber(c?: string | null): boolean {
  if (!c) return false;
  return /^#?(e6ac00|f5c542|ffb000|ffa500|d4a017|c89b3c|b8860b|fbbf24|f59e0b|fcd34d|fde68a|facc15|eab308|d97706)$/i.test(
    c.replace("#", ""),
  );
}

function normalizeUrl(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

async function readStoredBrand(): Promise<Brand> {
  try {
    let raw: string | null = null;
    if (Platform.OS === "web") {
      if (typeof window !== "undefined") {
        raw = window.localStorage?.getItem(STORAGE_KEY) ?? null;
      }
    } else {
      raw = await SecureStore.getItemAsync(STORAGE_KEY);
    }
    if (!raw) return DEFAULT_BRAND;
    const parsed = JSON.parse(raw) as Partial<Brand>;
    const logoUrl = normalizeUrl(parsed.logoUrl);
    const logoSquareUrl = normalizeUrl(parsed.logoSquareUrl);
    // Hard purge of any legacy amber that was persisted before the
    // amber ban. Uses the module-level `isLegacyAmber` so the same
    // gold/amber list applies here AND to the platform-brand fetch.
    const safePrimary = isLegacyAmber(parsed.primary) ? null : parsed.primary;
    const safeAccent = isLegacyAmber(parsed.accent) ? null : parsed.accent;
    return {
      primary: safePrimary || DEFAULT_BRAND_PRIMARY,
      accent: safeAccent || safePrimary || DEFAULT_BRAND_ACCENT,
      logoUrl,
      logoSquareUrl,
      name: parsed.name ?? null,
      isOrgBranded: !!(parsed.primary || logoUrl || logoSquareUrl),
    };
  } catch {
    return DEFAULT_BRAND;
  }
}

async function writeStoredBrand(brand: Brand): Promise<void> {
  try {
    const payload = JSON.stringify({
      primary: brand.primary,
      accent: brand.accent,
      logoUrl: brand.logoUrl,
      logoSquareUrl: brand.logoSquareUrl,
      name: brand.name,
    });
    if (Platform.OS === "web") {
      if (typeof window !== "undefined") {
        window.localStorage?.setItem(STORAGE_KEY, payload);
      }
    } else {
      await SecureStore.setItemAsync(STORAGE_KEY, payload);
    }
  } catch {
    /* ignore */
  }
}

export function getCachedBrand(): Brand {
  return cachedBrand;
}

export function isBrandCacheReady(): boolean {
  return cachedBrandLoaded;
}

export function subscribeBrand(listener: (brand: Brand) => void): () => void {
  cacheListeners.add(listener);
  return () => {
    cacheListeners.delete(listener);
  };
}

function setCachedBrand(brand: Brand) {
  cachedBrand = brand;
  cachedBrandLoaded = true;
  cacheListeners.forEach((l) => l(brand));
}

const BrandContext = createContext<Brand>(DEFAULT_BRAND);

export function BrandProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [hydrated, setHydrated] = useState(cachedBrandLoaded);
  const [hydratedBrand, setHydratedBrand] = useState<Brand>(cachedBrand);

  // The QueryClient is configured with `retry: false` (see app/_layout.tsx).
  // That means if /api/vendors/:id or /api/partners/:id ever returned an
  // error (e.g. a stale 403 from before a server-side role allowlist fix
  // landed, or a 401 from an expired token before re-login), React Query
  // caches the error forever and never retries on its own. The result was
  // that field_employee users like Joe at Winchester would log in, the
  // brand query would silently read the cached failure, and BrandProvider
  // would fall through to amber DEFAULT instead of showing #ceb673 +
  // Winchester logo. Invalidating on user-id change forces a fresh fetch
  // every time someone signs in, which is also exactly when we need the
  // freshest org-brand payload anyway.
  const userId = user?.id ?? null;
  useEffect(() => {
    if (!userId) return;
    void queryClient.invalidateQueries({
      predicate: (q) => {
        const k0 = q.queryKey?.[0];
        if (typeof k0 !== "string") return false;
        return k0.includes("/vendors/") || k0.includes("/partners/");
      },
    });
  }, [userId, queryClient]);

  useEffect(() => {
    if (cachedBrandLoaded) return;
    let cancelled = false;
    void (async () => {
      const stored = await readStoredBrand();
      if (cancelled) return;
      setCachedBrand(stored);
      setHydratedBrand(stored);
      setHydrated(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Keep the local hydratedBrand in lockstep with the global brand cache.
  // Without this, hydratedBrand was frozen at whatever readStoredBrand()
  // returned on first mount — meaning after a user logged in and their
  // org brand resolved, the cache updated but hydratedBrand did not.
  // On logout the unauthenticated render path falls back to
  // `return hydratedBrand` (line below), which would silently revert
  // to the original DEFAULT amber instead of holding onto the last
  // known org brand. Subscribing here makes login-screen + post-logout
  // honor the most recently resolved brand (Winchester tan, Mach blue,
  // etc.) the way users expect.
  useEffect(() => {
    const unsub = subscribeBrand((next) => {
      setHydratedBrand(next);
    });
    return unsub;
  }, []);

  // When the user transitions to null (sign-out, token wipe, etc.),
  // re-read the persisted brand from SecureStore. The subscribeBrand
  // hook above covers in-process updates, but a hard app restart
  // followed by sign-out could otherwise show DEFAULT briefly. This
  // ensures the login screen always reflects the last branded session.
  useEffect(() => {
    if (user) return;
    let cancelled = false;
    void (async () => {
      const stored = await readStoredBrand();
      if (cancelled) return;
      // Only adopt stored brand if it actually has org branding —
      // otherwise let the platform/default brand path below run.
      if (stored.name || stored.logoUrl || stored.logoSquareUrl) {
        setHydratedBrand(stored);
        setCachedBrand(stored);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  const partnerId = user?.partnerId ?? 0;
  const vendorId = user?.vendorId ?? 0;
  // Aggressive refetch policy for the org-brand queries: the QueryClient
  // root config sets `retry: false`, so a single transient error (e.g. a
  // 401 mid-token-refresh, or a 304 that RN failed to replay before the
  // custom-fetch `cache: "no-store"` fix landed) would otherwise stick in
  // the cache forever and Joe's Winchester chrome would silently fall
  // through to amber DEFAULT. `staleTime: 0` + `refetchOnMount: "always"`
  // guarantees a fresh network round-trip every time BrandProvider
  // remounts (i.e. every cold start and every login transition).
  const { data: partner, isFetching: isPartnerFetching } = useGetPartner(
    partnerId,
    {
      query: {
        enabled: !!partnerId,
        queryKey: getGetPartnerQueryKey(partnerId),
        staleTime: 0,
        gcTime: 0,
        refetchOnMount: "always",
      },
    },
  );
  const { data: vendor, isFetching: isVendorFetching } = useGetVendor(
    vendorId,
    {
      query: {
        enabled: !!vendorId,
        queryKey: getGetVendorQueryKey(vendorId),
        staleTime: 0,
        gcTime: 0,
        refetchOnMount: "always",
      },
    },
  );
  // VNDRLY-platform brand: the admin-configured brand color/logo from
  // the web app's `/admin/vndrly` settings page. Public + unauthenticated
  // so the mobile login screen flexes its pills, "Sign up as Vendor"
  // link, EN/ES toggle, etc. to whatever VNDRLY brand the admin set —
  // instead of always falling back to the hard-coded amber default.
  // We always fetch (no `enabled` gate) because this is the FLOOR brand
  // for unaffiliated users AND for unauthenticated visitors on the
  // login screen — partner/vendor still wins above when present.
  const { data: platformBrand } = useGetPublicPlatformBrand({
    query: {
      queryKey: getGetPublicPlatformBrandQueryKey(),
      // Brand changes are rare; cache aggressively so we don't refetch
      // on every screen mount.
      staleTime: 5 * 60 * 1000,
    },
  });

  const brand: Brand = useMemo(() => {
    if (partner) {
      const primary = partner.brandPrimaryColor || DEFAULT_BRAND_PRIMARY;
      const accent = partner.brandAccentColor || primary;
      const logoUrl = normalizeUrl(partner.logoUrl);
      const logoSquareUrl = normalizeUrl(partner.logoSquareUrl);
      const isOrgBranded = !!(
        partner.brandPrimaryColor ||
        logoUrl ||
        logoSquareUrl
      );
      return {
        primary,
        accent,
        logoUrl,
        logoSquareUrl,
        name: partner.name ?? null,
        isOrgBranded,
      };
    }
    if (vendor) {
      const primary = vendor.brandPrimaryColor || DEFAULT_BRAND_PRIMARY;
      const accent = vendor.brandAccentColor || primary;
      const logoUrl = normalizeUrl(vendor.logoUrl);
      // Vendors gained their own logo_square_url column to mirror partners,
      // and the iOS top-left brand badge prefers logoSquareUrl ?? logoUrl
      // (see app/(tabs)/index.tsx). Surfacing the square asset here is what
      // makes that preference actually take effect for vendor field users.
      const logoSquareUrl = normalizeUrl(vendor.logoSquareUrl);
      const isOrgBranded = !!(vendor.brandPrimaryColor || logoUrl || logoSquareUrl);
      return {
        primary,
        accent,
        logoUrl,
        logoSquareUrl,
        name: vendor.name ?? null,
        isOrgBranded,
      };
    }
    // VNDRLY-platform brand fallback (admin-configured in the web app).
    // Used when there's no partner/vendor org — i.e. unauthenticated
    // login screen, or signed-in users who aren't tied to an org. We
    // only treat this as "branded" when the admin actually uploaded a
    // logo or set a color; otherwise fall through to DEFAULT_BRAND so
    // the bundled VNDRLY assets win.
    //
    // CRITICAL: only consult the platform brand when the viewer has NO
    // expected org. If the user has a partnerId/vendorId, their org's
    // brand is the correct answer — even while that org's query is in
    // flight or briefly garbage-collected by `gcTime: 0` after the
    // user-id-change invalidation effect above. Without this gate, a
    // Winchester field employee (vendorId=3) would be hijacked by the
    // VNDRLY platform brand (amber + VNDRLY square logo) every time the
    // vendor query was momentarily undefined, snapping back to
    // Winchester only after the network round-trip completed. The web
    // hook already enforces this with
    // `enabled: !!user && !partnerId && !vendorId`; mirror it here.
    if (platformBrand && !partnerId && !vendorId) {
      const logoUrl = normalizeUrl(platformBrand.logoUrl);
      const logoSquareUrl = normalizeUrl(platformBrand.logoSquareUrl);
      const primaryRaw = isLegacyAmber(platformBrand.brandPrimaryColor)
        ? null
        : platformBrand.brandPrimaryColor || null;
      const accentRaw = isLegacyAmber(platformBrand.brandAccentColor)
        ? null
        : platformBrand.brandAccentColor || null;
      const hasCustomBrand = !!(primaryRaw || logoUrl || logoSquareUrl);
      if (hasCustomBrand) {
        const primary = primaryRaw || DEFAULT_BRAND_PRIMARY;
        const accent = accentRaw || primary;
        return {
          primary,
          accent,
          logoUrl,
          logoSquareUrl,
          name: platformBrand.name ?? null,
          // The platform brand is the VNDRLY brand, not a partner/vendor
          // org brand. `isOrgBranded` stays false so accent-tinted org
          // chrome (sidebar accents, etc.) doesn't kick in for users
          // who only have the platform-default brand.
          isOrgBranded: false,
        };
      }
    }
    if (!user) return hydratedBrand;
    // User exists with an org id but the org query hasn't produced data
    // yet — either still in flight (cold start, slow network) OR it
    // returned an error/empty payload (stale 401 stuck in react-query
    // because retry:false). In BOTH cases we hold the previously-cached
    // brand instead of flipping to the platform default. Otherwise a
    // Winchester field employee whose vendor query 401s once would see
    // the VNDRLY blue V mark for the rest of the session.
    if (partnerId || vendorId) {
      return hydratedBrand.isOrgBranded || hydratedBrand.name
        ? hydratedBrand
        : DEFAULT_BRAND;
    }
    return DEFAULT_BRAND;
  }, [
    partner,
    vendor,
    platformBrand,
    user,
    hydratedBrand,
    partnerId,
    vendorId,
    isPartnerFetching,
    isVendorFetching,
  ]);

  useEffect(() => {
    setCachedBrand(brand);
    // Persist whenever we have a resolved org identity (even if the org has
    // no brand fields populated). This keeps the dynamic app-icon mapping —
    // which is keyed off org name (e.g. "Mach", "Baker") — stable across
    // cold starts for orgs that haven't uploaded brand colors/logos yet.
    if (brand.name) {
      void writeStoredBrand(brand);
    }
  }, [brand]);

  useEffect(() => {
    const target: BrandIconName = resolveBrandIcon(brand.name);
    applyAppIcon(target);
  }, [brand.name]);

  void hydrated;

  return <BrandContext.Provider value={brand}>{children}</BrandContext.Provider>;
}

export function useBrand(): Brand {
  return useContext(BrandContext);
}
