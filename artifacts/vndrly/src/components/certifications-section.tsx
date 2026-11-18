import { CREDENTIAL_HOLDER_FIELD, credentialRequiresRecordNumber, EXTERNAL_CERTIFICATION_CATALOG } from "@workspace/api-zod";
import { useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListEmployeeCertifications,
  useCreateEmployeeCertification,
  useUpdateEmployeeCertification,
  useDeleteEmployeeCertification,
  useListCertificationNames,
  getListEmployeeCertificationsQueryKey,
  getListCertificationNamesQueryKey,
  type EmployeeCertification,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BrandedInput as Input } from "@/components/work-hub/chrome";
import { Label } from "@/components/ui/label";
import { BrandedCheckbox } from "@/components/branded-checkbox";
import { CertificationPicker } from "@/components/certification-picker";
import { Dialog, DialogTrigger } from "@/components/ui/dialog";
import EmployeeDialogContent from "@/components/employee-dialog-content";
import { ProfileActionButton, ProfileRow } from "@/components/gate-profile-chrome";
import { useToast } from "@/hooks/use-toast";
import { ShieldCheck, Pencil, Trash2 } from "lucide-react";
import ImagePill from "@/components/image-pill";
import { translateApiError } from "@/lib/api-error";
import { requiredCredentialsForRoles } from "@/lib/role-compliance";
import { ExternalTrainingCredit } from './external-training-credit';

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

function isSafeUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  return url.startsWith("/api/storage/") || url.startsWith("/objects/");
}

function statusBadge(expirationDate: string | null) {
  if (!expirationDate) {
    return <ImagePill color="grey">No expiration</ImagePill>;
  }
  const days = (new Date(expirationDate + "T00:00:00").getTime() - Date.now()) / (1000 * 60 * 60 * 24);
  if (days < 0) {
    return (
      <ImagePill color="red">
        Expired {Math.abs(Math.floor(days))}d ago
      </ImagePill>
    );
  }
  if (days <= 90) {
    return <ImagePill color="amber">Expires in {Math.ceil(days)}d</ImagePill>;
  }
  return <ImagePill color="green">Valid</ImagePill>;
}

function verifyBadge(c: EmployeeCertification) {
  if (c.vendorVerifiedAt) return null;
  return <ImagePill color="amber">Unverified</ImagePill>;
}

type FormState = {
  name: string;
  issuer: string;
  certNumber: string;
  issuedDate: string;
  expirationDate: string;
  documentUrl: string;
  documentPath: string;
  qualificationDetails: Record<string, string>;
};

const blankForm: FormState = { name: "", issuer: "", certNumber: "", issuedDate: "", expirationDate: "", documentUrl: "", documentPath: "", qualificationDetails: {} };

