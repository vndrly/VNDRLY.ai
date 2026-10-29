import StaffProfileDialog, { type StaffProfilePerson } from "@/components/staff-profile-dialog";
import type { StaffType } from "@/lib/staff-profile";
import { WORKFORCE_GROUPS, workforceCategories, workforceDisplayRoles } from "@/lib/vendor-workforce-groups";
import VendorOperatingArea from "@/components/vendor-operating-area";
import { VendorEditFlyout } from "@/components/vendor-edit-flyout";
import "./vendor-profile.css";
import CompanyOperationsChoice from "@/components/company-operations-choice";
import { useState, useRef, useMemo, useEffect } from "react";
import { useUnsavedChanges } from "@/hooks/use-unsaved-changes";

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
import { cn, formatPhone, handlePhoneInput, stripPhone } from "@/lib/utils";
import {
  compressMainLogo,
  fitImageIntoSquare,
  isSquareWithinTolerance,
} from "@/lib/image-resize";
import { SquareLogoCropDialog } from "@/components/square-logo-crop-dialog";
import {
  useGetVendor,
  useUpdateVendor,
  useListVendorContacts,
  useDeleteVendorContact,
  useDeleteFieldEmployee,
  useListVendorNotes,
  useCreateVendorNote,
  useDeleteVendorNote,
  useDeleteVendor,
  getGetVendorQueryKey,
  getListVendorsQueryKey,
  getListVendorContactsQueryKey,
  getListVendorNotesQueryKey,
  useGetVendorRatings,
  useUpsertVendorRating,
  useDeleteVendorRating,
  getGetVendorRatingsQueryKey,
  getListFieldEmployeesQueryKey,
  matchVendor,
} from "@workspace/api-client-react";
import type { MatchVendorResponseItem } from "@workspace/api-client-react";
import { useEligibleVendorFieldEmployeesByVendorId } from "@/hooks/use-eligible-vendor-field-employees";
import { useQueryClient, useMutation } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle, CARD_INNER_TILE_CLASS } from "@/components/ui/card";
import { PngPillButton as PillButton } from "@/components/png-pill-rollover";
import RemovePill from "@/components/remove-pill";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogLogoHeader } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertTriangle, ArrowDown, ArrowUp, Check, FileText, ImageIcon, Pencil, Plus, ShoppingCart, Star, Trash2, Upload, UserCheck, Users, X } from "lucide-react";
import StarRating from "@/components/star-rating";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { BrandedCheckbox as Checkbox } from "@/components/branded-checkbox";
import { useToast } from "@/hooks/use-toast";
import BlueButton from "@/components/blue-button";
import { PngPillButton } from "@/components/png-pill-rollover";

import { useBrand } from "@/hooks/use-brand";
import GreyButton from "@/components/grey-button";
import BrandPillButton from "@/components/brand-pill-button";
import RedButton from "@/components/red-button";
import SphereBackButton from "@/components/sphere-back-button";
import PecStatusBadge from "@/components/pec-status-badge";
import RoleBadge from "@/components/role-badge";
import { PhotoUploadField } from "@/components/photo-upload-field";
import EmployeePortalLoginFields from "@/components/employee-portal-login-fields";
import { useAuth } from "@/hooks/use-auth";
import OrgMembersCard from "@/components/org-members-card";
import VendorPartnerRelationshipsCard from "@/components/vendor-partner-relationships-card";
import ManagedSubcontractorEmployeesCard from "@/components/managed-subcontractor-employees-card";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { translateApiError } from "@/lib/api-error";
import { PlatformEulaModal } from "@/components/platform-eula-modal";
import { canManageVendorSubcontractors, canViewVendorOfficeEmployees } from "@/lib/vendor-detail-visibility";

