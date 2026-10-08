import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: { userId: 8, vendorId: 3, role: "vendor", activeMembershipId: 2 } }) }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ i18n: { language: "en" } }) }));
vi.mock("@/components/png-pill-rollover", () => ({ PngPillButton: ({ children, ...props }: any) => <button {...props}>{children}</button> }));
vi.mock("@/lib/native-operations-client", async importOriginal => ({
  ...await importOriginal<object>(), nativeOperationsRequest: vi.fn(async () => ({
    policy: { enabled: true, locationRequests: true, photoRequests: true, dutyModes: ["manual"], grants: [] },
    userId: 8, vendorId: 3, consent: { locationSharing: false }, duty: { active: false },
    canManagePolicy: false, devices: [], workers: [], requests: [{ id: "request", kind: "photo", state: "upload-in-progress", result: null, purpose: "Delivery proof" }],
  })),
}));
import NativeOperations from "./native-operations";

describe("web native work requests", () => {
  it("shows upload as pending saved evidence and provides worker consent separately from duty", async () => {
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><NativeOperations /></QueryClientProvider>);
    expect(await screen.findByText("Delivery proof")).toBeTruthy();
    expect(screen.getByText("Uploading — not saved yet")).toBeTruthy();
    expect(screen.getByLabelText("Allow location requests during active duty")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Start duty" })).toBeTruthy();
  });
});
