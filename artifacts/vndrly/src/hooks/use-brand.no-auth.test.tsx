import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// Task #950 — BrandProvider must render the default brand even when no
// AuthProvider is mounted. This locks in the new contract from
// `useAuth`: a missing AuthContext returns a stable logged-out value
// instead of throwing, so consumers like BrandProvider survive Vite HMR
// (when the AuthContext identity changes mid-tree) and any future
// surface that intentionally renders without auth (Storybook, public
// landing page, isolated tests, etc.).
//
// Unlike the sibling `use-brand.test.tsx`, this file does NOT mock
// `@/hooks/use-auth` — it imports the real hook so the AuthContext
// fallback path is exercised end-to-end.

vi.mock("@workspace/api-client-react", () => ({
  useGetPartner: () => ({ data: undefined }),
  useGetVendor: () => ({ data: undefined }),
  useGetPlatformSettings: () => ({ data: undefined }),
  getGetPartnerQueryKey: (id: number) => ["partner", id],
  getGetVendorQueryKey: (id: number) => ["vendor", id],
  getGetPlatformSettingsQueryKey: () => ["platform-settings"],
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
      <span data-testid="branded">{brand.isOrgBranded ? "yes" : "no"}</span>
    </div>
  );
}

beforeEach(() => {
  document.documentElement.style.removeProperty("--brand-primary");
  document.documentElement.style.removeProperty("--brand-accent");
  localStorage.clear();
});

describe("BrandProvider — resilience to missing AuthProvider (Task #950)", () => {
  it("renders the default brand without crashing when no AuthProvider is mounted", () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    // Note: deliberately no <AuthProvider> wrapper. Before Task #950 this
    // would throw "useAuth must be used within AuthProvider" and unmount
    // the subtree.
    expect(() =>
      render(
        <QueryClientProvider client={client}>
          <BrandProvider>
            <BrandProbe />
          </BrandProvider>
        </QueryClientProvider>,
      ),
    ).not.toThrow();

    expect(screen.getByTestId("primary").textContent).toBe(DEFAULT_BRAND_PRIMARY);
    expect(screen.getByTestId("accent").textContent).toBe(DEFAULT_BRAND_ACCENT);
    expect(screen.getByTestId("branded").textContent).toBe("no");
  });
});
