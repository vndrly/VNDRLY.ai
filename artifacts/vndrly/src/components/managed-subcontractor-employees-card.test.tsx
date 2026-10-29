import { beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import ManagedSubcontractorEmployeesCard from "./managed-subcontractor-employees-card";
vi.mock("@workspace/api-client-react", () => ({ useGetVendor: () => ({ data: { name: "GateGo" } }), getGetVendorQueryKey: () => ["vendor"] }));
vi.mock("./ui/dialog", () => ({ Dialog: ({ open, children }: any) => open ? children : null }));
vi.mock("./vendor-edit-flyout", () => ({ VendorEditFlyout: ({ children, title }: any) => <section aria-label={title}>{children}</section> }));
vi.mock("./branded-checkbox", () => ({ BrandedCheckbox: ({ checked, onCheckedChange, ...props }: any) => <input type="checkbox" checked={checked} onChange={event => onCheckedChange(event.target.checked)} {...props} /> }));
const company = { id: "org", name: "StaffGO", status: "managed", workers: [] };
function mount(items: unknown[]) {
 const fetch = vi.fn(async (_url: string, init: any) => ({ ok: true, json: async () => init.method === "GET" ? { items, sites: [{ id: 3, name: "Main Gate" }] } : company }));
 vi.stubGlobal("fetch", fetch);
 render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })}><ManagedSubcontractorEmployeesCard vendorId={7} /></QueryClientProvider>);
 return fetch;
}
beforeEach(() => { cleanup(); vi.clearAllMocks(); });
it("Add Contractor creates only the managed company", async () => {
 const fetch = mount([]);
 await waitFor(() => expect((screen.getByRole("button", { name: "Add Contractor", exact: true }) as HTMLButtonElement).disabled).toBe(false));
 fireEvent.click(screen.getByRole("button", { name: "Add Contractor", exact: true }));
 const name = screen.getByLabelText("Company name");
 fireEvent.change(name, { target: { value: "StaffGO" } }); fireEvent.submit(name.closest("form")!);
 await waitFor(() => expect(fetch.mock.calls.filter(([, init]) => init.method === "POST")).toHaveLength(1));
 const call = fetch.mock.calls.find(([, init]) => init.method === "POST")!;
 expect(call[0]).toBe("/api/vendors/7/managed-subcontractors");
 expect(JSON.parse(call[1].body)).toEqual({ name: "StaffGO" });
 expect(fetch.mock.calls.some(([url]) => url.includes("/workers"))).toBe(false);
});
it("Add Contracted Employee uses an existing company and does not send enrollment by default", async () => {
 const fetch = mount([company]);
 await waitFor(() => expect((screen.getByRole("button", { name: "Add Contracted Employee", exact: true }) as HTMLButtonElement).disabled).toBe(false));
 fireEvent.click(screen.getByRole("button", { name: "Add Contracted Employee", exact: true }));
 const name = screen.getByLabelText("Employee name");
 fireEvent.change(name, { target: { value: "Demo Gatekeeper" } });
 fireEvent.click(screen.getByRole("checkbox", { name: "Main Gate" }));
 fireEvent.submit(name.closest("form")!);
 await waitFor(() => expect(fetch.mock.calls.some(([url]) => url.includes("/org/workers"))).toBe(true));
 const call = fetch.mock.calls.find(([url]) => url.includes("/org/workers"))!;
 expect(JSON.parse(call[1].body)).toEqual({ name: "Demo Gatekeeper", role: "gatekeeper", siteIds: [3], sendInvitation: false });
 expect(fetch.mock.calls.some(([url, init]) => url === "/api/vendors/7/managed-subcontractors" && init.method === "POST")).toBe(false);
});
