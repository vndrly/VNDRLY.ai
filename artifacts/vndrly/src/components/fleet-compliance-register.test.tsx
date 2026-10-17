import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from "@testing-library/react";
import { it, expect, vi, afterEach } from "vitest";
import { FleetComplianceRegister } from "./fleet-compliance-register";
const mocks = vi.hoisted(() => ({ register: vi.fn() }));
vi.mock("@/lib/fleet-client", () => ({
  fleetClient: { complianceRegister: mocks.register },
}));
vi.mock("./png-pill-rollover", () => ({
  PngPillButton: ({ children, ...props }: any) => (
    <button {...props}>{children}</button>
  ),
}));
const entry = {
  id: "11111111-1111-4111-8111-111111111111",
  revision: 2,
  subject: { kind: "driver", id: 7 },
  requirementId: "OK-driver-license",
  requirementVersion: 1,
  kind: "driver_license",
  verification: "document_received",
  status: "red",
  reasons: ["unverified"],
  validUntil: "2026-11-01T00:00:00Z",
  evaluatedAt: "2026-10-16T18:00:00Z",
  maskedIdentifier: "••••1234",
  mayReview: false,
};
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
it("presents warning-only registers with masked evidence and no automatic private reads, and discards old pages when a filter is denied", async () => {
  mocks.register.mockResolvedValue({
    entries: [entry],
    nextCursor: null,
    mode: "warn_only",
  });
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <FleetComplianceRegister identity="company7" />
    </QueryClientProvider>,
  );
  expect(await screen.findByText("••••1234")).toBeTruthy();
  expect(screen.getByText(/warnings do not block/i)).toBeTruthy();
  expect(screen.getByText("Document received")).toBeTruthy();
  expect(screen.queryByRole("link", { name: /document/i })).toBeNull();
  mocks.register.mockRejectedValue(new Error("403"));
  fireEvent.change(screen.getByLabelText("Register"), {
    target: { value: "vehicle" },
  });
  await screen.findByRole("alert");
  expect(screen.queryByText("••••1234")).toBeNull();
  await waitFor(() =>
    expect(mocks.register).toHaveBeenLastCalledWith(
      expect.objectContaining({ subjectKind: "vehicle" }),
    ),
  );
});
