import * as React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: { role: "vendor", vendorId: 7, vendorRole: "office", activeMembershipId: 1, availableMemberships: [] } }) }));
import PayrollPage from "./payroll";
beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => new Response(JSON.stringify(url.endsWith("/employees") ? { employees: [{ id: 1, firstName: "Ada", lastName: "Worker" }] } : { fingerprint: "reviewed-source", exportable: true, grossPay: "20.00", issues: [], rows: [] }), { status: 200, headers: { "Content-Type": "application/json" } })));
});
describe("Payroll page", () => {
  it("requires explicit wages/policy confirmation and invalidates review on edits", async () => {
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><PayrollPage /></QueryClientProvider>);
    await screen.findByLabelText("Hourly wage for Ada Worker");
    expect((screen.getByRole("button", { name: "Calculate" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Start date"), { target: { value: "2026-09-07" } });
    fireEvent.change(screen.getByLabelText("End date (exclusive)"), { target: { value: "2026-09-08" } });
    fireEvent.change(screen.getByLabelText("Hourly wage for Ada Worker"), { target: { value: "20.00" } });
    fireEvent.click(screen.getByRole("checkbox", { name: /I confirm/ }));
    fireEvent.click(screen.getByRole("button", { name: "Calculate" }));
    await screen.findByText("Gross estimate: $20.00");
    expect((screen.getByRole("button", { name: "CSV" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("checkbox", { name: /I reviewed/ }));
    expect((screen.getByRole("button", { name: "CSV" }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.change(screen.getByLabelText("Weekly overtime threshold (hours)"), { target: { value: "38" } });
    await waitFor(() => expect((screen.getByRole("button", { name: "CSV" }) as HTMLButtonElement).disabled).toBe(true));
    expect((screen.getByRole("checkbox", { name: /I confirm/ }) as HTMLInputElement).checked).toBe(false);
    expect(screen.getByText(/QuickBooks time transfer: unavailable/)).toBeTruthy();
  });
});
