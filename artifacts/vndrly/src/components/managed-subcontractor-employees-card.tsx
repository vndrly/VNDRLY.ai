import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Plus, UserCheck } from "lucide-react";
import { useTranslation } from "react-i18next";
import BrandPillButton from "@/components/brand-pill-button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type Role = "gatekeeper" | "gate_supervisor";
type Worker = {
  id: string;
  name: string;
  email: string;
  jobTitle?: string | null;
  phone?: string | null;
  role: Role | null;
  status: string;
  siteIds: number[];
};
type Company = { id: string; name: string; status: string; workers: Worker[] };
type Data = { items: Company[]; sites: { id: number; name: string }[] };
type Row = Worker & { companyId: string; subcontractor: string };
type SortKey = "subcontractor" | "jobTitle" | "name" | "email" | "phone" | "role" | "sites" | "status";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

async function request<T>(url: string, method = "GET", body?: unknown): Promise<T> {
  const response = await fetch(`${BASE}${url}`, {
    method,
    credentials: "include",
    ...(body ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(typeof data?.error === "string" ? data.error : "Request failed");
  return data as T;
}

export default function ManagedSubcontractorEmployeesCard({ vendorId }: { vendorId: number }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const base = `/api/vendors/${vendorId}/managed-subcontractors`;
  const queryKey = ["vendor-managed-subcontractors", vendorId];
  const query = useQuery({ queryKey, queryFn: () => request<Data>(base) });
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({ key: "subcontractor", dir: "asc" });
  const [editor, setEditor] = useState<null | {
    companyId: string;
    workerId?: string;
    name: string;
    email: string;
    role: Role;
    siteIds: number[];
  }>(null);
  const mutation = useMutation({
    mutationFn: (value: NonNullable<typeof editor>) =>
      request(`${base}/${value.companyId}/workers${value.workerId ? `/${value.workerId}` : ""}`, value.workerId ? "PATCH" : "POST", value.workerId
        ? { role: value.role, siteIds: value.siteIds }
        : { name: value.name.trim(), email: value.email.trim(), role: value.role, siteIds: value.siteIds }),
    onSuccess: async () => {
      setEditor(null);
      await queryClient.invalidateQueries({ queryKey });
    },
  });
  const rows = useMemo<Row[]>(() => (query.data?.items ?? []).flatMap((company) =>
    company.workers.map((worker) => ({ ...worker, companyId: company.id, subcontractor: company.name }))), [query.data]);
  const siteNames = (row: Row) => row.siteIds.map((id) => query.data?.sites.find((site) => site.id === id)?.name ?? "").filter(Boolean).join(", ");
  const sorted = useMemo(() => [...rows].sort((a, b) => {
    const value = (row: Row) => sort.key === "sites" ? siteNames(row) : String(row[sort.key] ?? "");
    return value(a).localeCompare(value(b), undefined, { numeric: true, sensitivity: "base" }) * (sort.dir === "asc" ? 1 : -1);
  }), [rows, sort, query.data]);
  const toggleSort = (key: SortKey) => setSort((current) => ({ key, dir: current.key === key && current.dir === "asc" ? "desc" : "asc" }));
  const header = (key: SortKey, label: string) => (
    <TableHead className="cursor-pointer select-none" onClick={() => toggleSort(key)}>
      <span className="flex items-center gap-1">{label}{sort.key === key ? sort.dir === "asc" ? <ArrowUp className="h-3 w-3" style={{ color: "var(--brand-primary)" }} /> : <ArrowDown className="h-3 w-3" style={{ color: "var(--brand-primary)" }} /> : null}</span>
    </TableHead>
  );
  const openNew = () => {
    const company = query.data?.items.find((item) => item.status === "managed");
    if (company) setEditor({ companyId: company.id, name: "", email: "", role: "gatekeeper", siteIds: [] });
  };

  return (
    <Card data-testid="managed-subcontractor-employees-section">
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
        <CardTitle className="flex items-center gap-2">
          <UserCheck className="h-5 w-5" style={{ color: "var(--brand-primary)" }} />
          {t("managedSubcontractors.title")} ({rows.length})
        </CardTitle>
        <BrandPillButton tone="blue" disabled={!query.data?.items.some((item) => item.status === "managed")} onClick={openNew}>
          <Plus className="h-4 w-4" />{t("managedSubcontractors.addSubcontractedEmployee")}
        </BrandPillButton>
      </CardHeader>
      <CardContent className="p-0">
        {query.isLoading ? <div className="p-6"><Skeleton className="h-10 w-full" /></div> : query.isError ? (
          <div className="p-6 text-sm text-destructive">{t("managedSubcontractors.loadFailed")}</div>
        ) : rows.length ? (
          <Table>
            <TableHeader><TableRow>
              {header("subcontractor", t("managedSubcontractors.subcontractor"))}
              {header("jobTitle", t("fieldEmployees.jobTitle"))}
              {header("name", t("fieldEmployees.name"))}
              {header("email", t("fieldEmployees.email"))}
              {header("phone", t("fieldEmployees.phone"))}
              {header("role", t("managedSubcontractors.role"))}
              {header("sites", t("managedSubcontractors.siteAccess"))}
              {header("status", t("managedSubcontractors.status"))}
              <TableHead>{t("managedSubcontractors.actions")}</TableHead>
            </TableRow></TableHeader>
            <TableBody>{sorted.map((row) => <TableRow key={row.id}>
              <TableCell className="font-medium">{row.subcontractor}</TableCell>
              <TableCell>{row.jobTitle || "—"}</TableCell>
              <TableCell>{row.name}</TableCell>
              <TableCell>{row.email}</TableCell>
              <TableCell>{row.phone || "—"}</TableCell>
              <TableCell>{t(`managedSubcontractors.${row.role ?? "noRole"}`)}</TableCell>
              <TableCell>{siteNames(row) || "—"}</TableCell>
              <TableCell>{t(`managedSubcontractors.${row.status === "active" ? "active" : row.status === "paused" ? "paused" : "terminated"}`)}</TableCell>
              <TableCell><BrandPillButton tone="blue" onClick={() => setEditor({ companyId: row.companyId, workerId: row.id, name: row.name, email: row.email, role: row.role ?? "gatekeeper", siteIds: [...row.siteIds] })}>{t("managedSubcontractors.editAccess")}</BrandPillButton></TableCell>
            </TableRow>)}</TableBody>
          </Table>
        ) : <div className="p-6 text-center text-sm text-muted-foreground">{t("managedSubcontractors.noWorkers")}</div>}
      </CardContent>
      <Dialog open={!!editor} onOpenChange={(open) => { if (!open) setEditor(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>{t(editor?.workerId ? "managedSubcontractors.editAccess" : "managedSubcontractors.addSubcontractedEmployee")}</DialogTitle></DialogHeader>
          {editor && <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); mutation.mutate(editor); }}>
            {!editor.workerId && <>
              <Label htmlFor="managed-company">{t("managedSubcontractors.subcontractor")}</Label>
              <select id="managed-company" className="w-full rounded-md border bg-background p-2" value={editor.companyId} onChange={(event) => setEditor({ ...editor, companyId: event.target.value })}>
                {query.data?.items.filter((item) => item.status === "managed").map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
              <Label htmlFor="managed-worker-name">{t("managedSubcontractors.workerName")}</Label>
              <Input id="managed-worker-name" required value={editor.name} onChange={(event) => setEditor({ ...editor, name: event.target.value })} />
              <Label htmlFor="managed-worker-email">{t("managedSubcontractors.email")}</Label>
              <Input id="managed-worker-email" type="email" required value={editor.email} onChange={(event) => setEditor({ ...editor, email: event.target.value })} />
            </>}
            <Label htmlFor="managed-worker-role">{t("managedSubcontractors.role")}</Label>
            <select id="managed-worker-role" className="w-full rounded-md border bg-background p-2" value={editor.role} onChange={(event) => setEditor({ ...editor, role: event.target.value as Role })}>
              <option value="gatekeeper">{t("managedSubcontractors.gatekeeper")}</option>
              <option value="gate_supervisor">{t("managedSubcontractors.gate_supervisor")}</option>
            </select>
            <fieldset className="space-y-2"><legend className="text-sm font-medium">{t("managedSubcontractors.sites")}</legend>
              {query.data?.sites.map((site) => <label key={site.id} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={editor.siteIds.includes(site.id)} onChange={(event) => setEditor({ ...editor, siteIds: event.target.checked ? [...editor.siteIds, site.id] : editor.siteIds.filter((id) => id !== site.id) })} />{site.name}</label>)}
            </fieldset>
            {mutation.isError && <p className="text-sm text-destructive">{mutation.error.message}</p>}
            <div className="flex gap-2"><BrandPillButton type="submit" tone="blue" disabled={mutation.isPending || !editor.siteIds.length}>{t("managedSubcontractors.saveWorker")}</BrandPillButton><BrandPillButton onClick={() => setEditor(null)}>{t("managedSubcontractors.cancel")}</BrandPillButton></div>
          </form>}
        </DialogContent>
      </Dialog>
    </Card>
  );
}
