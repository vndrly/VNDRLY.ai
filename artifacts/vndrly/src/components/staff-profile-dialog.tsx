import { partnerSiteLabel } from "@/lib/warwick-gate-label";
import { companyRoleOptions, currentRoleLabel, loadStaffRoleCatalog, type CompanyStaffRoleCatalog } from "@/lib/staff-role-catalog";
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
import StaffEnrollmentControl from "./staff-enrollment-control";
import { PhotoUploadField } from "./photo-upload-field";
import CertificationsSection from "./certifications-section";
import { useToast } from "@/hooks/use-toast";
import { useUnsavedChanges } from "@/hooks/use-unsaved-changes";
import { stripPhone, handlePhoneInput } from "@/lib/utils";
import { STAFF_TYPES, STAFF_DUTIES, staffTypeFor, staffRolesFor, defaultStaffAccess, legacyStaffAccess, staffPrimaryRole, accessForStaffRoles, type StaffType, type StaffRoleDefinition } from "@/lib/staff-profile";
import { useGuidedTarget } from "./guided-target";
import "./staff-profile-dialog.css";

function RoleOptions({ roles }: { roles: StaffRoleDefinition[] }) {
  return [...new Set(roles.map(role => role.group))].map(group => <optgroup key={group} label={group}>{roles.filter(role => role.group === group).map(role => <option key={role.label} value={role.label}>{role.label}</option>)}</optgroup>);
}

