import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListEmployeeCertifications,
  useCreateEmployeeCertification,
  useUpdateEmployeeCertification,
  useDeleteEmployeeCertification,
  getListEmployeeCertificationsQueryKey,
  type EmployeeCertification,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PillButton } from "@/components/pill";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { ShieldCheck, Plus, Pencil, Trash2 } from "lucide-react";
import TogglePill, { TogglePillButton } from "@/components/toggle-pill";
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
  // "Valid" pill upgraded to canonical TogglePill (green = ON /
  // valid status per the established palette doctrine), height=24
  // to match the surrounding StatusBadge family. Expired and
  // Expires-soon variants intentionally left as-is per scope.
  return <TogglePill color="green">Valid</TogglePill>;
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

export default function CertificationsSection({ employeeId }: { employeeId: number }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: certs, isLoading } = useListEmployeeCertifications(employeeId, { query: { queryKey: getListEmployeeCertificationsQueryKey(employeeId) } });
  const create = useCreateEmployeeCertification();
  const update = useUpdateEmployeeCertification();
  const remove = useDeleteEmployeeCertification();

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<EmployeeCertification | null>(null);
  const [form, setForm] = useState<FormState>(blankForm);
  const [uploading, setUploading] = useState(false);

  const invalidate = () => qc.invalidateQueries({ queryKey: getListEmployeeCertificationsQueryKey(employeeId) });

  const startAdd = () => { setEditing(null); setForm(blankForm); setOpen(true); };
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

  const submit = async () => {
    if (!form.name.trim()) { toast({ title: "Name is required", variant: "destructive" }); return; }
    const data = {
      name: form.name.trim(),
      issuer: form.issuer || null,
      certNumber: form.certNumber || null,
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

  return (
    <Card data-testid="employee-certifications-section">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
        <CardTitle className="flex items-center gap-2">
          <ShieldCheck className="w-5 h-5 text-amber-500" />
          Certifications &amp; Training ({certs?.length || 0})
        </CardTitle>
        {/* Add → canonical TogglePillButton blue (primary action),
            height=24 to match the surrounding pill family. */}
        <TogglePillButton color="blue" onClick={startAdd} data-testid="button-add-certification"><Plus className="w-4 h-4" />Add</TogglePillButton>
      </CardHeader>
      <CardContent>
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
                {/* Edit / Delete icon row: tightened with gap-0 +
                    h-7/w-7/p-0/min-h-0 button overrides so the two
                    icons sit visually adjacent. (`size="sm"` injects
                    `min-h-8` which would otherwise prevent h-7 from
                    taking effect — `min-h-0` clears that floor.)
                    Both icons render gray at rest; on hover the Edit
                    icon flips to blue (primary) and the Trash icon
                    flips to red (destructive), matching the brand-
                    aware chrome doctrine. The `group` class on each
                    Button lets `group-hover:` on the inner svg react
                    to the button's hover state. */}
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

        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><span /></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>{editing ? "Edit certification" : "Add certification"}</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div><Label>Name *</Label><Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="e.g. PEC, OSHA 10, H2S Clear" /></div>
              <div><Label>Issuer</Label><Input value={form.issuer} onChange={e => setForm({ ...form, issuer: e.target.value })} placeholder="e.g. PEC Premier" /></div>
              <div><Label>Certificate #</Label><Input value={form.certNumber} onChange={e => setForm({ ...form, certNumber: e.target.value })} /></div>
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
                <PillButton color="blue" onClick={submit} disabled={create.isPending || update.isPending}>{editing ? "Save" : "Add"}</PillButton>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}
