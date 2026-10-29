import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useGetVendor, getGetVendorQueryKey } from "@workspace/api-client-react";
import { Dialog } from "@/components/ui/dialog";
import { VendorEditFlyout } from "./vendor-edit-flyout";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { BrandedCheckbox } from "./branded-checkbox";
import EmployeeAccessEditor, { type EmployeeOperationalRole } from "./employee-access-editor";
import EmployeePortalLoginFields from "./employee-portal-login-fields";
import { PhotoUploadField } from "./photo-upload-field";
import CertificationsSection from "./certifications-section";
import { useToast } from "@/hooks/use-toast";
import { useUnsavedChanges } from "@/hooks/use-unsaved-changes";
import { stripPhone, handlePhoneInput } from "@/lib/utils";
import { STAFF_TYPES, STAFF_DUTIES, staffTypeFor, staffRolesFor, defaultStaffAccess, legacyStaffAccess, staffAccessFor, type StaffType } from "@/lib/staff-profile";

export type StaffProfilePerson = {
  id: number; vendorId?: number; accountUserId?: number; isCompanyAdmin?: boolean; firstName: string; lastName: string; email: string;
  phone?: string | null; jobTitle?: string | null; vendorRole?: string | null;
  roles?: string[] | null; photoUrl?: string | null; pecCertification?: boolean; pecExpirationDate?: string | null;
};
type Access = { isAdmin: boolean; operationalRoles: EmployeeOperationalRole[]; siteLocationIds: number[] };
type Form = { firstName: string; lastName: string; email: string; phone: string; jobTitle: string; photoUrl: string | null; pecCertification: boolean; pecExpirationDate: string; roles: string[]; vendorRole: string; staffType: StaffType; duties: string[] };
const jsonRequest = async (url: string, method = "GET", body?: unknown) => {
  const response = await fetch(url, { method, credentials: "include", headers: { "Content-Type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.error ?? "Unable to save employee profile");
  return data;
};

export default function StaffProfileDialog({ open, onOpenChange, vendorId, person, defaultType = "Office Staff", canVerify = false }: {
  open: boolean; onOpenChange: (open: boolean) => void; vendorId: number; person?: StaffProfilePerson | null; defaultType?: StaffType; canVerify?: boolean;
}) {
  const cache = useQueryClient(), { toast } = useToast();
  const { data: vendor } = useGetVendor(vendorId, { query: { enabled: open && !!vendorId, queryKey: getGetVendorQueryKey(vendorId) } });
  const [form, setForm] = useState<Form | null>(null), [access, setAccess] = useState<Access | null>(null);
  const [sites, setSites] = useState<Array<{ id: number; name: string }>>([]);
  const [employeeId, setEmployeeId] = useState<number | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const baseline = useRef(""), originalAccess = useRef<Access | null>(null), [functionName, setFunctionName] = useState("");
  const dirty = !!form && baseline.current !== JSON.stringify({ form, access });
  useUnsavedChanges(open && dirty);
  const invalidate = () => { void cache.invalidateQueries({ predicate: q => /field-employees|vendor-contacts|contacts|people-access|org-members/.test(JSON.stringify(q.queryKey)) }); };
  const close = (value: boolean) => { if (!value && busy) return; if (!value && dirty && !window.confirm("Discard unsaved employee profile changes?")) return; onOpenChange(value); };

  useEffect(() => {
    if (!open) return;
    let live = true;
    setForm(null); setAccess(null); setError(""); setEmployeeId(person?.id || null); setFunctionName("");
    void (async () => {
      try {
        const accessData = await jsonRequest(`/api/vendors/${vendorId}/people-access`);
        let saved = person;
        if (person?.id) {
          const [office, field] = await Promise.all([
            jsonRequest(`/api/vendor-contacts?vendorId=${vendorId}`),
            jsonRequest(`/api/field-employees?vendorId=${vendorId}&includeInactive=true`),
          ]);
          saved = [...office, ...field].find((row: StaffProfilePerson) => row.id === person.id && row.vendorId === vendorId);
          if (!saved) throw new Error("This employee is no longer available in this company.");
        }
        const type = saved ? staffTypeFor(saved) : defaultType;
        const stored = accessData.people.find((row: { vendorPeopleId: number }) => row.vendorPeopleId === saved?.id);
        const nextAccess: Access = stored ?? { isAdmin: !!saved?.isCompanyAdmin || saved?.vendorRole === "admin", operationalRoles: saved ? legacyStaffAccess(saved.vendorRole) : defaultStaffAccess(type), siteLocationIds: [] };
        const duties = (saved?.roles ?? []).filter(role => STAFF_DUTIES.includes(role as typeof STAFF_DUTIES[number]));
        if (nextAccess.operationalRoles.includes("foreman") && !duties.includes("Foreman")) duties.push("Foreman");
        if (nextAccess.operationalRoles.includes("gate_supervisor") && !duties.includes("Gate Supervisor")) duties.push("Gate Supervisor");
        const nextForm: Form = { firstName: saved?.firstName ?? "", lastName: saved?.lastName ?? "", email: saved?.email ?? "", phone: saved?.phone ?? "", jobTitle: saved?.jobTitle ?? "", photoUrl: saved?.photoUrl ?? null, pecCertification: saved?.pecCertification ?? false, pecExpirationDate: saved?.pecExpirationDate ?? "", roles: saved?.roles ?? [], vendorRole: saved?.vendorRole ?? (type === "Office Staff" ? "office" : type === "Gatekeeper" ? "gatekeeper" : "field"), staffType: type, duties };
        if (!live) return;
        setSites(accessData.eligibleSites); setAccess(nextAccess); originalAccess.current = nextAccess;
        setForm(nextForm); baseline.current = JSON.stringify({ form: nextForm, access: nextAccess });
      } catch (cause) { if (live) setError(cause instanceof Error ? cause.message : "Unable to load employee profile"); }
    })();
    return () => { live = false; };
  }, [open, vendorId, person?.id, defaultType]);

  const save = async (event: React.FormEvent) => {
    event.preventDefault(); if (!form || !access) return;
    setBusy(true); setError("");
    let savedId = employeeId;
    let profileSaved = false;
    try {
      const payload = { jobTitle: form.jobTitle, firstName: form.firstName, lastName: form.lastName, email: form.email, phone: stripPhone(form.phone) || null, photoUrl: form.photoUrl, pecCertification: form.pecCertification, pecExpirationDate: form.pecExpirationDate || null, roles: staffRolesFor(form.staffType, form.duties, form.roles) };
      // Do not submit the stale legacy role on edits: access replacement
      // maintains its projection and existing membership privileges.
      const path = !savedId && person?.accountUserId ? `/api/vendors/${vendorId}/staff-profile-from-account/${person.accountUserId}` : `/api/vendors/${vendorId}/contacts${savedId ? `/${savedId}` : ""}`;
      const result = await jsonRequest(path, savedId ? "PATCH" : "POST", savedId ? payload : { ...payload, vendorRole: form.staffType === "Office Staff" ? "office" : form.staffType === "Gatekeeper" ? "gatekeeper" : "field" });
      if (!Number.isSafeInteger(result?.id) || result.id <= 0) throw new Error("The server did not return the saved profile ID. Refresh before retrying.");
      savedId = result.id; profileSaved = true; setEmployeeId(savedId);
      if (!person?.id || JSON.stringify(access) !== JSON.stringify(originalAccess.current)) {
        await jsonRequest(`/api/vendors/${vendorId}/people/${savedId}/access`, "PUT", { operationalRoles: access.operationalRoles, siteLocationIds: access.siteLocationIds });
      }
      originalAccess.current = access; baseline.current = JSON.stringify({ form, access }); invalidate();
      toast({ title: person ? "Employee profile saved" : "Staff profile created" });
      // Stay open after creation so login and certifications use the same ID.
      if (person) onOpenChange(false);
    } catch (cause) {
      invalidate();
      setError(`${cause instanceof Error ? cause.message : "Unable to save"}${profileSaved ? ". Profile details were saved, but permissions were not saved. Review and retry; the same profile will be used." : ""}`);
    } finally { setBusy(false); }
  };

  const changeType = (type: StaffType) => {
    if (!form || !access) return;
    setAccess({ ...access, operationalRoles: staffAccessFor(type, form.duties, access.operationalRoles, form.staffType) });
    setForm({ ...form, staffType: type });
  };
  const toggleDuty = (duty: string) => {
    if (!form || !access) return;
    const duties = form.duties.includes(duty) ? form.duties.filter(value => value !== duty) : [...form.duties, duty];
    const grant = duty === "Foreman" ? "foreman" : duty === "Gate Supervisor" ? "gate_supervisor" : null;
    const operationalRoles = grant ? (duties.includes(duty) ? [...new Set([...access.operationalRoles, grant])] : [...new Set([...access.operationalRoles.filter(value => value !== grant), ...defaultStaffAccess(form.staffType)])]) as EmployeeOperationalRole[] : access.operationalRoles;
    setForm({ ...form, duties }); setAccess({ ...access, operationalRoles });
  };
  return <Dialog open={open} onOpenChange={close}>
    <VendorEditFlyout title={person ? "Employee Profile" : employeeId ? "Employee Profile" : "Add Staff"} logoSrc={vendor?.logoSquareUrl || vendor?.logoUrl || undefined} logoAlt={`${vendor?.name ?? "Company"} logo`} onClose={() => close(false)}>
      {error && <p role="alert" className="text-red-300 mb-3">{error}</p>}
      {!form || !access ? <p>Loading employee profile…</p> : <form onSubmit={save} className="space-y-4" data-testid="shared-staff-profile">
        <div><Label>Employee photo</Label><PhotoUploadField value={form.photoUrl} onChange={photoUrl => setForm({ ...form, photoUrl })} testIdPrefix="staff-photo" /></div>
        <div><Label htmlFor="staff-type">Staff type</Label><select id="staff-type" value={form.staffType} onChange={e => changeType(e.target.value as StaffType)} className="staff-type-select">{STAFF_TYPES.map(type => <option key={type}>{type}</option>)}</select></div>
        {access.isAdmin && <p className="text-sm text-muted-foreground">Company administrator. Existing administrative access is retained.</p>}
        <div><Label htmlFor="staff-job-title">Job title</Label><Input id="staff-job-title" value={form.jobTitle} onChange={e => setForm({ ...form, jobTitle: e.target.value })} /></div>
        <fieldset><legend>Assigned roles / staff functions</legend><p className="text-xs text-muted-foreground mb-2">Choose duties in addition to the staff type. Foreman and Gate Supervisor include their operational access. Other function names do not grant extra access by themselves.</p><div className="grid grid-cols-2 gap-2">{STAFF_DUTIES.map(duty => <label key={duty} className="flex gap-2 items-center min-h-11"><BrandedCheckbox checked={form.duties.includes(duty)} onCheckedChange={() => toggleDuty(duty)} />{duty}</label>)}</div>
          <div className="flex gap-2 mt-2"><Input aria-label="Additional staff function" placeholder="Other function" value={functionName} onChange={e => setFunctionName(e.target.value)} /><button type="button" className="vendor-mini-card-button" disabled={!functionName.trim()} onClick={() => { const value = functionName.trim(); if (!STAFF_TYPES.includes(value as StaffType)) setForm({ ...form, roles: [...new Set([...form.roles, value])] }); setFunctionName(""); }}>Add function</button></div>
          {form.roles.filter(role => ![...STAFF_TYPES, "Field Worker", "Visitor Notifications", "office", "field", "field_employee", "foreman", "gatekeeper", "gate_supervisor", "driver", "dispatch", ...STAFF_DUTIES].includes(role)).map(role => <label key={role} className="flex items-center gap-2 min-h-11"><BrandedCheckbox checked onCheckedChange={() => setForm({ ...form, roles: form.roles.filter(value => value !== role) })} />{role}</label>)}
        </fieldset>
        <EmployeeAccessEditor isAdmin={access.isAdmin} operationalRoles={access.operationalRoles} siteLocationIds={access.siteLocationIds} eligibleSites={sites} onChange={value => { setAccess({ ...access, ...value }); setForm({ ...form, duties: form.duties.filter(duty => duty === "Foreman" ? value.operationalRoles.includes("foreman") : duty === "Gate Supervisor" ? value.operationalRoles.includes("gate_supervisor") : true) }); }} />
        <div className="grid grid-cols-2 gap-3"><div><Label htmlFor="staff-first">First name</Label><Input id="staff-first" required value={form.firstName} onChange={e => setForm({ ...form, firstName: e.target.value })} /></div><div><Label htmlFor="staff-last">Last name</Label><Input id="staff-last" required value={form.lastName} onChange={e => setForm({ ...form, lastName: e.target.value })} /></div></div>
        <div><Label htmlFor="staff-email">Email</Label><Input id="staff-email" type="email" required value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} /></div>
        <div><Label htmlFor="staff-phone">Phone</Label><Input id="staff-phone" value={form.phone} onChange={e => setForm({ ...form, phone: handlePhoneInput(e.target.value) })} /></div>
        <label className="flex gap-2 items-center"><BrandedCheckbox checked={form.roles.includes("Visitor Notifications")} onCheckedChange={checked => setForm({ ...form, roles: checked ? [...form.roles, "Visitor Notifications"] : form.roles.filter(role => role !== "Visitor Notifications") })} />Receive site visitor notifications</label>
        <div className="flex gap-3 flex-wrap"><label className="flex items-center gap-2"><BrandedCheckbox checked={form.pecCertification} onCheckedChange={checked => setForm({ ...form, pecCertification: !!checked })} />PEC certified</label><Input aria-label="PEC expiration date" type="date" value={form.pecExpirationDate} onChange={e => setForm({ ...form, pecExpirationDate: e.target.value })} /></div>
        {employeeId && <CertificationsSection employeeId={employeeId} variant="inline" showVendorVerify={canVerify} testIdPrefix="staff-certifications" />}
        <div className="flex gap-2"><button className="vendor-mini-card-button" type="submit" disabled={busy}>{busy ? "Saving…" : employeeId ? "Save Changes" : "Create Staff Profile"}</button><button className="vendor-mini-card-button" type="button" disabled={busy} onClick={() => close(false)}>Cancel</button></div>
      </form>}
      {form && employeeId && <div className="mt-4"><EmployeePortalLoginFields employeeId={employeeId} defaultEmail={form.email} vendorRole={form.vendorRole} variant="inline" showOnboardingInvite showDisableLogin testIdPrefix="staff-login" onSaved={invalidate} /></div>}
      {form && !employeeId && <p className="mt-3 text-xs text-muted-foreground">Create the profile first to configure portal login and certifications here.</p>}
    </VendorEditFlyout>
  </Dialog>;
}
