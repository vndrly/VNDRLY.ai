import { useMemo, useState } from "react";
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
import { PngPillButton as PillButton } from "@/components/png-pill-rollover";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { ShieldCheck, Pencil, Trash2 } from "lucide-react";
import PngPill, { PngPillButton } from "@/components/png-pill-rollover";
import { translateApiError } from "@/lib/api-error";

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

function isSafeUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  return url.startsWith("/api/storage/") || url.startsWith("/objects/");
}

function statusBadge(expirationDate: string | null) {
  if (!expirationDate) return <span className="text-xs px-2 py-0.5 rounded bg-gray-100 text-gray-700">No expiration</span>;
  const days = (new Date(expirationDate + "T00:00:00").getTime() - Date.now()) / (1000 * 60 * 60 * 24);
  if (days < 0) return <span className="text-xs px-2 py-0.5 rounded bg-red-100 text-red-700">Expired {Math.abs(Math.floor(days))}d ago</span>;
  if (days <= 60) return <span className="text-xs px-2 py-0.5 rounded bg-amber-100 text-amber-800">Expires in {Math.ceil(days)}d</span>;
  return <PngPill color="green">Valid</PngPill>;
}

function verifyBadge(c: EmployeeCertification) {
  if (c.vendorVerifiedAt) return null;
  return <span className="text-xs px-2 py-0.5 rounded bg-orange-100 text-orange-800">Unverified</span>;
}

type FormState = {
  name: string;
  issuer: string;
  certNumber: string;
  issuedDate: string;
  expirationDate: string;
  documentUrl: string;
  documentPath: string;
};

const blankForm: FormState = { name: "", issuer: "", certNumber: "", issuedDate: "", expirationDate: "", documentUrl: "", documentPath: "" };

