import { beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import StaffEnrollmentControl from "./staff-enrollment-control";
vi.mock("@workspace/api-client-react", () => ({ useGetVendor: () => ({ data: { name: "GateGo", logoSquareUrl: "/gatego.png" } }), getGetVendorQueryKey: () => ["vendor"] }));
vi.mock("./ui/dialog", () => ({ Dialog: ({ open, children }: any) => open ? children : null }));
vi.mock("./vendor-edit-flyout", () => ({ VendorEditFlyout: ({ children, title }: any) => <section aria-label={title}>{children}</section> }));
beforeEach(() => { cleanup(); vi.restoreAllMocks(); });
function mount(state = "unsent", failed = false) {
  const fetch = vi.fn(async (_url: string, init: any) => ({ ok: !init.method || !failed, json: async () => init.method ? failed ? { error: "Email delivery unavailable" } : { state: "sent" } : { entries: { "account:25": { state, email: "worker@example.com", hasLogin: true, expired: false, targetKey: "person:21" } } } }));
  vi.stubGlobal("fetch", fetch);
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })}><StaffEnrollmentControl vendorId={7} personKey="account:25" name="Connie Marsh" /></QueryClientProvider>);
  return fetch;
}
it("opens the shared branded invitation flow from an account row and uses the same employee record", async () => {
  const fetch = mount(); fireEvent.click(await screen.findByRole("button", { name: "SEND" }));
  expect((screen.getByLabelText("Verify email address") as HTMLInputElement).value).toBe("worker@example.com");
  expect(screen.getByText(/existing password and company permissions/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Preview email" }));
  expect(screen.getByTitle("Enrollment email preview").getAttribute("src")).toContain("/staff-enrollments/preview?name=Connie%20Marsh");
  fireEvent.click(screen.getByRole("button", { name: /^Send$/ }));
  await waitFor(() => expect(fetch.mock.calls.some(([, init]) => init.method === "POST")).toBe(true));
  const call = fetch.mock.calls.find(([, init]) => init.method === "POST")!;
  expect(JSON.parse(call[1].body)).toEqual({ key: "person:21", email: "worker@example.com" });
});
it("keeps the flyout open and shows a delivery failure without marking SENT", async () => {
  mount("unsent", true); fireEvent.click(await screen.findByRole("button", { name: "SEND" }));
  fireEvent.click(screen.getByRole("button", { name: /^Send$/ }));
  expect((await screen.findByRole("alert")).textContent).toBe("Email delivery unavailable");
  expect(screen.queryByText("SENT")).toBeNull();
});
it.each(["accepted", "revoked"])("shows %s without enabling another enrollment send", async state => {
  mount(state); expect(await screen.findByText(state.toUpperCase())).toBeTruthy(); expect(screen.queryByRole("button", { name: "SEND" })).toBeNull();
});
