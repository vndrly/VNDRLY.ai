import { useState, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useListFieldEmployees, useCreateVendorContact, useUpdateVendorContact, getListFieldEmployeesQueryKey, useGetVendor, useGetPartner, useListPartnerContacts, useCreatePartnerContact, useUpdatePartnerContact, getGetPartnerQueryKey, getListPartnerContactsQueryKey } from "@workspace/api-client-react";
import { useUnsavedChanges } from "@/hooks/use-unsaved-changes";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { cn, formatPhone, handlePhoneInput, stripPhone } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { PngPillButton as PillButton } from "@/components/png-pill-rollover";
import { UserCheck, ArrowUp, ArrowDown, Plus, RotateCcw } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PhotoUploadField } from "@/components/photo-upload-field";
import BrandPill from "@/components/brand-pill";
import BlueButton from "@/components/blue-button";
import { PngPillButton, brandImagePillSrc } from "@/components/png-pill-rollover";
import addEmployeeIdle from "@assets/download_1778508804009.png";
import addEmployeeModalActive from "@assets/NewPillPallet_0001s_0004_Layer-5.png";
import AccountActions, { SuspendedPill, InactivePill } from "@/components/account-actions";
import { EmployeeRolePill } from "@/components/employee-role-pill";
import PecStatusBadge from "@/components/pec-status-badge";
import { useAuth } from "@/hooks/use-auth";
import { useBrand } from "@/hooks/use-brand";
import { useToast } from "@/hooks/use-toast";
import BulkLoginUploadDialog from "@/components/bulk-login-upload-dialog";
import EmployeePortalLoginFields from "@/components/employee-portal-login-fields";
import CertificationsSection from "@/components/certifications-section";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

// PEC Status pill rendered via shared PecStatusBadge — uses RolePill's
// 3-slice (left/center/right with cap = height/2 widths) so the
// rounded caps never stretch regardless of label width. The previous
// inline EmployeePecPill / EmployeePillBg used a single PNG sliced
// with fractional aspect ratios and was the source of the visible
// stretching artifact in the PEC Status column.

const COMPANY_ROLES = [
  "Operations Manager",
  "Drilling / Completions Engineer",
  "Procurement / Supply Chain",
  "Hotlist Coordinator",
  "Field Superintendent",
  "Company Man / Site Representative",
  "HSE / Safety Officer",
  "Ticket Approver",
  "Accounts Payable",
  "Account Owner / Executive Sponsor",
  "Visitor Notifications",
] as const;

function RoleMultiSelect({ value, onChange, testIdPrefix }: { value: string[]; onChange: (next: string[]) => void; testIdPrefix: string }) {
  const toggle = (role: string) => {
    if (value.includes(role)) onChange(value.filter((r) => r !== role));
    else onChange([...value, role]);
  };
  return (
    <div className="flex flex-wrap gap-2 items-center">
      {COMPANY_ROLES.map((role) => {
        const active = value.includes(role);
        return (
          <BrandPill
            key={role}
            active={active}
            onClick={() => toggle(role)}
            testId={`${testIdPrefix}-${role.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`}
          >
            {role}
          </BrandPill>
        );
      })}
    </div>
  );
}

type PersonRow = {
  id: number;
  vendorId: number;
  vendorRole: string | null;
  jobTitle: string | null;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  vendorName: string | null;
  vendorLogoUrl?: string | null;
  pecCertification: boolean;
  pecExpirationDate: string | null;
  photoUrl?: string | null;
  profilePhotoPath?: string | null;
  roles?: string[] | null;
  userId?: number | null;
  hasLogin?: boolean;
  suspendedAt?: string | null;
  mustChangePassword?: boolean;
  isActive?: boolean;
  // Mirror of users.preferred_language exposed by GET /field-employees so
  // the field-side table can show which UI language each employee sees.
  // Null when there's no linked login or the user hasn't picked one yet.
  preferredLanguage?: string | null;
};

function resolveAvatarUrl(p: PersonRow): string | null {
  if (p.photoUrl) return p.photoUrl;
  const path = p.profilePhotoPath;
  if (!path) return null;
  if (path.startsWith("http")) return path;
  return `${BASE}/api/storage${path.startsWith("/") ? path : `/${path}`}`;
}

type SortKey = "jobTitle" | "name" | "email" | "phone" | "vendorName" | "vendorRole" | "pecStatus" | "language";
type SortDir = "asc" | "desc";

function getPecSortValue(exp: string | null) {
  if (!exp) return 2;
  const diff = new Date(exp + "T00:00:00").getTime() - new Date().setHours(0, 0, 0, 0);
  if (diff < 0) return 2;
  if (diff <= 30 * 86400000) return 1;
  return 0;
}

function sortRows(rows: PersonRow[], sort: { key: SortKey; dir: SortDir }) {
  const dir = sort.dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    if (sort.key === "name") return dir * `${a.firstName} ${a.lastName}`.localeCompare(`${b.firstName} ${b.lastName}`);
    if (sort.key === "pecStatus") return dir * (getPecSortValue(a.pecExpirationDate) - getPecSortValue(b.pecExpirationDate));
    if (sort.key === "vendorRole") return dir * (a.vendorRole || "").localeCompare(b.vendorRole || "");
    if (sort.key === "vendorName") return dir * (a.vendorName || "").localeCompare(b.vendorName || "");
    if (sort.key === "language") return dir * (a.preferredLanguage || "").localeCompare(b.preferredLanguage || "");
    const av = (a as any)[sort.key] || "";
    const bv = (b as any)[sort.key] || "";
    return dir * String(av).localeCompare(String(bv));
  });
}

