import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import OperationsDisplayDirectory from "./operations-display-directory";
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: { userId: 17, role: "vendor", vendorId: 4, partnerId: null, activeMembershipId: 12 } }) }));
it("links only validated saved monitor IDs using authenticated directory data", async () => {
  const id = "00000000-0000-4000-8000-000000000001", monitorId = "00000000-0000-4000-8000-000000000002";
  vi.spyOn(globalThis, "fetch").mockResolvedValue({ ok: true, json: async () => ({ monitors: [{ displayId: id, monitorId, displayName: "Dispatch", monitorName: "Left", href: "https://foreign.invalid" }], truncated: false }) } as Response);
  render(<OperationsDisplayDirectory />);
  expect((await screen.findByRole("link", { name: "Dispatch · Left" })).getAttribute("href")).toBe(`/operations-display/${id}/${monitorId}`);
  expect(screen.queryByText(/is connected/)).toBeNull(); vi.restoreAllMocks();
});
