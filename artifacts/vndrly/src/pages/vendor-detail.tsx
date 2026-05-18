import { useState, useRef, useMemo, useEffect } from "react";
import { useUnsavedChanges } from "@/hooks/use-unsaved-changes";

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
import { formatPhone, handlePhoneInput, stripPhone } from "@/lib/utils";
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
  useCreateVendorContact,
  useDeleteVendorContact,
  useUpdateVendorContact,
  useUpdateFieldEmployee,
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
  useListVendors,
  previewVendorMerge,
  mergeVendor,
  getListFieldEmployeesQueryKey,
  matchVendor,
} from "@workspace/api-client-react";
import type { MatchVendorResponseItem } from "@workspace/api-client-react";
import { useEligibleVendorFieldEmployeesByVendorId } from "@/hooks/use-eligible-vendor-field-employees";
import { useQueryClient, useMutation } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PillButton } from "@/components/pill";
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
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import BlueButton from "@/components/blue-button";
import { TogglePillButton } from "@/components/toggle-pill";
import BakerPillButton from "@/components/baker-pill-button";
import { useBrand } from "@/hooks/use-brand";
import GreyButton from "@/components/grey-button";
import BrandPillButton from "@/components/brand-pill-button";
import RedButton from "@/components/red-button";
import SphereBackButton from "@/components/sphere-back-button";
import PecStatusBadge from "@/components/pec-status-badge";
import RoleBadge from "@/components/role-badge";
import { PhotoUploadField } from "@/components/photo-upload-field";
import { useAuth } from "@/hooks/use-auth";
import OrgMembersCard from "@/components/org-members-card";
import VendorPartnerRelationshipsCard from "@/components/vendor-partner-relationships-card";
import { useQuery } from "@tanstack/react-query";
import { hotlistApi } from "@/lib/hotlist-api";
import { useTranslation } from "react-i18next";
import { translateApiError } from "@/lib/api-error";


