import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Task #367 — UI safety net for the recon-alert visibility additions
// on the partner-side vendor list. We lock in three things:
//   1. each vendor row shows whether reconciliation drift alerts are
//      on or off (admins need this to audit rollout)
//   2. the filter dropdown narrows the list to "on" / "off" only
//   3. the bulk-enable action issues PATCH /vendors/:id with
//      { accountingReconciliationNotificationsEnabled: true } for
//      every selected (currently-off) row, and skips already-on rows
//
// We mock the api-client-react module so the page never hits the
// network, and stub useBrand / useToast / wouter to keep providers
// out of the test setup.

if (typeof globalThis.ResizeObserver === "undefined") {
  class ResizeObserverPolyfill {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  (globalThis as { ResizeObserver: unknown }).ResizeObserver =
    ResizeObserverPolyfill;
}

// PointerEvent / hasPointerCapture aren't implemented in jsdom but
// Radix UI's Select uses them for the trigger. Provide minimal shims
// so opening the dropdown doesn't throw.
if (typeof window !== "undefined") {
  if (!(window.HTMLElement.prototype as unknown as { hasPointerCapture?: unknown }).hasPointerCapture) {
    (window.HTMLElement.prototype as unknown as { hasPointerCapture: () => boolean }).hasPointerCapture =
      () => false;
  }
  if (!(window.HTMLElement.prototype as unknown as { releasePointerCapture?: unknown }).releasePointerCapture) {
    (window.HTMLElement.prototype as unknown as { releasePointerCapture: () => void }).releasePointerCapture =
      () => {};
  }
  if (!(window.HTMLElement.prototype as unknown as { scrollIntoView?: unknown }).scrollIntoView) {
    (window.HTMLElement.prototype as unknown as { scrollIntoView: () => void }).scrollIntoView =
      () => {};
  }
}

type MockVendor = {
  id: number;
  name: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string | null;
  brandPrimaryColor: string | null;
  brandAccentColor: string | null;
  logoUrl: string | null;
  logoSquareUrl: string | null;
  accountingReconciliationNotificationsEnabled: boolean;
  createdAt: string;
};

const { vendorsRef, updateCalls, mutateAsyncImpl } = vi.hoisted(() => ({
  vendorsRef: { value: [] as MockVendor[] },
  updateCalls: [] as Array<{ id: number; data: Record<string, unknown> }>,
  mutateAsyncImpl: { fn: null as null | ((args: unknown) => Promise<unknown>) },
}));

vi.mock("@workspace/api-client-react", () => ({
  useListVendors: () => ({ data: vendorsRef.value, isLoading: false }),
  useCreateVendor: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateVendor: () => ({
    mutateAsync: async (args: { id: number; data: Record<string, unknown> }) => {
      updateCalls.push(args);
      if (mutateAsyncImpl.fn) return mutateAsyncImpl.fn(args);
      // Simulate the server flipping the flag so subsequent renders
      // reflect the new state.
      vendorsRef.value = vendorsRef.value.map((v) =>
        v.id === args.id ? { ...v, ...args.data } : v,
      );
      return { id: args.id };
    },
    isPending: false,
  }),
  getListVendorsQueryKey: () => ["vendors"],
  matchVendor: vi.fn(async () => ({ matches: [] })),
}));

vi.mock("@/hooks/use-brand", () => ({
  useBrand: () => ({ isOrgBranded: false, primary: "#000" }),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock("wouter", () => ({
  Link: ({ children, ...rest }: { children: React.ReactNode }) =>
    React.createElement("a", rest, children),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { defaultValue?: string } & Record<string, unknown>) => {
      if (opts && typeof opts.defaultValue === "string") {
        let out = opts.defaultValue;
        for (const [k, v] of Object.entries(opts)) {
          if (k === "defaultValue") continue;
          out = out.replaceAll(`{{${k}}}`, String(v));
        }
        return out;
      }
      return key;
    },
  }),
}));

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import Vendors from "./vendors";

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <Vendors />
    </QueryClientProvider>,
  );
}

