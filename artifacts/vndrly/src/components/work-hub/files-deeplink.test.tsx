import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { WorkHubFiles } from "./files";
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: { userId: 7, role: "vendor", vendorId: 1, partnerId: null, activeMembershipId: 1 } }) }));
vi.mock("@/lib/work-hub-client", async original => ({ ...await original<any>(), workHubRequest: async (path: string) => path === "/channels?limit=100" ? [{ id: "shared-1", name: "Shared operations", ownerOrgType: "partner", ownerOrgId: 2 }] : [] }));
afterEach(() => window.history.replaceState({}, "", "/"));
it("stages a composer attachment for explicit upload to the selected conversation", async () => {
  const consumed = vi.fn();
  const file = new File(["mock photo"], "mock-photo.jpg", { type: "image/jpeg" });
  render(<QueryClientProvider client={new QueryClient()}><WorkHubFiles fixedChannelId="shared-1" initialFile={file} onInitialFileConsumed={consumed} /></QueryClientProvider>);
  expect(await screen.findByText("mock-photo.jpg")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Upload", exact: true })).toBeTruthy();
  expect(consumed).toHaveBeenCalledOnce();
});
it("opens the invited channel upload audience from a conversation deep link", async () => {
  window.history.replaceState({}, "", "/work-hub/files?channel=shared-1");
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><WorkHubFiles /></QueryClientProvider>);
  expect((screen.getByLabelText("File audience") as HTMLSelectElement).value).toBe("channel");
  await screen.findByRole("option", { name: "Shared operations" });
  await waitFor(() => expect((screen.getByLabelText("File channel") as HTMLSelectElement).value).toBe("shared-1"));
  expect((screen.getByLabelText("Choose file to upload") as HTMLInputElement).disabled).toBe(false);
});
it("keeps an embedded Files pane locked to its selected conversation", async () => {
  window.history.replaceState({}, "", "/work-hub/chat?channel=another-chat");
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><WorkHubFiles fixedChannelId="shared-1" /></QueryClientProvider>);
  expect(screen.queryByLabelText("File audience")).toBeNull();
  expect(screen.queryByLabelText("File channel")).toBeNull();
  expect(screen.getByRole("button", { name: "Choose file" })).toBeTruthy();
  expect(screen.queryByText("Upload a file")).toBeNull();
});