export default function CertificationsSection({
  employeeId,
  variant = "card",
  testIdPrefix = "employee-certifications",
  showVendorVerify = false,
}: {
  employeeId: number;
  variant?: "card" | "inline";
  testIdPrefix?: string;
  /** Vendor office/admin can check off employee-submitted certifications. */
  showVendorVerify?: boolean;
}) {
  const { t } = useTranslation();
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
  const [addCertNumber, setAddCertNumber] = useState("");
  const [addExpiration, setAddExpiration] = useState("");

  const invalidate = () => qc.invalidateQueries({ queryKey: getListEmployeeCertificationsQueryKey(employeeId) });

  const existingNames = useMemo(() => new Set((certs ?? []).map((c) => c.name)), [certs]);
  const availableNames = useMemo(
    () => (catalogNames ?? []).filter((n) => !existingNames.has(n)),
    [catalogNames, existingNames],
  );

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
    });
    setOpen(true);
  };

  const resetAddInline = () => {
    setAddPick("");
    setAddCertNumber("");
    setAddExpiration("");
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
      await fetch(`${API_BASE}/api/storage/uploads/finalize`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ objectURL: uploadURL, visibility: "public" }),
      });
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
    if (!form.certNumber.trim()) { toast({ title: "Certificate # is required", variant: "destructive" }); return; }
    const data = {
      name: form.name.trim(),
      issuer: form.issuer || null,
      certNumber: form.certNumber.trim(),
      issuedDate: form.issuedDate || null,
      expirationDate: form.expirationDate || null,
      documentUrl: form.documentUrl || null,
      documentPath: form.documentPath || null,
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
      invalidate();
    } catch (e: unknown) {
      toast({
        title: translateApiError(e, t, t("errors.certification.save_failed")),
        variant: "destructive",
      });
    }
  };

  const submitAddInline = async () => {
    if (!addPick) return;
    if (!addCertNumber.trim()) {
      toast({ title: "Certificate # is required", variant: "destructive" });
      return;
    }
    try {
      await create.mutateAsync({
        employeeId,
        data: {
          name: addPick,
          certNumber: addCertNumber.trim(),
          expirationDate: addExpiration || null,
          issuer: null,
          issuedDate: null,
          documentUrl: null,
          documentPath: null,
        },
      });
      toast({ title: "Certification added" });
      resetAddInline();
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
    <div className="space-y-2">
      <Select
        value={addPick || undefined}
        onValueChange={(v) => {
          setAddPick(v);
          setAddCertNumber("");
          setAddExpiration("");
        }}
        disabled={availableNames.length === 0}
      >
        <SelectTrigger data-testid={`${testIdPrefix}-add-select`}>
          <SelectValue placeholder={availableNames.length === 0 ? "All certifications added" : "Add certification…"} />
        </SelectTrigger>
        <SelectContent>
          {availableNames.map((n) => (
            <SelectItem key={n} value={n}>{n}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      {addPick ? (
        <div className="flex flex-wrap items-end gap-x-3 gap-y-2 pt-1" data-testid={`${testIdPrefix}-add-form`}>
          <div className="min-w-[8rem]">
            <Label className="text-xs">Certification</Label>
            <p className="text-sm font-medium mt-1">{addPick}</p>
          </div>
          <div>
            <Label htmlFor={`${testIdPrefix}-add-cert-number`} className="text-xs">Certificate # *</Label>
            <Input
              id={`${testIdPrefix}-add-cert-number`}
              value={addCertNumber}
              onChange={(e) => setAddCertNumber(e.target.value)}
              className="w-[10rem] mt-1"
              data-testid={`${testIdPrefix}-add-cert-number`}
            />
          </div>
          <div>
            <Label htmlFor={`${testIdPrefix}-add-expiration`} className="text-xs">Expires</Label>
            <Input
              id={`${testIdPrefix}-add-expiration`}
              type="date"
              value={addExpiration}
              onChange={(e) => setAddExpiration(e.target.value)}
              className="w-auto max-w-[11rem] mt-1"
              data-testid={`${testIdPrefix}-add-expiration`}
            />
          </div>
          <div className="flex gap-2 pb-0.5">
            <PngPillButton color="blue" onClick={() => void submitAddInline()} disabled={create.isPending} data-testid={`${testIdPrefix}-add-save`}>
              Add
            </PngPillButton>
            <PngPillButton color="red" onClick={resetAddInline}>Cancel</PngPillButton>
          </div>
        </div>
      ) : null}
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
                <Checkbox
                  id={`${testIdPrefix}-enabled-${c.id}`}
                  checked
                  onCheckedChange={(v) => {
                    if (!v) void onDelete(c);
                  }}
                  data-testid={`${testIdPrefix}-enabled-${c.id}`}
                />
                <Label htmlFor={`${testIdPrefix}-enabled-${c.id}`} className="cursor-pointer font-medium whitespace-nowrap">
                  {c.name}
                </Label>
              </div>
              {statusBadge(c.expirationDate)}
              {verifyBadge(c)}
              <Input
                defaultValue={c.certNumber ?? ""}
                placeholder="Cert #"
                className="w-[8rem]"
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
                className="w-auto max-w-[11rem]"
                aria-label={`${c.name} expiration`}
                data-testid={`${testIdPrefix}-expiration-${c.id}`}
                onBlur={(e) => {
                  const next = e.target.value || null;
                  if (next !== (c.expirationDate || "")) void patchCert(c, { expirationDate: next });
                }}
              />
              {showVendorVerify ? (
                <div className="flex items-center gap-2">
                  <Checkbox
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
              <div className="flex-1">
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
              </div>
              <div className="flex items-center gap-0">
                <PillButton color="image" className="group min-w-[28px] px-0" onClick={() => startEdit(c)}>
                  <Pencil className="w-4 h-4 text-gray-500 transition-colors group-hover:text-blue-600" />
                </PillButton>
                <PillButton color="image" className="group min-w-[28px] px-0" onClick={() => onDelete(c)}>
                  <Trash2 className="w-4 h-4 text-gray-500 transition-colors group-hover:text-red-600" />
                </PillButton>
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );

  const editDialog = (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><span /></DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>{editing ? "Edit certification" : "Add certification"}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Name *</Label>
            {editing ? (
              <Input value={form.name} readOnly className="bg-muted" />
            ) : (
              <Select value={form.name || undefined} onValueChange={(v) => setForm({ ...form, name: v })}>
                <SelectTrigger data-testid={`${testIdPrefix}-name`}><SelectValue placeholder="Select certification…" /></SelectTrigger>
                <SelectContent>
                  {availableNames.map((n) => <SelectItem key={n} value={n}>{n}</SelectItem>)}
                </SelectContent>
              </Select>
            )}
          </div>
          <div><Label>Certificate # *</Label><Input value={form.certNumber} onChange={e => setForm({ ...form, certNumber: e.target.value })} data-testid={`${testIdPrefix}-cert-number`} /></div>
          <div><Label>Issuer</Label><Input value={form.issuer} onChange={e => setForm({ ...form, issuer: e.target.value })} placeholder="Optional" /></div>
          <div className="grid grid-cols-2 gap-2">
            <div><Label>Issued</Label><Input type="date" value={form.issuedDate} onChange={e => setForm({ ...form, issuedDate: e.target.value })} /></div>
            <div><Label>Expires</Label><Input type="date" value={form.expirationDate} onChange={e => setForm({ ...form, expirationDate: e.target.value })} /></div>
          </div>
          <div>
            <Label>Document</Label>
            <input type="file" accept="image/*,application/pdf" onChange={onUpload} className="text-sm" />
            {uploading && <p className="text-xs text-muted-foreground">Uploading…</p>}
            {isSafeUrl(form.documentUrl) && <a href={form.documentUrl} target="_blank" rel="noreferrer" className="text-xs text-blue-600 underline block mt-1">Current document</a>}
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <PillButton color="red" onClick={() => setOpen(false)}>Cancel</PillButton>
            <PillButton color="blue" onClick={submitDialog} disabled={create.isPending || update.isPending}>{editing ? "Save" : "Add"}</PillButton>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );

  if (variant === "inline") {
    return (
      <div className="rounded-md border p-3 space-y-3" data-testid={`${testIdPrefix}-section`}>
        <div className="flex flex-row items-center gap-2 mb-1">
          <p className="text-sm font-semibold flex items-center gap-2 flex-1">
            <ShieldCheck className="w-4 h-4 text-amber-500" />
            Certifications &amp; Training ({certs?.length || 0})
          </p>
        </div>
        {addCertPicker}
        {inlineCertRows}
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
        {cardCertRows}
        {editDialog}
      </CardContent>
    </Card>
  );
}
