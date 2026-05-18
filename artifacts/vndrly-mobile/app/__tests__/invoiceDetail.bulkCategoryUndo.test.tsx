import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Task #379: happy-path coverage for the mobile bulk 1099-category UI on
// the invoice detail screen. We assert that:
//  1. Selecting two lines, picking a category, and tapping Apply issues a
//     PATCH /api/invoices/:id/lines with the {lineIds, incomeCategory}
//     payload the server expects.
//  2. After the apply succeeds, the inline Undo banner appears and tapping
//     its Undo button issues a SECOND PATCH with the {updates: snapshot}
//     payload — restoring BOTH the prior incomeCategory and the prior
//     isManualOverride flag in a single round-trip, mirroring the web
//     reference behavior on artifacts/vndrly/src/pages/invoice-detail.tsx.

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
    muted: "#e5e5e5",
    mutedForeground: "#666",
    destructive: "#dc2626",
  }),
}));

vi.mock("@expo/vector-icons", () => ({ Feather: () => null }));
vi.mock("expo-image", async () => {
  const ReactLib = (await import("react")).default;
  return { Image: () => ReactLib.createElement("img") };
});
vi.mock("expo-linear-gradient", async () => {
  const ReactLib = (await import("react")).default;
  return {
    LinearGradient: ({ children }: { children?: React.ReactNode }) =>
      ReactLib.createElement("div", null, children),
  };
});

vi.mock("expo-router", () => ({
  Stack: { Screen: () => null },
  useLocalSearchParams: () => ({ id: "42" }),
}));

const tIdentity = (k: string, vars?: Record<string, unknown>) => {
  if (vars && Object.keys(vars).length > 0) {
    return `${k}:${JSON.stringify(vars)}`;
  }
  return k;
};
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: tIdentity }),
}));

const { apiFetchMock } = vi.hoisted(() => ({ apiFetchMock: vi.fn() }));
vi.mock("@/lib/api", () => ({
  apiFetch: (...a: unknown[]) => apiFetchMock(...a),
  getApiBase: () => "https://example.test",
  initApi: vi.fn(),
}));

const { getUserMock } = vi.hoisted(() => ({ getUserMock: vi.fn() }));
vi.mock("@/lib/auth", () => ({
  getUser: (...a: unknown[]) => getUserMock(...a),
  setUser: vi.fn(),
  setToken: vi.fn(),
  getToken: vi.fn(),
}));

vi.mock("@/lib/apiErrors", () => ({
  translateApiError: (_e: unknown, _t: unknown, fallback: string) => fallback,
}));

// Render BlueButton/GreyButton as plain <button> so testing-library can
// drive them with click events.
function makePlainButtonMock() {
  return async () => {
    const ReactLib = (await import("react")).default;
    return {
      default: ({
        children,
        onPress,
        disabled,
        loading,
        testID,
      }: {
        children?: React.ReactNode;
        onPress?: () => void;
        disabled?: boolean;
        loading?: boolean;
        testID?: string;
      }) => {
        const isDisabled = !!(disabled || loading);
        return ReactLib.createElement(
          "button",
          {
            "data-testid": testID,
            "aria-disabled": isDisabled || undefined,
            disabled: isDisabled,
            onClick: isDisabled ? undefined : onPress,
          },
          typeof children === "string" ? children : "btn",
        );
      },
    };
  };
}
vi.mock("@/components/BlueButton", makePlainButtonMock());
vi.mock("@/components/GreyButton", makePlainButtonMock());

// We import after mocks are registered.
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import InvoiceDetailScreen from "../invoice/[id]";

const SAMPLE_INVOICE = {
  id: 42,
  invoiceNumber: "INV-0042",
  vendorId: 7,
  status: "draft",
  total: "1500.00",
  lines: [
    {
      id: 101,
      description: "Foreman labor",
      amount: "500.00",
      lineType: "labor_regular",
      incomeCategory: "nec",
      isManualOverride: false,
    },
    {
      id: 102,
      description: "Equipment rental",
      amount: "1000.00",
      lineType: "equipment",
      incomeCategory: "nec",
      isManualOverride: false,
    },
  ],
};

