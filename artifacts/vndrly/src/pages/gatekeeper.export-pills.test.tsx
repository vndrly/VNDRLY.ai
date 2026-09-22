import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PILL_ACTION } from "@/lib/pill-palette-assets";

const { fetchMock, requests } = vi.hoisted(() => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  return {
    requests,
    fetchMock: vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({ url: String(input), init });
      return {
        ok: true,
        json: async () => ({ rows: [] }),
        blob: async () => new Blob(["report"]),
      } as Response;
    }),
  };
});

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({ user: { userId: 7 } }),
}));

vi.mock("@/lib/change-over-api", () => ({
  changeOverRequest: vi.fn(async (path: string) => path === "/sites"
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

function pillSrcs(el: HTMLElement): string[] {
  return Array.from(el.querySelectorAll("img")).map((img) => img.getAttribute("src") ?? "");
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

describe("Gate history export pills", () => {
  it("uses the red palette pill for PDF and the green palette pill for Excel", async () => {
    renderPage();
    const pdf = await screen.findByTestId("button-gate-export-pdf");
    const excel = screen.getByTestId("button-gate-export-excel");
    const word = screen.getByTestId("button-gate-export-word");

    expect(pdf.textContent).toContain("PDF");
    expect(excel.textContent).toContain("Excel");
    expect(word.textContent).toContain("Word");

    expect(pillSrcs(pdf)).toContain(PILL_ACTION.red);
    expect(pillSrcs(pdf)).not.toContain(PILL_ACTION.blue);
    expect(pillSrcs(excel)).toContain(PILL_ACTION.green);
    expect(pillSrcs(excel)).not.toContain(PILL_ACTION.blue);
    expect(pillSrcs(word)).toContain(PILL_ACTION.blue);
  });

  it("exports the selected Gate History filters through the server report contract", async () => {
    window.history.replaceState({}, "", "/gate/history?siteId=42&stationId=main-gate");
    renderPage();

    const pdf = await screen.findByTestId("button-gate-export-pdf");
    await waitFor(() => expect(pdf.getAttribute("disabled")).toBeNull());
    fireEvent.click(pdf);

    await waitFor(() => expect(requests.some(({ url }) => url.endsWith("/api/gate-report/export"))).toBe(true));
    const exportCall = requests.find(({ url }) => url.endsWith("/api/gate-report/export"));
    expect(exportCall).toBeDefined();
    expect(JSON.parse(String(exportCall?.init?.body))).toEqual({
      reportKind: "history",
      format: "pdf",
      filters: {
        siteId: 42,
        stationId: "main-gate",
        range: "current_shift",
        recordType: "all",
      },
    });
  });
});
