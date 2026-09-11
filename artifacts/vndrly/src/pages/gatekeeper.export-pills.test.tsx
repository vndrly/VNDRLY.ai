import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PILL_ACTION } from "@/lib/pill-palette-assets";

const listAllVisits = vi.hoisted(() => vi.fn(async () => [
  {
    id: 1,
    firstName: "Jordan",
    lastName: "Hale",
    vehiclePlate: "4412",
    plateState: "OK",
    checkInTime: "2026-08-23T10:00:00Z",
    checkOutTime: null,
  },
]));
const exportPdf = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@/lib/visits-api", () => ({
  listAllVisits,
}));

vi.mock("@/lib/gatekeeper-log-export", () => ({
  exportExcel: vi.fn(),
  exportPdf,
  exportWord: vi.fn(),
  toGateLogRows: (rows: unknown[]) => rows,
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

  it("exports only the gate selected by the Full Gate History route", async () => {
    window.history.replaceState({}, "", "/gate/history?siteLocationId=42");
    renderPage();

    const pdf = await screen.findByTestId("button-gate-export-pdf");
    await waitFor(() => expect(pdf.getAttribute("disabled")).toBeNull());
    fireEvent.click(pdf);

    await waitFor(() => expect(exportPdf).toHaveBeenCalledTimes(1));
    expect(listAllVisits).toHaveBeenCalledTimes(2);
    expect(listAllVisits).toHaveBeenLastCalledWith({ siteLocationId: 42 });
  });
});
