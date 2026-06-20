import { useState, useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import {
  useListVendors,
  getGetVendorSiteAfesQueryOptions,
} from "@workspace/api-client-react";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogLogoHeader } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ShoppingCart, Plus, Pencil, Trash2, ArrowUp, ArrowDown, ArrowUpDown, Download, Upload, Activity } from "lucide-react";
import { CARD_TITLE_ICON_CLASS } from "@/components/ui/card";
import { useBrand } from "@/hooks/use-brand";
import { PngPillButton } from "@/components/png-pill-rollover";
import ContentPaneBackLink from "@/components/content-pane-back-link";
import { PillColorLayer } from "@/components/png-pill-chrome";
import { pillBlue } from "@/lib/pill-palette-assets";
import AfePill from "@/components/afe-pill";
import { useToast } from "@/hooks/use-toast";
import { translateApiError } from "@/lib/api-error";

type CsvRow = {
  name: string;
  category: string;
  description: string;
  estimatedDuration: string;
  estimatedPrice: string;
  vendors: string;
};

type ImportSummary = {
  created: number;
  updated: number;
  total: number;
  errors: { row: number; message: string }[];
  unknownVendors: string[];
};

const CSV_HEADERS = ["name", "category", "duration", "price", "description", "vendors"] as const;

function csvEscape(value: string): string {
  if (value === "" || value == null) return "";
  if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

function buildCsv(rows: WorkType[]): string {
  const lines: string[] = [CSV_HEADERS.join(",")];
  for (const wt of rows) {
    const cells = [
      wt.name ?? "",
      wt.category ?? "",
      wt.estimatedDuration ?? "",
      wt.estimatedPrice ?? "",
      wt.description ?? "",
      wt.vendors?.map((v) => v.name).join(";") ?? "",
    ];
    lines.push(cells.map((c) => csvEscape(String(c))).join(","));
  }
  return lines.join("\r\n");
}

function downloadFile(filename: string, content: string, mime = "text/csv;charset=utf-8") {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let cur: string[] = [];
  let field = "";
  let i = 0;
  let inQuotes = false;
  const stripped = text.replace(/^\uFEFF/, "");
  while (i < stripped.length) {
    const ch = stripped[i];
    if (inQuotes) {
      if (ch === '"') {
        if (stripped[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }
    if (ch === '"') { inQuotes = true; i++; continue; }
    if (ch === ",") { cur.push(field); field = ""; i++; continue; }
    if (ch === "\r") { i++; continue; }
    if (ch === "\n") { cur.push(field); rows.push(cur); cur = []; field = ""; i++; continue; }
    field += ch;
    i++;
  }
  if (field !== "" || cur.length > 0) {
    cur.push(field);
    rows.push(cur);
  }
  return rows.filter((r) => r.length > 0 && r.some((c) => (c ?? "").trim() !== ""));
}

function rowsFromCsv(text: string): CsvRow[] {
  const grid = parseCsv(text);
  if (grid.length === 0) return [];
  const header = grid[0].map((h) => h.trim().toLowerCase());
  const idx = (key: string) => header.indexOf(key);
  const out: CsvRow[] = [];
  for (let r = 1; r < grid.length; r++) {
    const row = grid[r];
    const get = (key: string) => {
      const j = idx(key);
      return j >= 0 && j < row.length ? (row[j] ?? "").trim() : "";
    };
    const entry = {
      name: get("name"),
      category: get("category"),
      estimatedDuration: get("duration") || get("estimatedduration"),
      estimatedPrice: get("price") || get("estimatedprice"),
      description: get("description"),
      vendors: get("vendors") || get("vendor"),
    };
    if (Object.values(entry).every((v) => v === "")) continue;
    out.push(entry);
  }
  return out;
}

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
function apiFetch(path: string, opts?: RequestInit) {
  return fetch(`${BASE}${path}`, { credentials: "include", ...opts });
}

interface WorkType {
  id: number;
  name: string;
  category: string;
  description: string | null;
  estimatedDuration: string | null;
  estimatedPrice: string | null;
  requiredCertifications: string[] | null;
  blockingCertifications: string[] | null;
  taxTreatment: string | null;
  vendors: { id: number; name: string }[];
}

const TAX_TREATMENT_AUTO = "__auto__";

function taxTreatmentForApi(raw: string): string | null {
  if (!raw || raw === TAX_TREATMENT_AUTO) return null;
  return raw;
}

function parseCertList(raw: string): string[] | null {
  const items = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return items.length > 0 ? items : null;
}

const PLATFORM_WORK_TYPES_KEY = ["work-types", "platform"] as const;

export default function Catalog() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const brand = useBrand();
  const iconStyle = { color: brand.isOrgBranded ? brand.primary : "#f59e0b" };
  const { data: rawWorkTypes, isLoading } = useQuery({
    queryKey: PLATFORM_WORK_TYPES_KEY,
    queryFn: async () => {
      const res = await apiFetch("/api/work-types?scope=platform");
      if (!res.ok) throw new Error(`status ${res.status}`);
      return res.json() as Promise<WorkType[]>;
    },
  });
  const { data: allVendors } = useListVendors();
  const [workTypes, setWorkTypes] = useState<WorkType[]>([]);
  const [addOpen, setAddOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [selected, setSelected] = useState<WorkType | null>(null);
  // vendorSiteAfes is a per-(vendor × site-location) AFE matrix that mirrors
  // the vendor_site_location_afes table. Indexed by vendorId then
  // siteLocationId so toggling either dimension is O(1) and unchecking a
  // vendor preserves their AFEs in case the user re-checks them.
  const [form, setForm] = useState({
    name: "",
    category: "",
    description: "",
    estimatedDuration: "",
    estimatedPrice: "",
    vendorIds: [] as number[],
    vendorSiteAfes: {} as Record<number, Record<number, string>>,
    siteLocationIds: [] as number[],
    requiredCertifications: "",
    blockingCertifications: "",
    taxTreatment: "",
  });
  // Snapshot at modal open used to send only changed rows on save.
  const [initialVendorSiteAfes, setInitialVendorSiteAfes] = useState<
    Record<number, Record<number, string>>
  >({});
  // Site locations linked to the work type currently being edited, joined
  // with their owning partner. The first entry's partner logo is rendered
  // above the modal header.
  type SiteLocOption = { id: number; name: string; partnerId: number; partnerName: string; partnerLogoUrl: string | null };
  const [siteLocOptions, setSiteLocOptions] = useState<SiteLocOption[]>([]);
  const [saving, setSaving] = useState(false);
  // Inline error rendered under the name field when the server returns
  // 409 `work_type.duplicate_name` (case/whitespace-insensitive collision
  // against `work_types_canonical_name_unique`). Cleared on input change
  // and on modal open/reset so a stale message doesn't linger.
  const [nameError, setNameError] = useState<string | null>(null);
  const [sortCol, setSortCol] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  useEffect(() => {
    if (rawWorkTypes) {
      setWorkTypes(rawWorkTypes as unknown as WorkType[]);
    }
  }, [rawWorkTypes]);

  const handleSort = (col: string) => {
    if (sortCol === col) {
      if (sortDir === "asc") setSortDir("desc");
      else { setSortCol(null); setSortDir("asc"); }
    } else {
      setSortCol(col);
      setSortDir("asc");
    }
  };

  const sortIcon = (col: string) => {
    if (sortCol !== col) return <ArrowUpDown className="w-3.5 h-3.5 opacity-40" />;
    return sortDir === "asc" ? <ArrowUp className="w-3.5 h-3.5 text-amber-500" /> : <ArrowDown className="w-3.5 h-3.5 text-amber-500" />;
  };

  const sortedWorkTypes = (() => {
    if (!workTypes || !sortCol) return workTypes;
    const sorted = [...workTypes].sort((a, b) => {
      let aVal: string | number = "";
      let bVal: string | number = "";
      switch (sortCol) {
        case "name": aVal = a.name.toLowerCase(); bVal = b.name.toLowerCase(); break;
        case "category": aVal = a.category.toLowerCase(); bVal = b.category.toLowerCase(); break;
        case "duration": aVal = (a.estimatedDuration || "").toLowerCase(); bVal = (b.estimatedDuration || "").toLowerCase(); break;
        case "vendor": aVal = (a.vendors?.map(v => v.name).join(", ") || "").toLowerCase(); bVal = (b.vendors?.map(v => v.name).join(", ") || "").toLowerCase(); break;
        case "price": aVal = Number(a.estimatedPrice || 0); bVal = Number(b.estimatedPrice || 0); break;
        case "description": aVal = (a.description || "").toLowerCase(); bVal = (b.description || "").toLowerCase(); break;
      }
      if (aVal < bVal) return sortDir === "asc" ? -1 : 1;
      if (aVal > bVal) return sortDir === "asc" ? 1 : -1;
      return 0;
    });
    return sorted;
  })();

  // Inline AFE pills per work-type row (Task #818). Reuses the bulk
  // `/api/vendors/:id/site-afes` endpoint — same source of truth as
  // vendor-catalog.tsx — so the pill values agree across both pages.
  const uniqueVendorIds = useMemo(() => {
    const set = new Set<number>();
    for (const wt of workTypes ?? []) {
      for (const v of wt.vendors ?? []) set.add(v.id);
    }
    return Array.from(set).sort((a, b) => a - b);
  }, [workTypes]);

  const vendorAfeQueries = useQueries({
    queries: uniqueVendorIds.map((vid) => ({
      ...getGetVendorSiteAfesQueryOptions(vid),
    })),
  });

  const isLoadingBulkAfes =
    uniqueVendorIds.length > 0 &&
    vendorAfeQueries.some((q) => q.isLoading);

  // Aggregate per work-type: union of unique AFE values across every
  // (vendor, site) pair returned for vendors on that row. Blank AFEs
  // and any extra unique values fold into the "+N more" overflow.
  const afesByWorkType = useMemo(() => {
    const itemsByVendor = new Map<
      number,
      { workTypeId: number; afe: string | null }[]
    >();
    uniqueVendorIds.forEach((vid, i) => {
      itemsByVendor.set(vid, vendorAfeQueries[i]?.data?.items ?? []);
    });
    const m = new Map<
      number,
      { uniqueAfes: string[]; sitesWithoutAfe: number }
    >();
    for (const wt of workTypes ?? []) {
      const entry = { uniqueAfes: [] as string[], sitesWithoutAfe: 0 };
      const seen = new Set<string>();
      for (const v of wt.vendors ?? []) {
        for (const it of itemsByVendor.get(v.id) ?? []) {
          if (it.workTypeId !== wt.id) continue;
          const afe = (it.afe ?? "").trim();
          if (afe === "") {
            entry.sitesWithoutAfe += 1;
          } else if (!seen.has(afe)) {
            seen.add(afe);
            entry.uniqueAfes.push(afe);
          }
        }
      }
      m.set(wt.id, entry);
    }
    return m;
  }, [workTypes, uniqueVendorIds, vendorAfeQueries]);

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: PLATFORM_WORK_TYPES_KEY });

  const resetForm = () => {
    setForm({
      name: "",
      category: "",
      description: "",
      estimatedDuration: "",
      estimatedPrice: "",
      vendorIds: [],
      vendorSiteAfes: {},
      siteLocationIds: [],
      requiredCertifications: "",
      blockingCertifications: "",
      taxTreatment: "",
    });
    setInitialVendorSiteAfes({});
    setSiteLocOptions([]);
    setNameError(null);
  };

  // Pull every site location available to this user so the picker can
  // multi-select the ones this product/service applies to. Each row carries
  // its owning partner's logo so the modal can show the first one on top.
  const [allSiteLocs, setAllSiteLocs] = useState<SiteLocOption[]>([]);
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const [siteRes, partnerRes] = await Promise.all([
          apiFetch("/api/site-locations"),
          apiFetch("/api/partners"),
        ]);
        if (!siteRes.ok || !partnerRes.ok) return;
        const sites = (await siteRes.json()) as Array<{
          id: number;
          name: string;
          partnerId: number;
          partnerName?: string | null;
        }>;
        const partners = (await partnerRes.json()) as Array<{
          id: number;
          name: string;
          logoUrl?: string | null;
        }>;
        const partnerById = new Map(partners.map((p) => [p.id, p]));
        const opts: SiteLocOption[] = sites.map((s) => {
          const p = partnerById.get(s.partnerId);
          return {
            id: s.id,
            name: s.name,
            partnerId: s.partnerId,
            partnerName: s.partnerName ?? p?.name ?? "",
            partnerLogoUrl: p?.logoUrl ?? null,
          };
        });
        if (!cancelled) setAllSiteLocs(opts);
      } catch {
        // Non-fatal — modal still works without site location options.
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  // Send only the vendor AFEs that actually changed to avoid no-op writes,
  // and so that vendor entries left blank from the start are not classified
  // as "cleared".
  const persistSiteLocations = async (workTypeId: number) => {
    const res = await apiFetch(`/api/work-types/${workTypeId}/site-locations`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ siteLocationIds: form.siteLocationIds }),
    });
    if (!res.ok) throw new Error(`Site location save failed: status ${res.status}`);
  };

  // Diff the (vendor × site_location) AFE matrix against its snapshot and
  // POST only changed cells. Cells default to "" so a vendor or site that's
  // been unchecked correctly clears any AFE it had on the server.
  const persistVendorSiteAfes = async (workTypeId: number) => {
    const items: { vendorId: number; siteLocationId: number; afe: string }[] = [];
    const vendorIds = new Set<number>([
      ...Object.keys(form.vendorSiteAfes).map((k) => Number(k)),
      ...Object.keys(initialVendorSiteAfes).map((k) => Number(k)),
    ]);
    for (const vid of vendorIds) {
      const nextRow = form.vendorSiteAfes[vid] ?? {};
      const prevRow = initialVendorSiteAfes[vid] ?? {};
      const siteIds = new Set<number>([
        ...Object.keys(nextRow).map((k) => Number(k)),
        ...Object.keys(prevRow).map((k) => Number(k)),
      ]);
      const vendorIsChecked = form.vendorIds.includes(vid);
      for (const sid of siteIds) {
        const siteIsChecked = form.siteLocationIds.includes(sid);
        // Treat unchecked vendors or unchecked site locations as blank so
        // the server clears any prior AFE for those (vendor, site) pairs.
        const next =
          vendorIsChecked && siteIsChecked
            ? (nextRow[sid] ?? "").trim()
            : "";
        const prev = (prevRow[sid] ?? "").trim();
        if (next === prev) continue;
        items.push({ vendorId: vid, siteLocationId: sid, afe: next });
      }
    }
    if (items.length === 0) return;
    const res = await apiFetch(
      `/api/work-types/${workTypeId}/vendor-site-afes`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items }),
      },
    );
    if (!res.ok) throw new Error(`AFE save failed: status ${res.status}`);
  };

  // Inspect a non-OK response from POST/PUT /work-types. If it's the
  // structured 409 `work_type.duplicate_name` payload from the server,
  // run it through `translateApiError` (so the EN/ES copy interpolates
  // the conflicting name) and stash the message in `nameError` for
  // inline rendering. Returns true when the response was the 409 and
  // the caller should bail out; false otherwise so the caller can
  // continue with its normal failure path.
  const handleWorkTypeNameConflictResponse = async (
    res: Response,
  ): Promise<boolean> => {
    if (res.status !== 409) return false;
    let data: { code?: string; error?: string; details?: Record<string, unknown> } | null = null;
    try {
      data = await res.json();
    } catch {
      return false;
    }
    if (data?.code !== "work_type.duplicate_name") return false;
    const fakeError = Object.assign(new Error(data?.error ?? "duplicate name"), {
      status: 409,
      data,
    });
    setNameError(translateApiError(fakeError, t, data?.error ?? t("catalog.duplicateNameInline")));
    return true;
  };

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setNameError(null);
    try {
      const res = await apiFetch("/api/work-types", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          category: form.category,
          description: form.description || null,
          estimatedDuration: form.estimatedDuration || null,
          estimatedPrice: form.estimatedPrice || null,
          requiredCertifications: parseCertList(form.requiredCertifications),
          blockingCertifications: parseCertList(form.blockingCertifications),
          taxTreatment: taxTreatmentForApi(form.taxTreatment),
          vendorIds: form.vendorIds,
        }),
      });
      if (!res.ok) {
        // Surface the server's structured 409 inline next to the name
        // field so the admin understands which field needs attention,
        // instead of a generic toast / 500 blob. Other errors fall
        // through to the toast below.
        if (await handleWorkTypeNameConflictResponse(res)) {
          setSaving(false);
          return;
        }
        throw new Error(`status ${res.status}`);
      }
      const created = (await res.json()) as { id: number };
      // Order matters: site locations must be linked before AFE rows
      // because the AFE matrix endpoint validates against the
      // (vendor_work_types × work_type_site_locations) intersection.
      // The work-type POST above already wrote vendor_work_types via
      // vendorIds, so by the time we hit the matrix endpoint both
      // dimensions of the allowed set are correct.
      await persistSiteLocations(created.id);
      await persistVendorSiteAfes(created.id);
      invalidate();
      setAddOpen(false);
      resetForm();
      toast({ title: t("catalog.addedToast") });
    } catch {
      toast({ title: t("catalog.addFailed"), variant: "destructive" });
    }
    setSaving(false);
  };

  const handleEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selected) return;
    setSaving(true);
    setNameError(null);
    try {
      const res = await apiFetch(`/api/work-types/${selected.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          category: form.category,
          description: form.description || null,
          estimatedDuration: form.estimatedDuration || null,
          estimatedPrice: form.estimatedPrice || null,
          requiredCertifications: parseCertList(form.requiredCertifications),
          blockingCertifications: parseCertList(form.blockingCertifications),
          taxTreatment: taxTreatmentForApi(form.taxTreatment),
          vendorIds: form.vendorIds,
        }),
      });
      if (!res.ok) {
        if (await handleWorkTypeNameConflictResponse(res)) {
          setSaving(false);
          return;
        }
        throw new Error(`status ${res.status}`);
      }
      // Site locations first, then matrix — see handleAdd for why.
      await persistSiteLocations(selected.id);
      await persistVendorSiteAfes(selected.id);
      invalidate();
      setEditOpen(false);
      setSelected(null);
      toast({ title: t("catalog.updatedToast") });
    } catch {
      toast({ title: t("catalog.updateFailed"), variant: "destructive" });
    }
    setSaving(false);
  };

  const handleDelete = async () => {
    if (!selected) return;
    setSaving(true);
    try {
      await apiFetch(`/api/work-types/${selected.id}`, { method: "DELETE" });
      invalidate();
      setDeleteOpen(false);
      setSelected(null);
      toast({ title: t("catalog.removedToast") });
    } catch {
      toast({ title: t("catalog.removeFailed"), variant: "destructive" });
    }
    setSaving(false);
  };

  const openEdit = async (wt: WorkType) => {
    setSelected(wt);
    setNameError(null);
    // Hydrate form from server: the (vendor × site_location) AFE matrix
    // plus the linked site locations. Failures fall back to empty so the
    // modal still opens — admins can re-enter values manually.
    let vendorSiteAfes: Record<number, Record<number, string>> = {};
    let siteLocs: SiteLocOption[] = [];
    try {
      const [afeRes, sitesRes] = await Promise.all([
        apiFetch(`/api/work-types/${wt.id}/vendor-site-afes`),
        apiFetch(`/api/work-types/${wt.id}/site-locations`),
      ]);
      if (afeRes.ok) {
        const data = (await afeRes.json()) as {
          items: { vendorId: number; siteLocationId: number; afe: string }[];
        };
        for (const it of data.items) {
          if (!vendorSiteAfes[it.vendorId]) vendorSiteAfes[it.vendorId] = {};
          vendorSiteAfes[it.vendorId][it.siteLocationId] = it.afe;
        }
      }
      if (sitesRes.ok) {
        const data = (await sitesRes.json()) as {
          items: {
            siteLocationId: number;
            siteLocationName: string;
            partnerId: number;
            partnerName: string;
            partnerLogoUrl: string | null;
          }[];
        };
        siteLocs = data.items.map((it) => ({
          id: it.siteLocationId,
          name: it.siteLocationName,
          partnerId: it.partnerId,
          partnerName: it.partnerName,
          partnerLogoUrl: it.partnerLogoUrl,
        }));
      }
    } catch {
      vendorSiteAfes = {};
      siteLocs = [];
    }
    // Deep-clone the snapshot so later edits to form.vendorSiteAfes don't
    // mutate it (would otherwise defeat the diff in persistVendorSiteAfes).
    const snapshot: Record<number, Record<number, string>> = {};
    for (const [vid, row] of Object.entries(vendorSiteAfes)) {
      snapshot[Number(vid)] = { ...row };
    }
    setForm({
      name: wt.name,
      category: wt.category,
      description: wt.description || "",
      estimatedDuration: wt.estimatedDuration || "",
      estimatedPrice: wt.estimatedPrice || "",
      vendorIds: wt.vendors?.map((v) => v.id) || [],
      vendorSiteAfes,
      siteLocationIds: siteLocs.map((s) => s.id),
      requiredCertifications: (wt.requiredCertifications ?? []).join(", "),
      blockingCertifications: (wt.blockingCertifications ?? []).join(", "),
      taxTreatment: wt.taxTreatment ?? "",
    });
    setInitialVendorSiteAfes(snapshot);
    setSiteLocOptions(siteLocs);
    setEditOpen(true);
  };

  const openDelete = (wt: WorkType) => {
    setSelected(wt);
    setDeleteOpen(true);
  };

  const toggleVendor = (vendorId: number) => {
    setForm((prev) => ({
      ...prev,
      vendorIds: prev.vendorIds.includes(vendorId)
        ? prev.vendorIds.filter((id) => id !== vendorId)
        : [...prev.vendorIds, vendorId],
    }));
  };

  const categories = workTypes ? [...new Set(workTypes.map((w) => w.category))].sort() : [];

  // CSV import state
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [importRows, setImportRows] = useState<CsvRow[]>([]);
  const [importFileName, setImportFileName] = useState("");
  const [importError, setImportError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [importSummary, setImportSummary] = useState<ImportSummary | null>(null);

  const handleExport = () => {
    if (!workTypes || workTypes.length === 0) {
      toast({ title: t("catalog.exportEmpty") });
      return;
    }
    const csv = buildCsv(sortedWorkTypes ?? workTypes);
    const stamp = new Date().toISOString().slice(0, 10);
    downloadFile(`product-service-catalog-${stamp}.csv`, csv);
  };

  const handleDownloadTemplate = () => {
    const sample = [
      CSV_HEADERS.join(","),
      `"Sample Service","Earthworks","4 hours","250.00","Optional description","Vendor One;Vendor Two"`,
    ].join("\n");
    downloadFile("product-service-catalog-template.csv", sample);
  };

  const openImportDialog = () => {
    setImportRows([]);
    setImportFileName("");
    setImportError(null);
    setImportSummary(null);
    setImportOpen(true);
    setTimeout(() => fileInputRef.current?.click(), 0);
  };

  const handleFilePicked = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setImportError(null);
    setImportSummary(null);
    try {
      const text = await file.text();
      const rows = rowsFromCsv(text);
      setImportRows(rows);
      setImportFileName(file.name);
    } catch {
      setImportError(t("catalog.importParseError"));
    }
  };

  const runImport = async () => {
    setImporting(true);
    setImportError(null);
    try {
      const res = await apiFetch("/api/work-types/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows: importRows }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error || t("catalog.importFailed"));
      }
      const summary = (await res.json()) as ImportSummary;
      setImportSummary(summary);
      invalidate();
      toast({
        title: t("catalog.importDoneTitle"),
        description: `${t("catalog.importDoneSummary", {
          created: summary.created,
          updated: summary.updated,
          errors: summary.errors.length,
        })} ${t("catalog.importVendorsNotified")}`,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : t("catalog.importFailed");
      setImportError(message);
      toast({ title: t("catalog.importFailed"), description: message, variant: "destructive" });
    }
    setImporting(false);
  };

  const toggleSiteLocation = (id: number) => {
    setForm((prev) => {
      const next = prev.siteLocationIds.includes(id)
        ? prev.siteLocationIds.filter((x) => x !== id)
        : [...prev.siteLocationIds, id];
      return { ...prev, siteLocationIds: next };
    });
  };

  // The partner whose logo sits above the modal header is the partner
  // owning the *first* selected site location (preserve user's selection
  // order when possible, otherwise fall back to the catalog's natural
  // order from openEdit).
  const headerPartner = (() => {
    const firstId = form.siteLocationIds[0];
    if (!firstId) return null;
    const fromOptions = siteLocOptions.find((s) => s.id === firstId)
      ?? allSiteLocs.find((s) => s.id === firstId);
    return fromOptions ?? null;
  })();

  const ModalLogoHeader = () =>
    headerPartner ? (
      <DialogLogoHeader
        src={headerPartner.partnerLogoUrl}
        alt={headerPartner.partnerName}
        fallbackName={headerPartner.partnerName}
        data-testid="modal-partner-logo"
      />
    ) : null;

  const formFields = (prefix: string) => (
    <>
      <div>
        <Label>{t("catalog.productOrService")}</Label>
        <Input
          value={form.name}
          onChange={(e) => {
            setForm({ ...form, name: e.target.value });
            // Clear the duplicate-name error as soon as the admin
            // edits the field — otherwise the inline message lingers
            // even after they've changed the conflicting text.
            if (nameError) setNameError(null);
          }}
          required
          aria-invalid={nameError ? true : undefined}
          aria-describedby={nameError ? `${prefix}-name-error` : undefined}
          data-testid={`${prefix}-input-name`}
        />
        {nameError && (
          <p
            id={`${prefix}-name-error`}
            role="alert"
            className="mt-1 text-xs text-red-600"
            data-testid={`${prefix}-name-error`}
          >
            {nameError}
          </p>
        )}
      </div>
      <div>
        <Label>{t("catalog.phaseOfConstruction")}</Label>
        <Input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} required data-testid={`${prefix}-input-category`} list={`${prefix}-category-suggestions`} />
        {categories.length > 0 && (
          <datalist id={`${prefix}-category-suggestions`}>
            {categories.map((c) => <option key={c} value={c} />)}
          </datalist>
        )}
      </div>
      <div>
        <Label>{t("catalog.taxTreatment")}</Label>
        <Select
          value={form.taxTreatment || TAX_TREATMENT_AUTO}
          onValueChange={(value) =>
            setForm((prev) => ({
              ...prev,
              taxTreatment: value === TAX_TREATMENT_AUTO ? "" : value,
            }))
          }
        >
          <SelectTrigger data-testid={`${prefix}-select-tax-treatment`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={TAX_TREATMENT_AUTO}>{t("taxTreatment.auto")}</SelectItem>
            <SelectItem value="exempt_labor">{t("taxTreatment.exempt_labor")}</SelectItem>
            <SelectItem value="taxable_repair_service">
              {t("taxTreatment.taxable_repair_service")}
            </SelectItem>
            <SelectItem value="taxable_all">{t("taxTreatment.taxable_all")}</SelectItem>
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground mt-1">{t("catalog.taxTreatmentHelp")}</p>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label>{t("catalog.duration")}</Label>
          <Input value={form.estimatedDuration} onChange={(e) => setForm({ ...form, estimatedDuration: e.target.value })} placeholder={t("catalog.durationPlaceholder")} data-testid={`${prefix}-input-duration`} />
        </div>
        <div>
          <Label>{t("catalog.price")}</Label>
          <Input type="number" step="0.01" min="0" value={form.estimatedPrice} onChange={(e) => setForm({ ...form, estimatedPrice: e.target.value })} placeholder="0.00" data-testid={`${prefix}-input-price`} />
        </div>
      </div>
      <div>
        <Label>{t("catalog.description")}</Label>
        <Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder={t("catalog.descriptionPlaceholder")} data-testid={`${prefix}-input-description`} />
      </div>
      <div>
        <Label>{t("catalog.requiredCertifications")}</Label>
        <Input
          value={form.requiredCertifications}
          onChange={(e) =>
            setForm({ ...form, requiredCertifications: e.target.value })
          }
          placeholder={t("catalog.certificationsPlaceholder")}
          data-testid={`${prefix}-input-required-certs`}
        />
      </div>
      <div>
        <Label>{t("catalog.blockingCertifications")}</Label>
        <Input
          value={form.blockingCertifications}
          onChange={(e) =>
            setForm({ ...form, blockingCertifications: e.target.value })
          }
          placeholder={t("catalog.certificationsPlaceholder")}
          data-testid={`${prefix}-input-blocking-certs`}
        />
      </div>
      <div>
        <Label>{t("catalog.siteLocations")}</Label>
        <p className="text-xs text-muted-foreground mt-1">{t("catalog.siteLocationsNote")}</p>
        <div className="mt-1 max-h-[180px] overflow-y-auto border rounded-md p-2 space-y-1">
          {allSiteLocs.length > 0 ? (
            allSiteLocs.map((s) => {
              const checked = form.siteLocationIds.includes(s.id);
              return (
                <label
                  key={s.id}
                  className="flex items-center gap-2 text-sm hover:bg-muted/50 rounded px-1 py-0.5 cursor-pointer"
                  data-testid={`${prefix}-site-location-row-${s.id}`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleSiteLocation(s.id)}
                    className="rounded"
                    data-testid={`${prefix}-site-location-checkbox-${s.id}`}
                  />
                  <span className="truncate flex-1">{s.name}</span>
                  <span className="text-xs text-muted-foreground truncate">{s.partnerName}</span>
                </label>
              );
            })
          ) : (
            <p className="text-xs text-muted-foreground">{t("catalog.noSiteLocations")}</p>
          )}
        </div>
      </div>
      <div>
        <Label>{t("catalog.vendors")}</Label>
        <p className="text-xs text-muted-foreground mt-1">{t("catalog.vendorSiteAfeNote")}</p>
        <div className="mt-1 max-h-[320px] overflow-y-auto border rounded-md p-2 space-y-2">
          {allVendors && allVendors.length > 0 ? (
            allVendors.map((v) => {
              const checked = form.vendorIds.includes(v.id);
              // Each checked site location gets its own AFE input under
              // the vendor row. Unchecked vendors just show the checkbox.
              const sitesForAfes = form.siteLocationIds
                .map((sid) =>
                  siteLocOptions.find((o) => o.id === sid)
                    ?? allSiteLocs.find((o) => o.id === sid),
                )
                .filter((s): s is SiteLocOption => !!s);
              return (
                <div
                  key={v.id}
                  className="rounded border border-transparent hover:border-muted px-1 py-1"
                >
                  <label className="flex items-center gap-2 text-sm cursor-pointer">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleVendor(v.id)}
                      className="rounded"
                      data-testid={`${prefix}-vendor-checkbox-${v.id}`}
                    />
                    <span className="truncate font-medium">{v.name}</span>
                  </label>
                  {checked && (
                    <div className="mt-1 ml-6 space-y-1" data-testid={`${prefix}-vendor-afe-rows-${v.id}`}>
                      {sitesForAfes.length === 0 ? (
                        <p className="text-xs text-muted-foreground italic">
                          {t("catalog.vendorAfeNoSites")}
                        </p>
                      ) : (
                        sitesForAfes.map((s) => {
                          const value = form.vendorSiteAfes[v.id]?.[s.id] ?? "";
                          return (
                            <div
                              key={s.id}
                              className="flex items-center gap-2 text-xs"
                            >
                              <span className="truncate flex-1 text-muted-foreground">
                                {s.name}
                                <span className="ml-1 opacity-70">
                                  ({s.partnerName})
                                </span>
                              </span>
                              <div className="relative h-[23px] w-32 shrink-0">
                                <PillColorLayer src={pillBlue} />
                                <Input
                                  value={value}
                                  onChange={(e) =>
                                    setForm((prev) => ({
                                      ...prev,
                                      vendorSiteAfes: {
                                        ...prev.vendorSiteAfes,
                                        [v.id]: {
                                          ...(prev.vendorSiteAfes[v.id] ?? {}),
                                          [s.id]: e.target.value,
                                        },
                                      },
                                    }))
                                  }
                                  placeholder={t("catalog.vendorAfePlaceholder")}
                                  aria-label={`${v.name} – ${s.name} AFE`}
                                  className="relative z-10 h-[23px] w-32 rounded-full text-xs px-3 bg-transparent border-0 text-white placeholder:text-white/70 font-normal text-center focus-visible:ring-1 focus-visible:ring-white/60 focus-visible:ring-offset-0 shadow-none"
                                  data-testid={`${prefix}-vendor-afe-${v.id}-site-${s.id}`}
                                />
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>
                  )}
                </div>
              );
            })
          ) : (
            <p className="text-xs text-muted-foreground">{t("catalog.noVendors")}</p>
          )}
        </div>
      </div>
    </>
  );

  return (
    <div className="space-y-6" data-testid="catalog-page">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <ContentPaneBackLink href="/" />
          <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2" data-testid="text-page-title">
            <ShoppingCart className={CARD_TITLE_ICON_CLASS} style={iconStyle} />
            {t("catalog.title")}
          </h1>
          <p className="text-muted-foreground text-sm mt-1">{t("catalog.subtitle")}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Link href="/catalog-health">
            <PngPillButton color="blue" className="px-3" data-testid="button-catalog-health">
              <Activity className="w-4 h-4" />{t("catalog.healthLink")}
            </PngPillButton>
          </Link>
          <PngPillButton color="blue" className="px-3" onClick={handleExport} data-testid="button-export-csv">
            <Download className="w-4 h-4" />{t("catalog.exportCsv")}
          </PngPillButton>
          <PngPillButton color="blue" className="px-3" onClick={openImportDialog} data-testid="button-import-csv">
            <Upload className="w-4 h-4" />{t("catalog.importCsv")}
          </PngPillButton>
        <Dialog open={addOpen} onOpenChange={(o) => { setAddOpen(o); if (o) resetForm(); }}>
          <DialogTrigger asChild>
            <PngPillButton color="blue" className="px-3" data-testid="button-add-catalog-item"><Plus className="w-4 h-4" />{t("catalog.addItem")}</PngPillButton>
          </DialogTrigger>
          <DialogContent className="max-h-[85vh] overflow-y-auto">
            <ModalLogoHeader />
            <DialogHeader><DialogTitle>{t("catalog.addNew")}</DialogTitle></DialogHeader>
            <form onSubmit={handleAdd} className="space-y-4">
              {formFields("add")}
              <PngPillButton
                type="submit"
                color="blue"

                disabled={saving || !form.name || !form.category}
                data-testid="button-submit-add"
                className="w-full px-3 justify-center"
              >
                {saving ? t("catalog.adding") : t("catalog.add")}
              </PngPillButton>
            </form>
          </DialogContent>
        </Dialog>
        </div>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept=".csv,text/csv"
        className="hidden"
        onChange={handleFilePicked}
        data-testid="input-import-file"
      />

      <Dialog open={importOpen} onOpenChange={(o) => { setImportOpen(o); if (!o) { setImportRows([]); setImportFileName(""); setImportError(null); setImportSummary(null); } }}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-[640px]">
          <DialogHeader>
            <DialogTitle>{t("catalog.importTitle")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">{t("catalog.importDescription")}</p>
            <div className="flex items-center gap-2 flex-wrap">
              <PngPillButton color="blue" className="px-3" onClick={() => fileInputRef.current?.click()} data-testid="button-pick-import-file">
                <Upload className="w-4 h-4" />{t("catalog.importChooseFile")}
              </PngPillButton>
              <PngPillButton color="blue" className="px-3" onClick={handleDownloadTemplate} data-testid="button-download-template">
                <Download className="w-4 h-4" />{t("catalog.importDownloadTemplate")}
              </PngPillButton>
              {importFileName && (
                <span className="text-xs text-muted-foreground truncate" data-testid="text-import-filename">{importFileName}</span>
              )}
            </div>

            {importError && (
              <div className="text-sm text-red-600" data-testid="text-import-error">{importError}</div>
            )}

            {importRows.length > 0 && !importSummary && (
              <div className="border rounded-md max-h-[300px] overflow-auto" data-testid="import-preview">
                <div className="text-xs font-medium text-muted-foreground p-2 sticky top-0 bg-background border-b">
                  {t("catalog.importPreview", { count: importRows.length })}
                </div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs">{t("catalog.productOrService")}</TableHead>
                      <TableHead className="text-xs">{t("catalog.phaseOfConstruction")}</TableHead>
                      <TableHead className="text-xs">{t("catalog.duration")}</TableHead>
                      <TableHead className="text-xs">{t("catalog.price")}</TableHead>
                      <TableHead className="text-xs">{t("catalog.vendors")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {importRows.slice(0, 25).map((r, i) => (
                      <TableRow key={i}>
                        <TableCell className="text-xs">{r.name}</TableCell>
                        <TableCell className="text-xs">{r.category}</TableCell>
                        <TableCell className="text-xs">{r.estimatedDuration || "-"}</TableCell>
                        <TableCell className="text-xs">{r.estimatedPrice || "-"}</TableCell>
                        <TableCell className="text-xs">{r.vendors || "-"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                {importRows.length > 25 && (
                  <div className="text-xs text-muted-foreground p-2 text-center">… +{importRows.length - 25}</div>
                )}
              </div>
            )}

            {importRows.length === 0 && importFileName && !importError && (
              <div className="text-sm text-muted-foreground" data-testid="text-import-no-rows">{t("catalog.importNoRows")}</div>
            )}

            {importSummary && (
              <div className="space-y-2 text-sm" data-testid="import-summary">
                <div className="font-medium">
                  {t("catalog.importDoneSummary", {
                    created: importSummary.created,
                    updated: importSummary.updated,
                    errors: importSummary.errors.length,
                  })}
                </div>
                {importSummary.unknownVendors.length > 0 && (
                  <div className="text-amber-700 text-xs">
                    {t("catalog.importUnknownVendors", { names: importSummary.unknownVendors.join(", ") })}
                  </div>
                )}
                {importSummary.errors.length > 0 && (
                  <div className="text-red-600 text-xs space-y-1 max-h-[160px] overflow-auto border rounded p-2">
                    <div className="font-medium">{t("catalog.importErrors")}</div>
                    {importSummary.errors.map((er, i) => (
                      <div key={i}>{t("catalog.importErrorRow", { row: er.row, message: er.message })}</div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
          <DialogFooter className="mt-4 gap-2">
            <PngPillButton color="blue" className="px-3" onClick={() => setImportOpen(false)} data-testid="button-close-import">
              {importSummary ? t("common.close") : t("catalog.keep")}
            </PngPillButton>
            {!importSummary && (
              <PngPillButton
                color="blue"

                className="px-3"
                onClick={runImport}
                disabled={importRows.length === 0 || importing}
                data-testid="button-run-import"
              >
                <Upload className="w-4 h-4" />
                {importing ? t("catalog.importRunning") : t("catalog.importRun")}
              </PngPillButton>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-6 space-y-3">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
          ) : workTypes && workTypes.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="cursor-pointer select-none hover:bg-muted/50" onClick={() => handleSort("name")}><div className="flex items-center gap-1.5">{t("catalog.productOrService")} {sortIcon("name")}</div></TableHead>
                  <TableHead className="cursor-pointer select-none hover:bg-muted/50" onClick={() => handleSort("category")}><div className="flex items-center gap-1.5">{t("catalog.phaseOfConstruction")} {sortIcon("category")}</div></TableHead>
                  <TableHead className="cursor-pointer select-none hover:bg-muted/50" onClick={() => handleSort("duration")}><div className="flex items-center gap-1.5">{t("catalog.duration")} {sortIcon("duration")}</div></TableHead>
                  <TableHead className="cursor-pointer select-none hover:bg-muted/50" onClick={() => handleSort("vendor")}><div className="flex items-center gap-1.5">{t("catalog.vendor")} {sortIcon("vendor")}</div></TableHead>
                  <TableHead className="cursor-pointer select-none hover:bg-muted/50" onClick={() => handleSort("price")}><div className="flex items-center gap-1.5">{t("catalog.price")} {sortIcon("price")}</div></TableHead>
                  <TableHead className="cursor-pointer select-none hover:bg-muted/50" onClick={() => handleSort("description")}><div className="flex items-center gap-1.5">{t("catalog.description")} {sortIcon("description")}</div></TableHead>
                  <TableHead className="w-[80px]">{t("catalog.actions")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedWorkTypes.map((wt) => {
                  const afeInfo = afesByWorkType.get(wt.id);
                  const uniqueAfes = afeInfo?.uniqueAfes ?? [];
                  const sitesWithoutAfe = afeInfo?.sitesWithoutAfe ?? 0;
                  // Show up to 3 inline pills; the rest collapse into a
                  // single "+N more" affordance that opens the existing
                  // edit modal so admins still see the full breakdown.
                  const inlineAfes = uniqueAfes.slice(0, 3);
                  const overflowCount =
                    Math.max(uniqueAfes.length - inlineAfes.length, 0) +
                    sitesWithoutAfe;
                  return (
                  <TableRow key={wt.id} data-testid={`row-catalog-${wt.id}`}>
                    <TableCell className="font-medium">
                      <button
                        type="button"
                        onClick={() => openEdit(wt)}
                        className="flex items-center gap-2 text-left hover:text-amber-500 hover:underline transition-colors"
                        data-testid={`link-catalog-name-${wt.id}`}
                      >
                        <ShoppingCart className="w-4 h-4 text-amber-500" />
                        {wt.name}
                      </button>
                      {isLoadingBulkAfes ? (
                        <Skeleton
                          className="h-5 w-32 mt-1"
                          data-testid={`afe-pills-loading-${wt.id}`}
                        />
                      ) : inlineAfes.length > 0 || overflowCount > 0 ? (
                        <div
                          className="flex flex-wrap items-center gap-1.5 mt-1"
                          data-testid={`afe-pills-${wt.id}`}
                        >
                          {inlineAfes.map((afe) => (
                            <AfePill
                              key={afe}
                              data-testid={`inline-pill-afe-${wt.id}-${afe}`}
                            >
                              {afe}
                            </AfePill>
                          ))}
                          {overflowCount > 0 ? (
                            <button
                              type="button"
                              onClick={() => openEdit(wt)}
                              className="text-[11px] font-medium text-muted-foreground hover:text-foreground hover:underline focus:outline-none focus:underline px-1"
                              data-testid={`button-afe-more-${wt.id}`}
                              title={t("vendorCatalog.openAfeModal")}
                            >
                              {t("vendorCatalog.moreAfes", {
                                count: overflowCount,
                              })}
                            </button>
                          ) : null}
                        </div>
                      ) : null}
                    </TableCell>
                    <TableCell>{wt.category}</TableCell>
                    <TableCell>{wt.estimatedDuration || "-"}</TableCell>
                    <TableCell>
                      {wt.vendors && wt.vendors.length > 0
                        ? wt.vendors.map((v) => v.name).join(", ")
                        : "-"}
                    </TableCell>
                    <TableCell>{wt.estimatedPrice ? `$${Number(wt.estimatedPrice).toLocaleString("en-US", { minimumFractionDigits: 2 })}` : "-"}</TableCell>
                    <TableCell className="text-muted-foreground">{wt.description || "-"}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <button onClick={() => openEdit(wt)} className="text-gray-400 hover:text-blue-600 transition-colors" data-testid={`button-edit-${wt.id}`}>
                          <Pencil className="w-4 h-4" />
                        </button>
                        <button onClick={() => openDelete(wt)} className="text-gray-400 hover:text-red-600 transition-colors" data-testid={`button-delete-${wt.id}`}>
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </TableCell>
                  </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          ) : (
            <div className="p-12 text-center text-muted-foreground">
              <ShoppingCart className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p>{t("catalog.empty")}</p>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={editOpen} onOpenChange={(o) => { setEditOpen(o); if (!o) setNameError(null); }}>
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <ModalLogoHeader />
          <DialogHeader><DialogTitle>{t("catalog.editItem")}</DialogTitle></DialogHeader>
          <form onSubmit={handleEdit} className="space-y-4">
            {formFields("edit")}
            <PngPillButton
              type="submit"
              color="blue"

              disabled={saving || !form.name || !form.category}
              data-testid="button-submit-edit"
              className="w-full px-3 justify-center"
            >
              {saving ? t("common.saving") : t("common.saveChanges")}
            </PngPillButton>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{t("catalog.removeItem")}</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            {t("catalog.removeConfirmPrefix")} <span className="font-medium text-foreground">{selected?.name}</span>{t("catalog.removeConfirmSuffix")}
          </p>
          <div className="flex gap-3 justify-end mt-4">
            <PngPillButton color="blue" className="px-3" onClick={() => setDeleteOpen(false)} data-testid="button-cancel-delete">{t("catalog.keep")}</PngPillButton>
            <PngPillButton color="blue" className="px-3" onClick={handleDelete} disabled={saving} data-testid="button-confirm-delete">
              <Trash2 className="w-4 h-4" />{saving ? t("catalog.removing") : t("catalog.remove")}
            </PngPillButton>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
