import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { WorkHubFiles } from "./files";
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: { userId: 7, role: "vendor", vendorId: 1, partnerId: null, activeMembershipId: 1 } }) }));
vi.mock("@/lib/work-hub-client", async original => ({ ...await original<any>(), workHubRequest: async (path: string) => path === "/channels" ? [{ id: "shared-1", name: "Shared operations", ownerOrgType: "partner", ownerOrgId: 2 }] : [] }));
afterEach(() => window.history.replaceState({}, "", "/"));
it("opens the invited channel upload audience from a conversation deep link", async () => {
  window.history.replaceState({}, "", "/work-hub/files?channel=shared-1");
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><WorkHubFiles /></QueryClientProvider>);
  expect((screen.getByLabelText("File audience") as HTMLSelectElement).value).toBe("channel");
  await screen.findByRole("option", { name: "Shared operations" });
  await waitFor(() => expect((screen.getByLabelText("File channel") as HTMLSelectElement).value).toBe("shared-1"));
  expect((screen.getByLabelText("Choose file to upload") as HTMLInputElement).disabled).toBe(false);
});