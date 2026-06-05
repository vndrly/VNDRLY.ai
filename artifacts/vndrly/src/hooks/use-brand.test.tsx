import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// Task #452 — vendor-role users must inherit their vendor's brand
// colors the same way partner-role users inherit their partner's
// colors. The contract under test:
//
//   * a vendor-role user with `vendorId` set causes the BrandProvider
//     to expose that vendor's primary/accent colors and to write them
//     onto <html> as --brand-primary / --brand-accent, AND
//   * a vendor with no brand colors set falls back to the defaults so
//     we never apply an empty string to the CSS variable, AND
//   * the existing partner branding flow is unchanged (partner wins
//     when both partnerId and vendorId are present).

type AuthUser = {
  userId: number;
  role: "admin" | "vendor" | "partner" | "field_employee";
  partnerId: number | null;
  vendorId: number | null;
};

const mockState = vi.hoisted(() => ({
  user: null as AuthUser | null,
  partner: null as Record<string, unknown> | null,
  vendor: null as Record<string, unknown> | null,
  platformSettings: null as Record<string, unknown> | null,
  loginBrand: null as Record<string, unknown> | null,
  publicPlatformBrand: null as Record<string, unknown> | null,
}));

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({
    user: mockState.user,
    isLoading: false,
    login: async () => {},
    logout: async () => {},
    setPreferredLanguage: () => {},
    switchContext: async () => {},
    clearMustChangePassword: () => {},
  }),
}));

vi.mock("@workspace/api-client-react", () => ({
  useGetPartner: (_id: number, opts: { query?: { enabled?: boolean } }) => ({
    data: opts.query?.enabled ? mockState.partner : undefined,
  }),
  useGetVendor: (_id: number, opts: { query?: { enabled?: boolean } }) => ({
    data: opts.query?.enabled ? mockState.vendor : undefined,
  }),
  useGetPlatformSettings: (opts: { query?: { enabled?: boolean } }) => ({
    data: opts.query?.enabled ? mockState.platformSettings : undefined,
  }),
  useGetPublicPlatformBrand: (opts: { query?: { enabled?: boolean } }) => ({
    data: opts.query?.enabled ? mockState.publicPlatformBrand : undefined,
  }),
  getGetPartnerQueryKey: (id: number) => ["partner", id],
  getGetVendorQueryKey: (id: number) => ["vendor", id],
  getGetPlatformSettingsQueryKey: () => ["platform-settings"],
  getGetPublicPlatformBrandQueryKey: () => ["public-platform-brand"],
}));

import {
  BrandProvider,
  useBrand,
  DEFAULT_BRAND_PRIMARY,
  DEFAULT_BRAND_ACCENT,
} from "./use-brand";

function BrandProbe() {
  const brand = useBrand();
  return (
    <div>
      <span data-testid="primary">{brand.primary}</span>
      <span data-testid="accent">{brand.accent}</span>
      <span data-testid="name">{brand.name ?? "<null>"}</span>
      <span data-testid="branded">{brand.isOrgBranded ? "yes" : "no"}</span>
    </div>
  );
}

function renderWithProvider() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <BrandProvider>
        <BrandProbe />
      </BrandProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mockState.user = null;
  mockState.partner = null;
  mockState.vendor = null;
  mockState.platformSettings = null;
  mockState.loginBrand = null;
  mockState.publicPlatformBrand = null;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/public/login-brand")) {
        return {
          ok: true,
          json: async () =>
            mockState.loginBrand ?? {
              name: null,
              brandPrimaryColor: null,
              brandAccentColor: null,
              logoUrl: null,
              logoSquareUrl: null,
              isOrgBranded: false,
            },
        } as Response;
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }),
  );
  // Reset CSS custom properties between tests so a previous render's
  // values don't leak into the next assertion.
  document.documentElement.style.removeProperty("--brand-primary");
  document.documentElement.style.removeProperty("--brand-accent");
  localStorage.clear();
});

