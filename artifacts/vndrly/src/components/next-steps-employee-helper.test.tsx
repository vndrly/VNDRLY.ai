import { useState } from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import NextStepsEmployeeHelper from "./next-steps-employee-helper";
import StaffProfileDialog from "./staff-profile-dialog";
import type { SavedNextStepsWorker } from "./next-steps";
const state = vi.hoisted(() => ({ show: vi.fn(), saved: vi.fn() }));
vi.mock("./next-steps", () => ({ useNextSteps: () => ({ show: state.show, selected: { id: "first-watch", action: { href: "/field-employees?siteId=3" } } }) }));
vi.mock("@workspace/api-client-react", () => ({ useGetVendor: () => ({ data: { name: "GateCo" } }), getGetVendorQueryKey: (id: number) => ["vendor", id] }));
vi.mock("@/hooks/use-brand", () => ({ useBrand: () => ({ name: "GateCo", primary: "#187650" }) }));
vi.mock("@/lib/staff-role-catalog", async importOriginal => ({ ...await importOriginal<typeof import("@/lib/staff-role-catalog")>(), loadStaffRoleCatalog: async () => ({ version: 0, entries: [], canEdit: true }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/hooks/use-unsaved-changes", () => ({ useUnsavedChanges: () => {} }));
vi.mock("./ui/dialog", () => ({ Dialog: ({ open, children }: any) => open ? children : null }));
vi.mock("./vendor-edit-flyout", () => ({ VendorEditFlyout: ({ children, title }: any) => <section aria-label={title}>{children}</section> }));
vi.mock("./branded-checkbox", () => ({ BrandedCheckbox: ({ checked, onCheckedChange, ...props }: any) => <input type="checkbox" checked={checked} onChange={event => onCheckedChange(event.target.checked)} {...props} /> }));
vi.mock("./photo-upload-field", () => ({ PhotoUploadField: () => null }));
vi.mock("./certifications-section", () => ({ default: () => <span>Existing certifications</span> }));
vi.mock("./employee-portal-login-fields", () => ({ default: ({ employeeId }: any) => <span>Existing login controls for {employeeId}</span> }));
vi.mock("./staff-enrollment-control", () => ({ default: () => <span>Existing enrollment controls</span> }));
vi.mock("./employee-access-editor", () => ({ default: ({ siteLocationIds }: any) => <div>Selected authorized sites: {siteLocationIds.join(",")}</div> }));
const companies = [{ id: "actual-employer", name: "StaffCo", status: "managed", workers: [] }];
const person = { id: 19, vendorId: 7, firstName: "Existing", lastName: "Worker", email: "worker@example.invalid", vendorRole: "gatekeeper", isActive: true };
let cache: QueryClient;
const response = (body: unknown, ok = true) => ({ ok, json: async () => structuredClone(body) }) as Response;
let failAccess: boolean;
let failManaged: boolean;
beforeEach(() => {
  cleanup(); vi.clearAllMocks(); failAccess = false; failManaged = false;
  cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  vi.stubGlobal("confirm", () => true);
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith("people-access")) return response({ eligibleSites: [{ id: 3, name: "Main Gate" }], people: [] });
    if (url.endsWith("/access")) return response(failAccess ? { error: "Access was not saved" } : {}, !failAccess);
    if (url.endsWith("/contacts") && init?.method === "POST") return response({ id: 30, userId: null });
    if (url.includes("vendor-contacts")) return response([person]);
    if (url.includes("field-employees")) return response([]);
    if (url.endsWith("/actual-employer/workers")) return response(failManaged ? { error: "Contract employee was not saved" } : { id: "saved-sponsorship", userId: 42, name: "Managed Worker", role: "gatekeeper", siteIds: [3] }, !failManaged);
    if (url.endsWith("managed-subcontractors")) return response({ items: companies, sites: [{ id: 3, name: "Main Gate" }] });
    return response({ id: 30 });
  }));
});
afterEach(() => { cache.clear(); vi.unstubAllGlobals(); });
function Flow({ canManage = true, siteName = "Main Gate", scope = "company-7" }: { canManage?: boolean; siteName?: string; scope?: string }) {
  const [open, setOpen] = useState(false);
  const [savedWorker, setSavedWorker] = useState<SavedNextStepsWorker>();
  return <QueryClientProvider client={cache}>
    <NextStepsEmployeeHelper key={scope} vendorId={7} siteId={3} siteName={siteName} stationName="North" canManage={canManage} loading={false} people={[person]} savedWorker={savedWorker} onAddDirect={() => setOpen(true)} onEditDirect={id => state.saved({ selectedExistingId: id })} onManagedSaved={(worker, companyId) => {
      const result: SavedNextStepsWorker = { kind: "managed", managedWorkerId: worker.id, managedOrganizationId: companyId, userId: worker.userId, name: worker.name };
      state.saved(result); setSavedWorker(result);
    }} />
    <StaffProfileDialog open={open} onOpenChange={setOpen} vendorId={7} defaultType="Gatekeeper" defaultRole="Gatekeeper" defaultSiteId={3} operationCategories={["gate"]} nextSteps={{ siteName: "Main Gate", onReturn: state.show }} onSaved={profile => {
      const result: SavedNextStepsWorker = { kind: "direct", vendorPeopleId: profile.id, userId: profile.userId, name: `${profile.firstName} ${profile.lastName}` };
      state.saved(result); setSavedWorker(result);
    }} />
  </QueryClientProvider>;
}

