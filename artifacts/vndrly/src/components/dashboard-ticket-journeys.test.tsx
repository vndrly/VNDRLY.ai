import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }) }));
vi.mock("@/components/png-pill-rollover", () => ({ PngPillButton: ({ color: _color, ...props }: any) => <button {...props} /> }));
import { DashboardTicketJourneys } from "./dashboard-ticket-journeys";
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it("loads detail only on selection and records an invoice payment with the entered fields", async () => {
  const ticket = { id: 101, status: "approved", siteName: "San Roman", partnerName: "Warwick", vendorId: 1054,
    approvedAt: "2026-11-12T12:00:00Z", paid: false, paidAmount: "0", balanceDue: "100", finishedAt: null };
  const fetcher = vi.fn(async (url: string, options?: RequestInit) => {
    if (options?.method === "POST") return new Response(JSON.stringify({ payment: { id: 1 } }), { status: 201 });
    return new Response(JSON.stringify(url.endsWith("/101") ? { history: [], approvals: [], canRecordPayment: true,
      invoices: [{ id: 55, number: "INV-55", status: "open", total: "100", paidAmount: "0", balanceDue: "100", ticketCount: 1, payments: [] }] } : { tickets: [ticket] }));
  });
  vi.stubGlobal("fetch", fetcher);
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><DashboardTicketJourneys scope="vendor:1054" enabled /></QueryClientProvider>);
  await screen.findByText("ticketJourney.categories.payment");
  expect(fetcher.mock.calls.filter(([url]) => url.endsWith("/101"))).toHaveLength(0);
  fireEvent.click(screen.getByText("ticketJourney.categories.payment"));
  fireEvent.click(screen.getByRole("button", { name: /#101/ }));
  await screen.findByLabelText("ticketJourney.amount");
  fireEvent.change(screen.getByLabelText("ticketJourney.amount"), { target: { value: "25.50" } });
  fireEvent.change(screen.getByLabelText("ticketJourney.date"), { target: { value: "2026-11-12" } });
  fireEvent.change(screen.getByLabelText("ticketJourney.reference"), { target: { value: "ACH-12" } });
  fireEvent.click(screen.getByRole("button", { name: "ticketJourney.recordPayment" }));
  await waitFor(() => expect(fetcher.mock.calls.some(([, options]) => options?.method === "POST")).toBe(true));
  const [url, options] = fetcher.mock.calls.find(([, options]) => options?.method === "POST")!;
  expect(url).toBe("/api/invoices/55/payments");
  expect(JSON.parse(String(options!.body))).toMatchObject({ amount: "25.50", paidAt: "2026-11-12", method: "ach", referenceNumber: "ACH-12" });
});
it("does not fetch when the dashboard has paused loading", () => {
  const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
  render(<QueryClientProvider client={new QueryClient()}><DashboardTicketJourneys scope="vendor:1054" enabled={false} /></QueryClientProvider>);
  expect(screen.getByRole("status").textContent).toBe("ticketJourney.paused");
  expect(fetcher).not.toHaveBeenCalled();
});

it("keeps loaded categories visible when a refresh fails, instead of replacing them with an error", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const key = ["ticket-journeys", "vendor:1054"];
  client.setQueryData(key, { tickets: [{ id: 101, status: "in_progress", siteName: "Test Site", partnerName: "Test Partner", vendorId: 1054, paid: false }] });
  vi.stubGlobal("fetch", vi.fn(async () => new Response("unavailable", { status: 503 })));
  render(<QueryClientProvider client={client}><DashboardTicketJourneys scope="vendor:1054" enabled /></QueryClientProvider>);
  await client.invalidateQueries({ queryKey: key });
  expect(await screen.findByText("ticketJourney.stale")).toBeTruthy();
  expect(screen.getByText("ticketJourney.categories.working")).toBeTruthy();
  expect(screen.queryByText("ticketJourney.error")).toBeNull();
  client.clear();
}, 10000);

it("recovers automatically from a transient initial failure", async () => {
  const client = new QueryClient();
  const fetcher = vi.fn().mockResolvedValueOnce(new Response("unavailable", { status: 503 })).mockResolvedValue(new Response(JSON.stringify({tickets:[]})));
  vi.stubGlobal("fetch", fetcher);
  render(<QueryClientProvider client={client}><DashboardTicketJourneys scope="vendor:1054" enabled /></QueryClientProvider>);
  await waitFor(() => expect(screen.getByText("ticketJourney.open")).toBeTruthy(), {timeout:5000});
  expect(fetcher).toHaveBeenCalledTimes(2);
  client.clear();
});

it("does not keep displaying cached tickets after access is denied", async () => {
  const client = new QueryClient(); const key = ["ticket-journeys", "vendor:1054"];
  client.setQueryData(key, {tickets:[]});
  const fetcher=vi.fn(async()=>new Response("denied",{status:403}));vi.stubGlobal("fetch",fetcher);
  render(<QueryClientProvider client={client}><DashboardTicketJourneys scope="vendor:1054" enabled /></QueryClientProvider>);
  await client.invalidateQueries({queryKey:key});
  expect(await screen.findByText("ticketJourney.accessRequired")).toBeTruthy();
  expect(screen.queryByText("ticketJourney.open")).toBeNull();expect(fetcher).toHaveBeenCalledTimes(1);client.clear();
});
