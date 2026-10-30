import { beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import ManagedSubcontractorEmployeesCard from "./managed-subcontractor-employees-card";
vi.mock("@workspace/api-client-react", () => ({ useGetVendor: () => ({ data: { name: "GateGo" } }), getGetVendorQueryKey: () => ["vendor"] }));
vi.mock("./ui/dialog", async importOriginal => ({ ...await importOriginal<typeof import("./ui/dialog")>(), Dialog: ({ open, children }: any) => open ? children : null }));
vi.mock("./vendor-edit-flyout", () => ({ VendorEditFlyout: ({ children, title }: any) => <section aria-label={title}>{children}</section> }));
vi.mock("./branded-checkbox", () => ({ BrandedCheckbox: ({ checked, onCheckedChange, ...props }: any) => <input type="checkbox" checked={checked} onChange={event => onCheckedChange(event.target.checked)} {...props} /> }));
vi.mock("./staff-enrollment-control", () => ({ default: () => <span>SEND</span> }));
const company = { id: "org", name: "StaffGO", status: "managed", workers: [] };
function mount(items: unknown[]) {
 const fetch = vi.fn(async (_url: string, init: any) => ({ ok: true, json: async () => init.method === "GET" ? { items, sites: [{ id: 3, name: "Main Gate" }] } : company }));
 vi.stubGlobal("fetch", fetch);
 render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })}><ManagedSubcontractorEmployeesCard vendorId={7} /></QueryClientProvider>);
 return fetch;
}
beforeEach(() => { cleanup(); vi.clearAllMocks(); });
async function expandContractors() {
 await waitFor(() => expect((screen.getByRole('button',{name:'Add Contractor'}) as HTMLButtonElement).disabled).toBe(false));
 fireEvent.click(screen.getByRole('button',{name:/^Vendor Managed/}));
}
it("Add Contractor creates only the managed company", async () => {
 const fetch = mount([]);
 await waitFor(() => expect((screen.getByRole("button", { name: "Add Contractor" }) as HTMLButtonElement).disabled).toBe(false));
 fireEvent.click(screen.getByRole("button", { name: "Add Contractor" }));
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
 await expandContractors();
 fireEvent.click(screen.getByRole("button", { name: "Add Contract Employee" }));
 expect((screen.getByLabelText('Assigned role') as HTMLSelectElement).value).toBe('gatekeeper');
 expect(screen.queryByLabelText('Staff type')).toBeNull();
 expect(screen.queryByText('Job')).toBeNull();
 expect(screen.queryByRole('option',{name:'Foreman'})).toBeNull();
 expect(screen.queryByRole('option',{name:'Dispatch'})).toBeNull();
 const name = screen.getByLabelText("Employee name");
 fireEvent.change(name, { target: { value: "Demo Gatekeeper" } });
 fireEvent.click(screen.getByRole("checkbox", { name: "Main Gate" }));
 fireEvent.submit(name.closest("form")!);
 await waitFor(() => expect(fetch.mock.calls.some(([url]) => url.includes("/org/workers"))).toBe(true));
 const call = fetch.mock.calls.find(([url]) => url.includes("/org/workers"))!;
 expect(JSON.parse(call[1].body)).toEqual({ name: "Demo Gatekeeper", role: "gatekeeper", siteIds: [3], sendInvitation: false });
 expect(fetch.mock.calls.some(([url, init]) => url === "/api/vendors/7/managed-subcontractors" && init.method === "POST")).toBe(false);
});
it('uses the selected gate supervision role through the contractor flow',async()=>{
 const fetch=mount([company]);
 await expandContractors();
 fireEvent.click(screen.getByRole('button',{name:'Add Contract Employee'}));
 fireEvent.change(screen.getByLabelText('Assigned role'),{target:{value:'gate_supervisor'}});
 const name=screen.getByLabelText('Employee name');
 fireEvent.change(name,{target:{value:'Demo Supervisor'}});
 fireEvent.click(screen.getByRole('checkbox',{name:'Main Gate'}));
 fireEvent.submit(name.closest('form')!);
 await waitFor(()=>expect(fetch.mock.calls.some(([url])=>url.includes('/org/workers'))).toBe(true));
 const call=fetch.mock.calls.find(([url])=>url.includes('/org/workers'))!;
 expect(JSON.parse(call[1].body).role).toBe('gate_supervisor');
});
it('summarizes contractors and requires removal confirmation before ending the sponsorship',async()=>{
 const fetch=mount([{...company,workers:[{id:'worker',userId:42,name:'Bob Smith',email:'bob@example.invalid',role:'gatekeeper',status:'active',siteIds:[3]}]}]);
 fireEvent.click(await screen.findByRole('button',{name:'Vendor Managed (1)'}));
 fireEvent.click(screen.getByRole('button',{name:'StaffGO (1)'}));
 expect(screen.getByRole('button',{name:'Bob Smith'})).toBeTruthy();
 expect(screen.getByText('bob@example.invalid')).toBeTruthy();
 fireEvent.click(screen.getByRole('button',{name:'Remove Bob Smith'}));
 expect(fetch.mock.calls.some(([,init])=>init.method==='PATCH')).toBe(false);
 fireEvent.click(screen.getByRole('button',{name:'Remove'}));
 await waitFor(()=>expect(fetch.mock.calls.some(([,init])=>init.method==='PATCH')).toBe(true));
 const call=fetch.mock.calls.find(([,init])=>init.method==='PATCH')!;
 expect(call[0]).toBe('/api/vendors/7/managed-subcontractors/org/workers/worker');
 expect(JSON.parse(call[1].body)).toEqual({status:'terminated'});
});
it('adds under the selected contractor rather than defaulting to the first company',async()=>{
 const fetch=mount([company,{...company,id:'second',name:'SecondCo'}]);
 expect(screen.queryByRole('button',{name:'Add Contract Employee'})).toBeNull();
 await expandContractors();
 const heading=screen.getByRole('button',{name:'SecondCo (0)'});
 fireEvent.click(within(heading.closest('section')!).getByRole('button',{name:'Add Contract Employee'}));
 expect((screen.getByLabelText('Subcontractor company') as HTMLSelectElement).value).toBe('second');
 const name=screen.getByLabelText('Employee name');
 fireEvent.change(name,{target:{value:'New Worker'}});
 fireEvent.click(screen.getByRole('checkbox',{name:'Main Gate'}));
 fireEvent.submit(name.closest('form')!);
 await waitFor(()=>expect(fetch.mock.calls.some(([url])=>url.endsWith('/second/workers'))).toBe(true));
 expect(fetch.mock.calls.some(([url])=>url.endsWith('/org/workers'))).toBe(false);
});