describe("BrandProvider — vendor-role branding (Task #452)", () => {
  it("applies the vendor's brand colors for a vendor-role user", () => {
    mockState.user = {
      userId: 7,
      role: "vendor",
      partnerId: null,
      vendorId: 42,
    };
    mockState.vendor = {
      id: 42,
      name: "Acme Drilling",
      brandPrimaryColor: "#2b6cb0",
      brandAccentColor: "#1a365d",
      logoUrl: null,
      logoSquareUrl: null,
    };

    renderWithProvider();

    expect(screen.getByTestId("primary").textContent).toBe("#2b6cb0");
    expect(screen.getByTestId("accent").textContent).toBe("#1a365d");
    expect(screen.getByTestId("name").textContent).toBe("Acme Drilling");
    expect(screen.getByTestId("branded").textContent).toBe("yes");

    // The CSS variables must be pushed onto <html> so every
    // var(--brand-primary) call site downstream resolves to the
    // vendor's color, not the hard-coded amber default.
    expect(document.documentElement.style.getPropertyValue("--brand-primary")).toBe(
      "#2b6cb0",
    );
    expect(document.documentElement.style.getPropertyValue("--brand-accent")).toBe(
      "#1a365d",
    );
  });

  it("falls back to default brand colors when the vendor has none set", () => {
    mockState.user = {
      userId: 7,
      role: "vendor",
      partnerId: null,
      vendorId: 42,
    };
    mockState.vendor = {
      id: 42,
      name: "Plain Vendor",
      brandPrimaryColor: null,
      brandAccentColor: null,
      logoUrl: null,
      logoSquareUrl: null,
    };

    renderWithProvider();

    expect(screen.getByTestId("primary").textContent).toBe(DEFAULT_BRAND_PRIMARY);
    // Accent collapses to primary when the vendor has neither field set,
    // mirroring the partner-side fallback.
    expect(screen.getByTestId("accent").textContent).toBe(DEFAULT_BRAND_PRIMARY);
    // No logo + no custom color means we are NOT in branded mode, so the
    // sidebar etc. keeps falling through to the bundled vndrlyLogo asset.
    expect(screen.getByTestId("branded").textContent).toBe("no");
  });

  it("uses only the primary as accent when the vendor sets primary but not accent", () => {
    mockState.user = {
      userId: 7,
      role: "vendor",
      partnerId: null,
      vendorId: 42,
    };
    mockState.vendor = {
      id: 42,
      name: "Mono Vendor",
      brandPrimaryColor: "#cc0000",
      brandAccentColor: null,
      logoUrl: null,
      logoSquareUrl: null,
    };

    renderWithProvider();

    expect(screen.getByTestId("primary").textContent).toBe("#cc0000");
    expect(screen.getByTestId("accent").textContent).toBe("#cc0000");
    expect(screen.getByTestId("branded").textContent).toBe("yes");
  });

  it("lets partner branding win when a user has both partnerId and vendorId", () => {
    // Field employee scenarios can present with both IDs (vendor crew
    // working a partner site); the customer-facing partner brand wins.
    mockState.user = {
      userId: 7,
      role: "field_employee",
      partnerId: 1,
      vendorId: 42,
    };
    mockState.partner = {
      id: 1,
      name: "Exxon",
      brandPrimaryColor: "#dd1d21",
      brandAccentColor: "#000000",
      logoUrl: null,
      logoSquareUrl: null,
    };
    mockState.vendor = {
      id: 42,
      name: "Acme",
      brandPrimaryColor: "#2b6cb0",
      brandAccentColor: "#1a365d",
      logoUrl: null,
      logoSquareUrl: null,
    };

    renderWithProvider();

    expect(screen.getByTestId("primary").textContent).toBe("#dd1d21");
    expect(screen.getByTestId("accent").textContent).toBe("#000000");
    expect(screen.getByTestId("name").textContent).toBe("Exxon");
  });

  it("falls through to defaults for an admin with no org affiliation and no platform brand", () => {
    mockState.user = {
      userId: 1,
      role: "admin",
      partnerId: null,
      vendorId: null,
    };
    mockState.platformSettings = {
      brandPrimaryColor: null,
      brandAccentColor: null,
      logoUrl: null,
      logoSquareUrl: null,
      name: null,
    };

    renderWithProvider();

    expect(screen.getByTestId("primary").textContent).toBe(DEFAULT_BRAND_PRIMARY);
    expect(screen.getByTestId("accent").textContent).toBe(DEFAULT_BRAND_ACCENT);
    expect(screen.getByTestId("branded").textContent).toBe("no");
  });

  it("loads org branding from the public login-brand API after sign-out", async () => {
    window.history.replaceState({}, "", "/?vendorId=42");
    mockState.loginBrand = {
      name: "Acme Drilling",
      brandPrimaryColor: "#2b6cb0",
      brandAccentColor: "#1a365d",
      logoUrl: "https://example.com/logo.png",
      logoSquareUrl: "https://example.com/logo-sq.png",
      isOrgBranded: true,
    };

    renderWithProvider();

    await waitFor(() => {
      expect(screen.getByTestId("primary").textContent).toBe("#2b6cb0");
    });
    expect(screen.getByTestId("accent").textContent).toBe("#1a365d");
    expect(screen.getByTestId("name").textContent).toBe("Acme Drilling");
    expect(localStorage.getItem("vndrly:lastPartnerBrand")).toBeNull();
  });
});
