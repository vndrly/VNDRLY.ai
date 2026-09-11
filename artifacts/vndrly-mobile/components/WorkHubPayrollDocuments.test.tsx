import React from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import WorkHubPayrollDocuments from "./WorkHubPayrollDocuments";
const mocks = vi.hoisted(() => ({ api: vi.fn(), download: vi.fn(), share: vi.fn(), remove: vi.fn(), user: { id: 1, activeMembershipId: 2 } }));
vi.mock("@/lib/api", () => ({ apiFetch: mocks.api, getApiBase: () => "https://vndrly.example" }));
vi.mock("@/lib/auth", () => ({ getToken: async () => "session-token" }));
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: mocks.user }) }));
vi.mock("@/hooks/useColors", () => ({ useColors: () => ({ text: "black", mutedForeground: "gray", border: "gray", destructive: "red" }) }));
vi.mock("expo-file-system/legacy", () => ({ cacheDirectory: "file:///cache/", downloadAsync: mocks.download, deleteAsync: mocks.remove }));
vi.mock("expo-sharing", () => ({ isAvailableAsync: async () => true, shareAsync: mocks.share }));
afterEach(cleanup);
beforeEach(() => { vi.clearAllMocks(); mocks.user = { id: 1, activeMembershipId: 2 }; mocks.remove.mockResolvedValue(undefined); mocks.download.mockResolvedValue({ status: 200 }); mocks.share.mockResolvedValue(undefined); });
it("honestly shows unconfigured document delivery", async () => {
  mocks.api.mockResolvedValue({ documents: [], providerConfigured: false, message: "Payroll document delivery is not configured." });
  render(<WorkHubPayrollDocuments />);
  expect(await screen.findByText("Payroll document delivery is not configured.")).toBeTruthy();
  expect(screen.queryByRole("button")).toBeNull();
});
it("opens issued PDF with bearer headers and removes private cached copies", async () => {
  mocks.api.mockResolvedValue({ documents: [{ id: "doc-1", documentType: "w2", issuedAt: "2026-01-01T00:00:00Z", taxYear: 2025 }], message: "Issued documents", providerConfigured: false });
  render(<WorkHubPayrollDocuments />); fireEvent.click(await screen.findByRole("button"));
  await waitFor(() => expect(mocks.share).toHaveBeenCalled());
  expect(mocks.download).toHaveBeenCalledWith("https://vndrly.example/api/work-hub/finance/personal-documents/doc-1", expect.stringMatching(/^file:\/\/\/cache\/payroll-/), { headers: { Authorization: "Bearer session-token", "x-vndrly-client": "ios" } });
  await waitFor(() => expect(mocks.remove).toHaveBeenCalled());
});
it("hides prior employee documents immediately on identity change", async () => {
  mocks.api.mockResolvedValueOnce({ documents: [{ id: "old-doc", documentType: "w2", issuedAt: "2026-01-01T00:00:00Z", taxYear: 2025 }], message: "Old employee", providerConfigured: false }).mockImplementationOnce(() => new Promise(() => {}));
  const view = render(<WorkHubPayrollDocuments />); await screen.findByText("Old employee");
  mocks.user = { id: 9, activeMembershipId: 8 }; view.rerender(<WorkHubPayrollDocuments />);
  expect(screen.queryByText("Old employee")).toBeNull(); expect(screen.queryByRole("button")).toBeNull();
});
