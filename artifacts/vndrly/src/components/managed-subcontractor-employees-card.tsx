import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Users } from "lucide-react";
import { useGetVendor, getGetVendorQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./ui/table";
import { Dialog } from "./ui/dialog";
import { VendorEditFlyout } from "./vendor-edit-flyout";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { BrandedCheckbox } from "./branded-checkbox";

type Role = "gatekeeper" | "gate_supervisor";
type Worker = { id: string; userId: number; name: string; email: string; role: Role | null; status: string; siteIds: number[]; invitationState?: string | null };
type Company = { id: string; name: string; status: string; workers: Worker[] };
type Data = { items: Company[]; sites: { id: number; name: string }[] };
type Editor = { companyId: string; companyName: string; workerId?: string; name: string; email: string; role: Role; siteIds: number[]; sendInvitation: boolean };
async function request<T>(url: string, method = "GET", body?: unknown): Promise<T> {
 const response = await fetch(url, { method, credentials: "include", ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }) });
 const data = await response.json(); if (!response.ok) throw new Error(data.error ?? "Unable to save contractor"); return data;
}
export default function ManagedSubcontractorEmployeesCard({ vendorId }: { vendorId: number }) {
 const cache = useQueryClient(), base = `/api/vendors/${vendorId}/managed-subcontractors`;
 const query = useQuery({ queryKey: ["vendor-managed-subcontractors", vendorId], queryFn: () => request<Data>(base) });
 const { data: vendor } = useGetVendor(vendorId, { query: { enabled: !!vendorId, queryKey: getGetVendorQueryKey(vendorId) } });
 const [editor, setEditor] = useState<Editor | null>(null);
 const [companyEditor, setCompanyEditor] = useState(false), [companyName, setCompanyName] = useState("");
 const refresh = () => cache.invalidateQueries({ predicate: q => /managed-subcontractors|staffing|workforce|shift-plans/.test(JSON.stringify(q.queryKey)) });
 const mutation = useMutation({ mutationFn: async (value: Editor) => {
   let companyId = value.companyId;
   if (!companyId) throw new Error("Add or select a contractor company first");
   return request(`${base}/${companyId}/workers${value.workerId ? `/${value.workerId}` : ""}`, value.workerId ? "PATCH" : "POST", value.workerId ? { role: value.role, siteIds: value.siteIds } : { name: value.name.trim(), ...(value.email.trim() ? { email: value.email.trim() } : {}), role: value.role, siteIds: value.siteIds, sendInvitation: value.sendInvitation });
 }, onSuccess: async () => { setEditor(null); await refresh(); }, onError: () => { void refresh(); } });
 const companyMutation = useMutation({ mutationFn: async () => {
   if (query.data?.items.some(company => company.name.trim().toLowerCase() === companyName.trim().toLowerCase())) throw new Error("This contractor company is already registered here");
   return request<Company>(base, "POST", { name: companyName.trim() });
 }, onSuccess: async () => { setCompanyEditor(false); setCompanyName(""); await refresh(); } });
 const rows = (query.data?.items ?? []).flatMap(company => company.workers.map(worker => ({ ...worker, company })));
 const active = rows.filter(worker => worker.status === "active");
 const close = () => { if (!mutation.isPending) { setEditor(null); mutation.reset(); } };
 const openNew = () => { mutation.reset(); setEditor({ companyId: query.data?.items.find(company => company.status === "managed")?.id ?? "", companyName: "", name: "", email: "", role: "gatekeeper", siteIds: [], sendInvitation: false }); };
 return <Card data-testid="managed-subcontractor-employees-section">
  <CardHeader className="flex flex-row flex-wrap justify-between items-center gap-2">
   <CardTitle className="flex items-center gap-2"><Users className="w-5 h-5 text-[var(--brand-primary)]" />Vendor Managed Employees ({active.length})</CardTitle>
   <div className="flex flex-wrap gap-2"><button type="button" className="vendor-mini-card-button" onClick={() => { companyMutation.reset(); setCompanyName(""); setCompanyEditor(true); }} disabled={query.isLoading || query.isError}><Plus className="w-4 h-4" />Add Contractor</button><button type="button" className="vendor-mini-card-button" onClick={openNew} disabled={!query.data?.items.some(company => company.status === "managed")}><Plus className="w-4 h-4" />Add Contracted Employee</button></div>
  </CardHeader>
  <CardContent className="p-0">
   <p className="px-6 pb-4 text-sm text-muted-foreground">Contracted employees working under {vendor?.name ?? "your company"}. Add a contractor company first, then add its employees. Enrollment and verification can follow later.</p>
   {query.data?.items.length ? <p className="px-6 pb-4 text-sm">Contractor companies: {query.data.items.map(company => company.name).join(", ")}</p> : null}
   {query.isLoading ? <p className="p-6">Loading contractors…</p> : query.isError ? <p role="alert" className="p-6">Unable to load contractors. <button type="button" onClick={() => void query.refetch()}>Retry</button></p> : !rows.length ? <p className="p-6 text-sm text-muted-foreground">No contracted employees added yet</p> : <Table><TableHeader><TableRow><TableHead>Company</TableHead><TableHead>Name</TableHead><TableHead>Job</TableHead><TableHead>Role</TableHead><TableHead>Site access</TableHead><TableHead>Enrollment</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
    <TableBody>{rows.map(worker => <TableRow key={worker.id} data-testid={`row-contractor-${worker.userId}`} className="cursor-pointer" onClick={() => { mutation.reset(); setEditor({ companyId: worker.company.id, companyName: worker.company.name, workerId: worker.id, name: worker.name, email: worker.email.endsWith("@unenrolled.invalid") ? "" : worker.email, role: worker.role ?? "gatekeeper", siteIds: [...worker.siteIds], sendInvitation: false }); }}>
     <TableCell><span className="font-medium">{worker.company.name}</span></TableCell>
     <TableCell>{worker.name}</TableCell><TableCell>Gatekeeper</TableCell><TableCell>{worker.role === "gate_supervisor" ? "Gate Supervisor" : "Gate"}</TableCell>
     <TableCell>{worker.siteIds.map(id => query.data?.sites.find(site => site.id === id)?.name).filter(Boolean).join(", ") || "No sites assigned"}</TableCell><TableCell>{worker.invitationState === "claimed" ? "Enrolled" : "Not enrolled"}</TableCell><TableCell>{worker.status === "active" ? "In workforce pool" : worker.status}</TableCell>
    </TableRow>)}</TableBody></Table>}
  </CardContent>
  <Dialog open={companyEditor} onOpenChange={value => { if (!companyMutation.isPending) setCompanyEditor(value); }}><VendorEditFlyout title="Add Contractor" logoSrc={vendor?.logoSquareUrl || vendor?.logoUrl || undefined} logoAlt={`${vendor?.name ?? "Company"} logo`} onClose={() => { if (!companyMutation.isPending) setCompanyEditor(false); }}>
    <form className="space-y-4" onSubmit={event => { event.preventDefault(); companyMutation.mutate(); }}>
      <p className="text-sm text-muted-foreground">Register a subcontractor company supplying workers to {vendor?.name ?? "your company"}. It does not need to be enrolled or verified yet.</p>
      <div><Label htmlFor="managed-company-name">Company name</Label><Input id="managed-company-name" required maxLength={200} value={companyName} onChange={event => setCompanyName(event.target.value)} /></div>
      {companyMutation.isError && <p role="alert" className="text-red-300">{companyMutation.error.message}</p>}
      <div className="flex gap-2"><button className="vendor-mini-card-button" type="submit" disabled={companyMutation.isPending || !companyName.trim()}>Add Contractor</button><button type="button" className="vendor-mini-card-button" disabled={companyMutation.isPending} onClick={() => setCompanyEditor(false)}>Cancel</button></div>
    </form>
  </VendorEditFlyout></Dialog>
  <Dialog open={!!editor} onOpenChange={value => { if (!value) close(); }}><VendorEditFlyout title={editor?.workerId ? "Contracted Employee Profile" : "Add Contracted Employee"} logoSrc={vendor?.logoSquareUrl || vendor?.logoUrl || undefined} logoAlt={`${vendor?.name ?? "Company"} logo`} onClose={close}>
   {editor && <form className="space-y-4" onSubmit={event => { event.preventDefault(); mutation.mutate(editor); }}>
    <div><Label htmlFor="contractor-company">Subcontractor company</Label><select id="contractor-company" className="staff-type-select" disabled={!!editor.workerId} value={editor.companyId} onChange={event => setEditor({ ...editor, companyId: event.target.value })}>{query.data?.items.map(company => <option key={company.id} value={company.id}>{company.name}</option>)}</select></div>
    <div><Label htmlFor="contractor-name">Employee name</Label><Input id="contractor-name" required readOnly={!!editor.workerId} value={editor.name} onChange={event => setEditor({ ...editor, name: event.target.value })} /></div>
    <div><Label>Job</Label><p className="mt-1">Gatekeeper</p></div>
    <div><Label htmlFor="contractor-role">Assigned role</Label><select id="contractor-role" className="staff-type-select" value={editor.role} onChange={event => setEditor({ ...editor, role: event.target.value as Role })}><option value="gatekeeper">Gate</option><option value="gate_supervisor">Gate Supervisor</option></select></div>
    <fieldset><legend>Site access</legend><p className="text-xs text-muted-foreground mb-2">Choose the sites where this contractor may staff a gate.</p>{query.data?.sites.map(site => <label key={site.id} className="flex gap-2 items-center min-h-11"><BrandedCheckbox checked={editor.siteIds.includes(site.id)} onCheckedChange={checked => setEditor({ ...editor, siteIds: checked ? [...editor.siteIds, site.id] : editor.siteIds.filter(id => id !== site.id) })} />{site.name}</label>)}</fieldset>
    {!editor.workerId && <><div><Label htmlFor="contractor-email">Email (optional)</Label><Input id="contractor-email" type="email" value={editor.email} onChange={event => setEditor({ ...editor, email: event.target.value, sendInvitation: event.target.value ? editor.sendInvitation : false })} /></div><label className="flex gap-2 items-center"><BrandedCheckbox checked={editor.sendInvitation} disabled={!editor.email.trim()} onCheckedChange={checked => setEditor({ ...editor, sendInvitation: !!checked })} />Send an enrollment invitation</label><p className="text-xs text-muted-foreground">Enrollment is optional. Adding this contractor alone sends no invitation and does not verify their qualifications.</p></>}
    {mutation.isError && <p role="alert" className="text-red-300">{mutation.error.message}</p>}
    <div className="flex gap-2"><button type="submit" className="vendor-mini-card-button" disabled={mutation.isPending || !editor.siteIds.length}>{mutation.isPending ? "Saving…" : editor.workerId ? "Save Changes" : "Add Contracted Employee"}</button><button type="button" className="vendor-mini-card-button" disabled={mutation.isPending} onClick={close}>Cancel</button></div>
   </form>}
  </VendorEditFlyout></Dialog>
 </Card>;
}
