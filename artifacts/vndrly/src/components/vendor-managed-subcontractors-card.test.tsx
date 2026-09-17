import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import VendorManagedSubcontractorsCard from "./vendor-managed-subcontractors-card";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, string>) =>
      `${key}${values?.employer ? ` ${values.employer} ${values.vendor}` : ""}`,
  }),
}));
vi.mock("@/components/brand-pill-button", () => ({
  default: ({ children, tone: _tone, ...props }: any) => (
    <button {...props}>{children}</button>
  ),
}));
const initial = {
  items: [
    {
      id: 7,
      name: "NewTech",
      status: "managed",
      workers: [
        {
          id: 9,
          userId: 22,
          name: "Alex",
          email: "alex@example.com",
          role: "gatekeeper",
          status: "active",
          siteIds: [3],
        },
      ],
    },
  ],
  sites: [{ id: 3, name: "North Gate" }],
};
function setup() {
  const fetchMock = vi
    .fn()
    .mockResolvedValue({ ok: true, json: async () => initial });
  vi.stubGlobal("fetch", fetchMock);
  render(
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: {
            queries: { retry: false },
            mutations: { retry: false },
          },
        })
      }
    >
      <VendorManagedSubcontractorsCard vendorId={4} vendorName="Midcon" />
    </QueryClientProvider>,
  );
  return fetchMock;
}
afterEach(() => vi.unstubAllGlobals());

it("uses the primary brand outline for subcontractor company subcards", async () => {
  setup();
  const company = await screen.findByTestId("managed-subcontractor-7");
  expect(company.className).toContain("border-[color:var(--brand-primary)]");
});

it("creates a subcontractor under the current vendor", async () => {
  const fetchMock = setup();
  await screen.findByText("NewTech");
  fireEvent.change(screen.getByLabelText("managedSubcontractors.companyName"), {
    target: { value: "Second Company" },
  });
  fireEvent.click(screen.getByText("managedSubcontractors.createCompany"));
  await waitFor(() =>
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/vendors/4/managed-subcontractors"),
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ name: "Second Company" }),
      }),
    ),
  );
});

it("edits a worker role and site scope without changing their employer", async () => {
  const fetchMock = setup();
  await screen.findByText("Alex");
  fireEvent.click(screen.getByText("managedSubcontractors.editAccess"));
  fireEvent.change(screen.getByLabelText("managedSubcontractors.role"), {
    target: { value: "gate_supervisor" },
  });
  fireEvent.click(screen.getByText("managedSubcontractors.saveWorker"));
  await waitFor(() =>
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/7/workers/9"),
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ role: "gate_supervisor", siteIds: [3] }),
      }),
    ),
  );
});

it("requires confirmation before revoking access and preserves the worker record", async () => {
  const fetchMock = setup();
  await screen.findByText("Alex");
  fireEvent.click(screen.getByText("managedSubcontractors.revokeAccess"));
  expect(fetchMock.mock.calls.some(([, init]) => init?.method === "PATCH")).toBe(false);
  fireEvent.click(screen.getByText("managedSubcontractors.confirmRevoke"));
  await waitFor(() =>
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/7/workers/9"),
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ status: "terminated" }),
      }),
    ),
  );
});

it("invites a worker with a scoped role and exposes failed email delivery without pretending it was sent", async () => {
  const fetchMock = setup();
  await screen.findByText("NewTech");
  fireEvent.click(screen.getByText("managedSubcontractors.addWorker"));
  fireEvent.change(screen.getByLabelText("managedSubcontractors.workerName"), {
    target: { value: "Jamie" },
  });
  fireEvent.change(screen.getByLabelText("managedSubcontractors.email"), {
    target: { value: "jamie@example.com" },
  });
  fireEvent.click(screen.getByLabelText("North Gate"));
  fetchMock.mockResolvedValueOnce({
    ok: true,
    json: async () => ({
      invitation: { id: 44, state: "delivery_failed" },
      activationUrl: "https://example.com/activate/private-token",
    }),
  });
  fireEvent.click(screen.getByText("managedSubcontractors.saveWorker"));
  await screen.findByText("managedSubcontractors.deliveryFailed");
  expect(fetchMock).toHaveBeenCalledWith(
    expect.stringContaining("/7/workers"),
    expect.objectContaining({
      method: "POST",
      body: JSON.stringify({
        name: "Jamie",
        email: "jamie@example.com",
        role: "gatekeeper",
        siteIds: [3],
      }),
    }),
  );
  expect(
    (
      screen.getByLabelText(
        "managedSubcontractors.activationLink",
      ) as HTMLInputElement
    ).value,
  ).toBe("https://example.com/activate/private-token");
});
