import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import StaffProfileDialog from "./staff-profile-dialog";
const state = vi.hoisted(() => ({ invalidate: vi.fn(), toast: vi.fn(), catalog: { version: 0, entries: [], canEdit: true } as any }));
vi.mock("@/lib/staff-role-catalog", async importOriginal => ({ ...await importOriginal<typeof import("@/lib/staff-role-catalog")>(), loadStaffRoleCatalog: async () => state.catalog }));
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
vi.mock("./staff-enrollment-control", () => ({ default: () => null }));
vi.mock("./employee-access-editor", () => ({ default: ({ operationalRoles, siteLocationIds }: any) => <div data-testid="saved-access">{JSON.stringify({ operationalRoles, siteLocationIds })}</div> }));
const person = { id: 21, vendorId: 7, firstName: "Connie", lastName: "Marsh", email: "connie@example.invalid", vendorRole: "gatekeeper", roles: ["Visitor Notifications"], pecCertification: true };
const access = { eligibleSites: [{ id: 3, name: "Main Gate" }], people: [{ vendorPeopleId: 21, isAdmin: false, operationalRoles: ["gatekeeper", "office"], siteLocationIds: [3] }] };
const response = (body: unknown, ok = true) => ({ ok, json: async () => body });
beforeEach(() => { cleanup(); vi.clearAllMocks(); state.catalog = { version: 0, entries: [], canEdit: true }; vi.stubGlobal("confirm", () => true); });
describe("shared staff profile", () => {
  it("loads one canonical employee, permissions, sites, and portal login", async () => {
    const fetch = vi.fn(async (url: string, _init?: any) => response(url.includes("people-access") ? access : url.includes("vendor-contacts") ? [person] : []));
    vi.stubGlobal("fetch", fetch);
    render(<StaffProfileDialog open onOpenChange={vi.fn()} vendorId={7} person={person} />);
    await screen.findByDisplayValue("Connie");
    expect((screen.getByLabelText("Assigned role") as HTMLSelectElement).value).toBe("Gatekeeper");
    expect(screen.queryByLabelText("Staff type")).toBeNull();
    expect(screen.queryByLabelText("Job title")).toBeNull();
    expect(screen.getByTestId("saved-access").textContent).toContain('"siteLocationIds":[3]');
    expect(screen.getByText("Portal login for 21")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));
    await waitFor(() => expect(fetch.mock.calls.some(([, init]: any) => init.method === "PATCH")).toBe(true));
    expect(fetch.mock.calls.some(([, init]: any) => init.method === "PUT")).toBe(false);
    const patch = fetch.mock.calls.find(([, init]: any) => init.method === "PATCH") as any;
    expect(JSON.parse(patch[1].body)).not.toHaveProperty("vendorRole");
    expect(JSON.parse(patch[1].body).jobTitle).toBe("Gatekeeper");
  });
  it("uses company role definitions in employee profiles and removes renamed aliases on save", async () => {
    state.catalog = { version: 1, canEdit: true, entries: [{ id: "common:Payroll", label: "Payroll Coordinator", group: "Accounting", aliases: ["Payroll"] }, { id: "custom", label: "Travel Coordinator", group: "Office" }] };
    const employee = { ...person, jobTitle: "Payroll", vendorRole: "office", roles: ["Office Staff", "Payroll"] };
    const officeAccess = { ...access, people: [{ ...access.people[0], operationalRoles: ["office"] }] };
    const fetch = vi.fn(async (url: string, init: any) => response(init.method === "PATCH" ? { id: 21 } : url.includes("people-access") ? officeAccess : url.includes("vendor-contacts") ? [employee] : []));
    vi.stubGlobal("fetch", fetch);
    render(<StaffProfileDialog open onOpenChange={vi.fn()} vendorId={7} person={employee} />);
    await screen.findByDisplayValue("Payroll Coordinator");
    fireEvent.change(screen.getByLabelText("Add assigned role"), { target: { value: "Travel Coordinator" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));
    await waitFor(() => expect(fetch.mock.calls.some(([, init]) => init.method === "PATCH")).toBe(true));
    const payload = JSON.parse(fetch.mock.calls.find(([, init]) => init.method === "PATCH")![1].body);
    expect(payload.roles).toContain("Travel Coordinator"); expect(payload.roles).toContain("Payroll Coordinator"); expect(payload.roles).not.toContain("Payroll");
    expect(fetch.mock.calls.some(([, init]) => init.method === "PUT")).toBe(false);
  });
  it("fails closed when current permissions cannot load", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => response({ error: "Access denied" }, false)));
    render(<StaffProfileDialog open onOpenChange={vi.fn()} vendorId={7} person={person} />);
    expect((await screen.findByRole("alert")).textContent).toContain("Access denied");
    expect(screen.queryByRole("button", { name: "Save Changes" })).toBeNull();
  });
  it("adds gate supervision in an existing scheduler profile without losing office access or sites", async () => {
    const scheduler={...person,vendorRole:'office',jobTitle:'Scheduler',roles:['Office Staff','Scheduler']};
    const officeAccess={...access,people:[{...access.people[0],operationalRoles:['office']}]};
    vi.stubGlobal("fetch", vi.fn(async url => response(url.includes('people-access')?officeAccess:url.includes('vendor-contacts')?[scheduler]:[])));
    render(<StaffProfileDialog open onOpenChange={vi.fn()} vendorId={7} person={scheduler} />);
    await screen.findByLabelText("Assigned role");
    fireEvent.change(screen.getByLabelText("Add assigned role"), { target: { value: "Gate Supervisor" } });
    expect(screen.getByRole('button',{name:'Remove role Gate Supervisor'})).toBeTruthy();
    expect((screen.getByLabelText("Assigned role") as HTMLSelectElement).value).toBe("Scheduler");
    expect(screen.getByTestId("saved-access").textContent).toContain('"operationalRoles":["office","gatekeeper","gate_supervisor"]');
    expect(screen.getByTestId("saved-access").textContent).toContain('"siteLocationIds":[3]');
  });
  it('adds and removes a common role compactly and preserves the original employee record',async()=>{
    const fetch=vi.fn(async(url:string,init:any)=>response(init.method==='PATCH'?{id:21}:url.includes('people-access')?access:url.includes('vendor-contacts')?[person]:[]));
    vi.stubGlobal('fetch',fetch);
    render(<StaffProfileDialog open onOpenChange={vi.fn()} vendorId={7} person={person}/>);
    await screen.findByLabelText('Add assigned role');
    expect(screen.queryByRole('checkbox',{name:'Payroll'})).toBeNull();
    fireEvent.change(screen.getByLabelText('Add assigned role'),{target:{value:'Bookkeeper'}});
    expect(screen.getByRole('button',{name:'Remove role Bookkeeper'})).toBeTruthy();
    fireEvent.click(screen.getByRole('button',{name:'Remove role Bookkeeper'}));
    fireEvent.click(screen.getByRole('button',{name:'Save Changes'}));
    await waitFor(()=>expect(fetch.mock.calls.some(([,init])=>init.method==='PATCH')).toBe(true));
    const payload=JSON.parse(fetch.mock.calls.find(([,init])=>init.method==='PATCH')![1].body);
    expect(payload.roles).not.toContain('Bookkeeper');
    expect(payload.firstName).toBe('Connie');
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
    expect((screen.getByLabelText("Assigned role") as HTMLSelectElement).value).toBe("Gatekeeper");
    fireEvent.change(screen.getByLabelText("Last name"), { target: { value: "Staff" } });
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "new@example.invalid" } });
    fireEvent.submit(screen.getByTestId("shared-staff-profile"));
    await screen.findByRole("alert");
    fireEvent.submit(screen.getByTestId("shared-staff-profile"));
    await waitFor(() => expect(fetch.mock.calls.filter(([, init]) => init.method === "PUT")).toHaveLength(2));
    expect(fetch.mock.calls.filter(([, init]) => init.method === "POST")).toHaveLength(1);
    expect(fetch.mock.calls.filter(([, init]) => init.method === "PATCH")).toHaveLength(1);
  });
  it.each([
    ['Team Member','Office Staff',['office']],
    ['Office Staff','Office Staff',['office']],
    ['Gatekeeper','Gatekeeper',['gatekeeper']],
    ['Gate Supervisor','Gatekeeper',['gatekeeper','gate_supervisor']],
    ['Scheduler','Office Staff',['office']],
  ] as const)('prefills %s and saves its corresponding title and access',async(role,type,permissions)=>{
    const fetch=vi.fn(async(_url:string,init:any)=>response(init.method==='POST'?{id:30}:init.method==='PUT'?{}:access));
    vi.stubGlobal('fetch',fetch);
    render(<StaffProfileDialog open onOpenChange={vi.fn()} vendorId={7} defaultType={type} defaultRole={role} operationCategories={['gate']}/>);
    const assignedRole=await screen.findByLabelText('Assigned role') as HTMLSelectElement;
    expect(assignedRole.value).toBe(role);
    expect(screen.queryByLabelText('Staff type')).toBeNull();
    expect(screen.queryByLabelText('Job title')).toBeNull();
    expect(screen.queryByText('Operational permissions')).toBeNull();
    expect(screen.queryByText('Additional assigned roles')).toBeNull();
    expect(screen.queryByText('Employee photo')).toBeNull();
    expect(screen.queryByRole('checkbox',{name:'PEC certified'})).toBeNull();
    expect(screen.queryByRole('checkbox',{name:'Receive site visitor notifications'})).toBeNull();
    expect(screen.queryByRole('option',{name:'Foreman'})).toBeNull();
    expect(screen.queryByRole('option',{name:'Dispatch'})).toBeNull();
    fireEvent.change(screen.getByLabelText('First name'),{target:{value:'New'}});
    fireEvent.change(screen.getByLabelText('Last name'),{target:{value:'Worker'}});
    fireEvent.change(screen.getByLabelText('Email'),{target:{value:'new@example.invalid'}});
    fireEvent.submit(screen.getByTestId('shared-staff-profile'));
    await waitFor(()=>expect(fetch.mock.calls.some(([,init])=>init.method==='PUT')).toBe(true));
    expect(JSON.parse(fetch.mock.calls.find(([,init])=>init.method==='POST')![1].body).jobTitle).toBe(role);
    expect(JSON.parse(fetch.mock.calls.find(([,init])=>init.method==='POST')![1].body).roles.includes('Administrative Team')).toBe(role==='Team Member');
    expect(JSON.parse(fetch.mock.calls.find(([,init])=>init.method==='PUT')![1].body).operationalRoles).toEqual(permissions);
  });
});