export default function VendorDetail({ id }: { id: number }) {
  const [staffOpen, setStaffOpen] = useState(false);
  const [staffTarget, setStaffTarget] = useState<StaffProfilePerson | null>(null);
  const [staffDefaultType, setStaffDefaultType] = useState<StaffType>("Office Staff");
  const addStaff = (type: StaffType) => { setStaffTarget(null); setStaffDefaultType(type); setStaffOpen(true); };
  const brand = useBrand();
  const { t } = useTranslation();
  const { user: authUser } = useAuth();
  const isOwnVendor = authUser?.role === "vendor" && authUser.vendorId === id;
  const canEditVendor = authUser?.role === "admin" || isOwnVendor;
  const canViewOfficeEmployees = canViewVendorOfficeEmployees(authUser?.role, isOwnVendor);
  const { data: vendor, isLoading } = useGetVendor(id, { query: { enabled: !!id, queryKey: getGetVendorQueryKey(id) } });
  // Task #523: source the field-employee list through the shared hook so
  // every vendor-facing surface that lists vendor_people goes through the
  // same active-vendor + isActive defense (the table is read-only, but
  // routing it through the shared helper keeps invalidation and filtering
  // identical to the pickers and avoids future drift). The shared hook
  // already calls useListFieldEmployees({ vendorId: id }) under the hood,
  // so the queryKey lines up with the existing
  // getListFieldEmployeesQueryKey({ vendorId: id }) invalidations below.
  const { eligibleForemen: employees } =
    useEligibleVendorFieldEmployeesByVendorId(id, canEditVendor);
  const { data: contacts } = useListVendorContacts(id, undefined, { query: { enabled: !!id && canViewOfficeEmployees, queryKey: getListVendorContactsQueryKey(id) } });
  const { data: companyOperations, isError: operationsError } = useQuery({
    queryKey: ["company-operations", id], enabled: !!id && canEditVendor,
    queryFn: async (): Promise<{ categories: string[] }> => {
      const response = await fetch(`/api/company-operations?vendorId=${id}`, { credentials: "include" });
      if (!response.ok) throw new Error("Unable to load company operations");
      return response.json();
    },
  });
  const { data: workforceAccess } = useQuery({
    queryKey: ["vendor-people-access", id], enabled: !!id && canEditVendor, retry: false,
    queryFn: async (): Promise<{ people: { vendorPeopleId: number; operationalRoles: string[] }[] }> => {
      const response = await fetch(`/api/vendors/${id}/people-access`, { credentials: "include" });
      if (!response.ok) throw new Error("Unable to load employee duties");
      return response.json();
    },
  });
  const { data: notes } = useListVendorNotes(id, { query: { enabled: !!id && (authUser?.role === "admin" || authUser?.role === "partner" || isOwnVendor), queryKey: [...getListVendorNotesQueryKey(id), authUser?.role, authUser?.partnerId, authUser?.vendorId] } });
  const updateVendor = useUpdateVendor();
  const removeVendor = useDeleteVendor();
  const deleteContact = useDeleteVendorContact();
  const deleteEmployee = useDeleteFieldEmployee();
  const createNote = useCreateVendorNote();
  const deleteNote = useDeleteVendorNote();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [editOpen, setEditOpen] = useState(false);
  const [platformEulaOpen, setPlatformEulaOpen] = useState(false);
  const [editForm, setEditForm] = useState({ name: "", contactName: "", contactEmail: "", contactPhone: "", physicalAddress: "", billingAddress: "", stateTaxId: "", federalTaxId: "", businessPhone: "", hoursOfOperation: "", blurb: "", brandPrimaryColor: "", brandAccentColor: "" });
  const initialEditFormRef = useRef<typeof editForm | null>(null);
  const editFormDirty = useMemo(() => !!initialEditFormRef.current && JSON.stringify(editForm) !== JSON.stringify(initialEditFormRef.current), [editForm]);
  const anyDirty = editOpen && editFormDirty;
  useUnsavedChanges(anyDirty);
  const tryCloseEdit = (open: boolean) => {
    if (!open && editFormDirty && !window.confirm("You have unsaved changes. Discard them?")) return;
    if (!open) initialEditFormRef.current = null;
    setEditOpen(open);
  };



  // Duplicate-name guard for the rename flow. Mirrors the create-path
  // logic in vendors.tsx and the partner rename flow in
  // partner-detail.tsx so admins can't silently rename a vendor to a
  // near-duplicate of an existing one (which would re-introduce the
  // split-reporting problem the create-path warning prevents).
  // /vendors/match is admin-only, so we skip the lookup for vendor
  // self-edits; admins are the only role that can hit a 403 here.
  const isAdmin = authUser?.role === "admin";
  const [renameMatches, setRenameMatches] = useState<MatchVendorResponseItem[]>([]);
  const [renameMatchesLoading, setRenameMatchesLoading] = useState(false);
  const [renameCheckedName, setRenameCheckedName] = useState<string | null>(null);
  const [confirmDifferentRename, setConfirmDifferentRename] = useState(false);
  // Debounced fuzzy lookup against /vendors/match. Mirrors the create
  // path in vendors.tsx — AbortController prevents stale responses,
  // and we exclude the vendor being edited so the warning doesn't
  // fire when the name is unchanged.
  useEffect(() => {
    if (!editOpen || !isAdmin) return;
    const trimmed = editForm.name.trim();
    setConfirmDifferentRename(false);
    if (trimmed.length < 3) {
      setRenameMatches([]);
      setRenameMatchesLoading(false);
      setRenameCheckedName(trimmed);
      return;
    }
    setRenameCheckedName(null);
    setRenameMatchesLoading(true);
    const controller = new AbortController();
    const handle = setTimeout(async () => {
      try {
        const res = await matchVendor(
          { name: trimmed },
          { signal: controller.signal },
        );
        if (controller.signal.aborted) return;
        setRenameMatches(res.matches.filter((m) => m.id !== id));
        setRenameCheckedName(trimmed);
      } catch (err) {
        if (
          controller.signal.aborted ||
          (err instanceof DOMException && err.name === "AbortError")
        ) {
          return;
        }
        setRenameMatches([]);
        setRenameCheckedName(null);
      } finally {
        if (!controller.signal.aborted) setRenameMatchesLoading(false);
      }
    }, 300);
    return () => {
      clearTimeout(handle);
      controller.abort();
    };
  }, [editForm.name, editOpen, isAdmin, id]);
  // Reset duplicate-warning state every time the dialog opens so a
  // previous session's warning doesn't briefly flash on the next open.
  useEffect(() => {
    if (editOpen) {
      setRenameMatches([]);
      setConfirmDifferentRename(false);
      setRenameCheckedName(null);
    }
  }, [editOpen]);
  const [noteOpen, setNoteOpen] = useState(false);
  const [noteContent, setNoteContent] = useState("");
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const logoInputRef = useRef<HTMLInputElement>(null);
  const [uploadingSquareLogo, setUploadingSquareLogo] = useState(false);
  const squareLogoInputRef = useRef<HTMLInputElement>(null);
  // When non-null, the SquareLogoCropDialog is open with this file as
  // its source. Set by handleSquareLogoUpload for non-square inputs;
  // cleared by the dialog's onClose / onConfirm.
  const [pendingSquareLogoFile, setPendingSquareLogoFile] = useState<File | null>(null);

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast({ title: "Please select an image file", variant: "destructive" });
      return;
    }
    setUploadingLogo(true);
    try {
      // Cap the longest edge at ~1024px so multi-MB brand-kit exports
      // don't slow down every modal-header / vendor-detail render. SVG
      // passes through unchanged. See lib/image-resize.ts.
      const compressed = await compressMainLogo(file);
      const res = await fetch(`${API_BASE}/api/storage/uploads/request-url`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: compressed.name, size: compressed.size, contentType: compressed.type }),
      });
      if (!res.ok) throw new Error("Failed to get upload URL");
      const { uploadURL, objectPath } = await res.json();
      const uploadRes = await fetch(uploadURL, {
        method: "PUT",
        headers: { "Content-Type": compressed.type },
        body: compressed,
      });
      if (!uploadRes.ok) throw new Error("Upload failed");
      await fetch(`${API_BASE}/api/storage/uploads/finalize`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ objectURL: uploadURL, visibility: "public" }),
      });
      const logoUrl = `${API_BASE}/api/storage${objectPath}`;
      updateVendor.mutate(
        { id, data: { logoUrl } },
        {
          onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: getGetVendorQueryKey(id) });
            queryClient.invalidateQueries({ queryKey: getListVendorsQueryKey() });
            toast({ title: "Logo uploaded" });
          },
          onError: (err) => toast({ title: translateApiError(err, t, t("vendors.logoSaveFailed")), variant: "destructive" }),
        },
      );
    } catch {
      toast({ title: "Failed to upload logo", variant: "destructive" });
    } finally {
      setUploadingLogo(false);
      if (logoInputRef.current) logoInputRef.current.value = "";
    }
  };

  const handleRemoveLogo = () => {
    if (!confirm("Remove the company logo?")) return;
    updateVendor.mutate(
      { id, data: { logoUrl: null } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetVendorQueryKey(id) });
          queryClient.invalidateQueries({ queryKey: getListVendorsQueryKey() });
          toast({ title: "Logo removed" });
        },
        onError: (err) => toast({ title: translateApiError(err, t, t("vendors.logoRemoveFailed")), variant: "destructive" }),
      },
    );
  };

  // Uploads an already-normalized 512×512 PNG to storage and persists
  // the resulting URL on the vendor. Shared between the
  // "skip-cropper" branch (square-enough or SVG inputs) and the
  // SquareLogoCropDialog confirm callback.
  const uploadSquareLogo = async (normalized: File) => {
    setUploadingSquareLogo(true);
    try {
      const res = await fetch(`${API_BASE}/api/storage/uploads/request-url`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: normalized.name, size: normalized.size, contentType: normalized.type }),
      });
      if (!res.ok) throw new Error("Failed to get upload URL");
      const { uploadURL, objectPath } = await res.json();
      const uploadRes = await fetch(uploadURL, {
        method: "PUT",
        headers: { "Content-Type": normalized.type },
        body: normalized,
      });
      if (!uploadRes.ok) throw new Error("Upload failed");
      await fetch(`${API_BASE}/api/storage/uploads/finalize`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ objectURL: uploadURL, visibility: "public" }),
      });
      const logoSquareUrl = `${API_BASE}/api/storage${objectPath}`;
      updateVendor.mutate(
        { id, data: { logoSquareUrl } },
        {
          onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: getGetVendorQueryKey(id) });
            queryClient.invalidateQueries({ queryKey: getListVendorsQueryKey() });
            toast({ title: "Square logo uploaded" });
          },
          onError: (err) => toast({ title: translateApiError(err, t, t("vendors.logoSaveFailed")), variant: "destructive" }),
        },
      );
    } catch {
      toast({ title: "Failed to upload logo", variant: "destructive" });
    } finally {
      setUploadingSquareLogo(false);
    }
  };

  // Gate the square-logo upload behind a crop UI when the source is
  // visibly non-square. SVGs and already-square (within 2%) inputs
  // skip the modal and upload immediately to keep the happy path
  // friction-free; everything else opens the cropper so the user can
  // pick the most legible 1:1 region of their image.
  const handleSquareLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast({ title: "Please select an image file", variant: "destructive" });
      if (squareLogoInputRef.current) squareLogoInputRef.current.value = "";
      return;
    }
    try {
      const skipCropper = await isSquareWithinTolerance(file);
      if (skipCropper) {
        const normalized = await fitImageIntoSquare(file);
        await uploadSquareLogo(normalized);
      } else {
        setPendingSquareLogoFile(file);
      }
    } catch {
      toast({ title: "Failed to read image", variant: "destructive" });
    } finally {
      // Always reset the input so re-selecting the same file fires
      // onChange again — important for the "cancel cropper, retry"
      // flow.
      if (squareLogoInputRef.current) squareLogoInputRef.current.value = "";
    }
  };

  const handleRemoveSquareLogo = () => {
    if (!confirm("Remove the square logo?")) return;
    updateVendor.mutate(
      { id, data: { logoSquareUrl: null } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetVendorQueryKey(id) });
          queryClient.invalidateQueries({ queryKey: getListVendorsQueryKey() });
          toast({ title: "Square logo removed" });
        },
        onError: (err) => toast({ title: translateApiError(err, t, t("vendors.logoRemoveFailed")), variant: "destructive" }),
      },
    );
  };

  type ContactSortKey = "jobTitle" | "firstName" | "email" | "phone" | "vendorRole";
  type EmpSortKey = "jobTitle" | "name" | "email" | "phone" | "vendorRole" | "pecStatus";
  type SortDir = "asc" | "desc";
  const [contactSort, setContactSort] = useState<{ key: ContactSortKey; dir: SortDir }>({ key: "firstName", dir: "asc" });
  const [empSort, setEmpSort] = useState<{ key: EmpSortKey; dir: SortDir }>({ key: "name", dir: "asc" });

  const toggleContactSort = (key: ContactSortKey) => {
    setContactSort((prev) => prev.key === key ? { key, dir: prev.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" });
  };
  const toggleEmpSort = (key: EmpSortKey) => {
    setEmpSort((prev) => prev.key === key ? { key, dir: prev.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" });
  };

  const getPecSortValue = (exp: string | null) => {
    if (!exp) return 2;
    const diff = new Date(exp + "T00:00:00").getTime() - new Date().setHours(0, 0, 0, 0);
    if (diff < 0) return 2;
    if (diff <= 30 * 86400000) return 1;
    return 0;
  };

  const officeContacts = (contacts ?? []).filter(person => {
    const access = workforceAccess?.people.find(row => row.vendorPeopleId === person.id)?.operationalRoles;
    return access?.length ? access.includes("office") || person.vendorRole === "admin" : ["admin", "office", "both"].includes(person.vendorRole ?? "office");
  });
  const sortedContacts = [...officeContacts].sort((a, b) => {
    const dir = contactSort.dir === "asc" ? 1 : -1;
    const k = contactSort.key;
    if (k === "vendorRole") return dir * (a.vendorRole || "office").localeCompare(b.vendorRole || "office");
    const av = (a as any)[k] || "";
    const bv = (b as any)[k] || "";
    return dir * String(av).localeCompare(String(bv));
  });

  const workforcePeople = [...new Map([
    ...(contacts ?? []).map(person => ({ ...person, vendorRole: person.vendorRole ?? "office", pecCertification: person.pecCertification ?? false, source: "contact" as const })),
    ...(employees ?? []).map(person => ({ ...person, vendorRole: person.vendorRole ?? "field", source: "employee" as const })),
  ].map(person => [person.id, person])).values()];
  const workforceCards = WORKFORCE_GROUPS.filter(group => companyOperations?.categories.includes(group.category)).map(group => ({
    ...group,
    people: workforcePeople.filter(person => workforceCategories(person, workforceAccess?.people.find(row => row.vendorPeopleId === person.id)?.operationalRoles).includes(group.category)).sort((a, b) => {
      const dir = empSort.dir === "asc" ? 1 : -1;
      if (empSort.key === "name") return dir * `${a.firstName} ${a.lastName}`.localeCompare(`${b.firstName} ${b.lastName}`);
      if (empSort.key === "pecStatus") return dir * (getPecSortValue(a.pecExpirationDate ?? null) - getPecSortValue(b.pecExpirationDate ?? null));
      return dir * String(a[empSort.key] ?? "").localeCompare(String(b[empSort.key] ?? ""));
    }),
  }));

  const openEditDialog = () => {
    if (vendor) {
      const hydrated = {
        name: vendor.name,
        contactName: vendor.contactName,
        contactEmail: vendor.contactEmail,
        contactPhone: vendor.contactPhone || "",
        physicalAddress: vendor.physicalAddress || "",
        billingAddress: vendor.billingAddress || "",
        stateTaxId: vendor.stateTaxId || "",
        federalTaxId: vendor.federalTaxId || "",
        businessPhone: vendor.businessPhone || "",
        hoursOfOperation: vendor.hoursOfOperation || "",
        blurb: vendor.blurb || "",
        brandPrimaryColor: vendor.brandPrimaryColor || "",
        brandAccentColor: vendor.brandAccentColor || "",
      };
      setEditForm(hydrated);
      initialEditFormRef.current = hydrated;
    }
    setEditOpen(true);
  };

  const handleEdit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedName = editForm.name.trim();
    // Only admins can hit /vendors/match, so only gate the save for
    // them. Mirrors the gating in vendors.tsx so a fast Enter can't
    // slip through before the debounced check resolves.
    if (isAdmin && trimmedName.length >= 3 && (renameMatchesLoading || renameCheckedName !== trimmedName)) {
      toast({
        title: t("vendors.duplicateChecking", {
          defaultValue: "Checking for similar vendors…",
        }),
      });
      return;
    }
    if (isAdmin && renameMatches.length > 0 && !confirmDifferentRename) {
      toast({
        title: t("vendors.duplicateRenameConfirmRequired", {
          defaultValue:
            "Please confirm this is a different vendor before saving.",
        }),
        variant: "destructive",
      });
      return;
    }
    updateVendor.mutate(
      { id, data: { ...editForm, contactPhone: editForm.contactPhone || null, physicalAddress: editForm.physicalAddress || null, billingAddress: editForm.billingAddress || null, stateTaxId: editForm.stateTaxId || null, federalTaxId: editForm.federalTaxId || null, businessPhone: editForm.businessPhone || null, hoursOfOperation: editForm.hoursOfOperation || null, blurb: editForm.blurb || null, brandPrimaryColor: editForm.brandPrimaryColor || null, brandAccentColor: editForm.brandAccentColor || null } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetVendorQueryKey(id) });
          queryClient.invalidateQueries({ queryKey: getListVendorsQueryKey() });
          initialEditFormRef.current = editForm;
          setEditOpen(false);
          toast({ title: t("vendors.updateSuccess") });
        },
        onError: (err) => {
          toast({ title: translateApiError(err, t, t("vendors.updateFailed")), variant: "destructive" });
        },
      },
    );
  };



  const openEditContactDialog = (contact: { id: number; jobTitle: string | null; firstName: string; lastName: string; email: string; phone: string | null; vendorRole?: string; pecCertification?: boolean; pecExpirationDate?: string | null; photoUrl?: string | null; roles?: string[] | null }) => {
    setStaffTarget(contact); setStaffOpen(true);
  };



  const handleDeleteContact = (contactId: number) => {
    deleteContact.mutate(
      { vendorId: id, contactId },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListVendorContactsQueryKey(id) });
          queryClient.invalidateQueries({ queryKey: getListFieldEmployeesQueryKey({ vendorId: id }) });
          toast({ title: "Contact removed" });
        },
      },
    );
  };

  const openEditEmployeeDialog = (emp: { id: number; jobTitle?: string | null; firstName: string; lastName: string; email: string; phone: string | null; pecCertification: boolean; pecExpirationDate: string | null; vendorRole?: string | null; photoUrl?: string | null; roles?: string[] | null }) => {
    setStaffTarget(emp); setStaffOpen(true);
  };



  const handleDeleteEmployee = (employeeId: number) => {
    deleteEmployee.mutate(
      { id: employeeId },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListFieldEmployeesQueryKey({ vendorId: id }) });
          queryClient.invalidateQueries({ queryKey: getListVendorContactsQueryKey(id) });
          toast({ title: "Employee removed" });
        },
      },
    );
  };

  const handleAddNote = (e: React.FormEvent) => {
    e.preventDefault();
    createNote.mutate(
      { vendorId: id, data: { content: noteContent } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListVendorNotesQueryKey(id) });
          setNoteOpen(false);
          setNoteContent("");
          toast({ title: "Note added" });
        },
        onError: (err) => {
          toast({ title: translateApiError(err, t, t("vendors.addNoteFailed")), variant: "destructive" });
        },
      },
    );
  };

  const handleDeleteNote = (noteId: number) => {
    deleteNote.mutate(
      { vendorId: id, noteId },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListVendorNotesQueryKey(id) });
          toast({ title: "Note removed" });
        },
      },
    );
  };

  const handleRemoveVendor = () => {
    if (!confirm(`Are you sure you want to remove "${vendor?.name}"? This action cannot be undone.`)) return;
    removeVendor.mutate(
      { id },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListVendorsQueryKey() });
          toast({ title: "Vendor removed" });
          navigate("/vendors");
        },
        onError: (err) => {
          toast({ title: translateApiError(err, t, t("vendors.removeVendorFailed")), variant: "destructive" });
        },
      },
    );
  };

  if (isLoading) return <div className="space-y-4"><Skeleton className="h-8 w-48" /><Skeleton className="h-48 w-full" /></div>;
  if (!vendor) return <p className="text-muted-foreground">Vendor not found</p>;

  return (
    <div className="vendor-profile-page space-y-6" data-testid="vendor-detail-page">
      <SquareLogoCropDialog
        file={pendingSquareLogoFile}
        onConfirm={async (cropped) => {
          setPendingSquareLogoFile(null);
          await uploadSquareLogo(cropped);
        }}
        onClose={() => setPendingSquareLogoFile(null)}
      />
      <div className="flex items-center gap-4">
        {!isOwnVendor ? (
          <Link href="/vendors" className="group inline-flex items-center gap-2" aria-label="Back" data-testid="button-back"><SphereBackButton size={40} /></Link>
        ) : (
          <button type="button" onClick={() => window.history.back()} className="group inline-flex items-center gap-2" aria-label="Back" data-testid="button-back"><SphereBackButton size={40} /></button>
        )}
        {(vendor.logoUrl || vendor.logoSquareUrl) && (
          <div className="flex h-14 max-w-44 shrink-0 items-center justify-start" data-testid="vendor-header-logo">
            <img src={vendor.logoUrl || vendor.logoSquareUrl || ""} alt={`${vendor.name} logo`} className="h-full w-auto max-w-44 object-contain object-left" />
          </div>
        )}
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-vendor-name">{vendor.name}</h1>
          <p className="text-muted-foreground text-sm">Vendor since {new Date(vendor.createdAt).toLocaleDateString()}</p>
        </div>
        <div className="ml-auto">
          {canEditVendor && (
          <Dialog open={editOpen} onOpenChange={tryCloseEdit}>

            <VendorEditFlyout title={t("vendors.editVendor")} logoSrc={vendor.logoSquareUrl || vendor.logoUrl || undefined} logoAlt={`${vendor.name} logo`} onClose={() => tryCloseEdit(false)}>
              <form onSubmit={handleEdit} className="space-y-4">
                <CompanyOperationsChoice vendorId={id} />
<div>
                  <Label>{t("vendors.companyName")}</Label>
                  <Input value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} data-testid="input-vendor-name" />
                  {isAdmin && renameMatches.length > 0 && (
                    <div
                      role="alert"
                      data-testid="vendor-rename-duplicate-warning"
                      className="mt-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900"
                    >
                      <div className="flex items-start gap-2">
                        <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-amber-600" />
                        <div className="flex-1 space-y-1.5">
                          <p className="font-medium">
                            {t("vendors.duplicateWarningTitle", {
                              defaultValue:
                                "This name looks similar to existing vendors.",
                            })}
                          </p>
                          <ul className="space-y-0.5">
                            {renameMatches.map((m) => (
                              <li key={m.id}>
                                {t("vendors.duplicateWarningSuggestion", {
                                  defaultValue: "Did you mean ",
                                })}
                                <Link
                                  href={`/vendors/${m.id}`}
                                  className="font-semibold underline hover:text-amber-700"
                                  data-testid={`link-rename-duplicate-vendor-${m.id}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                >
                                  {m.name}
                                </Link>
                                ?
                              </li>
                            ))}
                          </ul>
                          <label className="mt-1 flex items-center gap-2 text-amber-900">
                            <Checkbox
                              data-testid="checkbox-confirm-different-vendor-rename"
                              checked={confirmDifferentRename}
                              onCheckedChange={(c) => setConfirmDifferentRename(c === true)}
                            />
                            <span>
                              {t("vendors.duplicateRenameConfirmLabel", {
                                defaultValue:
                                  "I'm sure this is a different vendor — rename it anyway.",
                              })}
                            </span>
                          </label>
                        </div>
                      </div>
                    </div>
                  )}
                  {isAdmin && renameMatchesLoading && renameMatches.length === 0 && editForm.name.trim().length >= 3 && (
                    <p className="mt-1 text-xs text-muted-foreground" data-testid="vendor-rename-match-loading">
                      {t("vendors.duplicateChecking", { defaultValue: "Checking for similar vendors…" })}
                    </p>
                  )}
                </div>
                <div>
                  <Label>{t("vendors.physicalAddress")}</Label>
                  <Input value={editForm.physicalAddress} onChange={(e) => setEditForm({ ...editForm, physicalAddress: e.target.value })} placeholder={t("vendors.addressPlaceholder")} data-testid="input-physical-address" />
                </div>
                <div>
                  <Label>{t("vendors.billingAddress")}</Label>
                  <Input value={editForm.billingAddress} onChange={(e) => setEditForm({ ...editForm, billingAddress: e.target.value })} placeholder={t("vendors.addressPlaceholder")} data-testid="input-billing-address" />
                </div>
                <div>
                  <Label>{t("vendors.businessPhone")}</Label>
                  <Input value={editForm.businessPhone} onChange={(e) => setEditForm({ ...editForm, businessPhone: handlePhoneInput(e.target.value) })} placeholder={t("vendors.businessPhonePlaceholder")} data-testid="input-business-phone" />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label>{t("vendors.stateTaxId")}</Label>
                    <Input value={editForm.stateTaxId} onChange={(e) => setEditForm({ ...editForm, stateTaxId: e.target.value })} placeholder={t("vendors.stateTaxIdPlaceholder")} data-testid="input-state-tax-id" />
                  </div>
                  <div>
                    <Label>{t("vendors.federalTaxIdEin")}</Label>
                    <Input value={editForm.federalTaxId} onChange={(e) => setEditForm({ ...editForm, federalTaxId: e.target.value })} placeholder={t("vendors.federalTaxIdPlaceholder")} data-testid="input-federal-tax-id" />
                  </div>
                </div>
                <div>
                  <Label>{t("vendors.hoursOfOperation")}</Label>
                  <Input value={editForm.hoursOfOperation} onChange={(e) => setEditForm({ ...editForm, hoursOfOperation: e.target.value })} placeholder={t("vendors.hoursOfOperationPlaceholder")} data-testid="input-hours-of-operation" />
                </div>
                <div>
                  <Label>{t("vendors.aboutUs")}</Label>
                  <Textarea value={editForm.blurb} onChange={(e) => setEditForm({ ...editForm, blurb: e.target.value })} placeholder={t("vendors.aboutUsPlaceholder")} rows={4} data-testid="input-blurb" />
                </div>
                {canEditVendor && (
                  <div className="space-y-4 pt-2 border-t">
                    <div className="flex items-start gap-4">
                      <div className="w-20 h-20 rounded-md border border-gray-200 bg-white flex items-center justify-center overflow-hidden shrink-0">
                        {vendor.logoUrl ? (
                          <img src={vendor.logoUrl} alt={`${vendor.name} logo`} className="w-full h-full object-contain" data-testid="img-edit-vendor-company-logo" />
                        ) : (
                          <ImageIcon className="w-7 h-7 text-gray-300" />
                        )}
                      </div>
                      <div className="flex-1">
                        <div className="text-sm font-medium mb-1">Company Logo</div>
                        <p className="text-xs text-muted-foreground mb-2">PNG, JPG, SVG, or animated GIF. Used in your portal sidebar and on tickets.</p>
                        <input ref={logoInputRef} type="file" accept="image/*" className="hidden" onChange={handleLogoUpload} data-testid="input-logo-file" />
                        <div className="flex gap-2 flex-wrap">
                          <button className="vendor-mini-card-button" type="button" onClick={() => logoInputRef.current?.click()} disabled={uploadingLogo} data-testid="button-upload-logo">
                            <Upload className="w-4 h-4" />{uploadingLogo ? "Uploading..." : vendor.logoUrl ? "Replace Logo" : "Upload Logo"}
                          </button>
                          {vendor.logoUrl && (
                            <button className="vendor-mini-card-button" type="button" onClick={handleRemoveLogo} data-testid="button-remove-logo">
                              <Trash2 className="w-4 h-4" />Remove
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-start gap-4">
                      <div className="w-20 h-20 rounded-md border border-gray-200 bg-white flex items-center justify-center overflow-hidden shrink-0">
                        {vendor.logoSquareUrl ? (
                          <img
                            src={vendor.logoSquareUrl}
                            alt={`${vendor.name} square logo`}
                            className="w-full h-full object-contain"
                            data-testid="img-edit-vendor-square-logo"
                          />
                        ) : (
                          <ImageIcon className="w-7 h-7 text-gray-300" />
                        )}
                      </div>
                      <div className="flex-1">
                        <div className="text-sm font-medium mb-1">Square Logo (1:1)</div>
                        <p className="text-xs text-muted-foreground mb-2">
                          PNG, JPG, SVG, or GIF, max 512x512, ideally a 1:1 square image. . Shown at 64×64 in the navigation sidebar.
                        </p>
                        <input
                          ref={squareLogoInputRef}
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={handleSquareLogoUpload}
                          data-testid="input-square-logo-file"
                        />
                        <div className="flex gap-2 flex-wrap">
                          <button className="vendor-mini-card-button"
                            type="button"
                            onClick={() => squareLogoInputRef.current?.click()}
                            disabled={uploadingSquareLogo}
                            data-testid="button-upload-square-logo"
                          >
                            <Upload className="w-4 h-4" />
                            {uploadingSquareLogo
                              ? "Uploading..."
                              : vendor.logoSquareUrl
                                ? "Replace Square Logo"
                                : "Upload Square Logo"}
                          </button>
                          {vendor.logoSquareUrl && (
                            <button className="vendor-mini-card-button" type="button" onClick={handleRemoveSquareLogo} data-testid="button-remove-square-logo">
                              <Trash2 className="w-4 h-4" />Remove
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                )}
                <div className="space-y-2">
                  <Label>{t("vendors.brandColors")}</Label>
                  <p className="text-xs text-muted-foreground">{t("vendors.brandColorsHelp")}</p>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label className="text-xs text-muted-foreground">{t("vendors.primary")}</Label>
                      <div className="flex items-center gap-2">
                        <input
                          type="color"
                          value={editForm.brandPrimaryColor || "#000000"}
                          onChange={(e) => setEditForm({ ...editForm, brandPrimaryColor: e.target.value })}
                          className="h-9 w-12 rounded border border-input cursor-pointer"
                          data-testid="input-brand-primary-color-picker"
                        />
                        <Input
                          value={editForm.brandPrimaryColor}
                          onChange={(e) => setEditForm({ ...editForm, brandPrimaryColor: e.target.value })}
                          placeholder="#1f7ae0"
                          className="flex-1"
                          data-testid="input-brand-primary-color"
                        />
                      </div>
                    </div>
                    <div>
                      <Label className="text-xs text-muted-foreground">{t("vendors.accentOptional")}</Label>
                      <div className="flex items-center gap-2">
                        <input
                          type="color"
                          value={editForm.brandAccentColor || "#000000"}
                          onChange={(e) => setEditForm({ ...editForm, brandAccentColor: e.target.value })}
                          className="h-9 w-12 rounded border border-input cursor-pointer"
                          data-testid="input-brand-accent-color-picker"
                        />
                        <Input
                          value={editForm.brandAccentColor}
                          onChange={(e) => setEditForm({ ...editForm, brandAccentColor: e.target.value })}
                          placeholder="#f59e0b"
                          className="flex-1"
                          data-testid="input-brand-accent-color"
                        />
                      </div>
                    </div>
                  </div>
                </div>
                <button className="vendor-mini-card-button"
                  type="submit"
                  disabled={updateVendor.isPending || (isAdmin && editForm.name.trim().length >= 3 && (renameMatchesLoading || renameCheckedName !== editForm.name.trim())) || (isAdmin && renameMatches.length > 0 && !confirmDifferentRename)}
                  data-testid="button-submit-edit"
                >
                  {updateVendor.isPending ? t("common.saving") : t("common.saveChanges")}
                </button>
              </form>
            </VendorEditFlyout>
          </Dialog>
          )}
        </div>
      </div>

      <Card>
        <CardHeader className="vendor-profile-info-header flex flex-row items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2"><Users className="w-5 h-5" style={{ color: "var(--brand-primary)" }} />Vendor Information</CardTitle>

        </CardHeader>
        <CardContent className="space-y-2">
          <div><span className="text-sm text-muted-foreground">Physical Address:</span> <span className="font-medium">{vendor.physicalAddress || "-"}</span></div>
          <div><span className="text-sm text-muted-foreground">Billing Address:</span> <span className="font-medium">{vendor.billingAddress || "-"}</span></div>
          <div><span className="text-sm text-muted-foreground">Business Phone:</span> <span className="font-medium">{vendor.businessPhone ? formatPhone(vendor.businessPhone) : "-"}</span></div>
          <div><span className="text-sm text-muted-foreground">Hours of Operation:</span> <span className="font-medium">{vendor.hoursOfOperation || "-"}</span></div>
          <div className="grid grid-cols-2 gap-4">
            <div><span className="text-sm text-muted-foreground">State Tax ID:</span> <span className="font-medium">{vendor.stateTaxId || "-"}</span></div>
            <div><span className="text-sm text-muted-foreground">Federal Tax ID:</span> <span className="font-medium">{vendor.federalTaxId || "-"}</span></div>
          </div>
          <div className="pt-2 border-t mt-2">
            <div className="text-sm text-muted-foreground mb-1">About Us</div>
            <p className="text-sm whitespace-pre-wrap">{vendor.blurb || "-"}</p>
          </div>
          <div className="vendor-profile-footer-actions pt-2 border-t">
          <VendorOperatingArea vendorId={id} canEdit={authUser?.role === "admin" || isOwnVendor} />
          <div className="vendor-profile-info-actions">
            {(isOwnVendor || authUser?.role === "admin") && <button type="button" className="vendor-mini-card-button" data-testid="button-view-platform-eula" onClick={() => setPlatformEulaOpen(true)}><FileText className="w-4 h-4" />{t("platformEula.viewButton")}</button>}
            {canEditVendor && <button type="button" className="vendor-mini-card-button" data-testid="button-edit-vendor" onClick={openEditDialog}><Pencil className="w-4 h-4" />{t("common.edit")}</button>}
          </div>
          </div>
        </CardContent>
      </Card>

      <VendorRatingsCard vendorId={id} />

      {/* Hide the Members card unless the viewer is a system admin or
          has an admin-role membership in THIS vendor — mirrors the
          backend authz so non-admin org members don't see a card that
          would 403 on every action. */}
      {canEditVendor && <OrgMembersCard
        onAddStaff={() => addStaff("Office Staff")}
        onEditStaff={(member) => {
          const match = workforcePeople.find(person => person.email.toLowerCase() === member.username.toLowerCase());
          if (match) { setStaffTarget(match); setStaffOpen(true); return true; }
          const [firstName, ...rest] = member.displayName.split(" ");
          setStaffTarget({ id: 0, vendorId: id, accountUserId: member.userId, isCompanyAdmin: member.role === "admin", firstName, lastName: rest.join(" "), email: member.username, vendorRole: member.role === "admin" ? "admin" : "office" });
          setStaffOpen(true); return true;
        }}
        administrativeOnly
        orgType="vendor"
        orgId={id}
        canManage={
          authUser?.role === "admin" ||
          (authUser?.availableMemberships ?? []).some(
            (m) => m.orgType === "vendor" && m.orgId === id && m.role === "admin",
          )
        }
        currentUserId={authUser?.userId ?? null}
        onEditFieldMember={canEditVendor ? (m) => {
          const emp = employees?.find((e) => e.userId === m.userId);
          if (emp) openEditEmployeeDialog(emp);
        } : undefined}
      />}


      {canViewOfficeEmployees && <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2"><UserCheck className="w-5 h-5" style={{ color: "var(--brand-primary)" }} />Office Staff ({officeContacts.length})</CardTitle>
          <button type="button" className="vendor-mini-card-button" data-testid="button-add-contact" onClick={() => addStaff("Office Staff")}><Plus className="w-4 h-4" />Add Office Staff</button>
        </CardHeader>
        <CardContent className="p-0">
          {officeContacts.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  {([["jobTitle", "Job Title", "w-[150px]"], ["firstName", "Name", "w-[20%]"], ["email", "Email", "w-[22%]"], ["phone", "Phone", "w-[12%]"], ["vendorRole", "Role", "w-[80px]"], ["pecStatus", "PEC Status", "w-[100px]"]] as const).map(([key, label, w]) => (
                    <TableHead key={key} className={`${w} cursor-pointer select-none`} onClick={() => toggleContactSort(key as ContactSortKey)}>
                      <div className="flex items-center gap-1">{label}{contactSort.key === key ? (contactSort.dir === "asc" ? <ArrowUp className="w-3 h-3" style={{ color: "var(--brand-primary)" }} /> : <ArrowDown className="w-3 h-3" style={{ color: "var(--brand-primary)" }} />) : null}</div>
                    </TableHead>
                  ))}
                  <TableHead className="w-[50px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedContacts.map((c) => (
                  <TableRow key={c.id} className={canEditVendor ? "group cursor-pointer hover:bg-muted/50" : ""} onClick={canEditVendor ? () => openEditContactDialog(c) : undefined} data-testid={`row-contact-${c.id}`}>
                    <TableCell className="font-medium">{c.jobTitle}</TableCell>
                    <TableCell><div className="flex items-center gap-2 text-gray-700 group-hover:text-[var(--brand-primary)] transition-colors">{c.photoUrl ? <img src={c.photoUrl} alt="" className="w-6 h-6 rounded-full object-cover border border-gray-200" /> : <UserCheck className="w-4 h-4" style={{ color: "var(--brand-primary)" }} />}{c.firstName} {c.lastName}</div></TableCell>
                    <TableCell>{c.email}</TableCell>
                    <TableCell>{formatPhone(c.phone)}</TableCell>
                    <TableCell>
                      <RoleBadge role={c.vendorRole} />
                    </TableCell>
                    <TableCell>
                      <PecStatusBadge expirationDate={c.pecExpirationDate || null} />
                    </TableCell>
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      {canEditVendor && (
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <RemovePill data-testid={`button-delete-contact-${c.id}`} />
                          </AlertDialogTrigger>
                          <AlertDialogContent onClick={(e) => e.stopPropagation()}>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Remove this contact?</AlertDialogTitle>
                              <AlertDialogDescription>
                                {c.firstName} {c.lastName} will be hidden from your portal. A VNDRLY Admin can restore them if this was a mistake.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction onClick={() => handleDeleteContact(c.id)} data-testid={`button-delete-contact-confirm-${c.id}`}>Remove</AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <div className="p-6 text-center text-muted-foreground text-sm">No contacts added yet</div>
          )}
        </CardContent>
      </Card>}

      {canEditVendor && workforceCards.map(group => <Card key={group.category} data-testid={`workforce-card-${group.category}`}>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2"><UserCheck className="w-5 h-5" style={{ color: "var(--brand-primary)" }} />{group.title} ({group.people.length})</CardTitle>
          {canEditVendor && (
            <button type="button" className="vendor-mini-card-button" data-testid={`button-add-${group.category}-employee`} onClick={() => addStaff(group.category === "gate" ? "Gatekeeper" : group.category === "fleet" ? "Driver" : "Field Employee")}><Plus className="w-4 h-4" />Add {group.category === "gate" ? "Gatekeeper" : group.category === "fleet" ? "Driver" : "Field Employee"}</button>
          )}
        </CardHeader>
        <CardContent className="p-0">
          {group.people.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  {([["jobTitle", "Job Title", "w-[150px]"], ["name", "Name", "w-[20%]"], ["email", "Email", "w-[22%]"], ["phone", "Phone", "w-[12%]"], ["vendorRole", "Role", "w-[80px]"], ["pecStatus", "PEC Status", "w-[100px]"]] as const).map(([key, label, w]) => (
                    <TableHead key={key} className={`${w} cursor-pointer select-none`} onClick={() => toggleEmpSort(key as EmpSortKey)}>
                      <div className="flex items-center gap-1">{label}{empSort.key === key ? (empSort.dir === "asc" ? <ArrowUp className="w-3 h-3" style={{ color: "var(--brand-primary)" }} /> : <ArrowDown className="w-3 h-3" style={{ color: "var(--brand-primary)" }} />) : null}</div>
                    </TableHead>
                  ))}
                  <TableHead className="w-[50px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {group.people.map((emp) => (
                  <TableRow key={emp.id} className={canEditVendor ? "group cursor-pointer hover:bg-muted/50" : ""} onClick={canEditVendor ? () => emp.source === "contact" ? openEditContactDialog(emp) : openEditEmployeeDialog(emp) : undefined} data-testid={`row-${group.category}-employee-${emp.id}`}>
                    <TableCell className="font-medium">{emp.jobTitle || "-"}</TableCell>
                    <TableCell className="font-medium"><div className="flex items-center gap-2 text-gray-700 group-hover:text-[var(--brand-primary)] transition-colors">{emp.photoUrl ? <img src={emp.photoUrl} alt="" className="w-6 h-6 rounded-full object-cover border border-gray-200" /> : <UserCheck className="w-4 h-4" style={{ color: "var(--brand-primary)" }} />}{emp.firstName} {emp.lastName}</div></TableCell>
                    <TableCell>{emp.email}</TableCell>
                    <TableCell>{formatPhone(emp.phone)}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">{workforceDisplayRoles(group.category, emp, workforceAccess?.people.find(row => row.vendorPeopleId === emp.id)?.operationalRoles).map(role => <RoleBadge key={role} role={role} />)}</div>
                    </TableCell>
                    <TableCell>
                      <PecStatusBadge expirationDate={emp.pecExpirationDate || null} />
                    </TableCell>
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      {canEditVendor && (
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <RemovePill data-testid={`button-delete-employee-${emp.id}`} />
                          </AlertDialogTrigger>
                          <AlertDialogContent onClick={(e) => e.stopPropagation()}>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Remove this employee?</AlertDialogTitle>
                              <AlertDialogDescription>
                                {emp.firstName} {emp.lastName} will be hidden from your portal. A VNDRLY Admin can restore them if this was a mistake.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction onClick={() => emp.source === "contact" ? handleDeleteContact(emp.id) : handleDeleteEmployee(emp.id)} data-testid={`button-delete-employee-confirm-${emp.id}`}>Remove</AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <div className="p-8 text-center text-muted-foreground"><p>No {group.title.toLowerCase()} yet</p></div>
          )}
        </CardContent>
      </Card>)}
      {canManageVendorSubcontractors(authUser, id) && <ManagedSubcontractorEmployeesCard vendorId={id} />}
      {canEditVendor && operationsError && <p role="alert">Unable to load workforce cards. Please refresh the page.</p>}

      {canEditVendor && <VendorPartnerRelationshipsCard vendorId={id} />}


      <VendorServicesAndPricingCard vendorId={id} />

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2"><FileText className="w-5 h-5" style={{ color: "var(--brand-primary)" }} />Notes ({notes?.length ?? 0})</CardTitle>
          <Dialog open={noteOpen} onOpenChange={setNoteOpen}>
            <DialogTrigger asChild>
              <PngPillButton color="brand" className="px-2" data-testid="button-add-note"><Plus className="w-4 h-4" />Add Note</PngPillButton>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Add Note</DialogTitle></DialogHeader>
              <form onSubmit={handleAddNote} className="space-y-4">
                <div>
                  <Label>Note</Label>
                  <Textarea value={noteContent} onChange={(e) => setNoteContent(e.target.value)} placeholder="Enter note..." rows={4} data-testid="input-note-content" />
                </div>
                <PngPillButton color="brand" type="submit" disabled={createNote.isPending} className="w-full" data-testid="button-submit-note">
                  {createNote.isPending ? "Adding..." : "Add Note"}
                </PngPillButton>
              </form>
            </DialogContent>
          </Dialog>
        </CardHeader>
        <CardContent>
          {notes && notes.length > 0 ? (
            <div className="space-y-3">
              {notes.map((note) => (
                <div key={note.id} className={cn(CARD_INNER_TILE_CLASS, "flex items-start gap-3")} data-testid={`note-${note.id}`}>
                  <div className="flex-1">
                    <p className="text-sm whitespace-pre-wrap">{note.content}</p>
                    <p className="text-xs text-muted-foreground mt-1">{new Date(note.createdAt).toLocaleString()}</p>
                  </div>
                  <RemovePill onClick={() => handleDeleteNote(note.id)} data-testid={`button-delete-note-${note.id}`} />
                </div>
              ))}
            </div>
          ) : (
            <p className="text-muted-foreground text-sm text-center">No notes added yet</p>
          )}
        </CardContent>
      </Card>

      {authUser?.role === "admin" && (
        <div className="flex justify-end">
          <PngPillButton color="red" onClick={handleRemoveVendor} disabled={removeVendor.isPending} data-testid="button-remove-vendor">
            <Trash2 className="w-4 h-4" />{removeVendor.isPending ? "Removing..." : "Remove Vendor"}
          </PngPillButton>
        </div>
      )}





      <StaffProfileDialog open={staffOpen} onOpenChange={setStaffOpen} vendorId={id} person={staffTarget} defaultType={staffDefaultType} canVerify={authUser?.role === "admin" || (authUser?.availableMemberships ?? []).some(m => m.orgType === "vendor" && m.orgId === id && m.role === "admin")} />
      <PlatformEulaModal open={platformEulaOpen} onOpenChange={setPlatformEulaOpen} />
    </div>
  );
}

function VendorRatingsCard({ vendorId }: { vendorId: number }) {
  const { user: authUser } = useAuth();
  const qc = useQueryClient();
  const { toast } = useToast();
  const { t } = useTranslation();
  const { data } = useGetVendorRatings(vendorId, { query: { enabled: !!vendorId, queryKey: getGetVendorRatingsQueryKey(vendorId) } });
  const upsert = useUpsertVendorRating();
  const remove = useDeleteVendorRating();
  const isPartnerUser = authUser?.role === "partner" && !!authUser.partnerId;
  const myRating = data?.myRating ?? null;

  const [editing, setEditing] = useState(false);
  const [draftRating, setDraftRating] = useState<number>(0);
  const [draftReview, setDraftReview] = useState<string>("");

  const startEdit = () => {
    setDraftRating(myRating?.rating ?? 0);
    setDraftReview(myRating?.review ?? "");
    setEditing(true);
  };

  const submit = () => {
    if (draftRating < 1 || draftRating > 5) {
      toast({ title: "Pick a rating", description: "Please select 1 to 5 stars before saving.", variant: "destructive" });
      return;
    }
    upsert.mutate(
      { vendorId, data: { rating: draftRating, review: draftReview.trim() || null } },
      {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: getGetVendorRatingsQueryKey(vendorId) });
          setEditing(false);
          toast({ title: "Rating saved" });
        },
        onError: (err) => toast({ title: translateApiError(err, t, t("vendors.couldNotSaveRating")), variant: "destructive" }),
      },
    );
  };

  const removeMine = () => {
    if (!myRating) return;
    if (!confirm("Remove your rating for this vendor?")) return;
    remove.mutate(
      { vendorId },
      {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: getGetVendorRatingsQueryKey(vendorId) });
          setEditing(false);
          toast({ title: "Rating removed" });
        },
      },
    );
  };

  const avg = data?.average ?? null;
  const count = data?.count ?? 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Star className="w-5 h-5" style={{ color: "var(--brand-primary)" }} />Ratings & Reviews</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-3">
          <StarRating value={avg ?? 0} readOnly size={22} data-testid="vendor-average-rating" />
          <div className="text-sm">
            {avg != null ? (
              <span><span className="font-semibold">{avg.toFixed(1)}</span> <span className="text-muted-foreground">/ 5</span></span>
            ) : (
              <span className="text-muted-foreground">No ratings yet</span>
            )}
            <span className="text-muted-foreground"> · {count} {count === 1 ? "review" : "reviews"}</span>
          </div>
        </div>

        {isPartnerUser && (
          <div className={cn(CARD_INNER_TILE_CLASS, "space-y-3")}>
            <div className="text-sm font-medium">Your rating</div>
            {!editing ? (
              <div className="flex items-center gap-3">
                {myRating ? (
                  <>
                    <StarRating value={myRating.rating} readOnly size={20} />
                    {myRating.review && <span className="text-sm text-muted-foreground line-clamp-1">"{myRating.review}"</span>}
                    <div className="ml-auto mr-2 flex items-center gap-4">
                      <PngPillButton color="brand" onClick={startEdit} className="px-2" data-testid="button-edit-my-rating"><Pencil className="w-4 h-4" />Edit</PngPillButton>
                      <BrandPillButton tone="red" onClick={removeMine} data-testid="button-remove-my-rating"><Trash2 className="w-4 h-4" />Remove</BrandPillButton>
                    </div>
                  </>
                ) : (
                  <>
                    <span className="text-sm text-muted-foreground">You haven't rated this vendor.</span>
                    <div className="ml-auto"><PngPillButton color="brand" className="px-2" onClick={startEdit} data-testid="button-add-my-rating"><Plus className="w-4 h-4" />Add Rating</PngPillButton></div>
                  </>
                )}
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <StarRating value={draftRating} onChange={setDraftRating} size={28} data-testid="input-rating-stars" />
                  <span className="text-sm text-muted-foreground">{draftRating > 0 ? `${draftRating} of 5` : "Pick a rating"}</span>
                </div>
                <Textarea
                  value={draftReview}
                  onChange={(e) => setDraftReview(e.target.value)}
                  placeholder="Share your experience working with this vendor (optional)."
                  rows={3}
                  data-testid="input-rating-review"
                />
                <div className="flex gap-2">
                  <PngPillButton color="brand" onClick={submit} disabled={upsert.isPending} data-testid="button-save-rating">
                    <Check className="w-4 h-4" />
                    {upsert.isPending ? "Saving..." : "Save"}
                  </PngPillButton>
                  <div className="w-3" />
                  <PngPillButton onClick={() => setEditing(false)} data-testid="button-cancel-rating">
                    <X className="w-4 h-4" />
                    Cancel
                  </PngPillButton>
                </div>
              </div>
            )}
          </div>
        )}

        <details className="vendor-reviews-list" data-testid="vendor-reviews-list">
          <summary><span>Reviews</span><span>{count}</span></summary>
          <div className="space-y-3 pt-3">
          {data?.items && data.items.length > 0 ? (
            data.items.map((r) => (
              <div key={r.id} className="border-t pt-3" data-testid={`rating-item-${r.id}`}>
                <div className="flex items-center gap-2">
                  <StarRating value={r.rating} readOnly size={16} />
                  <span className="text-sm font-medium">{r.partnerName}</span>
                  <span className="text-xs text-muted-foreground">· {r.userDisplayName}</span>
                  <span className="text-xs text-muted-foreground ml-auto">{new Date(r.updatedAt).toLocaleDateString()}</span>
                </div>
                {r.review && <p className="text-sm whitespace-pre-wrap mt-1">{r.review}</p>}
              </div>
            ))
          ) : (
            <p className="text-sm text-muted-foreground">No reviews yet.</p>
          )}
          </div>
        </details>
      </CardContent>
    </Card>
  );
}

type ServicesItem = {
  id: number;
  partnerId: number;
  partnerName: string;
  name: string;
  category: string | null;
  selected: boolean;
  unitPrice: string | null;
  unit: "per_hour" | "per_day" | "per_job" | "lump_sum" | null;
  currency: string | null;
  notes: string | null;
};

const UNIT_LABELS: Record<NonNullable<ServicesItem["unit"]>, string> = {
  per_hour: "per hour",
  per_day: "per day",
  per_job: "per job",
  lump_sum: "lump sum",
};

function formatPrice(item: ServicesItem): string {
  if (!item.unitPrice) return "—";
  const n = Number(item.unitPrice);
  const formatted = Number.isFinite(n)
    ? new Intl.NumberFormat(undefined, {
        style: "currency",
        currency: (item.currency || "USD").toUpperCase(),
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(n)
    : item.unitPrice;
  return item.unit ? `${formatted} ${UNIT_LABELS[item.unit]}` : formatted;
}

const PRICING_UNIT_OPTIONS = [
  "per_hour",
  "per_day",
  "per_job",
  "lump_sum",
] as const;

// Small modal that lets a vendor admin (or system admin) put a price on
// a row that's currently rendering the amber "No price" placeholder.
// The dedicated price endpoint updates only this selection.
function ServicePriceEditModal({
  vendorId,
  item,
  open,
  onOpenChange,
}: {
  vendorId: number;
  item: ServicesItem;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const base = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");
  const qc = useQueryClient();
  const { toast } = useToast();
  const [unitPrice, setUnitPrice] = useState(item.unitPrice ?? "");
  const [unit, setUnit] = useState<NonNullable<ServicesItem["unit"]> | "">(
    item.unit ?? "",
  );
  const [currency, setCurrency] = useState(item.currency ?? "USD");
  const [notes, setNotes] = useState(item.notes ?? "");
  // Per-edit free-text reason captured for the audit trail. Sent
  // only on the target row so passing siblings through doesn't
  // overwrite their prior `last_price_change_reason`.
  const [priceChangeReason, setPriceChangeReason] = useState("");
  useEffect(() => {
    if (open) {
      setUnitPrice(item.unitPrice ?? "");
      setUnit(item.unit ?? "");
      setCurrency(item.currency ?? "USD");
      setNotes(item.notes ?? "");
      setPriceChangeReason("");
    }
  }, [open, item]);

  const save = useMutation({
    mutationFn: async () => {
      const trimmedReason = priceChangeReason.trim();
      const res = await fetch(`${base}/api/vendors/${vendorId}/work-types/${item.id}/price`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          partnerId: item.partnerId,
          unitPrice: unitPrice.trim(),
          unit: unit === "" ? null : unit,
          currency: currency.trim().toUpperCase(),
          notes: notes.trim() || null,
          ...(trimmedReason ? { priceChangeReason: trimmedReason } : {}),
        }),
      });
      if (!res.ok) {
        let msg = `HTTP ${res.status}`;
        try {
          const j = await res.json();
          msg = j.error || msg;
        } catch {
          // ignore
        }
        throw new Error(msg);
      }
    },
    onSuccess: () => {
      toast({ title: `Price saved for ${item.name}` });
      qc.invalidateQueries({ queryKey: ["vendor-services-pricing", vendorId] });
      onOpenChange(false);
    },
    onError: (e: Error) =>
      toast({ title: e.message, variant: "destructive" }),
  });

  const canSubmit =
    !save.isPending &&
    unitPrice.trim() !== "" &&
    Number.isFinite(Number(unitPrice));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Change Pricing — {item.name}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-[140px_140px_100px] gap-2">
            <label className="text-xs space-y-1">
              <span className="text-muted-foreground">Price</span>
              <Input
                type="number"
                inputMode="decimal"
                min="0"
                step="0.01"
                placeholder="0.00"
                value={unitPrice}
                onChange={(e) => setUnitPrice(e.target.value)}
                data-testid={`input-edit-price-${item.id}`}
              />
            </label>
            <label className="text-xs space-y-1">
              <span className="text-muted-foreground">Unit</span>
              <Select
                value={unit === "" ? "__none__" : unit}
                onValueChange={(v) =>
                  setUnit(
                    v === "__none__"
                      ? ""
                      : (v as NonNullable<ServicesItem["unit"]>),
                  )
                }
              >
                <SelectTrigger data-testid={`select-edit-unit-${item.id}`}>
                  <SelectValue placeholder="Unit" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">—</SelectItem>
                  {PRICING_UNIT_OPTIONS.map((u) => (
                    <SelectItem key={u} value={u}>
                      {UNIT_LABELS[u]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
            <label className="text-xs space-y-1">
              <span className="text-muted-foreground">Currency</span>
              <Input
                value={currency}
                onChange={(e) =>
                  setCurrency(e.target.value.toUpperCase().slice(0, 3))
                }
                maxLength={3}
                data-testid={`input-edit-currency-${item.id}`}
              />
            </label>
          </div>
          <label className="text-xs space-y-1 block">
            <span className="text-muted-foreground">Notes (optional)</span>
            <Input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              maxLength={500}
              data-testid={`input-edit-notes-${item.id}`}
            />
          </label>
          <label className="text-xs space-y-1 block">
            <span className="text-muted-foreground">
              Reason for change (optional)
            </span>
            <Input
              value={priceChangeReason}
              onChange={(e) => setPriceChangeReason(e.target.value)}
              maxLength={500}
              placeholder="e.g. quarterly rate increase, new supplier contract"
              data-testid={`input-price-change-reason-${item.id}`}
            />
          </label>
          <p className="text-xs text-muted-foreground">
            Saved to this partner's services and pricing.
          </p>
        </div>
        <div className="flex items-stretch gap-2 pt-2">
          {/* Cancel → canonical PngPillButton with color="red".
              PngPillButton's default behavior is grey-idle → swap
              to its `color` on hover, so this renders neutral grey
              at rest and pulses red on hover (red = destructive,
              matching the brand-aware chrome doctrine). height={36}
              matches the sibling Save button so the two pills line
              up in the `flex items-stretch gap-2` footer. */}
          <PngPillButton color="red" size="sm" onClick={() => onOpenChange(false)} data-testid={`button-cancel-edit-price-${item.id}`}>Cancel</PngPillButton>
          {/* Wide blue TogglePill — idles in the shared light-grey
              pill chrome and pulses to the canonical TogglePill blue
              on hover. `flex-1` makes it span the remainder of the
              footer next to the Cancel button. */}
          <PngPillButton
            color="brand"
            size="sm"
            className="flex-1"
            onClick={() => save.mutate()}
            disabled={!canSubmit}
            data-testid={`button-save-price-${item.id}`}
          >
            {save.isPending ? "Saving…" : "Save price"}
          </PngPillButton>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function VendorServicesAndPricingCard({ vendorId }: { vendorId: number }) {
  const base = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");
  const { user } = useAuth();
  // Mirrors the server-side `requireVendorAdmin` gate on the work-types
  // PUT: VNDRLY system admin, OR a userOrgMembership row for this vendor
  // with role 'admin'. We check `availableMemberships` here so vendor
  // non-admin users (field/foreman/office) don't see an affordance the
  // server will reject. Server is still authoritative.
  const canEdit =
    user?.role === "admin" ||
    (user?.role === "vendor" && user.vendorId === vendorId && (user?.availableMemberships ?? []).some(
      (m) =>
        m.orgType === "vendor" && m.orgId === vendorId && m.role === "admin",
    ));

  const { data, isLoading, isError } = useQuery({
    queryKey: ["vendor-services-pricing", vendorId, user?.partnerId, user?.role],
    queryFn: async () => {
      const res = await fetch(`${base}/api/vendors/${vendorId}/work-types`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as { vendorId: number; items: ServicesItem[] };
    },
    enabled: !!vendorId,
  });

  const allSelected = useMemo(
    () => (data?.items ?? []).filter((it) => it.selected),
    [data],
  );
  const grouped = useMemo(() => {
    const map = new Map<string, ServicesItem[]>();
    for (const it of allSelected) {
      const category = it.category?.trim() || "Uncategorized";
      const key = user?.role === "partner" ? category : `${it.partnerName} / ${category}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(it);
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [allSelected, user?.role]);

  const selectedCount = grouped.reduce((acc, [, items]) => acc + items.length, 0);
  const missingPriceCount = grouped.reduce(
    (acc, [, items]) => acc + items.filter((i) => !i.unitPrice).length,
    0,
  );

  const [editing, setEditing] = useState<ServicesItem | null>(null);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 flex-wrap">
        <CardTitle className="flex items-center gap-2">
          <ShoppingCart className="w-5 h-5" style={{ color: "var(--brand-primary)" }} />
          Services &amp; Pricing ({selectedCount})
        </CardTitle>
        <div className="flex items-center gap-2">
        {canEdit ? (
          <Link
            href={`/vendor-catalog?vendorId=${vendorId}`}
            className="text-xs text-[var(--brand-primary)] hover:underline"
            data-testid="link-manage-vendor-catalog"
          >
            Manage full catalog
          </Link>
        ) : null}
        {missingPriceCount > 0 ? (
          <span
            className="text-xs text-amber-700"
            data-testid="text-services-missing-price-count"
          >
            {missingPriceCount} without a price
          </span>
        ) : null}
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-6 w-full" />
            ))}
          </div>
        ) : isError ? (
          <p className="text-sm text-destructive">Could not load services.</p>
        ) : grouped.length === 0 ? (
          <p
            className="text-sm text-muted-foreground"
            data-testid="text-services-empty"
          >
            No services have been selected for this partner.
          </p>
        ) : (
          <div className="space-y-4">
            {grouped.map(([category, items]) => (
              <div key={category} className="space-y-1">
                <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  {category}
                </h3>
                <div className="rounded-xl border-2 border-[color:var(--brand-primary)] bg-white divide-y">
                  {items.map((it) => (
                    <div
                      key={it.id}
                      className="grid grid-cols-[1fr_auto] items-start gap-3 px-3 py-2"
                      data-testid={`row-service-${it.id}`}
                    >
                      <div className="min-w-0">
                        <div className="text-sm font-medium truncate">{it.name}</div>
                        {it.notes ? (
                          <div
                            className="text-xs text-muted-foreground whitespace-pre-wrap"
                            data-testid={`text-service-notes-${it.id}`}
                          >
                            {it.notes}
                          </div>
                        ) : null}
                      </div>
                      <div
                        className="text-sm font-mono whitespace-nowrap"
                        data-testid={`text-service-price-${it.id}`}
                      >
                        {it.unitPrice ? (
                          formatPrice(it)
                        ) : canEdit ? (
                          <button
                            type="button"
                            onClick={() => setEditing(it)}
                            className="italic hover:underline transition-colors"
                            style={{ color: "var(--brand-primary)" }}
                            data-testid={`button-set-price-${it.id}`}
                          >
                            No price
                          </button>
                        ) : (
                          <span
                            className="italic"
                            style={{ color: "var(--brand-primary)" }}
                          >
                            No price
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
      {editing && (
        <ServicePriceEditModal
          vendorId={vendorId}
          item={editing}
          open={!!editing}
          onOpenChange={(v) => !v && setEditing(null)}
        />
      )}
    </Card>
  );
}
