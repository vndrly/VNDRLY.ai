import React from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import en from "@/lib/locales/en.json";

import { cleanup, render, screen } from "@testing-library/react";

// Task #186 — the indicator pulls from the same `useAuth` context the
// Profile screen's organization picker writes into via `switchContext`,
// so we mock just enough of that context for each scenario.
const { useAuthMock } = vi.hoisted(() => ({ useAuthMock: vi.fn() }));
vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => useAuthMock(),
}));

vi.mock("@/hooks/useColors", () => ({
  useColors: () => ({
    background: "#fff",
    foreground: "#000",
    card: "#f5f5f5",
    border: "#ccc",
    primary: "#f59e0b",
    primaryForeground: "#fff",
    accent: "#fef3c7",
    accentForeground: "#92400e",
    mutedForeground: "#666",
    destructive: "#dc2626",
    muted: "#e5e5e5",
  }),
}));

import ActiveOrgIndicator from "./ActiveOrgIndicator";

beforeAll(async () => {
  await i18next.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    compatibilityJSON: "v4",
    interpolation: { escapeValue: false },
    resources: { en: { translation: en } },
    react: { useSuspense: false },
  });
});

afterEach(() => {
  cleanup();
  useAuthMock.mockReset();
});

describe("ActiveOrgIndicator (Task #186)", () => {
  it("renders nothing for a single-membership user (clean header, no clutter)", () => {
    useAuthMock.mockReturnValue({
      availableMemberships: [
        { id: 1, orgType: "vendor", orgName: "Acme Vendor" },
      ],
      activeMembership: { id: 1, orgType: "vendor", orgName: "Acme Vendor" },
    });
    render(<ActiveOrgIndicator />);
    expect(screen.queryByTestId("active-org-indicator")).toBeNull();
  });

  it("renders nothing if no active membership is set even for a multi-membership user", () => {
    useAuthMock.mockReturnValue({
      availableMemberships: [
        { id: 1, orgType: "vendor", orgName: "Acme Vendor" },
        { id: 2, orgType: "partner", orgName: "Globex Partner" },
      ],
      activeMembership: null,
    });
    render(<ActiveOrgIndicator />);
    expect(screen.queryByTestId("active-org-indicator")).toBeNull();
  });

  it("shows the active org name and Vendor pill for a dual-role user acting as a vendor", () => {
    useAuthMock.mockReturnValue({
      availableMemberships: [
        { id: 1, orgType: "vendor", orgName: "Acme Vendor" },
        { id: 2, orgType: "partner", orgName: "Globex Partner" },
      ],
      activeMembership: { id: 1, orgType: "vendor", orgName: "Acme Vendor" },
    });
    render(<ActiveOrgIndicator />);
    expect(screen.getByTestId("active-org-indicator")).toBeTruthy();
    expect(screen.getByTestId("active-org-indicator-name").textContent).toBe(
      "Acme Vendor",
    );
    expect(
      screen.getByTestId("active-org-indicator-pill-vendor").textContent,
    ).toBe("Vendor");
    expect(screen.queryByTestId("active-org-indicator-pill-partner")).toBeNull();
  });

  it("flips to the partner pill and new org name after the user switches context", () => {
    // Initial render: acting as the vendor side.
    useAuthMock.mockReturnValue({
      availableMemberships: [
        { id: 1, orgType: "vendor", orgName: "Acme Vendor" },
        { id: 2, orgType: "partner", orgName: "Globex Partner" },
      ],
      activeMembership: { id: 1, orgType: "vendor", orgName: "Acme Vendor" },
    });
    const { rerender } = render(<ActiveOrgIndicator />);
    expect(
      screen.getByTestId("active-org-indicator-pill-vendor").textContent,
    ).toBe("Vendor");

    // Profile picker fires `switchContext`, which updates the auth
    // context. Re-render to simulate the resulting subscriber re-flow.
    useAuthMock.mockReturnValue({
      availableMemberships: [
        { id: 1, orgType: "vendor", orgName: "Acme Vendor" },
        { id: 2, orgType: "partner", orgName: "Globex Partner" },
      ],
      activeMembership: { id: 2, orgType: "partner", orgName: "Globex Partner" },
    });
    rerender(<ActiveOrgIndicator />);
    expect(screen.getByTestId("active-org-indicator-name").textContent).toBe(
      "Globex Partner",
    );
    expect(
      screen.getByTestId("active-org-indicator-pill-partner").textContent,
    ).toBe("Partner");
    expect(screen.queryByTestId("active-org-indicator-pill-vendor")).toBeNull();
  });

});
