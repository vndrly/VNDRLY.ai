import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
const api = vi.hoisted(() => ({
  supportChoices: vi.fn(),
  supportCompany: vi.fn(),
}));
vi.mock("@/lib/fleet-client", () => ({ fleetClient: api }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ i18n: { language: "en" } }),
}));
vi.mock("@/components/png-pill-rollover", () => ({
  PngPillButton: (props: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props} />
  ),
}));
import { FleetSupportPanel } from "./fleet-support";
beforeEach(() => {
  vi.resetAllMocks();
  api.supportChoices.mockResolvedValue({
    companies: [
      {
        companyId: 7,
        companyName: "Granted company",
        expiresAt: "2099-01-01T00:00:00Z",
        reason: "Approved investigation",
      },
    ],
    readOnly: true,
  });
  api.supportCompany.mockResolvedValue({
    companyId: 7,
    companyName: "Granted company",
    expiresAt: "2099-01-01T00:00:00Z",
    reason: "Approved investigation",
    readOnly: true,
    coordinateDisclosure: false,
    page: { nextCursor: null },
    runs: [],
  });
});
it("requires exact granted company selection and removes data on revoked read", async () => {
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <FleetSupportPanel identity="admin:8" />
    </QueryClientProvider>,
  );
  await screen.findByRole("option", { name: "Granted company" });
  expect(api.supportCompany).not.toHaveBeenCalled();
  fireEvent.change(screen.getByRole("combobox"), { target: { value: "7" } });
  await screen.findByRole("heading", { name: "Granted company" });
  expect(api.supportCompany).toHaveBeenCalledWith(7, undefined);
  expect(screen.queryByRole("button", { name: /Dispatch|Release/ })).toBeNull();
  api.supportCompany.mockRejectedValue(new Error("revoked"));
  fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
  await waitFor(() =>
    expect(
      screen.queryByRole("heading", { name: "Granted company" }),
    ).toBeNull(),
  );
});
