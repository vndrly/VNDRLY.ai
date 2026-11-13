import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ items: [] as any[] }));
vi.mock("@tanstack/react-query", () => ({ useQuery: () => ({ data: { items: state.items }, isLoading: false }) }));
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: { role: "vendor", vendorId: 1054 } }) }));
vi.mock("@/components/partner-approval-logo", () => ({ default: () => null }));
import VendorPartnerRelationshipsCard from "./vendor-partner-relationships-card";
afterEach(cleanup);
it("keeps ongoing approvals current and preserves revoked partners in collapsed history", () => {
  state.items = ["approved", "preferred", "pending_review", "auto_unapproved", "unaffiliated", "revoked"].map((status, i) => ({ partnerId: i + 1, partnerName: `Partner ${i + 1}`, status, ratedAt: null, approvedAt: "2026-09-09T12:00:00Z", approvedByUsername: "approver", notes: null }));
  render(<VendorPartnerRelationshipsCard vendorId={1054} />);
  const current = screen.getByTestId("partner-group-current");
  const former = screen.getByTestId("partner-group-former");
  expect(current.hasAttribute("open")).toBe(true);
  expect(former.hasAttribute("open")).toBe(false);
  expect(current.querySelector("summary")?.textContent).toContain("5");
  expect(former.querySelector("summary")?.textContent).toContain("1");
  expect(within(current).queryByText("Partner 6")).toBeNull();
  expect(within(former).getByText("Partner 6")).toBeTruthy();
  expect(within(former).getByTestId("badge-relationship-revoked").textContent).toBe("Revoked");
  expect(within(former).getByTestId("approval-details-6").textContent).toContain("approver");
});
it("renders both zero-count sections when there are no relationships", () => {
  state.items = [];
  render(<VendorPartnerRelationshipsCard vendorId={1054} />);
  expect(screen.getByText("No current partners.")).toBeTruthy();
  expect(screen.getByText("No former partners.")).toBeTruthy();
});
