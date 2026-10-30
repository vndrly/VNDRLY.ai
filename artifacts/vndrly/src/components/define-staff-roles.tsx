import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { UserCheck } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "./ui/card";
import { Dialog } from "./ui/dialog";
import { VendorEditFlyout } from "./vendor-edit-flyout";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { STAFF_ROLE_DEFINITIONS } from "@/lib/staff-profile";
import { catalogStaffRoles, loadStaffRoleCatalog, staffRoleCatalogKey, type CompanyStaffRoleCatalog } from "@/lib/staff-role-catalog";
import "./define-staff-roles.css";

export default function DefineStaffRoles({ vendorId, operations, logoSrc, companyName }: { vendorId: number; operations: readonly string[]; logoSrc?: string; companyName?: string }) {
  const cache = useQueryClient();
  const query = useQuery({ queryKey: staffRoleCatalogKey(vendorId), queryFn: () => loadStaffRoleCatalog(vendorId) });
  const roles = catalogStaffRoles(query.data);
  const [open, setOpen] = useState(false), [selected, setSelected] = useState(""), [label, setLabel] = useState(""), [group, setGroup] = useState("Office & Administration"), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const choose = (id: string) => { const role = roles.find(value => value.id === id); setSelected(id); setLabel(role?.label ?? ""); setGroup(role?.group ?? "Office & Administration"); setError(""); };
  const save = async (event: React.FormEvent) => {
    event.preventDefault(); if (!query.data || busy) return;
    const cleanLabel = label.trim(), cleanGroup = group.trim();
    if (roles.some(role => role.id !== selected && role.label.toLowerCase() === cleanLabel.toLowerCase())) { setError("That role already exists."); return; }
    const next = { id: selected || crypto.randomUUID(), label: cleanLabel, group: cleanGroup };
    const entries = selected ? roles.map(role => role.id === selected ? next : role) : [...roles, next];
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/vendors/${vendorId}/staff-roles`, { method: "PUT", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ version: query.data.version, entries }) });
      const data = await response.json();
      if (!response.ok) { if (response.status === 409) void query.refetch(); throw new Error(data.error ?? "Unable to save staffing role"); }
      cache.setQueryData<CompanyStaffRoleCatalog>(staffRoleCatalogKey(vendorId), data); setOpen(false);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to save staffing role"); }
    finally { setBusy(false); }
  };
  const platform = STAFF_ROLE_DEFINITIONS.filter(role => role.area !== "office" && operations.includes(role.area));
  return <Card data-testid="define-roles-card" className="define-staff-roles">
    <CardHeader><CardTitle><UserCheck size={20} />Define Roles</CardTitle>{query.data?.canEdit && <button type="button" className="vendor-mini-card-button" onClick={() => { choose(""); setOpen(true); }}>Add/Edit Roles</button>}</CardHeader>
    <CardContent>
      {query.isPending ? <p>Loading roles…</p> : query.error ? <p role="alert">{query.error.message} <button type="button" onClick={() => void query.refetch()}>Retry</button></p> : <>
        <details><summary>Staff positions ({roles.length})</summary><div className="staff-role-directory">{roles.map(role => <button key={role.id} type="button" disabled={!query.data?.canEdit} onClick={() => { choose(role.id); setOpen(true); }}>{role.label}</button>)}</div></details>
        {platform.length > 0 && <details><summary>VNDRLY operational roles ({platform.length})</summary><p className="staff-role-platform">{platform.map(role => role.label).join(" · ")}</p></details>}
      </>}
    </CardContent>
    <Dialog open={open} onOpenChange={value => { if (!busy) setOpen(value); }}><VendorEditFlyout title="Add/Edit Roles" logoSrc={logoSrc} logoAlt={`${companyName ?? "Company"} logo`} onClose={() => { if (!busy) setOpen(false); }}>
      <form className="staff-role-form" onSubmit={save}>
        <div><Label htmlFor="staff-role-existing">Staff position</Label><select id="staff-role-existing" value={selected} onChange={event => choose(event.target.value)}><option value="">Create new role</option>{roles.map(role => <option key={role.id} value={role.id}>{role.label}</option>)}</select></div>
        <div><Label htmlFor="staff-role-name">Role name</Label><Input id="staff-role-name" required maxLength={80} value={label} onChange={event => setLabel(event.target.value)} /></div>
        <div><Label htmlFor="staff-role-group">Group</Label><Input id="staff-role-group" required maxLength={80} list="staff-role-groups" value={group} onChange={event => setGroup(event.target.value)} /><datalist id="staff-role-groups">{[...new Set(roles.map(role => role.group))].map(value => <option key={value} value={value} />)}</datalist></div>
        {error && <p role="alert">{error}</p>}
        <div className="staff-role-actions"><button type="submit" className="vendor-mini-card-button" disabled={busy}>{busy ? "Saving…" : "Save Role"}</button><button type="button" className="vendor-mini-card-button" disabled={busy} onClick={() => setOpen(false)}>Cancel</button></div>
      </form>
    </VendorEditFlyout></Dialog>
  </Card>;
}
