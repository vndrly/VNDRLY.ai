import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { fetchMock, requests } = vi.hoisted(() => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  return {
    requests,
    fetchMock: vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({ url: String(input), init });
      return {
        ok: true,
        json: async () => ({ rows: [], arrivals: [] }),
        blob: async () => new Blob(["report"]),
      } as Response;
    }),
  };
});

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }),
}));

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({ user: { userId: 7 } }),
}));

vi.mock("@/lib/change-over-api", () => ({
  changeOverRequest: vi.fn(async (path: string) => path === "/sites?mode=history"
    ? { sites: [{ id: 42, name: "Big Cs Deep" }] }
    : { stations: [{ id: "main-gate", name: "Main gate" }] }),
}));

vi.mock("wouter", () => ({
  Link: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
  useLocation: () => ["/gate/history", vi.fn()],
}));

import GateHistoryPage from "./gate-history";

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={client}>
      <GateHistoryPage />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  window.history.replaceState({}, "", "/");
  vi.clearAllMocks();
});

beforeEach(() => {
  requests.length = 0;
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("URL", {
    ...URL,
    createObjectURL: vi.fn(() => "blob:gate-report"),
    revokeObjectURL: vi.fn(),
  });
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
});

describe("Gate history Export selector", () => {
  it("combines PDF, Excel, Word and Email into one selector", async () => {
    renderPage();
    const selector = await screen.findByRole("combobox", { name: "Export" });
    expect(Array.from(selector.querySelectorAll("option")).map(option => option.textContent)).toEqual(["Export", "PDF", "Excel", "Word", "Email"]);
    expect(screen.queryByTestId("button-gate-export-pdf")).toBeNull();
  });

  it.each(["pdf", "excel", "word"])("immediately exports %s with selected Gate History filters", async (format) => {
    window.history.replaceState({}, "", "/gate/history?siteId=42&stationId=main-gate");
    renderPage();

    const selector = await screen.findByRole("combobox", { name: "Export" });
    await waitFor(() => expect(selector.getAttribute("disabled")).toBeNull());
    fireEvent.change(selector, { target: { value: format } });

    await waitFor(() => expect(requests.some(({ url }) => url.endsWith("/api/gate-report/export"))).toBe(true));
    const exportCall = requests.find(({ url }) => url.endsWith("/api/gate-report/export"));
    expect(exportCall).toBeDefined();
    expect(JSON.parse(String(exportCall?.init?.body))).toEqual({
      reportKind: "history",
      format,
      filters: {
        siteId: 42,
        stationId: "main-gate",
        range: "current_shift",
        recordType: "all",
      },
    });
  });
});