it("requires an explicit path and person choice without auto-opening or writing any record", async () => {
  render(<Flow />);
  expect(screen.queryByLabelText("First name")).toBeNull();
  expect(screen.queryByLabelText("Employee name")).toBeNull();
  expect(fetch).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Use existing direct employee" }));
  const button = screen.getByRole("button", { name: "Open selected employee" }) as HTMLButtonElement;
  expect(button.disabled).toBe(true);
  fireEvent.change(screen.getByLabelText("Direct employee"), { target: { value: "19" } });
  fireEvent.click(button);
  expect(state.saved).toHaveBeenCalledWith({ selectedExistingId: 19 });
  expect(fetch).not.toHaveBeenCalled();
});

it("creates one direct profile through the shared editor and exposes its saved ID only after access succeeds", async () => {
  render(<Flow />);
  fireEvent.click(screen.getByRole("button", { name: "Add direct employee" }));
  fireEvent.change(await screen.findByLabelText("First name"), { target: { value: "New" } });
  fireEvent.change(screen.getByLabelText("Last name"), { target: { value: "Direct" } });
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: "direct@example.invalid" } });
  expect(screen.getByText("Selected authorized sites: 3")).toBeTruthy();
  expect(state.saved).not.toHaveBeenCalled();
  fireEvent.submit(screen.getByTestId("shared-staff-profile"));
  await waitFor(() => expect(state.saved).toHaveBeenCalledWith({ kind: "direct", vendorPeopleId: 30, userId: null, name: "New Direct" }));
  expect(screen.getByText("Existing login controls for 30")).toBeTruthy();
  expect(screen.getByText("Existing certifications")).toBeTruthy();
  const writes = vi.mocked(fetch).mock.calls.filter(([, init]) => init?.method === "POST" || init?.method === "PUT");
  expect(writes).toHaveLength(2);
  expect(JSON.parse(String(writes[1][1]?.body))).toEqual({ operationalRoles: ["gatekeeper"], siteLocationIds: [3] });
});

it("does not advance a direct worker when only profile details were saved and access failed", async () => {
  failAccess = true; render(<Flow />);
  fireEvent.click(screen.getByRole("button", { name: "Add direct employee" }));
  await screen.findByLabelText("First name"); fireEvent.submit(screen.getByTestId("shared-staff-profile"));
  expect((await screen.findByRole("alert")).textContent).toContain("permissions were not saved");
  expect(state.saved).not.toHaveBeenCalled();
});

it("saves a contracted worker under the explicitly selected real employer and carries its actual sponsorship/user IDs", async () => {
  render(<Flow />); fireEvent.click(screen.getByRole("button", { name: "Use contracted employee" }));
  fireEvent.click(await screen.findByRole("button", { name: "Add Contract Employee" }));
  const name = screen.getByLabelText("Employee name");
  expect((screen.getByLabelText("Subcontractor company") as HTMLSelectElement).value).toBe("actual-employer");
  expect((screen.getByRole("checkbox", { name: "Main Gate" }) as HTMLInputElement).checked).toBe(true);
  fireEvent.change(name, { target: { value: "Managed Worker" } });
  expect(state.saved).not.toHaveBeenCalled();
  fireEvent.submit(name.closest("form")!);
  await waitFor(() => expect(state.saved).toHaveBeenCalledWith({ kind: "managed", managedWorkerId: "saved-sponsorship", managedOrganizationId: "actual-employer", userId: 42, name: "Managed Worker" }));
  const call = vi.mocked(fetch).mock.calls.find(([url]) => String(url).endsWith("/actual-employer/workers"))!;
  expect(JSON.parse(String(call[1]?.body))).toEqual({ name: "Managed Worker", role: "gatekeeper", siteIds: [3], sendInvitation: false });
  expect(vi.mocked(fetch).mock.calls.some(([url, init]) => String(url).includes("/contacts") && init?.method === "POST")).toBe(false);
});

it("does not advance a contracted worker after a failed server save", async () => {
  failManaged = true; render(<Flow />); fireEvent.click(screen.getByRole("button", { name: "Use contracted employee" }));
  fireEvent.click(await screen.findByRole("button", { name: "Add Contract Employee" }));
  fireEvent.submit(screen.getByLabelText("Employee name").closest("form")!);
  expect(await screen.findByText("Contract employee was not saved")).toBeTruthy();
  expect(state.saved).not.toHaveBeenCalled();
});

it("fails closed on permissions and missing authorized site context", () => {
  const view = render(<Flow canManage={false} />);
  expect(screen.queryByRole("button", { name: "Add direct employee" })).toBeNull();
  view.rerender(<Flow siteName="" />);
  expect(screen.queryByRole("button", { name: "Add direct employee" })).toBeNull();
  expect(screen.getByText(/unavailable in your current company/)).toBeTruthy();
});

it("returns to the persistent helper and resets the employee path on company context change", async () => {
  const view = render(<Flow />);
  fireEvent.click(screen.getByRole("button", { name: "Use existing direct employee" }));
  fireEvent.change(screen.getByLabelText("Direct employee"), { target: { value: "19" } });
  fireEvent.click(screen.getByRole("button", { name: "Return to Next Steps" }));
  expect(state.show).toHaveBeenCalledOnce();
  view.rerender(<Flow scope="company-8" />);
  expect(screen.queryByLabelText("Direct employee")).toBeNull();
});