beforeEach(() => {
  apiFetchMock.mockReset();
  getUserMock.mockReset();
  getUserMock.mockResolvedValue({
    id: 1,
    username: "admin",
    role: "admin",
    displayName: "Admin",
  });
});
afterEach(() => {
  vi.clearAllMocks();
});

describe("Invoice detail — bulk 1099 category + Undo (Task #379)", () => {
  it("applies a bulk category and then undoes it via the inline Undo banner", async () => {
    apiFetchMock.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === "/api/invoices/42" && (!init || !init.method || init.method === "GET")) {
        return SAMPLE_INVOICE;
      }
      if (path === "/api/invoices/42/lines" && init?.method === "PATCH") {
        const body = JSON.parse(String(init.body));
        if ("lineIds" in body) {
          return {
            ok: true,
            updated: body.lineIds.length,
            previousCategories: body.lineIds.map((lineId: number) => ({
              lineId,
              incomeCategory: "nec",
              isManualOverride: false,
            })),
          };
        }
        return { ok: true, updated: body.updates.length };
      }
      throw new Error(`unexpected fetch ${init?.method ?? "GET"} ${path}`);
    });

    render(<InvoiceDetailScreen />);

    // Wait for the screen to load.
    await waitFor(() =>
      expect(screen.getByTestId("invoice-detail-screen")).toBeTruthy(),
    );

    // Select both lines.
    fireEvent.click(screen.getByTestId("checkbox-select-all-lines"));
    expect(screen.getByTestId("text-bulk-selection-summary").textContent).toContain(
      '"count":2',
    );

    // Open the picker and pick `misc_rents`.
    fireEvent.click(screen.getByTestId("select-bulk-income-category"));
    fireEvent.click(screen.getByTestId("bulk-category-option-misc_rents"));

    // Apply.
    fireEvent.click(screen.getByTestId("button-apply-bulk-category"));

    // First PATCH should match the {lineIds, incomeCategory} contract.
    await waitFor(() => {
      const patchCalls = apiFetchMock.mock.calls.filter(
        (c) => c[0] === "/api/invoices/42/lines",
      );
      expect(patchCalls.length).toBeGreaterThanOrEqual(1);
    });
    const applyCall = apiFetchMock.mock.calls.find(
      (c) => c[0] === "/api/invoices/42/lines",
    );
    expect(applyCall?.[1]?.method).toBe("PATCH");
    const applyBody = JSON.parse(String(applyCall?.[1]?.body));
    expect(applyBody.incomeCategory).toBe("misc_rents");
    expect([...applyBody.lineIds].sort()).toEqual([101, 102]);

    // Undo banner should appear.
    await waitFor(() =>
      expect(screen.getByTestId("undo-bulk-category-banner")).toBeTruthy(),
    );

    // Tap Undo.
    fireEvent.click(screen.getByTestId("button-undo-bulk-category"));

    // Second PATCH should be the {updates: snapshot} shape, restoring
    // both incomeCategory AND isManualOverride.
    await waitFor(() => {
      const patchCalls = apiFetchMock.mock.calls.filter(
        (c) => c[0] === "/api/invoices/42/lines" && c[1]?.method === "PATCH",
      );
      expect(patchCalls.length).toBeGreaterThanOrEqual(2);
    });
    const undoCall = apiFetchMock.mock.calls
      .filter(
        (c) => c[0] === "/api/invoices/42/lines" && c[1]?.method === "PATCH",
      )
      .at(-1);
    const undoBody = JSON.parse(String(undoCall?.[1]?.body));
    expect(Array.isArray(undoBody.updates)).toBe(true);
    expect(undoBody.updates).toEqual(
      expect.arrayContaining([
        { lineId: 101, incomeCategory: "nec", isManualOverride: false },
        { lineId: 102, incomeCategory: "nec", isManualOverride: false },
      ]),
    );

    // Undo banner clears after a successful undo.
    await waitFor(() =>
      expect(screen.queryByTestId("undo-bulk-category-banner")).toBeNull(),
    );
  });
});