export type StaffProfilePerson = {
  id: number; vendorId?: number; userId?: number | null; accountUserId?: number; isCompanyAdmin?: boolean; firstName: string; lastName: string; email: string;
  phone?: string | null; jobTitle?: string | null; vendorRole?: string | null;
  roles?: string[] | null; photoUrl?: string | null; pecCertification?: boolean; pecExpirationDate?: string | null;
};
type Access = { isAdmin: boolean; operationalRoles: EmployeeOperationalRole[]; siteLocationIds: number[] };
export type SavedStaffProfile = { id: number; vendorId: number; firstName: string; lastName: string; userId?: number | null; access: Access };
type Form = { firstName: string; lastName: string; email: string; phone: string; jobTitle: string; photoUrl: string | null; pecCertification: boolean; pecExpirationDate: string; roles: string[]; vendorRole: string; staffType: StaffType; duties: string[] };
const jsonRequest = async (url: string, method = "GET", body?: unknown) => {
  const response = await fetch(url, { method, credentials: "include", headers: { "Content-Type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.error ?? "Unable to save employee profile");
  return data;
};

export default function StaffProfileDialog({ open, onOpenChange, vendorId, person, defaultSiteId, defaultType = "Office Staff", defaultRole, operationCategories, canVerify = false, onSaved, nextSteps }: {
  open: boolean; onOpenChange: (open: boolean) => void; vendorId: number; person?: StaffProfilePerson | null; defaultSiteId?: number; defaultType?: StaffType; defaultRole?: string; operationCategories?: readonly string[]; canVerify?: boolean;
  onSaved?: (profile: SavedStaffProfile) => void;
  nextSteps?: { siteName: string; onReturn: () => void };
}) {
  const cache = useQueryClient(), { toast } = useToast();
  const { data: vendor } = useGetVendor(vendorId, { query: { enabled: open && !!vendorId, queryKey: getGetVendorQueryKey(vendorId) } });
  const isGateGo = vendor?.name?.trim().toLowerCase() === "gatego";
  const jobTitleFor = (title: string) => isGateGo && /^gate\s+attendant$/i.test(title.trim()) ? "Gatekeeper" : title;
  const operations = operationCategories ?? (isGateGo ? ["gate"] : ["field", "fleet", "gate"]);
  const [catalog, setCatalog] = useState<CompanyStaffRoleCatalog>();
  const companyRoles = companyRoleOptions(operations, catalog);
  const definition = (label: string) => companyRoles.find(role => role.label === label);
  const catalogLabels = [...companyRoles.map(role => role.label), ...(catalog?.entries.flatMap(role => role.aliases ?? []) ?? [])];
  const [form, setForm] = useState<Form | null>(null), [access, setAccess] = useState<Access | null>(null);
  const [sites, setSites] = useState<Array<{ id: number; name: string }>>([]);
  const [employeeId, setEmployeeId] = useState<number | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [profileSavedForGuide, setProfileSavedForGuide] = useState(false);
  const [savedLinkedUserId, setSavedLinkedUserId] = useState<number | null>(null);
  const baseline = useRef(""), originalAccess = useRef<Access | null>(null);
  const dirty = !!form && baseline.current !== JSON.stringify({ form, access });
  useUnsavedChanges(open && dirty);
  const invalidate = () => { void cache.invalidateQueries({queryKey:["account-next-steps"]}); void cache.invalidateQueries({ predicate: q => /field-employees|vendor-contacts|contacts|people-access|org-members|staff-enrollments/.test(JSON.stringify(q.queryKey)) }); };
  const close = (value: boolean) => { if (!value && busy) return false; if (!value && dirty && !window.confirm("Discard unsaved employee profile changes?")) return false; onOpenChange(value); return true; };

  useEffect(() => {
    if (!open) return;
    let live = true;
    setForm(null); setAccess(null); setError(""); setEmployeeId(person?.id || null); setProfileSavedForGuide(false); setSavedLinkedUserId(person?.userId ?? person?.accountUserId ?? null);
    void (async () => {
      try {
        const [accessData, loadedCatalog] = await Promise.all([jsonRequest(`/api/vendors/${vendorId}/people-access`), loadStaffRoleCatalog(vendorId)]);
        const loadedRoles = companyRoleOptions(operations, loadedCatalog);
        const loadedDefinition = (label: string) => loadedRoles.find(role => role.label === label);
        let saved = person;
        if (person?.id) {
          const [office, field] = await Promise.all([
            jsonRequest(`/api/vendor-contacts?vendorId=${vendorId}`),
            jsonRequest(`/api/field-employees?vendorId=${vendorId}&includeInactive=true`),
          ]);
          saved = [...office, ...field].find((row: StaffProfilePerson) => row.id === person.id && row.vendorId === vendorId);
          if (!saved) throw new Error("This employee is no longer available in this company.");
        }
        const requestedRole = currentRoleLabel(defaultRole ?? (defaultType === "Field Employee" ? "Field Worker" : defaultType), loadedCatalog);
        const initialRole = loadedRoles.some(role => role.label === requestedRole) ? requestedRole : defaultType === "Office Staff" ? "Office Staff" : loadedRoles.find(role => role.area !== "office")?.label ?? "Office Staff";
        const type = saved ? staffTypeFor(saved) : loadedDefinition(initialRole)?.type ?? defaultType;
        const stored = accessData.people.find((row: { vendorPeopleId: number }) => row.vendorPeopleId === saved?.id);
        const nextAccess: Access = stored ? structuredClone(stored) : { isAdmin: !!saved?.isCompanyAdmin || saved?.vendorRole === "admin", operationalRoles: saved ? legacyStaffAccess(saved.vendorRole) : loadedDefinition(initialRole)?.access ?? defaultStaffAccess(type), siteLocationIds: [] };
        const eligibleSites: Array<{ id: number; name: string; partnerName?: string | null }> = accessData.eligibleSites;
        const profileSites = vendorId === 1054
          ? eligibleSites
              .filter(site => site.id === 411 || /^(?:Warwick )?(?:Cactus 152|Precision 550)$/.test(site.name) || site.name === "Flywheel Energy Spur")
              .map(site => ({
                ...site,
                name: site.id === 411 ? "Warwick San Roman Completions" : /^(Cactus 152|Precision 550)$/.test(site.name) ? `Warwick ${site.name}` : site.name,
              }))
          : eligibleSites.map(site => ({ ...site, name: partnerSiteLabel(site) }));
        const initialAccess = structuredClone(nextAccess);
        if (defaultSiteId && profileSites.some(site => site.id === defaultSiteId) && !nextAccess.siteLocationIds.includes(defaultSiteId)) nextAccess.siteLocationIds = [...nextAccess.siteLocationIds,defaultSiteId];
        const primaryRole = saved ? currentRoleLabel(jobTitleFor(staffPrimaryRole(saved, nextAccess.operationalRoles)), loadedCatalog) : initialRole;
        const primaryAccess = loadedDefinition(primaryRole)?.access ?? defaultStaffAccess(type);
        const duties = saved ? (saved.roles ?? []).map(role => currentRoleLabel(role, loadedCatalog)).filter(role => loadedRoles.some(value => value.label === role) && role !== primaryRole) : [];
        for (const [permission, label] of [["office", "Office Staff"], ["foreman", "Foreman"], ["gate_supervisor", "Gate Supervisor"], ["gatekeeper", "Gatekeeper"], ["field_employee", "Field Worker"]] as const) {
          if (nextAccess.operationalRoles.includes(permission) && !primaryAccess.includes(permission) && !duties.includes(label)) duties.push(label);
        }
        const nextForm: Form = { firstName: saved?.firstName ?? "", lastName: saved?.lastName ?? "", email: saved?.email ?? "", phone: saved?.phone ?? "", jobTitle: primaryRole, photoUrl: saved?.photoUrl ?? null, pecCertification: saved?.pecCertification ?? false, pecExpirationDate: saved?.pecExpirationDate ?? "", roles: saved?.roles ?? (defaultRole === "Team Member" ? ["Administrative Team"] : []), vendorRole: saved?.vendorRole ?? (type === "Office Staff" ? "office" : type === "Gatekeeper" ? "gatekeeper" : "field"), staffType: type, duties };
        if (!live) return;
        setCatalog(loadedCatalog); setSites(profileSites); setAccess(nextAccess); originalAccess.current = initialAccess;
        setForm(nextForm); baseline.current = JSON.stringify({ form: nextForm, access: initialAccess });
      } catch (cause) { if (live) setError(cause instanceof Error ? cause.message : "Unable to load employee profile"); }
    })();
    return () => { live = false; };
  }, [open, vendorId, person?.id, defaultSiteId, defaultType, defaultRole, isGateGo, operationCategories?.join(",")]);

  const save = async (event: React.FormEvent) => {
    event.preventDefault(); if (!form || !access) return;
    setBusy(true); setError("");
    let savedId = employeeId;
    let profileSaved = false;
    try {
      const duties = [...new Set([...form.duties, ...companyRoles.filter(role => role.label === form.jobTitle).map(role => role.label)])];
      const payload = { jobTitle: jobTitleFor(form.jobTitle), firstName: form.firstName, lastName: form.lastName, email: form.email, phone: stripPhone(form.phone) || null, photoUrl: form.photoUrl, pecCertification: form.pecCertification, pecExpirationDate: form.pecExpirationDate || null, roles: staffRolesFor(form.staffType, duties, form.roles, catalogLabels) };
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
      setProfileSavedForGuide(true); setSavedLinkedUserId(result.userId ?? person?.userId ?? person?.accountUserId ?? null);
      onSaved?.({ id: result.id, vendorId, firstName: form.firstName, lastName: form.lastName, userId: result.userId ?? person?.userId ?? null, access: structuredClone(access) });
      toast({ title: person ? "Employee profile saved" : "Staff profile created" });
      // Stay open after creation so login and certifications use the same ID.
      if (person && !nextSteps) onOpenChange(false);
    } catch (cause) {
      invalidate();
      setError(`${cause instanceof Error ? cause.message : "Unable to save"}${profileSaved ? ". Profile details were saved, but permissions were not saved. Review and retry; the same profile will be used." : ""}`);
    } finally { setBusy(false); }
  };

  const changeRole = (role: string) => {
    if (!form || !access) return;
    const duties = form.duties.filter(value => value !== role);
    setAccess({ ...access, operationalRoles: accessForStaffRoles([role, ...duties], [form.jobTitle, ...form.duties], access.operationalRoles, companyRoles) });
    setForm({ ...form, staffType: definition(role)?.type ?? form.staffType, jobTitle: role, duties });
  };
  const toggleDuty = (duty: string) => {
    if (!form || !access) return;
    const duties = form.duties.includes(duty) ? form.duties.filter(value => value !== duty) : [...form.duties, duty];
    const operationalRoles = accessForStaffRoles([form.jobTitle, ...duties], [form.jobTitle, ...form.duties], access.operationalRoles, companyRoles);
    setForm({ ...form, duties }); setAccess({ ...access, operationalRoles });
  };
  const guidanceScope = `next-steps-direct-profile:${vendorId}:${employeeId ?? "new"}`;
  const guidanceId = profileSavedForGuide && !savedLinkedUserId ? "testid:staff-login-portal-enabled" : !form?.firstName.trim() ? "first-name" : !form.lastName.trim() ? "last-name" : !form.email.trim() ? "email" : !access?.operationalRoles.some(role => role === "gatekeeper" || role === "gate_supervisor") ? employeeId ? "additional-role" : "assigned-role" : defaultSiteId && !access.siteLocationIds.includes(defaultSiteId) ? "site-access" : "save";
  const guidancePrompts: Record<string, string> = { "testid:staff-login-portal-enabled": "The employee and site access were saved. Use these existing portal login controls to configure their Gate access, or the existing enrollment control if needed. No invitation is sent automatically.", "first-name": "Enter this employee’s first name.", "last-name": "Enter this employee’s last name.", email: "Enter this employee’s actual email address.", "assigned-role": "Choose Gatekeeper as the assigned role.", "additional-role": "Add Gatekeeper capability while keeping this employee’s existing assigned roles.", "site-access": `Review site access and select ${nextSteps?.siteName ?? "the authorized gate site"}.`, save: "Review the employee and site access, then save using this button. Nothing is saved automatically." };
  useGuidedTarget({ scopeId: guidanceScope, targetId: guidanceId, prompt: guidancePrompts[guidanceId] }, !!nextSteps && open && !!form && !!access && !busy, 100);
  const additionalRoles = form ? [...new Set([...form.duties, ...form.roles.filter(role => ![...STAFF_TYPES, "Field Worker", "Visitor Notifications", "Administrative Team", "office", "field", "field_employee", "foreman", "gatekeeper", "gate_supervisor", "driver", "dispatch", ...catalogLabels].includes(role))])].filter(role => role !== form.jobTitle) : [];
  return <Dialog open={open} onOpenChange={close}>
    <VendorEditFlyout title={person || employeeId ? "Employee Profile" : `Add ${form?.jobTitle ?? defaultRole ?? defaultType}`} logoSrc={vendor?.logoSquareUrl || vendor?.logoUrl || undefined} logoAlt={`${vendor?.name ?? "Company"} logo`} onClose={() => close(false)}>
      {nextSteps && <section className="mb-3 space-y-2 text-sm" aria-label="Next Steps employee guidance"><p>For {nextSteps.siteName}, choose Gatekeeper as the assigned role or add it under Additional assigned roles. Review the authorized site access, then save. Use the existing enrollment and login controls if this employee still needs access.</p><button type="button" className="vendor-mini-card-button" onClick={() => { if (close(false)) nextSteps.onReturn(); }}>Return to Next Steps</button></section>}
      {error && <p role="alert" className="text-red-300 mb-3">{error}</p>}
      {!form || !access ? <p>Loading employee profile…</p> : <form data-guidance-scope={guidanceScope} onSubmit={save} className="space-y-3" data-testid="shared-staff-profile">
        {(person || employeeId) && <div><Label>Employee photo</Label><PhotoUploadField value={form.photoUrl} onChange={photoUrl => setForm({ ...form, photoUrl })} testIdPrefix="staff-photo" /></div>}
        <div><Label htmlFor="staff-assigned-role">Assigned role</Label><select data-guidance-id="assigned-role" id="staff-assigned-role" value={form.jobTitle} onChange={e => changeRole(e.target.value)} className="staff-type-select">
          {![...companyRoles].some(role => role.label === form.jobTitle) && <option value={form.jobTitle}>{form.jobTitle}</option>}
          <RoleOptions roles={companyRoles.filter(role => person || employeeId || role.area === (defaultType === "Gatekeeper" ? "gate" : defaultType === "Driver" ? "fleet" : defaultType === "Field Employee" ? "field" : "office"))} />
        </select></div>
        {access.isAdmin && <p className="text-sm text-muted-foreground">Company administrator. Existing administrative access is retained.</p>}
        {(person || employeeId) && <section className="staff-additional-roles" aria-label="Additional assigned roles"><div className="staff-additional-roles-header"><Label htmlFor="staff-add-role">Additional assigned roles</Label><select data-guidance-id="additional-role" id="staff-add-role" aria-label="Add assigned role" className="staff-type-select" value="" onChange={event => { if (event.target.value) toggleDuty(event.target.value); }}><option value="">+ Add role…</option><RoleOptions roles={companyRoles.filter(role => role.label !== form.jobTitle && role.label !== "Team Member" && !additionalRoles.includes(role.label))} /></select></div>
          {additionalRoles.length > 0 && <div className="staff-assigned-role-list">{additionalRoles.map(role => <span key={role} className="staff-assigned-role">{role}<button type="button" aria-label={`Remove role ${role}`} onClick={() => form.duties.includes(role) ? toggleDuty(role) : setForm({ ...form, roles: form.roles.filter(value => value !== role) })}><span aria-hidden="true">×</span></button></span>)}</div>}
        </section>}
        {(person || employeeId || defaultSiteId) && <div data-guidance-id="site-access"><EmployeeAccessEditor showOperationalRoles={false} isAdmin={access.isAdmin} operationalRoles={access.operationalRoles} siteLocationIds={access.siteLocationIds} eligibleSites={sites} onChange={value => setAccess({ ...access, ...value })} /></div>}
        <div className="grid grid-cols-2 gap-3"><div><Label htmlFor="staff-first">First name</Label><Input data-guidance-id="first-name" id="staff-first" required value={form.firstName} onChange={e => setForm({ ...form, firstName: e.target.value })} /></div><div><Label htmlFor="staff-last">Last name</Label><Input data-guidance-id="last-name" id="staff-last" required value={form.lastName} onChange={e => setForm({ ...form, lastName: e.target.value })} /></div></div>
        <div><Label htmlFor="staff-email">Email</Label><Input data-guidance-id="email" id="staff-email" type="email" required value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} /></div>
        <div><Label htmlFor="staff-phone">Phone</Label><Input id="staff-phone" value={form.phone} onChange={e => setForm({ ...form, phone: handlePhoneInput(e.target.value) })} /></div>
        {(person || employeeId) && <><label className="flex gap-2 items-center"><BrandedCheckbox checked={form.roles.includes("Visitor Notifications")} onCheckedChange={checked => setForm({ ...form, roles: checked ? [...form.roles, "Visitor Notifications"] : form.roles.filter(role => role !== "Visitor Notifications") })} />Receive site visitor notifications</label>
        <div className="flex gap-3 flex-wrap"><label className="flex items-center gap-2"><BrandedCheckbox checked={form.pecCertification} onCheckedChange={checked => setForm({ ...form, pecCertification: !!checked })} />PEC certified</label><Input aria-label="PEC expiration date" type="date" value={form.pecExpirationDate} onChange={e => setForm({ ...form, pecExpirationDate: e.target.value })} /></div></>}
        {employeeId && <CertificationsSection employeeId={employeeId} variant="inline" showVendorVerify={canVerify} testIdPrefix="staff-certifications" />}
        <div className="flex gap-2"><button data-guidance-id="save" className="vendor-mini-card-button" type="submit" disabled={busy}>{busy ? "Saving…" : employeeId ? "Save Changes" : "Create Staff Profile"}</button><button className="vendor-mini-card-button" type="button" disabled={busy} onClick={() => close(false)}>Cancel</button></div>
      </form>}
      {form && employeeId && <div data-guidance-scope={guidanceScope} className="mt-4"><div className="flex items-center justify-between mb-3"><strong>Enrollment</strong><StaffEnrollmentControl vendorId={vendorId} personKey={`person:${employeeId}`} name={`${form.firstName} ${form.lastName}`} email={form.email} /></div><EmployeePortalLoginFields employeeId={employeeId} defaultEmail={form.email} vendorRole={form.vendorRole} variant="inline" showDisableLogin testIdPrefix="staff-login" onSaved={invalidate} /></div>}
      {form && !employeeId && <p className="mt-3 text-xs text-muted-foreground">Add the employee now. Complete their photo, qualifications, enrollment, and additional roles in the employee profile.</p>}
    </VendorEditFlyout>
  </Dialog>;
}