export default function FieldEmployees() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const brand = useBrand();
  const accentColor = brand.isOrgBranded ? brand.primary : "#f59e0b";
  const iconStyle = { color: accentColor };
  const isVendor = user?.role === "vendor" && !!user.vendorId;
  const vendorId = isVendor ? user!.vendorId! : null;
  const isPartner = user?.role === "partner" && !!user.partnerId;
  const partnerId = isPartner ? user!.partnerId! : null;
  const isForemanOnly =
    user?.role === "field_employee" &&
    (user.vendorRole === "foreman" || user.vendorRole === "both");

  const pecIsCurrent = (form: { pecCertification: boolean; pecExpirationDate: string }) => {
    if (form.pecExpirationDate) {
      const exp = new Date(`${form.pecExpirationDate}T00:00:00`);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      return exp.getTime() >= today.getTime();
    }
    return form.pecCertification;
  };

  const canEditPerson = (p: PersonRow) => !isForemanOnly || p.vendorRole !== "admin";

  const { data: vendorData } = useGetVendor(vendorId ?? 0, { query: { enabled: !!vendorId, queryKey: ["vendor", vendorId] } });
  const { data: partnerData } = useGetPartner(partnerId ?? 0, { query: { enabled: !!partnerId, queryKey: getGetPartnerQueryKey(partnerId ?? 0) } });
  const { data: partnerContacts, isLoading: isLoadingPartnerContacts } = useListPartnerContacts(partnerId ?? 0, undefined, { query: { enabled: !!partnerId, queryKey: getListPartnerContactsQueryKey(partnerId ?? 0) } });

  // The admin/vendor field-employees page legitimately surfaces deactivated
  // rows so they can be edited (or eventually reactivated). The list endpoint
  // defaults to active-only, so we opt back in here.
  const fieldQueryParams = vendorId ? { vendorId, includeInactive: true } : { includeInactive: true };
  const { data: fieldEmployees, isLoading: isLoadingField } = useListFieldEmployees(fieldQueryParams, {
    query: { queryKey: getListFieldEmployeesQueryKey(fieldQueryParams) },
  });

  const officeQueryKey = ["vendor-contacts", vendorId ?? "all"];
  const { data: officeEmployees, isLoading: isLoadingOffice } = useQuery<PersonRow[]>({
    queryKey: officeQueryKey,
    queryFn: async () => {
      const url = vendorId ? `${BASE}/api/vendor-contacts?vendorId=${vendorId}` : `${BASE}/api/vendor-contacts`;
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load office employees");
      return res.json();
    },
  });

  const createContact = useCreateVendorContact();
  const updateVendorContact = useUpdateVendorContact();
  const createPartnerContact = useCreatePartnerContact();
  const updatePartnerContact = useUpdatePartnerContact();

  type EditOfficeForm = { jobTitle: string; firstName: string; lastName: string; email: string; phone: string; vendorRole: string; pecCertification: boolean; pecExpirationDate: string; photoUrl: string | null; roles: string[] };
  const [editOfficeOpen, setEditOfficeOpen] = useState(false);
  const [editingOfficeContactId, setEditingOfficeContactId] = useState<number | null>(null);
  const [editingFromFieldTable, setEditingFromFieldTable] = useState(false);
  const [editingOfficeVendorId, setEditingOfficeVendorId] = useState<number | null>(null);
  const [editingOfficeVendorLogoUrl, setEditingOfficeVendorLogoUrl] = useState<string | null>(null);
  const [editingOfficeVendorName, setEditingOfficeVendorName] = useState<string | null>(null);
  const [editOfficeForm, setEditOfficeForm] = useState<EditOfficeForm>({ jobTitle: "", firstName: "", lastName: "", email: "", phone: "", vendorRole: "office", pecCertification: false, pecExpirationDate: "", photoUrl: null, roles: [] });
  const initialEditOfficeFormRef = useRef<EditOfficeForm | null>(null);
  const editOfficeDirty = useMemo(() => !!initialEditOfficeFormRef.current && JSON.stringify(editOfficeForm) !== JSON.stringify(initialEditOfficeFormRef.current), [editOfficeForm]);
  useUnsavedChanges(editOfficeOpen && editOfficeDirty);
  const tryCloseEditOffice = (open: boolean) => {
    if (!open && editOfficeDirty && !window.confirm("You have unsaved changes. Discard them?")) return;
    if (!open) {
      initialEditOfficeFormRef.current = null;
      setEditingOfficeContactId(null);
      setEditingFromFieldTable(false);
      setEditingOfficeVendorId(null);
      setEditingOfficeVendorLogoUrl(null);
      setEditingOfficeVendorName(null);
    }
    setEditOfficeOpen(open);
  };

  const openEditOfficeDialog = (p: PersonRow, fromFieldTable: boolean) => {
    setEditingOfficeContactId(p.id);
    setEditingFromFieldTable(fromFieldTable);
    setEditingOfficeVendorId(p.vendorId);
    setEditingOfficeVendorLogoUrl(p.vendorLogoUrl ?? null);
    setEditingOfficeVendorName(p.vendorName ?? null);
    const hydrated: EditOfficeForm = {
      jobTitle: p.jobTitle ?? "",
      firstName: p.firstName,
      lastName: p.lastName,
      email: p.email,
      phone: p.phone ? formatPhone(p.phone) : "",
      vendorRole: p.vendorRole ?? "office",
      pecCertification: p.pecCertification ?? false,
      pecExpirationDate: p.pecExpirationDate ?? "",
      photoUrl: p.photoUrl ?? p.profilePhotoPath ?? null,
      roles: p.roles ?? [],
    };
    setEditOfficeForm(hydrated);
    initialEditOfficeFormRef.current = hydrated;
    setEditOfficeOpen(true);
  };

  const handleEditOffice = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingOfficeContactId || !editingOfficeVendorId) return;
    const targetVendorId = editingOfficeVendorId;
    updateVendorContact.mutate(
      { vendorId: targetVendorId, contactId: editingOfficeContactId, data: { ...editOfficeForm, phone: stripPhone(editOfficeForm.phone) || null, pecExpirationDate: editOfficeForm.pecExpirationDate || null } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: ["vendor-contacts", vendorId ?? "all"] });
          queryClient.invalidateQueries({ queryKey: getListFieldEmployeesQueryKey(fieldQueryParams) });
          initialEditOfficeFormRef.current = editOfficeForm;
          setEditOfficeOpen(false);
          setEditingOfficeContactId(null);
          setEditingOfficeVendorId(null);
          toast({ title: t("fieldEmployees.updatedToast") });
        },
        onError: () => toast({ title: t("fieldEmployees.updateFailed"), variant: "destructive" }),
      },
    );
  };

  const [editPartnerContactOpen, setEditPartnerContactOpen] = useState(false);
  const [editingPartnerContactId, setEditingPartnerContactId] = useState<number | null>(null);
  const [editPartnerContactForm, setEditPartnerContactForm] = useState({ jobTitle: "", name: "", email: "", phone: "", roles: [] as string[], photoUrl: null as string | null });

  const [addPartnerContactOpen, setAddPartnerContactOpen] = useState(false);
  const emptyPartnerContactForm = { jobTitle: "", name: "", email: "", phone: "", roles: [] as string[], photoUrl: null as string | null };
  const [addPartnerContactForm, setAddPartnerContactForm] = useState(emptyPartnerContactForm);

  const handleAddPartnerContact = (e: React.FormEvent) => {
    e.preventDefault();
    if (!partnerId) return;
    createPartnerContact.mutate(
      { partnerId, data: { ...addPartnerContactForm, phone: stripPhone(addPartnerContactForm.phone) || null } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListPartnerContactsQueryKey(partnerId) });
          setAddPartnerContactOpen(false);
          setAddPartnerContactForm(emptyPartnerContactForm);
          toast({ title: t("fieldEmployees.addedToast", { defaultValue: "Employee added" }) });
        },
        onError: () => toast({ title: t("fieldEmployees.addFailed", { defaultValue: "Failed to add employee" }), variant: "destructive" }),
      },
    );
  };

  const openEditPartnerContact = (c: { id: number; jobTitle: string; name: string; email: string; phone: string | null; roles?: string[] | null; photoUrl?: string | null }) => {
    setEditingPartnerContactId(c.id);
    setEditPartnerContactForm({
      jobTitle: c.jobTitle ?? "",
      name: c.name ?? "",
      email: c.email ?? "",
      phone: c.phone ? formatPhone(c.phone) : "",
      roles: c.roles ?? [],
      photoUrl: c.photoUrl ?? null,
    });
    setEditPartnerContactOpen(true);
  };

  const handleEditPartnerContact = (e: React.FormEvent) => {
    e.preventDefault();
    if (!partnerId || !editingPartnerContactId) return;
    updatePartnerContact.mutate(
      { partnerId, contactId: editingPartnerContactId, data: { ...editPartnerContactForm, phone: stripPhone(editPartnerContactForm.phone) || null } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListPartnerContactsQueryKey(partnerId) });
          setEditPartnerContactOpen(false);
          setEditingPartnerContactId(null);
          toast({ title: t("fieldEmployees.updatedToast") });
        },
        onError: () => toast({ title: t("fieldEmployees.updateFailed"), variant: "destructive" }),
      },
    );
  };

  const [officeSort, setOfficeSort] = useState<{ key: SortKey; dir: SortDir }>({ key: "name", dir: "asc" });
  const [fieldSort, setFieldSort] = useState<{ key: SortKey; dir: SortDir }>({ key: "name", dir: "asc" });
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">("all");

  const isAdmin = user?.role === "admin";
  const removedQueryKey = ["removed-vendor-people", isAdmin] as const;
  const { data: removedRows, isLoading: isLoadingRemoved } = useQuery<Array<PersonRow & { deletedAt: string | null; deletedBy: string | null }>>({
    queryKey: removedQueryKey,
    enabled: isAdmin,
    queryFn: async () => {
      const [field, office] = await Promise.all([
        // Soft-delete also flips isActive=false, so we must opt in to inactive
        // rows to actually surface deleted ones now that the list endpoint
        // defaults to active-only.
        fetch(`${BASE}/api/field-employees?includeDeleted=true&includeInactive=true`, { credentials: "include" }).then(r => r.ok ? r.json() : []),
        fetch(`${BASE}/api/vendor-contacts?includeDeleted=true`, { credentials: "include" }).then(r => r.ok ? r.json() : []),
      ]);
      const all = [...(field as any[]), ...(office as any[])];
      // De-duplicate by id (field-employees and vendor-contacts both query vendor_people)
      const byId = new Map<number, any>();
      for (const r of all) byId.set(r.id, r);
      return Array.from(byId.values()).filter(r => r.deletedAt) as any;
    },
  });

  const handleRestore = async (row: PersonRow) => {
    const isField = row.vendorRole === "field" || row.vendorRole === "both" || row.vendorRole === "foreman";
    const url = isField
      ? `${BASE}/api/field-employees/${row.id}/restore`
      : `${BASE}/api/vendors/${row.vendorId}/contacts/${row.id}/restore`;
    const res = await fetch(url, { method: "POST", credentials: "include" });
    if (!res.ok) {
      toast({ title: t("fieldEmployees.restoreFailed"), variant: "destructive" });
      return;
    }
    toast({ title: t("fieldEmployees.restoredToast") });
    queryClient.invalidateQueries({ queryKey: removedQueryKey });
    queryClient.invalidateQueries({ queryKey: getListFieldEmployeesQueryKey({}) });
    queryClient.invalidateQueries({ queryKey: ["vendor-contacts", "all"] });
  };

  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState({ jobTitle: "", firstName: "", lastName: "", email: "", phone: "", vendorRole: "field" as string, pecCertification: false, pecExpirationDate: "" });

  const filterByStatus = (rows: PersonRow[]) => {
    if (statusFilter === "active") return rows.filter((r) => r.isActive !== false);
    if (statusFilter === "inactive") return rows.filter((r) => r.isActive === false);
    return rows;
  };
  const sortedOffice = useMemo(() => sortRows(filterByStatus((officeEmployees ?? []) as PersonRow[]), officeSort), [officeEmployees, officeSort, statusFilter]);
  const sortedField = useMemo(() => sortRows(filterByStatus((fieldEmployees ?? []) as PersonRow[]), fieldSort), [fieldEmployees, fieldSort, statusFilter]);

  const handleAdd = (e: React.FormEvent, defaultRole: string) => {
    e.preventDefault();
    if (!vendorId) return;
    createContact.mutate(
      { vendorId, data: { ...form, phone: stripPhone(form.phone) || null, jobTitle: form.jobTitle || "", pecExpirationDate: form.pecExpirationDate || null } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListFieldEmployeesQueryKey(fieldQueryParams) });
          queryClient.invalidateQueries({ queryKey: officeQueryKey });
          setAddOpen(false);
          setForm({ jobTitle: "", firstName: "", lastName: "", email: "", phone: "", vendorRole: defaultRole, pecCertification: false, pecExpirationDate: "" });
          toast({ title: t("fieldEmployees.addedToast") });
        },
        onError: () => toast({ title: t("fieldEmployees.addFailed"), variant: "destructive" }),
      },
    );
  };

  const renderHeader = (
    cols: ReadonlyArray<readonly [SortKey, string, string]>,
    sort: { key: SortKey; dir: SortDir },
    setSort: (s: { key: SortKey; dir: SortDir }) => void,
  ) => (
    <TableHeader>
      <TableRow>
        {cols.map(([key, label, w]) => (
          <TableHead
            key={key}
            className={`${w} cursor-pointer select-none`}
            onClick={() => setSort(sort.key === key ? { key, dir: sort.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" })}
          >
            <div className="flex items-center gap-1">
              {label}
              {sort.key === key ? (sort.dir === "asc" ? <ArrowUp className="w-3 h-3" style={iconStyle} /> : <ArrowDown className="w-3 h-3" style={iconStyle} />) : null}
            </div>
          </TableHead>
        ))}
      </TableRow>
    </TableHeader>
  );

  const officeCols: ReadonlyArray<readonly [SortKey, string, string]> = isVendor
    ? [["jobTitle", t("fieldEmployees.jobTitle"), "w-[150px]"], ["name", t("fieldEmployees.name"), "w-[20%]"], ["email", t("fieldEmployees.email"), "w-[22%]"], ["phone", t("fieldEmployees.phone"), "w-[12%]"], ["vendorRole", t("fieldEmployees.role"), "w-[80px]"], ["pecStatus", t("fieldEmployees.pecStatus"), "w-[100px]"]]
    : [["jobTitle", t("fieldEmployees.jobTitle"), "w-[140px]"], ["name", t("fieldEmployees.name"), "w-[18%]"], ["vendorName", t("fieldEmployees.vendorName"), "w-[16%]"], ["email", t("fieldEmployees.email"), "w-[20%]"], ["phone", t("fieldEmployees.phone"), "w-[11%]"], ["vendorRole", t("fieldEmployees.role"), "w-[80px]"], ["pecStatus", t("fieldEmployees.pecStatus"), "w-[100px]"]];

  // Field employees get an extra "Language" column sourced from
  // users.preferred_language (joined in GET /field-employees). Office
  // contacts don't have a linked login in every case, so the column is
  // intentionally field-only.
  const fieldCols: ReadonlyArray<readonly [SortKey, string, string]> = [
    ...officeCols,
    ["language", t("fieldEmployees.language"), "w-[80px]"],
  ];

  const renderRow = (p: PersonRow, kind: "office" | "field") => {
    const avatarUrl = resolveAvatarUrl(p);
    const avatar = avatarUrl ? (
      <img
        src={avatarUrl}
        alt={`${p.firstName} ${p.lastName}`}
        className="w-6 h-6 rounded-full object-cover border border-gray-200"
        data-testid={`avatar-${kind}-${p.id}`}
      />
    ) : (
      <UserCheck className="w-4 h-4" style={iconStyle} />
    );
    return (
    <TableRow key={p.id} data-testid={`row-${kind}-${p.id}`}>
      <TableCell className="font-medium">{p.jobTitle || "-"}</TableCell>
      <TableCell className="font-medium">
        {kind === "field" ? (
          canEditPerson(p) ? (
          <button
            type="button"
            onClick={() => openEditOfficeDialog(p, true)}
            className="text-gray-700 hover:[color:var(--brand-primary)] hover:[text-shadow:0_1px_2px_rgba(0,0,0,0.35)] transition-all text-left bg-transparent p-0 m-0 border-0 cursor-pointer"
            data-testid={`button-edit-field-${p.id}`}
          >
            <div className="flex items-center gap-2">{avatar}<span>{p.firstName} {p.lastName}</span>{p.suspendedAt && <SuspendedPill />}{p.isActive === false && <InactivePill />}</div>
          </button>
          ) : (
            <div className="flex items-center gap-2">{avatar}<span>{p.firstName} {p.lastName}</span>{p.suspendedAt && <SuspendedPill />}{p.isActive === false && <InactivePill />}</div>
          )
        ) : (
          canEditPerson(p) ? (
          <button
            type="button"
            onClick={() => openEditOfficeDialog(p, false)}
            className="text-gray-700 hover:[color:var(--brand-primary)] hover:[text-shadow:0_1px_2px_rgba(0,0,0,0.35)] transition-all text-left bg-transparent p-0 m-0 border-0 cursor-pointer"
            data-testid={`button-edit-office-${p.id}`}
          >
            <div className="flex items-center gap-2">{avatar}<span>{p.firstName} {p.lastName}</span>{p.suspendedAt && <SuspendedPill />}{p.isActive === false && <InactivePill />}</div>
          </button>
          ) : (
            <div className="flex items-center gap-2">{avatar}<span>{p.firstName} {p.lastName}</span>{p.suspendedAt && <SuspendedPill />}{p.isActive === false && <InactivePill />}</div>
          )
        )}
      </TableCell>
      {!isVendor && <TableCell>{p.vendorName || "-"}</TableCell>}
      <TableCell>{p.email}</TableCell>
      <TableCell>{formatPhone(p.phone)}</TableCell>
      <TableCell><EmployeeRolePill role={p.vendorRole} /></TableCell>
      <TableCell><PecStatusBadge expirationDate={p.pecExpirationDate} /></TableCell>
      {kind === "field" && (
        <TableCell data-testid={`text-language-${p.id}`}>
          {p.preferredLanguage
            ? p.preferredLanguage.toUpperCase()
            : t("fieldEmployees.languageNotSet")}
        </TableCell>
      )}
    </TableRow>
    );
  };

  return (
    <div className="space-y-6" data-testid="field-employees-page">
      <div className="flex items-center justify-between">
        <div>
          {isVendor && vendorData && <p className="text-sm font-medium text-muted-foreground" data-testid="text-vendor-name">{vendorData.name}</p>}
          {isPartner && partnerData && <p className="text-sm font-medium text-muted-foreground" data-testid="text-partner-name">{partnerData.name}</p>}
          <h1 className="text-2xl font-bold tracking-tight" data-testid="text-page-title">{t("fieldEmployees.title")}</h1>
          <p className="text-muted-foreground text-sm mt-1">{isVendor ? t("fieldEmployees.subtitleVendor") : isPartner ? t("fieldEmployees.subtitleVendor") : t("fieldEmployees.subtitleAdmin")}</p>
        </div>
        <div className="flex items-center gap-3">
          {!isPartner && (
            <div className="flex items-center gap-2">
              <Label htmlFor="status-filter" className="text-sm text-muted-foreground whitespace-nowrap">{t("fieldEmployees.statusFilterLabel")}</Label>
              <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as "all" | "active" | "inactive")}>
                <SelectTrigger id="status-filter" className="w-[160px]" data-testid="select-status-filter">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all" data-testid="status-filter-all">{t("fieldEmployees.statusFilterAll")}</SelectItem>
                  <SelectItem value="active" data-testid="status-filter-active">{t("fieldEmployees.statusFilterActive")}</SelectItem>
                  <SelectItem value="inactive" data-testid="status-filter-inactive">{t("fieldEmployees.statusFilterInactive")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
        <BulkLoginUploadDialog visible={(isAdmin || isVendor) && !isPartner} />
        {isVendor && (
          <Dialog open={addOpen} onOpenChange={setAddOpen}>
            <DialogTrigger asChild>
              <PngPillButton
                color="blue"
                data-testid="button-add-employee"
                onClick={() => setForm((f) => ({ ...f, vendorRole: "field" }))}
                className="px-2"
              >
                <Plus className="w-4 h-4" />
                {t("fieldEmployees.addEmployee")}
              </PngPillButton>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>{t("fieldEmployees.addEmployee")}</DialogTitle></DialogHeader>
              <form onSubmit={(e) => handleAdd(e, "field")} className="space-y-4">
                <div>
                  <Label>{t("fieldEmployees.jobTitle")}</Label>
                  <Input value={form.jobTitle} onChange={(e) => setForm({ ...form, jobTitle: e.target.value })} placeholder={t("fieldEmployees.jobTitlePlaceholder")} data-testid="input-job-title" />
                </div>
                <div>
                  <Label>{t("fieldEmployees.role")}</Label>
                  <Select value={form.vendorRole} onValueChange={(v) => setForm({ ...form, vendorRole: v })}>
                    <SelectTrigger data-testid="select-employee-role"><SelectValue placeholder={t("fieldEmployees.selectRole")} /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="admin" className="focus:bg-transparent data-[highlighted]:bg-transparent"><EmployeeRolePill role="admin" /></SelectItem>
                      <SelectItem value="office" className="focus:bg-transparent data-[highlighted]:bg-transparent"><EmployeeRolePill role="office" /></SelectItem>
                      <SelectItem value="field" className="focus:bg-transparent data-[highlighted]:bg-transparent"><EmployeeRolePill role="field" /></SelectItem>
                      <SelectItem value="both" className="focus:bg-transparent data-[highlighted]:bg-transparent"><EmployeeRolePill role="both" /></SelectItem>
                      <SelectItem value="foreman" className="focus:bg-transparent data-[highlighted]:bg-transparent"><EmployeeRolePill role="foreman" /></SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground mt-1">{t("fieldEmployees.roleHelp")}</p>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div><Label>{t("fieldEmployees.firstName")}</Label><Input value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} required data-testid="input-first-name" /></div>
                  <div><Label>{t("fieldEmployees.lastName")}</Label><Input value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} required data-testid="input-last-name" /></div>
                </div>
                <div><Label>{t("fieldEmployees.email")}</Label><Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required data-testid="input-email" /></div>
                <div><Label>{t("fieldEmployees.phone")}</Label><Input value={form.phone} onChange={(e) => setForm({ ...form, phone: handlePhoneInput(e.target.value) })} data-testid="input-phone" /></div>
                <div className="flex items-center gap-2">
                  <Checkbox id="pec-cert-page" checked={form.pecCertification} onCheckedChange={(v) => setForm({ ...form, pecCertification: !!v })} data-testid="checkbox-pec-certification" />
                  <Label htmlFor="pec-cert-page" className="cursor-pointer">{t("fieldEmployees.pecCertified")}</Label>
                </div>
                <div><Label>{t("fieldEmployees.pecExpiration")}</Label><Input type="date" value={form.pecExpirationDate} onChange={(e) => setForm({ ...form, pecExpirationDate: e.target.value })} data-testid="input-pec-expiration" /></div>
                <PngPillButton
                  type="submit"
                  disabled={createContact.isPending}
                  data-testid="button-submit-employee"
                  height={36}
                  idleOpacity={0.5}
                  color="image"
                  activeSrc={
                    brand.name?.toLowerCase().includes("baker")
                      ? addEmployeeModalActive
                      : brandImagePillSrc(brand.primary, brand.name)
                  }
                  idleSrc={
                    brand.name?.toLowerCase().includes("baker")
                      ? addEmployeeIdle
                      : undefined
                  }
                >
                  {createContact.isPending ? t("fieldEmployees.adding") : t("fieldEmployees.addEmployee")}
                </PngPillButton>
              </form>
            </DialogContent>
          </Dialog>
        )}
        </div>
      </div>

      {isPartner ? (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <UserCheck className="w-5 h-5" style={iconStyle} />
              {partnerData?.name ? `${partnerData.name} ${t("fieldEmployees.title")}` : t("fieldEmployees.title")} ({partnerContacts?.length ?? 0})
            </CardTitle>
            <Dialog open={addPartnerContactOpen} onOpenChange={(open) => { setAddPartnerContactOpen(open); if (!open) setAddPartnerContactForm(emptyPartnerContactForm); }}>
              <DialogTrigger asChild>
                <PngPillButton color="blue" data-testid="button-add-partner-employee"><Plus className="w-4 h-4" />{t("fieldEmployees.addEmployee")}</PngPillButton>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>{t("fieldEmployees.addEmployee")}</DialogTitle></DialogHeader>
                <form onSubmit={handleAddPartnerContact} className="space-y-4">
                  <div>
                    <Label>{t("fieldEmployees.photo", { defaultValue: "Photo" })}</Label>
                    <div className="mt-2"><PhotoUploadField value={addPartnerContactForm.photoUrl} onChange={(url) => setAddPartnerContactForm({ ...addPartnerContactForm, photoUrl: url })} testIdPrefix="add-partner-employee-photo" /></div>
                  </div>
                  <div>
                    <Label>{t("fieldEmployees.jobTitle")}</Label>
                    <Input value={addPartnerContactForm.jobTitle} onChange={(e) => setAddPartnerContactForm({ ...addPartnerContactForm, jobTitle: e.target.value })} placeholder={t("fieldEmployees.jobTitlePlaceholder")} data-testid="input-add-partner-contact-job-title" />
                  </div>
                  <div>
                    <Label>{t("fieldEmployees.name")}</Label>
                    <Input value={addPartnerContactForm.name} onChange={(e) => setAddPartnerContactForm({ ...addPartnerContactForm, name: e.target.value })} required data-testid="input-add-partner-contact-name" />
                  </div>
                  <div>
                    <Label>{t("fieldEmployees.email")}</Label>
                    <Input type="email" value={addPartnerContactForm.email} onChange={(e) => setAddPartnerContactForm({ ...addPartnerContactForm, email: e.target.value })} required data-testid="input-add-partner-contact-email" />
                  </div>
                  <div>
                    <Label>{t("fieldEmployees.phone")}</Label>
                    <Input value={addPartnerContactForm.phone} onChange={(e) => setAddPartnerContactForm({ ...addPartnerContactForm, phone: handlePhoneInput(e.target.value) })} data-testid="input-add-partner-contact-phone" />
                  </div>
                  <div>
                    <Label>{t("fieldEmployees.role")}</Label>
                    <p className="text-xs text-muted-foreground mb-2">{t("fieldEmployees.partnerRolesHelp")}</p>
                    <RoleMultiSelect value={addPartnerContactForm.roles} onChange={(roles) => setAddPartnerContactForm({ ...addPartnerContactForm, roles })} testIdPrefix="add-partner-role" />
                  </div>
                  <PngPillButton color="blue" type="submit" disabled={createPartnerContact.isPending} className="w-full" data-testid="button-submit-add-partner-contact">
                    {createPartnerContact.isPending ? t("fieldEmployees.adding") : t("fieldEmployees.addEmployee")}
                  </PngPillButton>
                </form>
              </DialogContent>
            </Dialog>
          </CardHeader>
          <CardContent className="p-0">
            {isLoadingPartnerContacts ? (
              <div className="p-6 space-y-3">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
            ) : partnerContacts && partnerContacts.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[180px]">{t("fieldEmployees.jobTitle")}</TableHead>
                    <TableHead className="w-[20%]">{t("fieldEmployees.name")}</TableHead>
                    <TableHead className="w-[24%]">{t("fieldEmployees.email")}</TableHead>
                    <TableHead className="w-[14%]">{t("fieldEmployees.phone")}</TableHead>
                    <TableHead>{t("fieldEmployees.role")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {partnerContacts.map((c) => (
                    <TableRow key={c.id} className="group cursor-pointer hover:bg-muted/50" onClick={() => openEditPartnerContact(c)} data-testid={`row-partner-contact-${c.id}`}>
                      <TableCell className="font-medium">{c.jobTitle || "-"}</TableCell>
                      <TableCell className="font-medium">
                        <div className="flex items-center gap-2 transition-colors group-hover:[color:var(--brand-primary)]">{c.photoUrl ? <img src={c.photoUrl} alt="" className="w-6 h-6 rounded-full object-cover border border-gray-200" /> : <UserCheck className="w-4 h-4" style={iconStyle} />}{c.name}</div>
                      </TableCell>
                      <TableCell>{c.email}</TableCell>
                      <TableCell>{formatPhone(c.phone)}</TableCell>
                      <TableCell>
                        {c.roles && c.roles.length > 0 ? (
                          <div className="flex flex-wrap gap-1">
                            {c.roles.map((r) => (
                              <span
                                key={r}
                                className="px-3 py-1 rounded-full text-xs font-medium border text-white"
                                style={{
                                  backgroundColor: "var(--brand-primary)",
                                  borderColor: "var(--brand-primary)",
                                }}
                              >
                                {r}
                              </span>
                            ))}
                          </div>
                        ) : "-"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <div className="p-6 text-center text-muted-foreground text-sm">{t("fieldEmployees.noOffice")}</div>
            )}
          </CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="flex items-center gap-2"><UserCheck className="w-5 h-5" style={iconStyle} />{t("fieldEmployees.officeEmployees")} ({sortedOffice.length})</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {isLoadingOffice ? (
                <div className="p-6 space-y-3">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
              ) : sortedOffice.length > 0 ? (
                <Table>
                  {renderHeader(officeCols, officeSort, setOfficeSort)}
                  <TableBody>{sortedOffice.map((p) => renderRow(p, "office"))}</TableBody>
                </Table>
              ) : (
                <div className="p-6 text-center text-muted-foreground text-sm">{t("fieldEmployees.noOffice")}</div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="flex items-center gap-2"><UserCheck className="w-5 h-5" style={iconStyle} />{t("fieldEmployees.fieldEmployees")} ({sortedField.length})</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {isLoadingField ? (
                <div className="p-6 space-y-3">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
              ) : sortedField.length > 0 ? (
                <Table>
                  {renderHeader(fieldCols, fieldSort, setFieldSort)}
                  <TableBody>{sortedField.map((p) => renderRow(p, "field"))}</TableBody>
                </Table>
              ) : (
                <div className="p-8 text-center text-muted-foreground"><p>{t("fieldEmployees.noField")}</p></div>
              )}
            </CardContent>
          </Card>

          {isAdmin && (
            <Card data-testid="removed-employees-section">
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="flex items-center gap-2 text-muted-foreground">
                  <RotateCcw className="w-5 h-5" />
                  {t("fieldEmployees.removedEmployees", { count: removedRows?.length ?? 0 })}
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                {isLoadingRemoved ? (
                  <div className="p-6 space-y-3">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
                ) : (removedRows?.length ?? 0) > 0 ? (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-[140px]">{t("fieldEmployees.jobTitle")}</TableHead>
                        <TableHead className="w-[18%]">{t("fieldEmployees.name")}</TableHead>
                        <TableHead className="w-[16%]">{t("fieldEmployees.vendorName")}</TableHead>
                        <TableHead className="w-[20%]">{t("fieldEmployees.email")}</TableHead>
                        <TableHead className="w-[110px]">{t("fieldEmployees.role")}</TableHead>
                        <TableHead className="w-[180px]">{t("fieldEmployees.removedByCol")}</TableHead>
                        <TableHead className="w-[110px]">{t("fieldEmployees.actionCol")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(removedRows ?? []).map((p) => (
                        <TableRow key={`removed-${p.id}`} data-testid={`row-removed-${p.id}`}>
                          <TableCell className="font-medium">{p.jobTitle || "-"}</TableCell>
                          <TableCell className="font-medium">{p.firstName} {p.lastName}</TableCell>
                          <TableCell>{p.vendorName || "-"}</TableCell>
                          <TableCell>{p.email}</TableCell>
                          <TableCell><EmployeeRolePill role={p.vendorRole} /></TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {p.deletedBy || "-"}
                            {p.deletedAt ? <div>{new Date(p.deletedAt).toLocaleString()}</div> : null}
                          </TableCell>
                          <TableCell>
                            <PillButton color="red" onClick={() => handleRestore(p)} data-testid={`button-restore-${p.id}`}>
                              <RotateCcw className="w-3 h-3 mr-1" />{t("fieldEmployees.restore")}
                            </PillButton>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                ) : (
                  <div className="p-6 text-center text-muted-foreground text-sm">{t("fieldEmployees.noRemoved")}</div>
                )}
              </CardContent>
            </Card>
          )}
        </>
      )}

      {isPartner && (
        <Dialog open={editPartnerContactOpen} onOpenChange={setEditPartnerContactOpen}>
          <DialogContent>
            <DialogHeader><DialogTitle>{t("fieldEmployees.editEmployee")}</DialogTitle></DialogHeader>
            <form onSubmit={handleEditPartnerContact} className="space-y-4">
              <div>
                <Label>{t("fieldEmployees.employeePhoto")}</Label>
                <div className="mt-2"><PhotoUploadField value={editPartnerContactForm.photoUrl} onChange={(url) => setEditPartnerContactForm({ ...editPartnerContactForm, photoUrl: url })} testIdPrefix="edit-partner-employee-photo" /></div>
              </div>
              <div>
                <Label>{t("fieldEmployees.jobTitle")}</Label>
                <Input value={editPartnerContactForm.jobTitle} onChange={(e) => setEditPartnerContactForm({ ...editPartnerContactForm, jobTitle: e.target.value })} data-testid="input-edit-partner-contact-job-title" />
              </div>
              <div>
                <Label>{t("fieldEmployees.name")}</Label>
                <Input value={editPartnerContactForm.name} onChange={(e) => setEditPartnerContactForm({ ...editPartnerContactForm, name: e.target.value })} required data-testid="input-edit-partner-contact-name" />
              </div>
              <div>
                <Label>{t("fieldEmployees.email")}</Label>
                <Input type="email" value={editPartnerContactForm.email} onChange={(e) => setEditPartnerContactForm({ ...editPartnerContactForm, email: e.target.value })} required data-testid="input-edit-partner-contact-email" />
              </div>
              <div>
                <Label>{t("fieldEmployees.phone")}</Label>
                <Input value={editPartnerContactForm.phone} onChange={(e) => setEditPartnerContactForm({ ...editPartnerContactForm, phone: handlePhoneInput(e.target.value) })} data-testid="input-edit-partner-contact-phone" />
              </div>
              <div>
                <Label>{t("fieldEmployees.companyRoles")}</Label>
                <p className="text-xs text-muted-foreground mb-2">{t("fieldEmployees.partnerRolesHelp")}</p>
                <RoleMultiSelect value={editPartnerContactForm.roles} onChange={(roles) => setEditPartnerContactForm({ ...editPartnerContactForm, roles })} testIdPrefix="edit-partner-role" />
              </div>
              <PngPillButton color="blue" type="submit" disabled={updatePartnerContact.isPending} className="w-full" data-testid="button-submit-edit-partner-contact">
                {updatePartnerContact.isPending ? t("fieldEmployees.saving") : t("fieldEmployees.saveChanges")}
              </PngPillButton>
            </form>
          </DialogContent>
        </Dialog>
      )}

      <Dialog open={editOfficeOpen} onOpenChange={tryCloseEditOffice}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          {editingOfficeVendorLogoUrl && (
            <div className="absolute inset-x-0 top-0 z-30 h-[calc(1.5in+1rem)] flex items-center justify-center pointer-events-none">
              <img src={editingOfficeVendorLogoUrl} alt={editingOfficeVendorName ? `${editingOfficeVendorName} logo` : "Company logo"} className="max-h-24 max-w-[70%] object-contain" data-testid="img-edit-office-vendor-logo" />
            </div>
          )}
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {t("fieldEmployees.editEmployee")}
              {(() => {
                const editing = (officeEmployees ?? []).find((e) => e.id === editingOfficeContactId);
                return editing?.suspendedAt ? <SuspendedPill /> : null;
              })()}
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={handleEditOffice} className="space-y-4">
            <div>
              <Label>{t("fieldEmployees.employeePhoto")}</Label>
              <div className="mt-2"><PhotoUploadField value={editOfficeForm.photoUrl} onChange={(url) => setEditOfficeForm({ ...editOfficeForm, photoUrl: url })} testIdPrefix="edit-office-employee-photo" /></div>
            </div>
            <div>
              <Label>{t("fieldEmployees.jobTitle")}</Label>
              <Input value={editOfficeForm.jobTitle} onChange={(e) => setEditOfficeForm({ ...editOfficeForm, jobTitle: e.target.value })} data-testid="input-edit-office-job-title" />
            </div>
            <div>
              <Label>{t("fieldEmployees.role")}</Label>
              <Select value={editOfficeForm.vendorRole} onValueChange={(v) => setEditOfficeForm({ ...editOfficeForm, vendorRole: v })}>
                <SelectTrigger data-testid="select-edit-office-role"><SelectValue placeholder={t("fieldEmployees.selectRole")} /></SelectTrigger>
                <SelectContent>
                  {(!isForemanOnly || pecIsCurrent(editOfficeForm)) ? (
                    <SelectItem value="admin" className="focus:bg-transparent data-[highlighted]:bg-transparent"><EmployeeRolePill role="admin" /></SelectItem>
                  ) : null}
                  <SelectItem value="office" className="focus:bg-transparent data-[highlighted]:bg-transparent"><EmployeeRolePill role="office" /></SelectItem>
                  <SelectItem value="field" className="focus:bg-transparent data-[highlighted]:bg-transparent"><EmployeeRolePill role="field" /></SelectItem>
                  <SelectItem value="both" className="focus:bg-transparent data-[highlighted]:bg-transparent"><EmployeeRolePill role="both" /></SelectItem>
                  <SelectItem value="foreman" className="focus:bg-transparent data-[highlighted]:bg-transparent"><EmployeeRolePill role="foreman" /></SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div><Label>{t("fieldEmployees.firstName")}</Label><Input value={editOfficeForm.firstName} onChange={(e) => setEditOfficeForm({ ...editOfficeForm, firstName: e.target.value })} required data-testid="input-edit-office-first-name" /></div>
              <div><Label>{t("fieldEmployees.lastName")}</Label><Input value={editOfficeForm.lastName} onChange={(e) => setEditOfficeForm({ ...editOfficeForm, lastName: e.target.value })} required data-testid="input-edit-office-last-name" /></div>
            </div>
            <div><Label>{t("fieldEmployees.email")}</Label><Input type="email" value={editOfficeForm.email} onChange={(e) => setEditOfficeForm({ ...editOfficeForm, email: e.target.value })} data-testid="input-edit-office-email" /></div>
            <div><Label>{t("fieldEmployees.phone")}</Label><Input value={editOfficeForm.phone} onChange={(e) => setEditOfficeForm({ ...editOfficeForm, phone: handlePhoneInput(e.target.value) })} data-testid="input-edit-office-phone" /></div>
            <div className="flex items-center gap-2">
              <Checkbox id="pec-cert-office-edit" checked={editOfficeForm.pecCertification} onCheckedChange={(v) => setEditOfficeForm({ ...editOfficeForm, pecCertification: !!v })} data-testid="checkbox-edit-office-pec-cert" />
              <Label htmlFor="pec-cert-office-edit" className="cursor-pointer">{t("fieldEmployees.pecCertified")}</Label>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox id="visit-notif-office-edit" checked={editOfficeForm.roles.includes("Visitor Notifications")} onCheckedChange={(v) => setEditOfficeForm({ ...editOfficeForm, roles: v ? Array.from(new Set([...editOfficeForm.roles, "Visitor Notifications"])) : editOfficeForm.roles.filter((r) => r !== "Visitor Notifications") })} data-testid="checkbox-edit-office-visit-notifications" />
              <Label htmlFor="visit-notif-office-edit" className="cursor-pointer">Receive site visitor check-in notifications</Label>
            </div>
            <div><Label>{t("fieldEmployees.pecExpiration")}</Label><Input type="date" value={editOfficeForm.pecExpirationDate} onChange={(e) => setEditOfficeForm({ ...editOfficeForm, pecExpirationDate: e.target.value })} data-testid="input-edit-office-pec-expiration" /></div>
            {editingOfficeContactId ? (
              <CertificationsSection
                employeeId={editingOfficeContactId}
                variant="inline"
                testIdPrefix="edit-office-certifications"
              />
            ) : null}
            {editingOfficeContactId &&
            (editingFromFieldTable ||
              editOfficeForm.vendorRole === "field" ||
              editOfficeForm.vendorRole === "both" ||
              editOfficeForm.vendorRole === "foreman") ? (
              <EmployeePortalLoginFields
                employeeId={editingOfficeContactId}
                defaultEmail={editOfficeForm.email}
                vendorRole={editOfficeForm.vendorRole}
                variant="inline"
                testIdPrefix="edit-office-login"
                onSaved={() => {
                  queryClient.invalidateQueries({ queryKey: officeQueryKey });
                  queryClient.invalidateQueries({ queryKey: getListFieldEmployeesQueryKey(fieldQueryParams) });
                }}
              />
            ) : null}
            {(() => {
              const editing =
                (officeEmployees ?? []).find((e) => e.id === editingOfficeContactId) ??
                (fieldEmployees ?? []).find((e) => e.id === editingOfficeContactId);
              if (!editing?.hasLogin || !editing.userId) return null;
              return (
                <AccountActions
                  userId={editing.userId}
                  hasLogin={editing.hasLogin}
                  suspendedAt={editing.suspendedAt ?? null}
                  testIdPrefix="edit-office-account"
                  onChanged={() => queryClient.invalidateQueries({ queryKey: officeQueryKey })}
                />
              );
            })()}
            <PngPillButton color="blue" type="submit" disabled={updateVendorContact.isPending} attention={editOfficeDirty} className="w-full" data-testid="button-submit-edit-office">
              {updateVendorContact.isPending ? t("fieldEmployees.saving") : t("fieldEmployees.saveChanges")}
            </PngPillButton>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
