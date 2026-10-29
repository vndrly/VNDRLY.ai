import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import StaffProfileDialog from "./staff-profile-dialog";
const state = vi.hoisted(() => ({ invalidate: vi.fn(), toast: vi.fn() }));
vi.mock("@tanstack/react-query", () => ({ useQueryClient: () => ({ invalidateQueries: state.invalidate }) }));
vi.mock("@workspace/api-client-react", () => ({ useGetVendor: () => ({ data: { name: "GateGo", logoSquareUrl: "/logo.png" } }), getGetVendorQueryKey: (id: number) => ["vendor", id] }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: state.toast }) }));
vi.mock("@/hooks/use-unsaved-changes", () => ({ useUnsavedChanges: () => {} }));
vi.mock("@/components/ui/dialog", () => ({ Dialog: ({ open, children }: any) => open ? children : null }));
vi.mock("./vendor-edit-flyout", () => ({ VendorEditFlyout: ({ children, title }: any) => <section aria-label={title}>{children}</section> }));
vi.mock("./branded-checkbox", () => ({ BrandedCheckbox: ({ checked, onCheckedChange, ...props }: any) => <input type="checkbox" checked={checked} onChange={e => onCheckedChange?.(e.target.checked)} {...props} /> }));
vi.mock("./photo-upload-field", () => ({ PhotoUploadField: () => null }));
vi.mock("./certifications-section", () => ({ default: () => null }));
vi.mock("./employee-portal-login-fields", () => ({ default: ({ employeeId }: any) => <div>Portal login for {employeeId}</div> }));
vi.mock("./employee-access-editor", () => ({ default: ({ operationalRoles, siteLocationIds }: any) => <div data-testid="saved-access">{JSON.stringify({ operationalRoles, siteLocationIds })}</div> }));
const person = { id: 21, vendorId: 7, firstName: "Connie", lastName: "Marsh", email: "connie@example.invalid", vendorRole: "gatekeeper", roles: ["Visitor Notifications"], pecCertification: true };
const access = { eligibleSites: [{ id: 3, name: "Main Gate" }], people: [{ vendorPeopleId: 21, isAdmin: false, operationalRoles: ["gatekeeper", "office"], siteLocationIds: [3] }] };
const response = (body: unknown, ok = true) => ({ ok, json: async () => body });
beforeEach(() => { cleanup(); vi.clearAllMocks(); vi.stubGlobal("confirm", () => true); });
describe("shared staff profile", () => {
  it("loads one canonical employee, permissions, sites, and portal login", async () => {
    const fetch = vi.fn(async (url: string, _init?: any) => response(url.includes("people-access") ? access : url.includes("vendor-contacts") ? [person] : []));
    vi.stubGlobal("fetch", fetch);
    render(<StaffProfileDialog open onOpenChange={vi.fn()} vendorId={7} person={person} />);
    await screen.findByDisplayValue("Connie");
    expect((screen.getByLabelText("Staff type") as HTMLSelectElement).value).toBe("Gatekeeper");
    expect(screen.getByTestId("saved-access").textContent).toContain('"siteLocationIds":[3]');
    expect(screen.getByText("Portal login for 21")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));
    await waitFor(() => expect(fetch.mock.calls.some(([, init]: any) => init.method === "PATCH")).toBe(true));
    expect(fetch.mock.calls.some(([, init]: any) => init.method === "PUT")).toBe(false);
    const patch = fetch.mock.calls.find(([, init]: any) => init.method === "PATCH") as any;
    expect(JSON.parse(patch[1].body)).not.toHaveProperty("vendorRole");
  });
  it("fails closed when current permissions cannot load", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => response({ error: "Access denied" }, false)));
    render(<StaffProfileDialog open onOpenChange={vi.fn()} vendorId={7} person={person} />);
    expect((await screen.findByRole("alert")).textContent).toContain("Access denied");
    expect(screen.queryByRole("button", { name: "Save Changes" })).toBeNull();
  });
  it("adds gate supervision to office staff without changing their staff type or sites", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => response(access)));
    render(<StaffProfileDialog open onOpenChange={vi.fn()} vendorId={7} defaultType="Office Staff" />);
    await screen.findByLabelText("Staff type");
    fireEvent.click(screen.getByRole("checkbox", { name: "Gate Supervisor" }));
    expect((screen.getByLabelText("Staff type") as HTMLSelectElement).value).toBe("Office Staff");
    expect(screen.getByTestId("saved-access").textContent).toContain('"operationalRoles":["office","gate_supervisor"]');
    expect(screen.getByTestId("saved-access").textContent).toContain('"siteLocationIds":[]');
  });
  it("retries permission failure against the created ID, never another POST", async () => {
    let failAccess = true;
    const fetch = vi.fn(async (url: string, init: any) => {
      if (init.method === "POST") return response({ id: 30 });
      if (init.method === "PUT") { const ok = !failAccess; failAccess = false; return response(ok ? {} : { error: "Try again" }, ok); }
      if (init.method === "PATCH") return response({ id: 30 });
      return response(access);
    });
    vi.stubGlobal("fetch", fetch);
    render(<StaffProfileDialog open onOpenChange={vi.fn()} vendorId={7} defaultType="Gatekeeper" />);
    fireEvent.change(await screen.findByLabelText("First name"), { target: { value: "New" } });
    fireEvent.change(screen.getByLabelText("Last name"), { target: { value: "Staff" } });
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "new@example.invalid" } });
    fireEvent.submit(screen.getByTestId("shared-staff-profile"));
    await screen.findByRole("alert");
    fireEvent.submit(screen.getByTestId("shared-staff-profile"));
    await waitFor(() => expect(fetch.mock.calls.filter(([, init]) => init.method === "PUT")).toHaveLength(2));
    expect(fetch.mock.calls.filter(([, init]) => init.method === "POST")).toHaveLength(1);
    expect(fetch.mock.calls.filter(([, init]) => init.method === "PATCH")).toHaveLength(1);
  });
});