export default function VendorDetail({ id }: { id: number }) {
  const brand = useBrand();
  const { t } = useTranslation();
  const { user: authUser } = useAuth();
  const isOwnVendor = authUser?.role === "vendor" && authUser.vendorId === id;
  const canEditVendor = authUser?.role === "admin" || isOwnVendor;
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
    useEligibleVendorFieldEmployeesByVendorId(id);
  const { data: contacts } = useListVendorContacts(id, undefined, { query: { enabled: !!id, queryKey: getListVendorContactsQueryKey(id) } });
  const { data: notes } = useListVendorNotes(id, { query: { enabled: !!id, queryKey: getListVendorNotesQueryKey(id) } });
  const updateVendor = useUpdateVendor();
  const removeVendor = useDeleteVendor();
  const createContact = useCreateVendorContact();
  const deleteContact = useDeleteVendorContact();
  const updateContact = useUpdateVendorContact();
  const updateEmployee = useUpdateFieldEmployee();
  const deleteEmployee = useDeleteFieldEmployee();
  const createNote = useCreateVendorNote();
  const deleteNote = useDeleteVendorNote();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [editOpen, setEditOpen] = useState(false);
  const [contactOpen, setContactOpen] = useState(false);
  const [editContactOpen, setEditContactOpen] = useState(false);
  const [editEmployeeOpen, setEditEmployeeOpen] = useState(false);
  const [editingContactId, setEditingContactId] = useState<number | null>(null);
  const [editingEmployeeId, setEditingEmployeeId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState({ name: "", contactName: "", contactEmail: "", contactPhone: "", physicalAddress: "", billingAddress: "", stateTaxId: "", federalTaxId: "", businessPhone: "", hoursOfOperation: "", blurb: "", brandPrimaryColor: "", brandAccentColor: "" });
  const [contactForm, setContactForm] = useState({ jobTitle: "", firstName: "", lastName: "", email: "", phone: "", vendorRole: "office" as string, pecCertification: false, pecExpirationDate: "", roles: [] as string[] });
  const [editContactForm, setEditContactForm] = useState({ jobTitle: "", firstName: "", lastName: "", email: "", phone: "", vendorRole: "office" as string, pecCertification: false, pecExpirationDate: "", photoUrl: null as string | null, roles: [] as string[] });
  const [editEmployeeForm, setEditEmployeeForm] = useState({ jobTitle: "", firstName: "", lastName: "", email: "", phone: "", pecCertification: false, pecExpirationDate: "", vendorRole: "field" as string, photoUrl: null as string | null, roles: [] as string[] });
  const initialEditFormRef = useRef<typeof editForm | null>(null);
  const initialEditContactFormRef = useRef<typeof editContactForm | null>(null);
  const initialEditEmployeeFormRef = useRef<typeof editEmployeeForm | null>(null);
  const editFormDirty = useMemo(() => !!initialEditFormRef.current && JSON.stringify(editForm) !== JSON.stringify(initialEditFormRef.current), [editForm]);
  const editContactDirty = useMemo(() => !!initialEditContactFormRef.current && JSON.stringify(editContactForm) !== JSON.stringify(initialEditContactFormRef.current), [editContactForm]);
  const editEmployeeDirty = useMemo(() => !!initialEditEmployeeFormRef.current && JSON.stringify(editEmployeeForm) !== JSON.stringify(initialEditEmployeeFormRef.current), [editEmployeeForm]);
  const anyDirty = (editOpen && editFormDirty) || (editContactOpen && editContactDirty) || (editEmployeeOpen && editEmployeeDirty);
  useUnsavedChanges(anyDirty);
  const tryCloseEdit = (open: boolean) => {
    if (!open && editFormDirty && !window.confirm("You have unsaved changes. Discard them?")) return;
    if (!open) initialEditFormRef.current = null;
    setEditOpen(open);
  };
  const tryCloseEditContact = (open: boolean) => {
    if (!open && editContactDirty && !window.confirm("You have unsaved changes. Discard them?")) return;
    if (!open) { initialEditContactFormRef.current = null; setEditingContactId(null); }
    setEditContactOpen(open);
  };
  const tryCloseEditEmployee = (open: boolean) => {
    if (!open && editEmployeeDirty && !window.confirm("You have unsaved changes. Discard them?")) return;
    if (!open) { initialEditEmployeeFormRef.current = null; setEditingEmployeeId(null); }
    setEditEmployeeOpen(open);
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

  // ── Vendor merge (admin only) ───────────────────────────────────
  // Two-step UX: open dialog → pick survivor → fetch preview counts →
  // confirm. We keep all transient state local; preview & merge mutate
  // the server (preview just runs inside a rolled-back transaction so
  // it stays read-only). The dialog is only mounted under the admin
  // gate below, but every state hook lives at the top level so React's
  // hook order stays stable when the gate flips.
  const [mergeOpen, setMergeOpen] = useState(false);
  const [mergeSurvivorId, setMergeSurvivorId] = useState<string>("");
  const [mergePreview, setMergePreview] = useState<{
    survivorVendorId: number;
    survivorVendorName: string;
    loserVendorId: number;
    loserVendorName: string;
    counts: Record<string, { move: number; conflictDelete: number }>;
    totalMoved: number;
    totalConflictDeleted: number;
  } | null>(null);
  const [mergePreviewLoading, setMergePreviewLoading] = useState(false);
  const [mergeApplying, setMergeApplying] = useState(false);
  const [mergeError, setMergeError] = useState<string | null>(null);
  const { data: allVendors } = useListVendors({
    query: { enabled: mergeOpen && authUser?.role === "admin", queryKey: getListVendorsQueryKey() },
  });
  const resetMergeDialog = () => {
    setMergeSurvivorId("");
    setMergePreview(null);
    setMergePreviewLoading(false);
    setMergeApplying(false);
    setMergeError(null);
  };
  const handleLoadMergePreview = async () => {
    const survivorId = Number(mergeSurvivorId);
    if (!Number.isInteger(survivorId) || survivorId <= 0) {
      setMergeError("Pick a survivor vendor first.");
      return;
    }
    if (survivorId === id) {
      setMergeError("Survivor must be a different vendor.");
      return;
    }
    setMergeError(null);
    setMergePreview(null);
    setMergePreviewLoading(true);
    try {
      const res = await previewVendorMerge(id, { survivorVendorId: survivorId });
      setMergePreview(res);
    } catch (err: any) {
      const msg =
        err?.response?.data?.error ||
        err?.data?.error ||
        err?.message ||
        "Failed to preview merge";
      setMergeError(msg);
    } finally {
      setMergePreviewLoading(false);
    }
  };
  const handleConfirmMerge = async () => {
    if (!mergePreview) return;
    setMergeError(null);
    setMergeApplying(true);
    try {
      const res = await mergeVendor(id, {
        survivorVendorId: mergePreview.survivorVendorId,
      });
      queryClient.invalidateQueries({ queryKey: getListVendorsQueryKey() });
      toast({
        title: "Vendors merged",
        description: `${res.totalMoved} row(s) moved, ${res.totalConflictDeleted} conflict row(s) dropped.`,
      });
      setMergeOpen(false);
      resetMergeDialog();
      navigate(`/vendors/${res.survivorVendorId}`);
    } catch (err: any) {
      const msg =
        err?.response?.data?.error ||
        err?.data?.error ||
        err?.message ||
        "Failed to merge vendors";
      setMergeError(msg);
    } finally {
      setMergeApplying(false);
    }
  };

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

  const sortedContacts = contacts ? [...contacts].sort((a, b) => {
    const dir = contactSort.dir === "asc" ? 1 : -1;
    const k = contactSort.key;
    if (k === "vendorRole") return dir * (a.vendorRole || "office").localeCompare(b.vendorRole || "office");
    const av = (a as any)[k] || "";
    const bv = (b as any)[k] || "";
    return dir * String(av).localeCompare(String(bv));
  }) : [];

  const sortedEmployees = employees ? [...employees].sort((a, b) => {
    const dir = empSort.dir === "asc" ? 1 : -1;
    const k = empSort.key;
    if (k === "name") return dir * `${a.firstName} ${a.lastName}`.localeCompare(`${b.firstName} ${b.lastName}`);
    if (k === "vendorRole") return dir * (a.vendorRole || "field").localeCompare(b.vendorRole || "field");
    if (k === "pecStatus") return dir * (getPecSortValue(a.pecExpirationDate) - getPecSortValue(b.pecExpirationDate));
    const av = (a as any)[k] || "";
    const bv = (b as any)[k] || "";
    return dir * String(av).localeCompare(String(bv));
  }) : [];

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

  const handleAddContact = (e: React.FormEvent) => {
    e.preventDefault();
    createContact.mutate(
      { vendorId: id, data: { ...contactForm, phone: stripPhone(contactForm.phone) || null, jobTitle: contactForm.jobTitle || "", pecExpirationDate: contactForm.pecExpirationDate || null } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListVendorContactsQueryKey(id) });
          queryClient.invalidateQueries({ queryKey: getListFieldEmployeesQueryKey({ vendorId: id }) });
          setContactOpen(false);
          setContactForm({ jobTitle: "", firstName: "", lastName: "", email: "", phone: "", vendorRole: "office", pecCertification: false, pecExpirationDate: "", roles: [] });
          const role = contactForm.vendorRole;
          const label = role === "field" || role === "foreman" ? t("vendors.fieldEmployeeAddedToast") : t("vendors.employeeAddedToast");
          toast({ title: label });
        },
        onError: (err) => {
          toast({ title: translateApiError(err, t, t("vendors.addEmployeeFailed")), variant: "destructive" });
        },
      },
    );
  };

  const openEditContactDialog = (contact: { id: number; jobTitle: string | null; firstName: string; lastName: string; email: string; phone: string | null; vendorRole?: string; pecCertification?: boolean; pecExpirationDate?: string | null; photoUrl?: string | null; roles?: string[] | null }) => {
    setEditingContactId(contact.id);
    const hydrated = {
      jobTitle: contact.jobTitle ?? "",
      firstName: contact.firstName,
      lastName: contact.lastName,
      email: contact.email,
      phone: contact.phone ? formatPhone(contact.phone) : "",
      vendorRole: contact.vendorRole || "office",
      pecCertification: contact.pecCertification ?? false,
      pecExpirationDate: contact.pecExpirationDate ?? "",
      photoUrl: contact.photoUrl ?? null,
      roles: contact.roles ?? [],
    };
    setEditContactForm(hydrated);
    initialEditContactFormRef.current = hydrated;
    setEditContactOpen(true);
  };

  const handleEditContact = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingContactId) return;
    updateContact.mutate(
      { vendorId: id, contactId: editingContactId, data: { ...editContactForm, phone: stripPhone(editContactForm.phone) || null, pecExpirationDate: editContactForm.pecExpirationDate || null } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListVendorContactsQueryKey(id) });
          initialEditContactFormRef.current = editContactForm;
          setEditContactOpen(false);
          setEditingContactId(null);
          toast({ title: t("vendors.contactUpdatedToast") });
        },
        onError: (err) => {
          toast({ title: translateApiError(err, t, t("vendors.updateContactFailed")), variant: "destructive" });
        },
      },
    );
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
    setEditingEmployeeId(emp.id);
    const hydrated = {
      jobTitle: emp.jobTitle || "",
      firstName: emp.firstName,
      lastName: emp.lastName,
      email: emp.email,
      phone: emp.phone ? formatPhone(emp.phone) : "",
      pecCertification: emp.pecCertification,
      pecExpirationDate: emp.pecExpirationDate || "",
      vendorRole: emp.vendorRole || "field",
      photoUrl: emp.photoUrl ?? null,
      roles: emp.roles ?? [],
    };
    setEditEmployeeForm(hydrated);
    initialEditEmployeeFormRef.current = hydrated;
    setEditEmployeeOpen(true);
  };

  const handleEditEmployee = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingEmployeeId) return;
    updateEmployee.mutate(
      { id: editingEmployeeId, data: { ...editEmployeeForm, jobTitle: editEmployeeForm.jobTitle || null, phone: stripPhone(editEmployeeForm.phone) || null, pecExpirationDate: editEmployeeForm.pecExpirationDate || null } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListFieldEmployeesQueryKey({ vendorId: id }) });
          initialEditEmployeeFormRef.current = editEmployeeForm;
          setEditEmployeeOpen(false);
          setEditingEmployeeId(null);
          toast({ title: t("vendors.employeeUpdatedToast") });
        },
        onError: (err) => {
          toast({ title: translateApiError(err, t, t("vendors.updateEmployeeFailed")), variant: "destructive" });
        },
      },
    );
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
    <div className="space-y-6" data-testid="vendor-detail-page">
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
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-vendor-name">{vendor.name}</h1>
          <p className="text-muted-foreground text-sm">Vendor since {new Date(vendor.createdAt).toLocaleDateString()}</p>
        </div>
        <div className="ml-auto">
          {canEditVendor && (
          <Dialog open={editOpen} onOpenChange={tryCloseEdit}>
            <DialogTrigger asChild>
              <TogglePillButton color="blue" onClick={openEditDialog} className="px-2" data-testid="button-edit-vendor"><Pencil className="w-4 h-4" />{t("common.edit")}</TogglePillButton>
            </DialogTrigger>
            <DialogContent className="max-h-[90vh] overflow-y-auto">
              <DialogLogoHeader
                src={vendor?.logoUrl}
                alt={vendor ? `${vendor.name} logo` : undefined}
                data-testid="img-edit-vendor-logo"
              />
              <DialogHeader><DialogTitle>{t("vendors.editVendor")}</DialogTitle></DialogHeader>
              <form onSubmit={handleEdit} className="space-y-4">
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
                        <p className="text-xs text-muted-foreground mb-2">PNG, JPG, or SVG. Used in your portal sidebar and on tickets.</p>
                        <input ref={logoInputRef} type="file" accept="image/*" className="hidden" onChange={handleLogoUpload} data-testid="input-logo-file" />
                        <div className="flex gap-2 flex-wrap">
                          {/* Logo actions converted to TogglePill family per
                              user UI doctrine: blue = non-destructive
                              primary in dialog (Upload/Replace), red =
                              destructive (Remove). Pulses to colored state
                              on hover to match the rest of the pill chrome. */}
                          <TogglePillButton type="button" color="blue" onClick={() => logoInputRef.current?.click()} disabled={uploadingLogo} data-testid="button-upload-logo">
                            <Upload className="w-4 h-4" />{uploadingLogo ? "Uploading..." : vendor.logoUrl ? "Replace Logo" : "Upload Logo"}
                          </TogglePillButton>
                          {vendor.logoUrl && (
                            <TogglePillButton type="button" color="red" onClick={handleRemoveLogo} data-testid="button-remove-logo">
                              <Trash2 className="w-4 h-4" />Remove
                            </TogglePillButton>
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
                          PNG, JPG, or SVG, ideally a 1:1 square mark/icon. Shown at 64×64 in the navigation sidebar. Optional — if you don't upload one, the main logo will be used.
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
                          <TogglePillButton
                            type="button"
                            color="blue"
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
                          </TogglePillButton>
                          {vendor.logoSquareUrl && (
                            <TogglePillButton type="button" color="red" onClick={handleRemoveSquareLogo} data-testid="button-remove-square-logo">
                              <Trash2 className="w-4 h-4" />Remove
                            </TogglePillButton>
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
                        {editForm.brandPrimaryColor && (
                          <button
                            type="button"
                            onClick={() => setEditForm({ ...editForm, brandPrimaryColor: "" })}
                            className="text-xs text-muted-foreground hover:text-destructive"
                            data-testid="button-clear-brand-primary-color"
                          >
                            {t("vendors.clear")}
                          </button>
                        )}
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
                        {editForm.brandAccentColor && (
                          <button
                            type="button"
                            onClick={() => setEditForm({ ...editForm, brandAccentColor: "" })}
                            className="text-xs text-muted-foreground hover:text-destructive"
                            data-testid="button-clear-brand-accent-color"
                          >
                            {t("vendors.clear")}
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
                {/* Save Changes — BakerPillButton matching the vendor
                    login portal Sign In button: 44px tall, idle uses
                    the new "grey-modal" light-grey square PNG, hover/
                    pulse swaps to the brand-matched colored pill. */}
                <BakerPillButton
                  type="submit"
                  height={44}
                  idleVariant="grey-modal"
                  brandColor={
                    /* Per user direction: hard-pin Baker vendors to the
                       Baker teal pill PNG regardless of stored brand
                       color. `brandColor={null}` makes BakerPillButton
                       fall through to the bakerTeal asset directly. */
                    vendor?.name?.toLowerCase().includes("baker")
                      ? null
                      : brand.primary
                  }
                  attention={editFormDirty}
                  disabled={updateVendor.isPending || (isAdmin && editForm.name.trim().length >= 3 && (renameMatchesLoading || renameCheckedName !== editForm.name.trim())) || (isAdmin && renameMatches.length > 0 && !confirmDifferentRename)}
                  testId="button-submit-edit"
                >
                  {updateVendor.isPending ? t("common.saving") : t("common.saveChanges")}
                </BakerPillButton>
              </form>
            </DialogContent>
          </Dialog>
          )}
        </div>
      </div>

      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><Users className="w-5 h-5" style={{ color: "var(--brand-primary)" }} />Vendor Information</CardTitle></CardHeader>
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
          <OperatingAreaEditor vendorId={id} canEdit={authUser?.role === "admin" || isOwnVendor} />
        </CardContent>
      </Card>

      <VendorRatingsCard vendorId={id} />

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2"><UserCheck className="w-5 h-5" style={{ color: "var(--brand-primary)" }} />Office Employees ({contacts?.length ?? 0})</CardTitle>
          <Dialog open={contactOpen} onOpenChange={setContactOpen}>
            {canEditVendor && (
            <DialogTrigger asChild>
              <TogglePillButton color="blue" data-testid="button-add-contact" className="px-2" onClick={() => setContactForm((f) => ({ ...f, vendorRole: "office" }))}><Plus className="w-4 h-4" />{t("vendors.addEmployee")}</TogglePillButton>
            </DialogTrigger>
            )}
            <DialogContent>
              <DialogHeader><DialogTitle>{t("vendors.addEmployeeTitle")}</DialogTitle></DialogHeader>
              <form onSubmit={handleAddContact} className="space-y-4">
                <div>
                  <Label>{t("vendors.jobTitle")}</Label>
                  <Input value={contactForm.jobTitle} onChange={(e) => setContactForm({ ...contactForm, jobTitle: e.target.value })} placeholder={t("vendors.jobTitlePlaceholderOffice")} data-testid="input-contact-job-title" />
                </div>
                <div>
                  <Label>{t("vendors.role")}</Label>
                  <Select value={contactForm.vendorRole} onValueChange={(v) => setContactForm({ ...contactForm, vendorRole: v })}>
                    <SelectTrigger data-testid="select-contact-role"><SelectValue placeholder={t("vendors.selectRole")} /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="admin" className="focus:bg-transparent data-[highlighted]:bg-transparent"><RoleBadge role="admin" /></SelectItem>
                      <SelectItem value="office" className="focus:bg-transparent data-[highlighted]:bg-transparent"><RoleBadge role="office" /></SelectItem>
                      <SelectItem value="field" className="focus:bg-transparent data-[highlighted]:bg-transparent"><RoleBadge role="field" /></SelectItem>
                      <SelectItem value="both" className="focus:bg-transparent data-[highlighted]:bg-transparent"><RoleBadge role="both" /></SelectItem>
                      <SelectItem value="foreman" className="focus:bg-transparent data-[highlighted]:bg-transparent"><RoleBadge role="foreman" /></SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground mt-1">{t("vendors.roleHelp")}</p>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label>{t("vendors.firstName")}</Label>
                    <Input value={contactForm.firstName} onChange={(e) => setContactForm({ ...contactForm, firstName: e.target.value })} required data-testid="input-new-contact-first-name" />
                  </div>
                  <div>
                    <Label>{t("vendors.lastName")}</Label>
                    <Input value={contactForm.lastName} onChange={(e) => setContactForm({ ...contactForm, lastName: e.target.value })} required data-testid="input-new-contact-last-name" />
                  </div>
                </div>
                <div>
                  <Label>{t("common.email")}</Label>
                  <Input type="email" value={contactForm.email} onChange={(e) => setContactForm({ ...contactForm, email: e.target.value })} data-testid="input-new-contact-email" />
                </div>
                <div>
                  <Label>{t("common.phone")}</Label>
                  <Input value={contactForm.phone} onChange={(e) => setContactForm({ ...contactForm, phone: handlePhoneInput(e.target.value) })} data-testid="input-new-contact-phone" />
                </div>
                <div className="flex items-center gap-2">
                  <Checkbox id="pec-cert-contact-add" checked={contactForm.pecCertification} onCheckedChange={(v) => setContactForm({ ...contactForm, pecCertification: !!v })} data-testid="checkbox-contact-pec-cert" />
                  <Label htmlFor="pec-cert-contact-add" className="cursor-pointer">{t("vendors.pecCertified")}</Label>
                </div>
                <div className="flex items-center gap-2">
                  <Checkbox id="visit-notif-contact-add" checked={contactForm.roles.includes("Visitor Notifications")} onCheckedChange={(v) => setContactForm({ ...contactForm, roles: v ? Array.from(new Set([...contactForm.roles, "Visitor Notifications"])) : contactForm.roles.filter((r) => r !== "Visitor Notifications") })} data-testid="checkbox-contact-visit-notifications" />
                  <Label htmlFor="visit-notif-contact-add" className="cursor-pointer">{t("vendors.visitorNotifications")}</Label>
                </div>
                <div>
                  <Label>{t("vendors.pecExpiration")}</Label>
                  <Input type="date" value={contactForm.pecExpirationDate} onChange={(e) => setContactForm({ ...contactForm, pecExpirationDate: e.target.value })} data-testid="input-contact-pec-expiration" />
                </div>
                <TogglePillButton color="blue" type="submit" disabled={createContact.isPending} className="w-full" data-testid="button-submit-contact">
                  {createContact.isPending ? t("vendors.addingEmployee") : t("vendors.addEmployee")}
                </TogglePillButton>
              </form>
            </DialogContent>
          </Dialog>
        </CardHeader>
        <CardContent className="p-0">
          {contacts && contacts.length > 0 ? (
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
                    <TableCell>
                      {canEditVendor && (
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <PillButton color="image" className="group min-w-[28px] px-0" data-testid={`button-delete-contact-${c.id}`}>
                              <Trash2 className="w-4 h-4 text-muted-foreground group-hover:text-destructive transition-colors" />
                            </PillButton>
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
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2"><UserCheck className="w-5 h-5" style={{ color: "var(--brand-primary)" }} />Field Employees ({employees?.length ?? 0})</CardTitle>
          {canEditVendor && (
            <TogglePillButton color="blue" data-testid="button-add-employee" className="px-2" onClick={() => { setContactForm({ jobTitle: "", firstName: "", lastName: "", email: "", phone: "", vendorRole: "field", pecCertification: false, pecExpirationDate: "", roles: [] }); setContactOpen(true); }}><Plus className="w-4 h-4" />{t("vendors.addEmployee")}</TogglePillButton>
          )}
        </CardHeader>
        <CardContent className="p-0">
          {employees && employees.length > 0 ? (
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
                {sortedEmployees.map((emp) => (
                  <TableRow key={emp.id} className={canEditVendor ? "group cursor-pointer hover:bg-muted/50" : ""} onClick={canEditVendor ? () => openEditEmployeeDialog(emp) : undefined} data-testid={`row-employee-${emp.id}`}>
                    <TableCell className="font-medium">{emp.jobTitle || "-"}</TableCell>
                    <TableCell className="font-medium"><div className="flex items-center gap-2 text-gray-700 group-hover:text-[var(--brand-primary)] transition-colors">{emp.photoUrl ? <img src={emp.photoUrl} alt="" className="w-6 h-6 rounded-full object-cover border border-gray-200" /> : <UserCheck className="w-4 h-4" style={{ color: "var(--brand-primary)" }} />}{emp.firstName} {emp.lastName}</div></TableCell>
                    <TableCell>{emp.email}</TableCell>
                    <TableCell>{formatPhone(emp.phone)}</TableCell>
                    <TableCell>
                      <RoleBadge role={emp.vendorRole} />
                    </TableCell>
                    <TableCell>
                      <PecStatusBadge expirationDate={emp.pecExpirationDate || null} />
                    </TableCell>
                    <TableCell>
                      {canEditVendor && (
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <PillButton color="image" className="group min-w-[28px] px-0" data-testid={`button-delete-employee-${emp.id}`}>
                              <Trash2 className="w-4 h-4 text-muted-foreground group-hover:text-destructive transition-colors" />
                            </PillButton>
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
                              <AlertDialogAction onClick={() => handleDeleteEmployee(emp.id)} data-testid={`button-delete-employee-confirm-${emp.id}`}>Remove</AlertDialogAction>
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
            <div className="p-8 text-center text-muted-foreground"><p>No field employees yet</p></div>
          )}
        </CardContent>
      </Card>

      {/* Hide the Members card unless the viewer is a system admin or
          has an admin-role membership in THIS vendor — mirrors the
          backend authz so non-admin org members don't see a card that
          would 403 on every action. */}
      <OrgMembersCard
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
      />

      <VendorPartnerRelationshipsCard vendorId={id} />

      <VendorServicesAndPricingCard vendorId={id} />

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2"><FileText className="w-5 h-5" style={{ color: "var(--brand-primary)" }} />Notes ({notes?.length ?? 0})</CardTitle>
          <Dialog open={noteOpen} onOpenChange={setNoteOpen}>
            <DialogTrigger asChild>
              <TogglePillButton color="blue" className="px-2" data-testid="button-add-note"><Plus className="w-4 h-4" />Add Note</TogglePillButton>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Add Note</DialogTitle></DialogHeader>
              <form onSubmit={handleAddNote} className="space-y-4">
                <div>
                  <Label>Note</Label>
                  <Textarea value={noteContent} onChange={(e) => setNoteContent(e.target.value)} placeholder="Enter note..." rows={4} data-testid="input-note-content" />
                </div>
                <TogglePillButton color="blue" type="submit" disabled={createNote.isPending} className="w-full" data-testid="button-submit-note">
                  {createNote.isPending ? "Adding..." : "Add Note"}
                </TogglePillButton>
              </form>
            </DialogContent>
          </Dialog>
        </CardHeader>
        <CardContent>
          {notes && notes.length > 0 ? (
            <div className="space-y-3">
              {notes.map((note) => (
                <div key={note.id} className="flex items-start gap-3 p-3 border rounded-lg" data-testid={`note-${note.id}`}>
                  <div className="flex-1">
                    <p className="text-sm whitespace-pre-wrap">{note.content}</p>
                    <p className="text-xs text-muted-foreground mt-1">{new Date(note.createdAt).toLocaleString()}</p>
                  </div>
                  <PillButton color="image" className="min-w-[28px] px-0" onClick={() => handleDeleteNote(note.id)} data-testid={`button-delete-note-${note.id}`}>
                    <Trash2 className="w-4 h-4 text-muted-foreground hover:text-destructive transition-colors" />
                  </PillButton>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-muted-foreground text-sm text-center">No notes added yet</p>
          )}
        </CardContent>
      </Card>

      {authUser?.role === "admin" && (
        <div className="flex justify-end gap-2">
          <TogglePillButton
            onClick={() => { resetMergeDialog(); setMergeOpen(true); }}
            data-testid="button-merge-vendor"
          >
            <Users className="w-4 h-4" />Merge into another vendor…
          </TogglePillButton>
          <TogglePillButton color="red" onClick={handleRemoveVendor} disabled={removeVendor.isPending} data-testid="button-remove-vendor">
            <Trash2 className="w-4 h-4" />{removeVendor.isPending ? "Removing..." : "Remove Vendor"}
          </TogglePillButton>
        </div>
      )}

      {authUser?.role === "admin" && (
        <Dialog
          open={mergeOpen}
          onOpenChange={(open) => {
            if (mergeApplying) return;
            setMergeOpen(open);
            if (!open) resetMergeDialog();
          }}
        >
          <DialogContent className="max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Merge "{vendor.name}" into another vendor</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                This vendor will be deleted. Every row that references it
                (tickets, invoices, ratings, billing settings, etc.) will be
                re-pointed to the survivor inside a single transaction.
                Conflict rows on duplicate unique keys are dropped.
              </p>
              <div>
                <Label>Survivor vendor</Label>
                <Select
                  value={mergeSurvivorId}
                  onValueChange={(v) => { setMergeSurvivorId(v); setMergePreview(null); setMergeError(null); }}
                  disabled={mergeApplying}
                >
                  <SelectTrigger data-testid="select-merge-survivor">
                    <SelectValue placeholder="Pick a vendor to absorb this one…" />
                  </SelectTrigger>
                  <SelectContent>
                    {(allVendors ?? [])
                      .filter((v) => v.id !== id)
                      .sort((a, b) => a.name.localeCompare(b.name))
                      .map((v) => (
                        <SelectItem key={v.id} value={String(v.id)}>
                          {v.name} (#{v.id})
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
              {mergeError && (
                <div className="text-sm text-destructive" data-testid="text-merge-error">
                  {mergeError}
                </div>
              )}
              {!mergePreview ? (
                <div className="flex justify-end">
                  <TogglePillButton color="blue"
                    onClick={handleLoadMergePreview}
                    disabled={mergePreviewLoading || !mergeSurvivorId}
                    data-testid="button-load-merge-preview"
                  >
                    {mergePreviewLoading ? "Loading…" : "Preview merge"}
                  </TogglePillButton>
                </div>
              ) : (
                <div className="space-y-3" data-testid="merge-preview-block">
                  <div className="text-sm">
                    Merging <strong>#{mergePreview.loserVendorId} {mergePreview.loserVendorName}</strong>
                    {" → "}
                    <strong>#{mergePreview.survivorVendorId} {mergePreview.survivorVendorName}</strong>
                  </div>
                  <div className="rounded border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Table</TableHead>
                          <TableHead className="text-right">Rows moved</TableHead>
                          <TableHead className="text-right">Conflict rows dropped</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {Object.entries(mergePreview.counts)
                          .filter(([, c]) => c.move > 0 || c.conflictDelete > 0)
                          .sort(([a], [b]) => a.localeCompare(b))
                          .map(([table, c]) => (
                            <TableRow key={table} data-testid={`row-merge-count-${table}`}>
                              <TableCell className="font-mono text-xs">{table}</TableCell>
                              <TableCell className="text-right">{c.move}</TableCell>
                              <TableCell className="text-right">{c.conflictDelete}</TableCell>
                            </TableRow>
                          ))}
                        {Object.values(mergePreview.counts).every(
                          (c) => c.move === 0 && c.conflictDelete === 0,
                        ) && (
                          <TableRow>
                            <TableCell colSpan={3} className="text-center text-muted-foreground text-sm">
                              No FK rows reference this vendor. Only the vendor row itself will be deleted.
                            </TableCell>
                          </TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </div>
                  <div className="text-sm" data-testid="text-merge-totals">
                    Total: <strong>{mergePreview.totalMoved}</strong> row(s) moved,{" "}
                    <strong>{mergePreview.totalConflictDeleted}</strong> conflict row(s) dropped.
                  </div>
                  <div className="flex justify-end gap-2">
                    <TogglePillButton
                      onClick={() => { setMergePreview(null); }}
                      disabled={mergeApplying}
                      data-testid="button-merge-back"
                    >
                      Back
                    </TogglePillButton>
                    <TogglePillButton color="red"
                      onClick={handleConfirmMerge}
                      disabled={mergeApplying}
                      data-testid="button-confirm-merge"
                    >
                      {mergeApplying ? "Merging…" : "Confirm merge"}
                    </TogglePillButton>
                  </div>
                </div>
              )}
            </div>
          </DialogContent>
        </Dialog>
      )}

      <Dialog open={editContactOpen} onOpenChange={tryCloseEditContact}>
        <DialogContent>
          <DialogLogoHeader
            src={vendor?.logoUrl}
            alt={vendor ? t("vendors.logoAlt", { name: vendor.name }) : undefined}
            data-testid="img-edit-contact-vendor-logo"
          />
          <DialogHeader><DialogTitle>{t("vendors.editOfficeEmployeeTitle")}</DialogTitle></DialogHeader>
          <form onSubmit={handleEditContact} className="space-y-4">
            <div>
              <Label>{t("vendors.employeePhoto")}</Label>
              <div className="mt-2"><PhotoUploadField value={editContactForm.photoUrl} onChange={(url) => setEditContactForm({ ...editContactForm, photoUrl: url })} testIdPrefix="edit-contact-photo" /></div>
            </div>
            <div>
              <Label>{t("vendors.jobTitle")}</Label>
              <Input value={editContactForm.jobTitle} onChange={(e) => setEditContactForm({ ...editContactForm, jobTitle: e.target.value })} data-testid="input-edit-contact-job-title" />
            </div>
            <div>
              <Label>{t("vendors.role")}</Label>
              <Select value={editContactForm.vendorRole} onValueChange={(v) => setEditContactForm({ ...editContactForm, vendorRole: v })}>
                <SelectTrigger data-testid="select-edit-contact-role"><SelectValue placeholder={t("vendors.selectRole")} /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="admin" className="focus:bg-transparent data-[highlighted]:bg-transparent"><RoleBadge role="admin" /></SelectItem>
                  <SelectItem value="office" className="focus:bg-transparent data-[highlighted]:bg-transparent"><RoleBadge role="office" /></SelectItem>
                  <SelectItem value="field" className="focus:bg-transparent data-[highlighted]:bg-transparent"><RoleBadge role="field" /></SelectItem>
                      <SelectItem value="both" className="focus:bg-transparent data-[highlighted]:bg-transparent"><RoleBadge role="both" /></SelectItem>
                      <SelectItem value="foreman" className="focus:bg-transparent data-[highlighted]:bg-transparent"><RoleBadge role="foreman" /></SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>{t("vendors.firstName")}</Label>
                <Input value={editContactForm.firstName} onChange={(e) => setEditContactForm({ ...editContactForm, firstName: e.target.value })} required data-testid="input-edit-contact-first-name" />
              </div>
              <div>
                <Label>{t("vendors.lastName")}</Label>
                <Input value={editContactForm.lastName} onChange={(e) => setEditContactForm({ ...editContactForm, lastName: e.target.value })} required data-testid="input-edit-contact-last-name" />
              </div>
            </div>
            <div>
              <Label>{t("common.email")}</Label>
              <Input type="email" value={editContactForm.email} onChange={(e) => setEditContactForm({ ...editContactForm, email: e.target.value })} data-testid="input-edit-contact-email" />
            </div>
            <div>
              <Label>{t("common.phone")}</Label>
              <Input value={editContactForm.phone} onChange={(e) => setEditContactForm({ ...editContactForm, phone: handlePhoneInput(e.target.value) })} data-testid="input-edit-contact-phone" />
            </div>
            <div className="flex items-center gap-2">
              <Checkbox id="pec-cert-contact-edit" checked={editContactForm.pecCertification} onCheckedChange={(v) => setEditContactForm({ ...editContactForm, pecCertification: !!v })} data-testid="checkbox-edit-contact-pec-cert" />
              <Label htmlFor="pec-cert-contact-edit" className="cursor-pointer">{t("vendors.pecCertified")}</Label>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox id="visit-notif-contact-edit" checked={editContactForm.roles.includes("Visitor Notifications")} onCheckedChange={(v) => setEditContactForm({ ...editContactForm, roles: v ? Array.from(new Set([...editContactForm.roles, "Visitor Notifications"])) : editContactForm.roles.filter((r) => r !== "Visitor Notifications") })} data-testid="checkbox-edit-contact-visit-notifications" />
              <Label htmlFor="visit-notif-contact-edit" className="cursor-pointer">{t("vendors.visitorNotifications")}</Label>
            </div>
            <div>
              <Label>{t("vendors.pecExpiration")}</Label>
              <Input type="date" value={editContactForm.pecExpirationDate} onChange={(e) => setEditContactForm({ ...editContactForm, pecExpirationDate: e.target.value })} data-testid="input-edit-contact-pec-expiration" />
            </div>
            <TogglePillButton color="blue" type="submit" disabled={updateContact.isPending} attention={editContactDirty} className="w-full" data-testid="button-submit-edit-contact">
              {updateContact.isPending ? t("common.saving") : t("common.saveChanges")}
            </TogglePillButton>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={editEmployeeOpen} onOpenChange={tryCloseEditEmployee}>
        <DialogContent>
          <DialogLogoHeader
            src={vendor?.logoUrl}
            alt={vendor ? t("vendors.logoAlt", { name: vendor.name }) : undefined}
            data-testid="img-edit-employee-vendor-logo"
          />
          <DialogHeader><DialogTitle>{t("vendors.editFieldEmployeeTitle")}</DialogTitle></DialogHeader>
          <form onSubmit={handleEditEmployee} className="space-y-4">
            <div>
              <Label>{t("vendors.employeePhoto")}</Label>
              <div className="mt-2"><PhotoUploadField value={editEmployeeForm.photoUrl} onChange={(url) => setEditEmployeeForm({ ...editEmployeeForm, photoUrl: url })} testIdPrefix="edit-employee-photo" /></div>
            </div>
            <div>
              <Label>{t("vendors.jobTitle")}</Label>
              <Input value={editEmployeeForm.jobTitle} onChange={(e) => setEditEmployeeForm({ ...editEmployeeForm, jobTitle: e.target.value })} data-testid="input-edit-job-title" placeholder={t("vendors.jobTitlePlaceholderField")} />
            </div>
            <div>
              <Label>{t("vendors.role")}</Label>
              <Select value={editEmployeeForm.vendorRole} onValueChange={(v) => setEditEmployeeForm({ ...editEmployeeForm, vendorRole: v })}>
                <SelectTrigger data-testid="select-edit-employee-role"><SelectValue placeholder={t("vendors.selectRole")} /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="admin" className="focus:bg-transparent data-[highlighted]:bg-transparent"><RoleBadge role="admin" /></SelectItem>
                      <SelectItem value="office" className="focus:bg-transparent data-[highlighted]:bg-transparent"><RoleBadge role="office" /></SelectItem>
                      <SelectItem value="field" className="focus:bg-transparent data-[highlighted]:bg-transparent"><RoleBadge role="field" /></SelectItem>
                      <SelectItem value="both" className="focus:bg-transparent data-[highlighted]:bg-transparent"><RoleBadge role="both" /></SelectItem>
                      <SelectItem value="foreman" className="focus:bg-transparent data-[highlighted]:bg-transparent"><RoleBadge role="foreman" /></SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>{t("vendors.firstName")}</Label>
                <Input value={editEmployeeForm.firstName} onChange={(e) => setEditEmployeeForm({ ...editEmployeeForm, firstName: e.target.value })} data-testid="input-edit-first-name" required />
              </div>
              <div>
                <Label>{t("vendors.lastName")}</Label>
                <Input value={editEmployeeForm.lastName} onChange={(e) => setEditEmployeeForm({ ...editEmployeeForm, lastName: e.target.value })} data-testid="input-edit-last-name" required />
              </div>
            </div>
            <div>
              <Label>{t("common.email")}</Label>
              <Input type="email" value={editEmployeeForm.email} onChange={(e) => setEditEmployeeForm({ ...editEmployeeForm, email: e.target.value })} data-testid="input-edit-email" required />
            </div>
            <div>
              <Label>{t("common.phone")}</Label>
              <Input value={editEmployeeForm.phone} onChange={(e) => setEditEmployeeForm({ ...editEmployeeForm, phone: handlePhoneInput(e.target.value) })} data-testid="input-edit-phone" />
            </div>
            <div className="flex items-center gap-2">
              <Label>{t("vendors.pecCertification")}</Label>
              <PecStatusBadge expirationDate={editEmployeeForm.pecExpirationDate || null} />
            </div>
            <div>
              <Label>{t("vendors.expirationDate")}</Label>
              <Input type="date" value={editEmployeeForm.pecExpirationDate} onChange={(e) => setEditEmployeeForm({ ...editEmployeeForm, pecExpirationDate: e.target.value })} data-testid="input-edit-pec-expiration" />
            </div>
            <div className="flex items-center gap-2">
              <Checkbox id="visit-notif-employee-edit" checked={editEmployeeForm.roles.includes("Visitor Notifications")} onCheckedChange={(v) => setEditEmployeeForm({ ...editEmployeeForm, roles: v ? Array.from(new Set([...editEmployeeForm.roles, "Visitor Notifications"])) : editEmployeeForm.roles.filter((r) => r !== "Visitor Notifications") })} data-testid="checkbox-edit-employee-visit-notifications" />
              <Label htmlFor="visit-notif-employee-edit" className="cursor-pointer">{t("vendors.visitorNotifications")}</Label>
            </div>
            <TogglePillButton type="submit" color="blue" className="w-full px-2" disabled={updateEmployee.isPending} attention={editEmployeeDirty} data-testid="button-submit-edit-employee">
              {updateEmployee.isPending ? t("common.saving") : t("common.saveChanges")}
            </TogglePillButton>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function OperatingAreaEditor({ vendorId, canEdit }: { vendorId: number; canEdit: boolean }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { toast } = useToast();
  const areaQueryKey = ["hotlist", "operating-area", vendorId];
  const { data: v } = useQuery({ queryKey: areaQueryKey, queryFn: () => hotlistApi.getOperatingArea(vendorId), enabled: !!vendorId });
  const [editing, setEditing] = useState(false);
  const [radius, setRadius] = useState<string>("");
  const [refresh, setRefresh] = useState(false);
  const [saving, setSaving] = useState(false);

  const start = () => {
    setRadius(v?.operatingRadiusMiles != null ? String(v.operatingRadiusMiles) : "");
    setRefresh(false);
    setEditing(true);
  };

  const save = async () => {
    setSaving(true);
    try {
      const result = await hotlistApi.setOperatingArea(vendorId, {
        operatingRadiusMiles: radius === "" ? null : parseInt(radius),
        refreshGeocode: refresh,
      });
      qc.invalidateQueries({ queryKey: areaQueryKey });
      qc.invalidateQueries({ queryKey: ["hotlist", "list"] });
      if (result.geocodeWarning) {
        toast({
          title: "Saved, but address could not be geocoded",
          description: result.geocodeWarning,
          variant: "destructive",
        });
      } else if (result.geocodeUsedQuery) {
        toast({
          title: "Operating area saved",
          description: `Exact street address not found; geocoded using "${result.geocodeUsedQuery}" instead.`,
        });
      } else {
        toast({ title: "Operating area saved" });
      }
      setEditing(false);
    } catch (e: unknown) {
      toast({
        title: translateApiError(e, t, t("errors.vendor.operating_area_save_failed")),
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const hasGeo = v?.latitude != null && v?.longitude != null;
  return (
    <div className="pt-2 border-t" data-testid="operating-area-section">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm text-muted-foreground">Operating Radius:</div>
          <div className="font-medium" data-testid="text-operating-radius">
            {v?.operatingRadiusMiles != null ? `${v.operatingRadiusMiles} miles` : "Not set"}
            {!hasGeo && v?.operatingRadiusMiles != null && (
              <span className="ml-2 text-xs text-amber-600">(address could not be geocoded — try editing the physical address to "City, ST ZIP" format)</span>
            )}
            {hasGeo && (
              <span className="ml-2 text-xs text-muted-foreground">· geocoded {v.geocodedAt ? new Date(v.geocodedAt).toLocaleDateString() : ""}</span>
            )}
          </div>
        </div>
        {canEdit && !editing && (
          <TogglePillButton color="blue" onClick={start} className="px-2" data-testid="button-edit-operating-area"><Pencil className="w-3 h-3" />Change Radius</TogglePillButton>
        )}
      </div>
      {editing && (
        <div className="mt-3 space-y-3">
          <div>
            <Label>Radius (miles)</Label>
            <Input type="number" min="0" max="5000" value={radius} onChange={(e) => setRadius(e.target.value)} placeholder="e.g. 100" data-testid="input-operating-radius" />
            <p className="text-xs text-muted-foreground mt-1">Hotlist jobs whose location is within this distance of your physical address will appear on your dashboard.</p>
          </div>
          {hasGeo && (
            <div className="flex items-center gap-2">
              <Checkbox id="refresh-geo" checked={refresh} onCheckedChange={(c) => setRefresh(!!c)} />
              <Label htmlFor="refresh-geo" className="cursor-pointer text-sm">Re-geocode from current physical address</Label>
            </div>
          )}
          {/* Save / Cancel converted to TogglePill family per user
              spec — both 24px tall. Save uses canonical blue (the
              "Edit / non-destructive primary in dialogs" doctrine);
              Cancel is explicitly red per user request (overrides
              the usual grey-cancel convention for this surface). */}
          <div className="flex gap-2">
            <TogglePillButton color="blue" onClick={save} disabled={saving} data-testid="button-save-operating-area">
              <Check className="h-4 w-4" />
              {saving ? "Saving..." : "Save"}
            </TogglePillButton>
            <div className="w-3" />
            <TogglePillButton color="red" onClick={() => setEditing(false)} data-testid="button-cancel-operating-area">
              <X className="h-4 w-4" />
              Cancel
            </TogglePillButton>
          </div>
        </div>
      )}
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
          <div className="rounded-md border p-3 space-y-3">
            <div className="text-sm font-medium">Your rating</div>
            {!editing ? (
              <div className="flex items-center gap-3">
                {myRating ? (
                  <>
                    <StarRating value={myRating.rating} readOnly size={20} />
                    {myRating.review && <span className="text-sm text-muted-foreground line-clamp-1">"{myRating.review}"</span>}
                    <div className="ml-auto mr-2 flex items-center gap-4">
                      <TogglePillButton color="blue" onClick={startEdit} className="px-2" data-testid="button-edit-my-rating"><Pencil className="w-4 h-4" />Edit</TogglePillButton>
                      <BrandPillButton tone="red" onClick={removeMine} data-testid="button-remove-my-rating"><Trash2 className="w-4 h-4" />Remove</BrandPillButton>
                    </div>
                  </>
                ) : (
                  <>
                    <span className="text-sm text-muted-foreground">You haven't rated this vendor.</span>
                    <div className="ml-auto"><TogglePillButton color="blue" className="px-2" onClick={startEdit} data-testid="button-add-my-rating"><Plus className="w-4 h-4" />Add Rating</TogglePillButton></div>
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
                  <TogglePillButton color="blue" onClick={submit} disabled={upsert.isPending} data-testid="button-save-rating">
                    <Check className="w-4 h-4" />
                    {upsert.isPending ? "Saving..." : "Save"}
                  </TogglePillButton>
                  <div className="w-3" />
                  <TogglePillButton onClick={() => setEditing(false)} data-testid="button-cancel-rating">
                    <X className="w-4 h-4" />
                    Cancel
                  </TogglePillButton>
                </div>
              </div>
            )}
          </div>
        )}

        <div className="space-y-3">
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
      </CardContent>
    </Card>
  );
}

type ServicesItem = {
  id: number;
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
// The vendor work-types PUT is a full-replace, so we send back every
// currently-selected row with this one's pricing fields swapped — that
// preserves siblings instead of nuking them.
function ServicePriceEditModal({
  vendorId,
  item,
  allSelected,
  open,
  onOpenChange,
}: {
  vendorId: number;
  item: ServicesItem;
  allSelected: ServicesItem[];
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
      const items = allSelected.map((row) => {
        const isTarget = row.id === item.id;
        return {
          workTypeId: row.id,
          unitPrice: isTarget
            ? unitPrice.trim() === ""
              ? null
              : unitPrice.trim()
            : row.unitPrice,
          unit: isTarget ? (unit === "" ? null : unit) : row.unit,
          currency: isTarget ? currency.trim().toUpperCase() : row.currency,
          notes: isTarget ? (notes.trim() === "" ? null : notes) : row.notes,
          ...(isTarget && trimmedReason !== ""
            ? { priceChangeReason: trimmedReason }
            : {}),
        };
      });
      const res = await fetch(`${base}/api/vendors/${vendorId}/work-types`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items }),
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
            Saved as a draft on your catalog. Publish a new catalog version
            from the Catalog page so partners can re-approve.
          </p>
        </div>
        <div className="flex items-stretch gap-2 pt-2">
          {/* Cancel → canonical TogglePillButton with color="red".
              TogglePillButton's default behavior is grey-idle → swap
              to its `color` on hover, so this renders neutral grey
              at rest and pulses red on hover (red = destructive,
              matching the brand-aware chrome doctrine). height={36}
              matches the sibling Save button so the two pills line
              up in the `flex items-stretch gap-2` footer. */}
          <TogglePillButton color="red" size="sm" height={36} onClick={() => onOpenChange(false)} data-testid={`button-cancel-edit-price-${item.id}`}>Cancel</TogglePillButton>
          {/* Wide blue TogglePill — idles in the shared light-grey
              pill chrome and pulses to the canonical TogglePill blue
              on hover. `flex-1` makes it span the remainder of the
              footer next to the Cancel button. */}
          <TogglePillButton
            color="blue"
            size="sm"
            height={36}
            className="flex-1"
            onClick={() => save.mutate()}
            disabled={!canSubmit}
            data-testid={`button-save-price-${item.id}`}
          >
            {save.isPending ? "Saving…" : "Save price"}
          </TogglePillButton>
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
    (user?.availableMemberships ?? []).some(
      (m) =>
        m.orgType === "vendor" && m.orgId === vendorId && m.role === "admin",
    );

  const { data, isLoading, isError } = useQuery({
    queryKey: ["vendor-services-pricing", vendorId],
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
      const key = it.category?.trim() || "Uncategorized";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(it);
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [allSelected]);

  const selectedCount = grouped.reduce((acc, [, items]) => acc + items.length, 0);
  const missingPriceCount = grouped.reduce(
    (acc, [, items]) => acc + items.filter((i) => !i.unitPrice).length,
    0,
  );

  const [editing, setEditing] = useState<ServicesItem | null>(null);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2">
          <ShoppingCart className="w-5 h-5" style={{ color: "var(--brand-primary)" }} />
          Services &amp; Pricing ({selectedCount})
        </CardTitle>
        {missingPriceCount > 0 ? (
          <span
            className="text-xs text-amber-700"
            data-testid="text-services-missing-price-count"
          >
            {missingPriceCount} without a price
          </span>
        ) : null}
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
            This vendor has not configured any services yet.
          </p>
        ) : (
          <div className="space-y-4">
            {grouped.map(([category, items]) => (
              <div key={category} className="space-y-1">
                <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  {category}
                </h3>
                <div className="rounded border divide-y">
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
          allSelected={allSelected}
          open={!!editing}
          onOpenChange={(v) => !v && setEditing(null)}
        />
      )}
    </Card>
  );
}
