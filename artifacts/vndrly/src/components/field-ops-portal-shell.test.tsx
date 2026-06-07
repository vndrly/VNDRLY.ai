import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Home } from "lucide-react";

const mockState = vi.hoisted(() => ({
  user: null as Record<string, unknown> | null,
  vendorRatings: null as { items: Array<{ rating: number }> } | null,
  fetchMock: vi.fn(),
}));

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({
    user: mockState.user,
    logout: vi.fn(),
  }),
}));

vi.mock("@/hooks/use-theme", () => ({
  useTheme: () => ({
    resolved: "light",
    setMode: vi.fn(),
  }),
}));

vi.mock("@/hooks/use-brand", () => ({
  useBrand: () => ({
    name: "Winchester Demo",
    isOrgBranded: true,
    primary: "#f59e0b",
    accent: "#d97706",
    logoUrl: null,
    logoSquareUrl: null,
  }),
  brandStyleVars: () => ({}),
}));

vi.mock("@workspace/api-client-react", () => ({
  useGetVendor: () => ({ data: { name: "Winchester Demo" } }),
  useGetVendorRatings: () => ({ data: mockState.vendorRatings }),
  getGetVendorQueryKey: (id: number) => ["vendor", id],
  getGetVendorRatingsQueryKey: (id: number) => ["vendor-ratings", id],
}));

vi.mock("@/components/notifications-bell", () => ({
  default: () => <div data-testid="notifications-bell" />,
}));

vi.mock("@/components/assistant-panel", () => ({
  AssistantLauncher: ({ placement }: { placement: string }) => (
    <div data-testid="assistant-launcher" data-placement={placement} />
  ),
}));

vi.mock("@/components/refer-to-vndrly-dialog", () => ({
  default: ({ trigger }: { trigger: React.ReactNode }) => <>{trigger}</>,
}));

vi.mock("@/components/language-toggle", () => ({
  default: () => <div data-testid="language-toggle" />,
}));

vi.mock("@/components/dark-light-toggle", () => ({
  default: () => <div data-testid="theme-toggle" />,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.stubGlobal(
  "fetch",
  (...args: Parameters<typeof fetch>) => mockState.fetchMock(...args),
);

import { FieldOpsPortalShell } from "./field-ops-portal-shell";

const TABS = [
  {
    href: "/foreman",
    icon: Home,
    labelKey: "foremanNav.home",
    testId: "tab-foreman-home",
    match: (p: string) => p === "/foreman",
  },
];

function renderShell() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <FieldOpsPortalShell
        tabs={TABS}
        portalLabelKey="foremanHome.portal"
        navAriaKey="foremanNav.aria"
      >
        <div data-testid="page-content">content</div>
      </FieldOpsPortalShell>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mockState.user = {
    userId: 1,
    role: "field_employee",
    vendorId: 42,
    displayName: "Pat Foreman",
    availableMemberships: [],
  };
  mockState.vendorRatings = {
    items: [{ rating: 5 }, { rating: 4 }],
  };
  mockState.fetchMock.mockResolvedValue({
    ok: true,
    json: async () => ({
      vendorName: "Winchester Demo",
      firstName: "Pat",
      lastName: "Foreman",
    }),
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("FieldOpsPortalShell", () => {
  it("mirrors vendor portal chrome: AskV pane, nav sign-out, star rating", () => {
    renderShell();

    expect(screen.getByTestId("askv-pane")).toBeTruthy();
    expect(screen.getByTestId("assistant-launcher").getAttribute("data-placement")).toBe(
      "askv-pane",
    );
    expect(screen.getByTestId("button-askv-pane-refer-to-vndrly")).toBeTruthy();
    expect(screen.getByTestId("nav-sign-out-sidebar")).toBeTruthy();
    expect(screen.getByTestId("sidebar-vendor-rating")).toBeTruthy();
    expect(screen.getByTestId("notifications-bell")).toBeTruthy();
    expect(screen.getByTestId("img-sidebar-logo")).toBeTruthy();
    expect(screen.queryByTestId("nav-field-portal-sign-out")).toBeNull();
  });
});
