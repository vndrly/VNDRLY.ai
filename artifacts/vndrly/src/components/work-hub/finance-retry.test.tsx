import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { WorkHubFinance } from "./finance";
const request = vi.hoisted(() => vi.fn());
const exportCsv = vi.hoisted(() => vi.fn());
vi.mock("./csv", () => ({ downloadCsv: exportCsv }));
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: { userId: 7, role: "vendor", vendorId: 1, partnerId: null, activeMembershipId: 1 } }) }));
vi.mock("@/lib/work-hub-client", async importOriginal => ({ ...await importOriginal<any>(), workHubRequest: request }));
describe("finance retry protection", () => {
  it("reuses failed command identity and edits the created invoice after success", async () => {
    const sends: any[] = [];
    request.mockImplementation(async (_path: string, init?: RequestInit) => {
      if (!init) return { permissions: { billing: true }, providers: { message: "Manual records", email: false }, invoices: [], payroll: [], grants: [], members: [], canonicalInvoices: [], fee: { basisPoints: 50, capCents: null } };
      sends.push(JSON.parse(String(init.body)));
      if (sends.length === 1) throw new Error("Connection interrupted");
      return { resource: { id: "invoice-1", data: {} } };
    });
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><WorkHubFinance/></QueryClientProvider>);
    fireEvent.change(await screen.findByLabelText("Customer (onboarded or external)"), { target: { value: "Example customer" } });
    fireEvent.change(screen.getByLabelText("Services / description"), { target: { value: "Field service" } });
    fireEvent.change(screen.getByLabelText("Total USD"), { target: { value: "125.50" } });
    fireEvent.change(screen.getByLabelText("Due date"), { target: { value: "2026-10-01" } });
    fireEvent.click(screen.getByRole("button", { name: "Save invoice draft" }));
    await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("button", { name: "Save invoice draft" }));
    await waitFor(() => expect(sends.length).toBe(2));
    expect(sends[0].operationId).toBe(sends[1].operationId);
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    fireEvent.change(screen.getByLabelText("Total USD"), { target: { value: "130.00" } });
    fireEvent.click(screen.getByRole("button", { name: "Save invoice draft" }));
    await waitFor(() => expect(sends.length).toBe(3));
    expect(sends[2].operationId).not.toBe(sends[1].operationId);
    expect(sends[2].payload).toMatchObject({ id: "invoice-1", amountCents: 13000 });
  });
});

describe("gross-pay report", () => {
  it("exports only the authorized returned payroll rows with an explicit draft label", async () => {
    request.mockResolvedValue({ permissions: { payrollView: true }, providers: { message: "No provider", email: false }, invoices: [], payroll: [{ id: "p1", data: { periodEnd: "2026-09-30", status: "draft", employees: [{ userId: 7, grossCents: 12345 }] } }], grants: [], members: [{ userId: 7, displayName: "Casey Example", role: "employee" }], canonicalInvoices: [], fee: { basisPoints: 50, capCents: null } });
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><WorkHubFinance /></QueryClientProvider>);
    fireEvent.click(await screen.findByRole("button", { name: "Export gross-pay report CSV" }));
    expect(exportCsv).toHaveBeenCalledWith("payroll-gross-drafts.csv", expect.any(Array), [["p1", "2026-09-30", "draft", 7, "Casey Example", "123.45", "Gross-pay draft only; no taxes, net pay or funds transfer"]]);
  });
});