function makeVendor(overrides: Partial<MockVendor> & { id: number; name: string }): MockVendor {
  return {
    contactName: "Pat Contact",
    contactEmail: "pat@example.com",
    contactPhone: null,
    brandPrimaryColor: null,
    brandAccentColor: null,
    logoUrl: null,
    logoSquareUrl: null,
    accountingReconciliationNotificationsEnabled: false,
    createdAt: "2025-01-01T00:00:00.000Z",
    ...overrides,
  };
}

beforeEach(() => {
  updateCalls.length = 0;
  mutateAsyncImpl.fn = null;
  vendorsRef.value = [
    makeVendor({ id: 1, name: "Alpha Co", accountingReconciliationNotificationsEnabled: true }),
    makeVendor({ id: 2, name: "Bravo LLC", accountingReconciliationNotificationsEnabled: false }),
    makeVendor({ id: 3, name: "Charlie Inc", accountingReconciliationNotificationsEnabled: false }),
  ];
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("vendors page — reconciliation drift alert visibility", () => {
  it("renders an On/Off pill for every vendor row", () => {
    renderPage();
    expect(screen.getByTestId("recon-status-1").getAttribute("data-recon-enabled")).toBe("true");
    expect(screen.getByTestId("recon-status-2").getAttribute("data-recon-enabled")).toBe("false");
    expect(screen.getByTestId("recon-status-3").getAttribute("data-recon-enabled")).toBe("false");
  });

  it("hides the per-row bulk-enable checkbox for vendors already opted in", () => {
    renderPage();
    // Vendor #1 already has alerts on — selecting it would be a
    // no-op PATCH, so the checkbox should not be rendered.
    expect(screen.queryByTestId("checkbox-recon-1")).toBeNull();
    expect(screen.queryByTestId("checkbox-recon-2")).not.toBeNull();
    expect(screen.queryByTestId("checkbox-recon-3")).not.toBeNull();
  });

  it("bulk-enables drift alerts only on selected off-rows via PATCH /vendors/:id", async () => {
    renderPage();
    fireEvent.click(screen.getByTestId("checkbox-recon-2"));
    fireEvent.click(screen.getByTestId("checkbox-recon-3"));
    const button = screen.getByTestId("button-bulk-enable-recon");
    expect(button.textContent).toContain("Enable drift alerts (2)");
    fireEvent.click(button);
    await waitFor(() => expect(updateCalls.length).toBe(2));
    expect(updateCalls).toEqual([
      { id: 2, data: { accountingReconciliationNotificationsEnabled: true } },
      { id: 3, data: { accountingReconciliationNotificationsEnabled: true } },
    ]);
  });

  it("filter dropdown narrows the list to off-only rows", async () => {
    renderPage();
    expect(screen.queryByTestId("row-vendor-1")).not.toBeNull();
    expect(screen.queryByTestId("row-vendor-2")).not.toBeNull();
    expect(screen.queryByTestId("row-vendor-3")).not.toBeNull();

    fireEvent.click(screen.getByTestId("select-recon-alert-filter"));
    const option = await screen.findByTestId("recon-filter-off");
    fireEvent.click(option);

    await waitFor(() => {
      expect(screen.queryByTestId("row-vendor-1")).toBeNull();
    });
    expect(screen.queryByTestId("row-vendor-2")).not.toBeNull();
    expect(screen.queryByTestId("row-vendor-3")).not.toBeNull();
  });

  it("select-all checkbox toggles every off-row at once", () => {
    renderPage();
    fireEvent.click(screen.getByTestId("checkbox-select-all-recon"));
    expect(screen.getByTestId("button-bulk-enable-recon").textContent).toContain(
      "Enable drift alerts (2)",
    );
  });
});