export default function CertificationsSection({
  employeeId,
  variant = "card",
  testIdPrefix = "employee-certifications",
  showVendorVerify = false,
  roles = [],
  profileTraining,
}: {
  employeeId: number;
  variant?: "card" | "inline";
  testIdPrefix?: string;
  /** Vendor office/admin can check off employee-submitted certifications. */
  showVendorVerify?: boolean;
  /** Selected workforce roles determine which credentials are required. */
  roles?: string[];
  profileTraining?: { assigned: ReactNode; completed: ReactNode; completedCount: number };
}) {
  const { t, i18n } = useTranslation();
  const [industryOpen, setIndustryOpen] = useState(false);
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: certs, isLoading } = useListEmployeeCertifications(employeeId, { query: { queryKey: getListEmployeeCertificationsQueryKey(employeeId) } });
  const { data: catalogNames } = useListCertificationNames({ query: { queryKey: getListCertificationNamesQueryKey() } });
  const create = useCreateEmployeeCertification();
  const update = useUpdateEmployeeCertification();
  const remove = useDeleteEmployeeCertification();

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<EmployeeCertification | null>(null);
  const [form, setForm] = useState<FormState>(blankForm);
  const [uploading, setUploading] = useState(false);
  const [addPick, setAddPick] = useState("");
  const closeDialog = () => { setOpen(false); setAddPick(""); };


  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["account-next-steps"] });
    return qc.invalidateQueries({ queryKey: getListEmployeeCertificationsQueryKey(employeeId) });
  };

  const existingNames = useMemo(() => new Set((certs ?? []).map((c) => c.name)), [certs]);
  const availableNames = useMemo(
    () => (catalogNames ?? []).filter((n) => !existingNames.has(n)),
    [catalogNames, existingNames],
  );
  const requiredCredentials = useMemo(() => requiredCredentialsForRoles(roles), [roles]);
  const requirementSummary = requiredCredentials.length > 0 ? (
    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground" data-testid={`${testIdPrefix}-role-requirements`}>
      <span>Required for selected roles:</span>
      {requiredCredentials.map((credential) => <ImagePill key={credential} color={existingNames.has(credential) ? "green" : "red"}>{credential}</ImagePill>)}
    </div>
  ) : null;

  const startEdit = (c: EmployeeCertification) => {
    setEditing(c);
    setForm({
      name: c.name,
      issuer: c.issuer || "",
      certNumber: c.certNumber || "",
      issuedDate: c.issuedDate || "",
      expirationDate: c.expirationDate || "",
      documentUrl: c.documentUrl || "",
      documentPath: c.documentPath || "",
      qualificationDetails: c.qualificationDetails || {},
    });
    setOpen(true);
  };

  const onUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const r = await fetch(`${API_BASE}/api/storage/uploads/request-url`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: file.name, size: file.size, contentType: file.type }),
      });
      if (!r.ok) throw new Error("Failed to request upload URL");
      const { uploadURL, objectPath } = await r.json();
      const up = await fetch(uploadURL, { method: "PUT", headers: { "Content-Type": file.type }, body: file });
      if (!up.ok) throw new Error("Upload failed");
      const finalized = await fetch(`${API_BASE}/api/storage/uploads/finalize`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ objectURL: uploadURL, visibility: "private" }),
      });
      if (!finalized.ok) throw new Error("Upload could not be finalized");
      setForm(f => ({ ...f, documentPath: objectPath, documentUrl: `${API_BASE}/api/storage${objectPath}` }));
    } catch (err: unknown) {
      toast({
        title: translateApiError(err, t, t("errors.certification.upload_failed")),
        variant: "destructive",
      });
    } finally {
      setUploading(false);
    }
  };

  const submitDialog = async () => {
    if (!form.name.trim()) { toast({ title: "Certification name is required", variant: "destructive" }); return; }
    if (credentialRequiresRecordNumber(form.name) && !form.certNumber.trim()) { toast({ title: "Certificate # is required", variant: "destructive" }); return; }
    const data = {
      name: form.name.trim(),
      issuer: form.issuer || null,
      certNumber: form.certNumber.trim() || null,
      issuedDate: form.issuedDate || null,
      expirationDate: form.expirationDate || null,
      documentUrl: form.documentUrl || null,
      documentPath: form.documentPath || null,
      qualificationDetails: form.qualificationDetails,
    };
    try {
      if (editing) {
        await update.mutateAsync({ employeeId, certId: editing.id, data });
        toast({ title: "Certification updated" });
      } else {
        await create.mutateAsync({ employeeId, data });
        toast({ title: "Certification added" });
      }
      setOpen(false);
      setAddPick("");
      invalidate();
    } catch (e: unknown) {
      toast({
        title: translateApiError(e, t, t("errors.certification.save_failed")),
        variant: "destructive",
      });
    }
  };

  const onDelete = async (c: EmployeeCertification) => {
    if (!confirm(`Remove "${c.name}"?`)) return;
    try {
      await remove.mutateAsync({ employeeId, certId: c.id });
      invalidate();
      toast({ title: "Certification removed" });
    } catch (e: unknown) {
      toast({
        title: translateApiError(e, t, t("errors.certification.delete_failed")),
        variant: "destructive",
      });
    }
  };

  const patchCert = async (c: EmployeeCertification, patch: { expirationDate?: string | null; certNumber?: string; vendorVerified?: boolean }) => {
    try {
      await update.mutateAsync({
        employeeId,
        certId: c.id,
        data: {
          name: c.name,
          issuer: c.issuer,
          certNumber: patch.certNumber ?? c.certNumber,
          issuedDate: c.issuedDate,
          expirationDate: patch.expirationDate !== undefined ? patch.expirationDate : c.expirationDate,
          documentUrl: c.documentUrl,
          documentPath: c.documentPath,
          ...(patch.vendorVerified !== undefined ? { vendorVerified: patch.vendorVerified } : {}),
        },
      });
      invalidate();
    } catch (e: unknown) {
      toast({
        title: translateApiError(e, t, t("errors.certification.save_failed")),
        variant: "destructive",
      });
    }
  };

  const addCertPicker = (
    <div className="min-w-0 max-w-full space-y-2">
      <CertificationPicker names={availableNames} value={addPick || undefined}
        onChange={name => { setAddPick(name); setEditing(null); setForm({ ...blankForm, name }); setOpen(true); }}
        testId={`${testIdPrefix}-add-select`} label="Add certification"
        placeholder={availableNames.length === 0 ? "All certifications added" : "Add certification…"} />
    </div>
  );

  const inlineCertRows = (
    <>
      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : !certs || certs.length === 0 ? (
        <p className="text-sm text-muted-foreground mb-2">No certifications yet. Choose one from the dropdown above.</p>
      ) : (
        <ul className="space-y-2">
          {certs.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center gap-x-3 gap-y-2" data-testid={`${testIdPrefix}-row-${c.id}`}>
              <div className="flex items-center gap-2">
                <BrandedCheckbox
                  id={`${testIdPrefix}-enabled-${c.id}`}
                  checked
                  onCheckedChange={(v) => {
                    if (!v) void onDelete(c);
                  }}
                  data-testid={`${testIdPrefix}-enabled-${c.id}`}
                />
                <Label htmlFor={`${testIdPrefix}-enabled-${c.id}`} className="min-w-0 cursor-pointer font-medium whitespace-normal break-words">
                  {c.name}
                </Label>
              </div>
              <button type="button" className="gate-history-filter" onClick={() => startEdit(c)}>Edit details</button>
              {statusBadge(c.expirationDate)}
              {verifyBadge(c)}
              <Input
                defaultValue={c.certNumber ?? ""}
                placeholder="Cert #"
                className="min-w-0 w-[8rem] max-w-full"
                aria-label={`${c.name} certificate number`}
                data-testid={`${testIdPrefix}-cert-number-${c.id}`}
                onBlur={(e) => {
                  const next = e.target.value.trim();
                  if (next !== (c.certNumber ?? "") && next) void patchCert(c, { certNumber: next });
                }}
              />
              <Input
                type="date"
                defaultValue={c.expirationDate ?? ""}
                className="min-w-0 w-[11rem] max-w-full"
                aria-label={`${c.name} expiration`}
                data-testid={`${testIdPrefix}-expiration-${c.id}`}
                onBlur={(e) => {
                  const next = e.target.value || null;
                  if (next !== (c.expirationDate || "")) void patchCert(c, { expirationDate: next });
                }}
              />
              {showVendorVerify ? (
                <div className="flex items-center gap-2">
                  <BrandedCheckbox
                    id={`${testIdPrefix}-verified-${c.id}`}
                    checked={!!c.vendorVerifiedAt}
                    onCheckedChange={(v) => void patchCert(c, { vendorVerified: !!v })}
                    data-testid={`${testIdPrefix}-verified-${c.id}`}
                  />
                  <Label htmlFor={`${testIdPrefix}-verified-${c.id}`} className="cursor-pointer text-xs whitespace-nowrap">
                    Verified
                  </Label>
                </div>
              ) : null}
              {showVendorVerify && <ExternalTrainingCredit employeeId={employeeId} certificateId={c.id} credit={(c as EmployeeCertification & {trainingCredit?:{families:{familyId:string}[];reviewNote:string}}).trainingCredit} onSaved={invalidate} />}
            </li>
          ))}
        </ul>
      )}
    </>
  );

  const cardCertRows = (
    <>
      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : !certs || certs.length === 0 ? (
        <p className="text-sm text-muted-foreground">No certifications yet.</p>
      ) : (
        <ul className="space-y-2">
          {certs.map(c => (
            <li key={c.id} className="border rounded p-3 flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1 break-words">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium">{c.name}</span>
                  {statusBadge(c.expirationDate)}
                  {verifyBadge(c)}
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  {c.issuer || "—"}{c.certNumber ? ` · #${c.certNumber}` : ""}
                  {c.issuedDate ? ` · issued ${c.issuedDate}` : ""}
                  {c.expirationDate ? ` · exp ${c.expirationDate}` : ""}
                </div>
                {isSafeUrl(c.documentUrl) && (
                  <a href={c.documentUrl!} target="_blank" rel="noreferrer" className="text-xs text-blue-600 underline">View document</a>
                )}
                {showVendorVerify && <ExternalTrainingCredit employeeId={employeeId} certificateId={c.id} credit={(c as EmployeeCertification & {trainingCredit?:{families:{familyId:string}[];reviewNote:string}}).trainingCredit} onSaved={invalidate} />}
              </div>
              <div className="flex items-center gap-0">
                <ProfileActionButton aria-label={`Edit ${c.name}`} className="group px-3" onClick={() => startEdit(c)}>
                  <Pencil className="w-4 h-4 text-gray-500 transition-colors group-hover:text-blue-600" />
                </ProfileActionButton>
                <ProfileActionButton aria-label={`Delete ${c.name}`} className="group px-3" onClick={() => onDelete(c)}>
                  <Trash2 className="w-4 h-4 text-gray-500 transition-colors group-hover:text-red-600" />
                </ProfileActionButton>
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );

  const editDialog = (
    <Dialog open={open} onOpenChange={value => value ? setOpen(true) : closeDialog()}>
      <DialogTrigger asChild><span /></DialogTrigger>
      <EmployeeDialogContent title={editing ? "Edit certification" : "Add certification"} appearance="dark"
        footerAction={<ProfileActionButton onClick={submitDialog} disabled={uploading || create.isPending || update.isPending}>{editing ? "Save" : "Add"}</ProfileActionButton>}>
        <div className="certification-form space-y-3">
          <div>
            <Label>Name *</Label>
            {editing ? (
              <p className="certification-picker-trigger break-words" aria-label="Name">{form.name}</p>
            ) : (
              <CertificationPicker names={availableNames} value={form.name} onChange={name => setForm({ ...form, name, qualificationDetails: {} })}
                testId={`${testIdPrefix}-name`} placeholder="Select certification…" />
            )}
          </div>
          <div><Label>{credentialRequiresRecordNumber(form.name) ? "Certificate # *" : "Record number (if shown)"}</Label><Input aria-label="Certificate number" value={form.certNumber} onChange={e => setForm({ ...form, certNumber: e.target.value })} data-testid={`${testIdPrefix}-cert-number`} /></div>
          <div><Label>Issuer</Label><Input aria-label="Issuer" value={form.issuer} onChange={e => setForm({ ...form, issuer: e.target.value })} placeholder="Optional" /></div>
          {EXTERNAL_CERTIFICATION_CATALOG.filter(item => item.name === form.name).flatMap(item => [CREDENTIAL_HOLDER_FIELD, ...item.fields]).map(field => (
            <div key={field}><Label>{field}</Label><Input aria-label={field} type={/date$/i.test(field) ? 'date' : 'text'} value={form.qualificationDetails[field] ?? ""}
              onChange={e => setForm({...form, qualificationDetails: {...form.qualificationDetails, [field]: e.target.value}})} /></div>
          ))}
          {EXTERNAL_CERTIFICATION_CATALOG.find(item => item.name === form.name)?.nonExpiring && <p className="text-xs text-muted-foreground">This credential has no issuer expiry. Leave Expires blank unless your actual credential specifies one.</p>}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="min-w-0"><Label>Issued (optional)</Label><Input aria-label="Issued (optional)" type="date" value={form.issuedDate} onChange={e => setForm({ ...form, issuedDate: e.target.value })} /></div>
            <div className="min-w-0"><Label>Expires</Label><Input aria-label="Expires" type="date" value={form.expirationDate} onChange={e => setForm({ ...form, expirationDate: e.target.value })} /></div>
          </div>
          <div className="space-y-2">
            <Label className="block" htmlFor={`${testIdPrefix}-document`}>Certification card / document</Label>
            <input id={`${testIdPrefix}-document`} type="file" accept="image/*,application/pdf" onChange={onUpload} className="sr-only peer" />
            <label htmlFor={`${testIdPrefix}-document`} className="inline-flex min-h-11 cursor-pointer items-center rounded-lg border border-[var(--brand-primary)] bg-[#2b2b2f] px-3 py-2 text-xs font-semibold text-[#ececec] peer-focus-visible:outline peer-focus-visible:outline-[var(--brand-primary)]">Choose file</label>
            {uploading && <p className="text-xs text-muted-foreground">Uploading…</p>}
            {isSafeUrl(form.documentUrl) && <a href={form.documentUrl} target="_blank" rel="noreferrer" className="text-xs text-blue-600 underline block mt-1">Current document</a>}
          </div>
        </div>
      </EmployeeDialogContent>
    </Dialog>
  );

  if (variant === "inline") {
    return (
      <div className="min-w-0 max-w-full rounded-md border p-3 space-y-3" data-testid={`${testIdPrefix}-section`}>
        {profileTraining?.assigned}
        <div className="flex flex-row items-center gap-2 mb-1">
          <p className="text-sm font-semibold flex items-center gap-2 flex-1">
            <ShieldCheck className="w-4 h-4 text-amber-500" />
            Certifications &amp; Training ({(certs?.length || 0) + (profileTraining?.completedCount || 0)})
          </p>
        </div>
        {addCertPicker}
        {requirementSummary}
        {profileTraining ? <div>
          <ProfileRow label={i18n?.language?.startsWith("es") ? "Certificaciones de la industria" : "Industry certifications"} open={industryOpen} onClick={() => setIndustryOpen(value => !value)} unframed>{inlineCertRows}</ProfileRow>
          {profileTraining.completed}
        </div> : inlineCertRows}
        {editDialog}
      </div>
    );
  }

  return (
    <Card data-testid={`${testIdPrefix}-section`}>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
        <CardTitle className="flex items-center gap-2">
          <ShieldCheck className="w-5 h-5 text-amber-500" />
          Certifications &amp; Training ({certs?.length || 0})
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {addCertPicker}
        {requirementSummary}
        {cardCertRows}
        {editDialog}
      </CardContent>
    </Card>
  );
}
