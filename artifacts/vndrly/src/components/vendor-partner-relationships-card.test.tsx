import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ items: [] as any[] }));
vi.mock("@tanstack/react-query", () => ({ useQuery: () => ({ data: { items: state.items }, isLoading: false }), useQueries: () => state.items.map(item => ({ data: { contactEmail: `${item.partnerId}@example.com` } })) }));
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: { role: "vendor", vendorId: 1054 } }) }));
vi.mock("@/components/partner-approval-logo", () => ({ default: () => null }));
vi.mock("@workspace/api-client-react", () => ({
  getGetPartnerQueryKey: (id: number) => ["partner", id],
  getGetPartnerQueryOptions: () => ({}),
  useGetPartner: (id: number, options: any) => ({ data: options.query.enabled ? { id, name: `Partner ${id}`, contactName: "Partner contact", contactEmail: "contact@example.com", contactPhone: "4057026991", createdAt: "2026-08-23T12:00:00Z" } : undefined }),
}));
vi.mock("@/components/poster-preview", () => ({ PosterThumbnail: ({ partnerId }: any) => <span data-testid={`poster-${partnerId}`} /> }));
import VendorPartnerRelationshipsCard from "./vendor-partner-relationships-card";
afterEach(cleanup);
it("searches names and saved contacts across current and former partners", () => {
  state.items = [{ partnerId: 1, partnerName: "Flywheel", status: "approved" }, { partnerId: 2, partnerName: "Warwick", status: "revoked" }];
  render(<VendorPartnerRelationshipsCard vendorId={1054} />);
  const search = screen.getByRole("searchbox", { name: "Search partners" });
  fireEvent.change(search, { target: { value: "2@example.com" } });
  expect(screen.queryByText("Flywheel")).toBeNull();
  expect(screen.getByText("Warwick")).toBeTruthy();
  expect(screen.getByTestId("partner-group-former").hasAttribute("open")).toBe(true);
  fireEvent.change(search, { target: { value: "FLYWHEEL" } });
  expect(screen.getByText("Flywheel")).toBeTruthy();
  expect(screen.queryByText("Warwick")).toBeNull();
  fireEvent.change(search, { target: { value: "" } });
  expect(screen.getByText("Warwick")).toBeTruthy();
  expect(screen.getByTestId("partner-group-former").hasAttribute("open")).toBe(false);
});
it("expands canonical partner contact details and its poster without changing approval metadata", () => {
  state.items = [{ partnerId: 7, partnerName: "Partner 7", status: "approved", approvedAt: "2026-09-09T12:00:00Z", approvedByUsername: "approver" }];
  render(<VendorPartnerRelationshipsCard vendorId={1054} />);
  const details = screen.getByTestId("partner-contact-details-7");
  expect(details.hasAttribute("open")).toBe(false);
  expect(screen.queryByText("Partner contact")).toBeNull();
  details.setAttribute("open", "");
  fireEvent(details, new Event("toggle"));
  expect(screen.getByText("Partner contact")).toBeTruthy();
  expect(screen.getByText("contact@example.com").getAttribute("href")).toBe("mailto:contact@example.com");
  expect(screen.getByTestId("poster-7")).toBeTruthy();
  expect(within(details).getByText(new Date("2026-08-23T12:00:00Z").toLocaleDateString())).toBeTruthy();
});
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
