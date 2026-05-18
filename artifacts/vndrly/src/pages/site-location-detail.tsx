import { useState, useRef, useEffect } from "react";
import {
  useGetSiteLocation,
  useGetSiteLocationQrCode,
  useCreateSiteAssignment,
  useUpdateSiteAssignment,
  useDeleteSiteAssignment,
  useUpdateSiteLocation,
  useDeleteSiteLocation,
  SiteLocationStatus,
  type SiteLocationStatus as SiteLocationStatusType,
  useListWorkTypes,
  useListVendors,
  useListTickets,
  useListSiteDirectAssignments,
  useCreateSiteDirectAssignment,
  useCancelDirectAssignment,
  getGetSiteLocationQueryKey,
  getGetSiteLocationQrCodeQueryKey,
  getListSiteAssignmentsQueryKey,
  getListSiteLocationsQueryKey,
  getListTicketsQueryKey,
  getListSiteDirectAssignmentsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { useTranslation } from "react-i18next";
import { visitsApi, type VisitorRow } from "@/lib/visits-api";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PillButton } from "@/components/pill";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Label } from "@/components/ui/label";
import { Plus, Trash2, QrCode, ChevronDown, ChevronUp, FileText, Clock, Info, Briefcase, Pencil, Save, X, ListChecks, Printer, MapPin, LocateFixed, Users, ArrowRight, Send, CalendarDays } from "lucide-react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { useBrand } from "@/hooks/use-brand";
import StatusBadge from "@/components/status-badge";
import TicketStatusBadge from "@/components/ticket-status-badge";
import TicketStatusTogglePill from "@/components/ticket-status-toggle-pill";
import { SiteLocationMap } from "@/components/site-location-map";
import BlueButton from "@/components/blue-button";
import RedButton from "@/components/red-button";
import GreyButton from "@/components/grey-button";
import LightGreyRedButton from "@/components/light-grey-red-button";
import GreenV2Button from "@/components/green-v2-button";
import AmberButton from "@/components/amber-button";
import BrandPill from "@/components/brand-pill";
import TogglePill, { TogglePillButton } from "@/components/toggle-pill";
import BrandPillButton from "@/components/brand-pill-button";
import SphereBackButton from "@/components/sphere-back-button";
import AfePill from "@/components/afe-pill";

export default function SiteLocationDetail({ id }: { id: number }) {
  const { data: site, isLoading } = useGetSiteLocation(id, { query: { enabled: !!id, queryKey: getGetSiteLocationQueryKey(id) } });
  const { data: qrData } = useGetSiteLocationQrCode(id, { query: { enabled: !!id, queryKey: getGetSiteLocationQrCodeQueryKey(id) } });
  const { data: workTypes } = useListWorkTypes();
  const { data: vendors } = useListVendors();
  const createAssignment = useCreateSiteAssignment();
  const updateAssignment = useUpdateSiteAssignment();
  const deleteAssignment = useDeleteSiteAssignment();
  const deleteSite = useDeleteSiteLocation();
  const updateSite = useUpdateSiteLocation();
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { user } = useAuth();
  const { t } = useTranslation();
  const brand = useBrand();
  const accentColor = brand.isOrgBranded ? brand.primary : "#f59e0b";
  const iconStyle = { color: accentColor };
  const isVendor = user?.role === "vendor";
  const { data: siteVisits } = useQuery<VisitorRow[]>({
    queryKey: ["visits-site", id],
    queryFn: () => visitsApi.list({ siteLocationId: id }),
    enabled: !!id && (user?.role === "admin" || user?.role === "partner" || user?.role === "vendor"),
    refetchInterval: 60000,
  });
  const canManageAssignments = user?.role === "admin" || user?.role === "partner";
  const [open, setOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [editingCoords, setEditingCoords] = useState(false);
  const [editLat, setEditLat] = useState("");
  const [editLng, setEditLng] = useState("");
  const [editingAfe, setEditingAfe] = useState(false);
  const [editAfe, setEditAfe] = useState("");
  const [editingAssignmentAfeId, setEditingAssignmentAfeId] = useState<number | null>(null);
  const [editAssignmentAfe, setEditAssignmentAfe] = useState("");
  const [statusOpen, setStatusOpen] = useState(false);
  const statusRef = useRef<HTMLDivElement>(null);
  const [geoLocating, setGeoLocating] = useState(false);
  const [editingRadius, setEditingRadius] = useState(false);
  const [editRadius, setEditRadius] = useState("");
  // When the SWA write returns 400 work_type_not_in_vendor_catalog we
  // stash the rejected payload here and surface the add-to-catalog
  // confirm dialog. Once the vendor accepts, we POST the work type to
  // the vendor's self-service catalog and replay the original SWA
  // create request.
  const [catalogConflict, setCatalogConflict] = useState<{
    workTypeId: number;
    vendorId: number;
    workTypeName: string;
    vendorName: string;
    afe: string | null;
  } | null>(null);
  const [catalogConfirmSaving, setCatalogConfirmSaving] = useState(false);
  const [form, setForm] = useState({ workTypeId: "", vendorId: "", afe: "" });
  // Direct work assignments (Partner → Vendor offer with Commit/Pass loop).
  // Lives alongside the work-types catalog above but is its own independent
  // surface — partner sets a date range + optional scope, vendor responds.
  const [directOpen, setDirectOpen] = useState(false);
  const [directForm, setDirectForm] = useState({
    vendorId: "",
    startDate: "",
    endDate: "",
    price: "",
    crewSize: "",
    priority: "normal" as "low" | "normal" | "high",
    scopeOfWork: "",
  });
  const [cancelDirectId, setCancelDirectId] = useState<number | null>(null);
  // Only partner/admin viewers can call this endpoint (vendor users
  // get a 403 — the section is hidden for them anyway). Gating the
  // query on `canManageAssignments` here avoids spamming the network
  // tab with background 403s for vendor viewers who happen to land on
  // a site detail page.
  const directAssignmentsQuery = useListSiteDirectAssignments(id, {
    query: {
      enabled: !!id && canManageAssignments,
      queryKey: getListSiteDirectAssignmentsQueryKey(id),
    },
  });
  const createDirectAssignment = useCreateSiteDirectAssignment();
  const cancelDirectAssignment = useCancelDirectAssignment();
  const [expandOpen, setExpandOpen] = useState(false);
  const [expandVendorId, setExpandVendorId] = useState<string>("");
  const [expandChecked, setExpandChecked] = useState<Set<number>>(new Set());
  const [expandInitial, setExpandInitial] = useState<Set<number>>(new Set());
  const [expandSaving, setExpandSaving] = useState(false);
  const expandDirty = expandChecked.size !== expandInitial.size || Array.from(expandChecked).some((id) => !expandInitial.has(id));
  const canRemove = user?.role === "admin" || user?.role === "partner";
  const { data: siteTickets, isLoading: ticketsLoading } = useListTickets({ siteLocationId: id }, { query: { enabled: !!id, queryKey: getListTicketsQueryKey({ siteLocationId: id }) } });

  type RecentSortKey = "tracking" | "workType" | "employee" | "status" | "date";
  const [recentSortKey, setRecentSortKey] = useState<RecentSortKey>("date");
  const [recentSortDir, setRecentSortDir] = useState<"asc" | "desc">("desc");
  const handleRecentSort = (column: RecentSortKey) => {
    if (recentSortKey === column) {
      setRecentSortDir(recentSortDir === "asc" ? "desc" : "asc");
    } else {
      setRecentSortKey(column);
      setRecentSortDir("asc");
    }
  };
  const RecentSortableHead = ({ label, column }: { label: string; column: RecentSortKey }) => (
    <TableHead className="cursor-pointer select-none" onClick={() => handleRecentSort(column)}>
      <div className="flex items-center gap-1">
        {label}
        {recentSortKey === column ? (
          recentSortDir === "asc" ? <ChevronUp className="w-4 h-4" style={iconStyle} /> : <ChevronDown className="w-4 h-4" style={iconStyle} />
        ) : (
          <div className="flex flex-col -space-y-1">
            <ChevronUp className="w-3 h-3 text-muted-foreground" />
            <ChevronDown className="w-3 h-3 text-muted-foreground" />
          </div>
        )}
      </div>
    </TableHead>
  );

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (statusRef.current && !statusRef.current.contains(event.target as Node)) {
        setStatusOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const isAdmin = user?.role === "admin";
  const handleUnhide = () => {
    updateSite.mutate(
      { id, data: { hidden: false } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetSiteLocationQueryKey(id) });
          queryClient.invalidateQueries({ queryKey: getListSiteLocationsQueryKey() });
          toast({ title: t("siteLocations.unhidden") });
        },
        onError: () => {
          toast({ title: t("siteLocations.unhideFailed"), variant: "destructive" });
        },
      },
    );
  };

  const handleStatusChange = (newStatus: SiteLocationStatusType) => {
    updateSite.mutate(
      { id, data: { status: newStatus } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetSiteLocationQueryKey(id) });
          queryClient.invalidateQueries({ queryKey: getListSiteLocationsQueryKey() });
          toast({ title: t("siteLocations.statusUpdated", { status: newStatus.charAt(0).toUpperCase() + newStatus.slice(1) }) });
          setStatusOpen(false);
        },
        onError: () => {
          toast({ title: t("siteLocations.statusUpdateFailed"), variant: "destructive" });
        },
      },
    );
  };

  const handleSaveAfe = () => {
    const trimmed = editAfe.trim();
    updateSite.mutate(
      { id, data: { afe: trimmed === "" ? null : trimmed } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetSiteLocationQueryKey(id) });
          queryClient.invalidateQueries({ queryKey: getListSiteLocationsQueryKey() });
          toast({ title: t("siteLocations.afeUpdated") });
          setEditingAfe(false);
        },
        onError: () => {
          toast({ title: t("siteLocations.afeUpdateFailed"), variant: "destructive" });
        },
      },
    );
  };

  const handleSaveCoords = () => {
    const lat = parseFloat(editLat);
    const lng = parseFloat(editLng);
    if (isNaN(lat) || isNaN(lng)) {
      toast({ title: t("siteLocations.invalidCoordinates"), variant: "destructive" });
      return;
    }
    updateSite.mutate(
      { id, data: { latitude: lat, longitude: lng } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetSiteLocationQueryKey(id) });
          queryClient.invalidateQueries({ queryKey: getListSiteLocationsQueryKey() });
          toast({ title: t("siteLocations.coordsUpdated") });
          setEditingCoords(false);
        },
        onError: () => {
          toast({ title: t("siteLocations.coordsUpdateFailed"), variant: "destructive" });
        },
      },
    );
  };

  // SWA writes now require the (vendor, work_type) pair to exist in the
  // vendor's self-service catalog. The server returns 400 with
  // `error: 'work_type_not_in_vendor_catalog'` when it doesn't. We
  // capture that here, surface a confirm dialog, and on accept add the
  // row to the vendor's catalog before retrying the original SWA write.
  const submitAssignment = (
    workTypeId: number,
    vendorId: number,
    afe: string | null,
  ) => {
    createAssignment.mutate(
      { siteId: id, data: { workTypeId, vendorId, afe } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetSiteLocationQueryKey(id) });
          setOpen(false);
          setForm({ workTypeId: "", vendorId: "", afe: "" });
          toast({ title: t("siteLocations.assignmentAdded") });
        },
        onError: (err: any) => {
          const data = err?.response?.data ?? err?.data ?? null;
          if (data?.code === "work_type_not_in_vendor_catalog" || data?.error === "work_type_not_in_vendor_catalog") {
            // Stash payload — the dialog will replay this with the
            // same (workTypeId, vendorId, afe) once the vendor row is
            // inserted.
            setCatalogConflict({
              workTypeId: Number(data.workTypeId ?? workTypeId),
              vendorId: Number(data.vendorId ?? vendorId),
              workTypeName: String(data.workTypeName ?? ""),
              vendorName: String(data.vendorName ?? ""),
              afe,
            });
            return;
          }
          toast({
            title: t("siteLocations.assignmentAddFailed", {
              defaultValue: "Failed to add assignment",
            }),
            variant: "destructive",
          });
        },
      },
    );
  };

  const handleAddAssignment = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedAfe = form.afe.trim();
    submitAssignment(
      parseInt(form.workTypeId),
      parseInt(form.vendorId),
      trimmedAfe === "" ? null : trimmedAfe,
    );
  };

  // Submit a direct Partner→Vendor work offer for this site. The server
  // creates a `pending` row, fans out an in-app notification + branded
  // email to vendor admins (via notifyUsers), and the vendor responds
  // Commit / Pass on their dashboard.
  const handleSubmitDirectAssignment = (e: React.FormEvent) => {
    e.preventDefault();
    const vendorIdNum = parseInt(directForm.vendorId);
    if (
      !vendorIdNum ||
      !directForm.startDate ||
      !directForm.endDate
    ) {
      toast({
        title: t("directAssignment.missingFieldsToast"),
        variant: "destructive",
      });
      return;
    }
    if (directForm.endDate < directForm.startDate) {
      toast({
        title: t("directAssignment.endBeforeStartToast"),
        variant: "destructive",
      });
      return;
    }
    // Compose the structured invite-detail fields (price, crew size,
    // priority) into the scopeOfWork text so the vendor sees them in
    // the existing scope payload — the API contract doesn't yet have
    // dedicated columns for these. Free-text scope follows the
    // structured prefix lines.
    const scopeRaw = directForm.scopeOfWork.trim();
    const detailLines: string[] = [];
    const priceTrim = directForm.price.trim();
    const crewTrim = directForm.crewSize.trim();
    if (priceTrim !== "") {
      detailLines.push(
        `${t("directAssignment.inviteDetailsPricePrefix")}: $${priceTrim}`,
      );
    }
    if (crewTrim !== "") {
      detailLines.push(
        `${t("directAssignment.inviteDetailsCrewPrefix")}: ${crewTrim}`,
      );
    }
    if (directForm.priority !== "normal") {
      const priorityLabel =
        directForm.priority === "high"
          ? t("directAssignment.priorityHigh")
          : t("directAssignment.priorityLow");
      detailLines.push(
        `${t("directAssignment.inviteDetailsPriorityPrefix")}: ${priorityLabel}`,
      );
    }
    const composedScope = [detailLines.join("\n"), scopeRaw]
      .filter((s) => s !== "")
      .join("\n\n");
    createDirectAssignment.mutate(
      {
        siteId: id,
        data: {
          vendorId: vendorIdNum,
          startDate: directForm.startDate,
          endDate: directForm.endDate,
          scopeOfWork: composedScope === "" ? null : composedScope,
        },
      },
      {
        onSuccess: () => {
          toast({ title: t("directAssignment.createdToast") });
          setDirectForm({
            vendorId: "",
            startDate: "",
            endDate: "",
            price: "",
            crewSize: "",
            priority: "normal",
            scopeOfWork: "",
          });
          setDirectOpen(false);
          queryClient.invalidateQueries({
            queryKey: getListSiteDirectAssignmentsQueryKey(id),
          });
        },
        onError: () => {
          toast({
            title: t("directAssignment.createFailedToast"),
            variant: "destructive",
          });
        },
      },
    );
  };

  const handleCancelDirectAssignment = (assignmentId: number) => {
    cancelDirectAssignment.mutate(
      { id: assignmentId },
      {
        onSuccess: () => {
          toast({ title: t("directAssignment.cancelledToast") });
          setCancelDirectId(null);
          queryClient.invalidateQueries({
            queryKey: getListSiteDirectAssignmentsQueryKey(id),
          });
        },
        onError: () => {
          toast({
            title: t("directAssignment.cancelFailedToast"),
            variant: "destructive",
          });
        },
      },
    );
  };

  const handleConfirmCatalogAdd = async () => {
    if (!catalogConflict) return;
    setCatalogConfirmSaving(true);
    try {
      const apiBase = import.meta.env.BASE_URL.replace(/\/$/, "");
      // Add-only endpoint: partner-admin and system-admin sessions are
      // permitted (vendor-admins too). The full PUT /work-types route
      // intentionally rejects partner sessions because it can edit
      // pricing and remove rows; this append-only path cannot.
      const appendRes = await fetch(
        `${apiBase}/api/vendors/${catalogConflict.vendorId}/work-types/append`,
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ workTypeId: catalogConflict.workTypeId }),
        },
      );
      if (!appendRes.ok) throw new Error(`HTTP ${appendRes.status}`);
      const conflict = catalogConflict;
      setCatalogConflict(null);
      submitAssignment(conflict.workTypeId, conflict.vendorId, conflict.afe);
    } catch {
      toast({
        title: t("siteLocations.catalogAddFailed", {
          defaultValue: "Could not add to vendor catalog",
        }),
        variant: "destructive",
      });
    } finally {
      setCatalogConfirmSaving(false);
    }
  };

  const handleUseCurrentLocation = () => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      toast({
        title: t("siteLocations.geolocationUnavailable", {
          defaultValue: "Geolocation is not available in this browser",
        }),
        variant: "destructive",
      });
      return;
    }
    setGeoLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setEditLat(pos.coords.latitude.toFixed(6));
        setEditLng(pos.coords.longitude.toFixed(6));
        setEditingCoords(true);
        setGeoLocating(false);
      },
      () => {
        setGeoLocating(false);
        toast({
          title: t("siteLocations.geolocationFailed", {
            defaultValue: "Could not get current location. Check browser permissions.",
          }),
          variant: "destructive",
        });
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 },
    );
  };

  const handleSaveRadius = () => {
    const trimmed = editRadius.trim();
    const next = trimmed === "" ? null : parseInt(trimmed, 10);
    if (next !== null && (Number.isNaN(next) || next < 1 || next > 10000)) {
      toast({
        title: t("siteLocations.radiusInvalid", {
          defaultValue: "Radius must be between 1 and 10,000 meters",
        }),
        variant: "destructive",
      });
      return;
    }
    updateSite.mutate(
      { id, data: { siteRadiusMeters: next } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetSiteLocationQueryKey(id) });
          toast({
            title: t("siteLocations.radiusUpdated", {
              defaultValue: "Geofence radius updated",
            }),
          });
          setEditingRadius(false);
        },
        onError: () => {
          toast({
            title: t("siteLocations.radiusUpdateFailed", {
              defaultValue: "Failed to update radius",
            }),
            variant: "destructive",
          });
        },
      },
    );
  };

  const handleSaveAssignmentAfe = (assignmentId: number) => {
    const trimmed = editAssignmentAfe.trim();
    updateAssignment.mutate(
      { siteId: id, assignmentId, data: { afe: trimmed === "" ? null : trimmed } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetSiteLocationQueryKey(id) });
          queryClient.invalidateQueries({ queryKey: getListSiteAssignmentsQueryKey(id) });
          toast({ title: t("siteLocations.assignmentAfeUpdated") });
          setEditingAssignmentAfeId(null);
        },
        onError: () => {
          toast({ title: t("siteLocations.assignmentAfeUpdateFailed"), variant: "destructive" });
        },
      },
    );
  };

  const handleOpenExpand = () => {
    const targetVendorId = isVendor && user?.vendorId ? user.vendorId : (expandVendorId ? parseInt(expandVendorId) : null);
    const existingForVendor = (site?.assignments ?? []).filter((a: any) => targetVendorId == null || a.vendorId === targetVendorId);
    const initial = new Set<number>(existingForVendor.map((a: any) => a.workTypeId));
    setExpandChecked(new Set(initial));
    setExpandInitial(initial);
    setExpandOpen(true);
  };

  const handleExpandVendorChange = (v: string) => {
    setExpandVendorId(v);
    const vid = parseInt(v);
    const existingForVendor = (site?.assignments ?? []).filter((a: any) => a.vendorId === vid);
    const initial = new Set<number>(existingForVendor.map((a: any) => a.workTypeId));
    setExpandChecked(new Set(initial));
    setExpandInitial(initial);
  };

  const toggleExpandCheck = (workTypeId: number, alreadyAssigned: boolean) => {
    if (alreadyAssigned) return;
    setExpandChecked((prev) => {
      const next = new Set(prev);
      if (next.has(workTypeId)) next.delete(workTypeId);
      else next.add(workTypeId);
      return next;
    });
  };

  const handleSaveExpand = async () => {
    const targetVendorId = isVendor && user?.vendorId ? user.vendorId : (expandVendorId ? parseInt(expandVendorId) : null);
    if (!targetVendorId) {
      toast({ title: t("siteLocations.selectVendorFirst"), variant: "destructive" });
      return;
    }
    const existingIds = new Set(
      (site?.assignments ?? []).filter((a: any) => a.vendorId === targetVendorId).map((a: any) => a.workTypeId),
    );
    const toAdd = Array.from(expandChecked).filter((wid) => !existingIds.has(wid));
    if (toAdd.length === 0) {
      toast({ title: t("siteLocations.noNewWorkTypes") });
      setExpandOpen(false);
      return;
    }
    setExpandSaving(true);
    try {
      await Promise.all(
        toAdd.map((workTypeId) =>
          createAssignment.mutateAsync({ siteId: id, data: { workTypeId, vendorId: targetVendorId } }),
        ),
      );
      queryClient.invalidateQueries({ queryKey: getGetSiteLocationQueryKey(id) });
      queryClient.invalidateQueries({ queryKey: getListSiteAssignmentsQueryKey(id) });
      toast({ title: t("siteLocations.addedWorkTypes", { count: toAdd.length }) });
      setExpandOpen(false);
    } catch {
      toast({ title: t("siteLocations.expandCatalogFailed"), variant: "destructive" });
    } finally {
      setExpandSaving(false);
    }
  };

  const handleDeleteSite = () => {
    deleteSite.mutate(
      { id },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListSiteLocationsQueryKey() });
          toast({ title: t("siteLocations.siteRemoved") });
          navigate("/site-locations");
        },
        onError: () => {
          toast({ title: t("siteLocations.siteRemoveFailed"), variant: "destructive" });
        },
      },
    );
  };

  const handleDeleteAssignment = (assignmentId: number, force = false) => {
    // Pass `force=true` as a query param when the user has explicitly
    // confirmed in the in-use dialog. The orval-generated mutation
    // doesn't expose query params for DELETE, so we go through fetch
    // directly here when forcing — same auth (cookie) as the rest of
    // the app.
    if (force) {
      const apiBase = import.meta.env.BASE_URL.replace(/\/$/, "");
      void fetch(
        `${apiBase}/api/site-locations/${id}/assignments/${assignmentId}?force=true`,
        { method: "DELETE", credentials: "include" },
      )
        .then((r) => {
          if (r.ok || r.status === 204) {
            queryClient.invalidateQueries({
              queryKey: getGetSiteLocationQueryKey(id),
            });
            toast({ title: t("siteLocations.assignmentRemoved") });
          } else {
            toast({
              title: t("siteLocations.assignmentRemoveFailed", {
                defaultValue: "Failed to remove assignment",
              }),
              variant: "destructive",
            });
          }
        })
        .catch(() => {
          toast({
            title: t("siteLocations.assignmentRemoveFailed", {
              defaultValue: "Failed to remove assignment",
            }),
            variant: "destructive",
          });
        });
      return;
    }
    deleteAssignment.mutate(
      { siteId: id, assignmentId },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetSiteLocationQueryKey(id) });
          toast({ title: t("siteLocations.assignmentRemoved") });
        },
        onError: (err: any) => {
          // The API returns HTTP 409 with `error: 'assignment_in_use'` and
          // an `openTicketCount` when active tickets still depend on this
          // (vendor, work_type) pair. Surface a confirm so the partner
          // doesn't remove the catalog row from under in-flight work
          // unless they really mean to.
          const data = err?.response?.data ?? err?.data ?? null;
          const code = data?.error;
          if (code === "assignment_in_use") {
            const count = Number(data?.openTicketCount ?? 0);
            const ok = window.confirm(
              t("siteLocations.assignmentInUseConfirm", {
                defaultValue:
                  "{{count}} open ticket(s) still depend on this assignment. Removing it now will leave them without a catalog anchor. Remove anyway?",
                count,
              }),
            );
            if (ok) handleDeleteAssignment(assignmentId, true);
            return;
          }
          toast({
            title: t("siteLocations.assignmentRemoveFailed", {
              defaultValue: "Failed to remove assignment",
            }),
            variant: "destructive",
          });
        },
      },
    );
  };

  if (isLoading) return <div className="space-y-4"><Skeleton className="h-8 w-48" /><Skeleton className="h-48 w-full" /></div>;
  if (!site) return <p className="text-muted-foreground">{t("siteLocations.siteNotFound")}</p>;

  return (
    <div className="space-y-6" data-testid="site-location-detail-page">
      <div className="flex items-center gap-4">
        <Link href="/site-locations" className="group inline-flex items-center" aria-label="Back" data-testid="button-back"><SphereBackButton size={40} /></Link>
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-site-name">{site.name}</h1>
          <p className="text-muted-foreground text-sm">{site.address}</p>
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><Info className="w-5 h-5" style={iconStyle} />{t("siteLocations.siteInfo")}</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div><span className="text-sm text-muted-foreground">{t("siteLocations.partnerLabel")}</span> <span className="font-medium">{site.partnerName}</span></div>
            <div><span className="text-sm text-muted-foreground">{t("siteLocations.siteCodeLabel")}</span> <code className="text-xs bg-muted px-2 py-1 rounded">{site.siteCode}</code></div>
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">{t("siteLocations.afeLabel")}</span>
              {!editingAfe ? (
                <>
                  {site.afe ? (
                    <AfePill data-testid="text-site-afe">{site.afe}</AfePill>
                  ) : (
                    <span className="text-xs italic text-muted-foreground" data-testid="text-site-afe-empty">{t("siteLocations.afeNotSet")}</span>
                  )}
                  {canManageAssignments && (
                    <button onClick={() => { setEditAfe(site.afe ?? ""); setEditingAfe(true); }} data-testid="button-edit-afe">
                      <Pencil className="w-3.5 h-3.5 text-muted-foreground hover:text-[var(--brand-primary)] transition-colors" />
                    </button>
                  )}
                </>
              ) : (
                <div className="flex items-center gap-2">
                  <Input value={editAfe} onChange={(e) => setEditAfe(e.target.value)} className="w-44 h-7 text-xs" placeholder={t("siteLocations.afePlaceholder")} data-testid="input-edit-afe" />
                  <button className="text-green-600 hover:text-green-700" onClick={handleSaveAfe} data-testid="button-save-afe"><Save className="w-4 h-4" /></button>
                  <button className="text-muted-foreground hover:text-foreground" onClick={() => setEditingAfe(false)} data-testid="button-cancel-afe"><X className="w-4 h-4" /></button>
                </div>
              )}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">{t("siteLocations.coordinatesLabel")}</span>
                {!editingCoords ? (
                  <>
                    <span className="text-sm">{site.latitude.toFixed(4)}, {site.longitude.toFixed(4)}</span>
                    {canManageAssignments && (
                      <button onClick={() => { setEditLat(String(site.latitude)); setEditLng(String(site.longitude)); setEditingCoords(true); }} data-testid="button-edit-coords">
                        <Pencil className="w-3.5 h-3.5 text-muted-foreground hover:text-[var(--brand-primary)] transition-colors" />
                      </button>
                    )}
                  </>
                ) : (
                  <div className="flex flex-wrap items-center gap-2">
                    <Input type="number" step="any" value={editLat} onChange={(e) => setEditLat(e.target.value)} className="w-28 h-7 text-xs" placeholder={t("siteLocations.latitude")} data-testid="input-edit-lat" />
                    <Input type="number" step="any" value={editLng} onChange={(e) => setEditLng(e.target.value)} className="w-28 h-7 text-xs" placeholder={t("siteLocations.longitude")} data-testid="input-edit-lng" />
                    <BrandPillButton
                      type="button"

                      onClick={handleUseCurrentLocation}
                      disabled={geoLocating}
                      data-testid="button-use-current-location"
                    >
                      <LocateFixed className="w-4 h-4" />
                      {geoLocating
                        ? t("siteLocations.locating", { defaultValue: "Locating..." })
                        : t("siteLocations.useCurrentLocation", { defaultValue: "Use my current location" })}
                    </BrandPillButton>
                    <button className="text-green-600 hover:text-green-700" onClick={handleSaveCoords} data-testid="button-save-coords"><Save className="w-4 h-4" /></button>
                    <button className="text-muted-foreground hover:text-foreground" onClick={() => setEditingCoords(false)} data-testid="button-cancel-coords"><X className="w-4 h-4" /></button>
                  </div>
                )}
              </div>
              {!editingCoords && canManageAssignments ? (
                <div className="mt-1">
                  <BrandPillButton
                    type="button"

                    onClick={handleUseCurrentLocation}
                    disabled={geoLocating}
                    data-testid="button-use-current-location-shortcut"
                  >
                    <LocateFixed className="w-4 h-4" />
                    {geoLocating
                      ? t("siteLocations.locating", { defaultValue: "Locating..." })
                      : t("siteLocations.useCurrentLocation", { defaultValue: "Use my current location" })}
                  </BrandPillButton>
                </div>
              ) : null}
            </div>
            <div>
              <div className="flex items-center gap-2" data-testid="row-geofence-radius">
                <span className="text-sm text-muted-foreground">
                  {t("siteLocations.radiusLabel", { defaultValue: "Geofence radius" })}
                </span>
                {!editingRadius ? (
                  <>
                    <span className="text-sm" data-testid="text-radius-value">
                      {site.siteRadiusMeters
                        ? t("siteLocations.radiusMeters", {
                            defaultValue: "{{meters}} m",
                            meters: site.siteRadiusMeters,
                          })
                        : t("siteLocations.radiusDefault", { defaultValue: "Default" })}
                    </span>
                    {canManageAssignments && (
                      <button
                        onClick={() => {
                          setEditRadius(site.siteRadiusMeters ? String(site.siteRadiusMeters) : "");
                          setEditingRadius(true);
                        }}
                        data-testid="button-edit-radius"
                      >
                        <Pencil className="w-3.5 h-3.5 text-muted-foreground hover:text-[var(--brand-primary)] transition-colors" />
                      </button>
                    )}
                  </>
                ) : (
                  <div className="flex items-center gap-2">
                    <Input
                      type="number"
                      min="1"
                      max="10000"
                      step="1"
                      value={editRadius}
                      onChange={(e) => setEditRadius(e.target.value)}
                      className="w-28 h-7 text-xs"
                      placeholder={t("siteLocations.radiusPlaceholder", { defaultValue: "e.g. 250" })}
                      data-testid="input-edit-radius"
                    />
                    <button
                      className="text-green-600 hover:text-green-700"
                      onClick={handleSaveRadius}
                      disabled={updateSite.isPending}
                      data-testid="button-save-radius"
                    >
                      <Save className="w-4 h-4" />
                    </button>
                    <button
                      className="text-muted-foreground hover:text-foreground"
                      onClick={() => setEditingRadius(false)}
                      data-testid="button-cancel-radius"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                )}
              </div>
              {editingRadius ? (
                <p className="text-xs text-muted-foreground mt-1">
                  {t("siteLocations.radiusHelp", {
                    defaultValue:
                      "Vendors must be within this many meters of the site to check in. Leave blank to use the system default.",
                  })}
                </p>
              ) : null}
            </div>
            <div className="flex items-center gap-2" ref={statusRef}>
              <span className="text-sm text-muted-foreground">{t("siteLocations.statusLabel")}</span>
              {canManageAssignments ? (
                <div className="relative">
                  <div className="cursor-pointer flex items-center gap-1" onClick={() => setStatusOpen(!statusOpen)} data-testid="button-status-dropdown">
                    <StatusBadge status={site.status} className="w-[100px] justify-center" />
                    <ChevronDown className="w-4 h-4 text-muted-foreground" />
                  </div>
                  {statusOpen && (
                    <div className="absolute left-0 top-[32px] z-50 bg-white border rounded-lg shadow-lg p-2 space-y-1">
                      {(Object.values(SiteLocationStatus) as SiteLocationStatusType[]).map((s) => (
                        <div key={s} className="cursor-pointer" onClick={() => handleStatusChange(s)} data-testid={`status-option-${s}`}>
                          <StatusBadge status={s} className="w-[100px] justify-center" />
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <StatusBadge status={site.status} className="w-[100px] justify-center" />
              )}
            </div>
            <div className="pt-2">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-muted-foreground">{t("siteLocations.locationLabel")}</span>
                <a
                  href={`https://www.google.com/maps/dir/?api=1&destination=${site.latitude},${site.longitude}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs font-medium hover:opacity-80 transition-opacity"
                  style={iconStyle}
                  data-testid="link-directions"
                >
                  {t("siteLocations.getDirections")}
                </a>
              </div>
              {/* Site Info map preview — locked to a 4:3 rectangle
                  (height = 3/4 of width) and defaults to satellite
                  imagery so the wellhead reads as a real-world place
                  rather than a road map. Read-only: marker is not
                  draggable here; geofence radius circle is rendered
                  when the site has one configured. */}
              <SiteLocationMap
                lat={site.latitude}
                lng={site.longitude}
                radiusMeters={site.siteRadiusMeters ?? null}
                aspectRatio="4 / 3"
                tileLayer="satellite"
                draggable={false}
              />
            </div>
          </CardContent>
          {isAdmin && site.hidden && (
            <div className="px-6 pt-2 pb-2">
              <div
                className="rounded-md border border-amber-300 bg-amber-50 p-3 space-y-2"
                data-testid="panel-hidden-site"
              >
                <div className="flex items-start gap-2">
                  <Info className="w-4 h-4 text-amber-600 mt-0.5 flex-shrink-0" />
                  <div className="text-sm">
                    <p className="font-medium text-amber-900" data-testid="text-hidden-banner">{t("siteLocations.hiddenBannerTitle")}</p>
                    <p className="text-xs text-amber-800 mt-1">
                      {site.supersededAt
                        ? t("siteLocations.hiddenBannerSupersededDesc", { date: new Date(site.supersededAt).toLocaleDateString() })
                        : t("siteLocations.hiddenBannerDesc")}
                    </p>
                  </div>
                </div>
                <TogglePillButton color="blue"
                  className="w-full"
                  onClick={handleUnhide}
                  disabled={updateSite.isPending}
                  data-testid="button-unhide-site"
                >
                  {updateSite.isPending ? t("siteLocations.unhiding") : t("siteLocations.unhideSite")}
                </TogglePillButton>
              </div>
            </div>
          )}
          {canRemove && (
            <div className="px-6 pb-6">
              <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
                <DialogTrigger asChild>
                  <TogglePillButton color="red" className="w-full px-2" data-testid="button-remove-site"><Trash2 className="w-4 h-4" />{t("siteLocations.removeSite")}</TogglePillButton>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader><DialogTitle>{t("siteLocations.removeSiteTitle")}</DialogTitle></DialogHeader>
                  <p className="text-sm text-muted-foreground">{t("siteLocations.removeSiteConfirmPrefix")} <strong>{site.name}</strong>{t("siteLocations.removeSiteConfirmSuffix")}</p>
                  <div className="flex gap-3 justify-end mt-4">
                    <PillButton color="red" onClick={() => setDeleteOpen(false)}>{t("common.cancel")}</PillButton>
                    <TogglePillButton color="red" onClick={handleDeleteSite} data-testid="button-confirm-remove">{deleteSite.isPending ? t("siteLocations.removing") : t("siteLocations.removeSite")}</TogglePillButton>
                  </div>
                </DialogContent>
              </Dialog>
            </div>
          )}
        </Card>

        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><QrCode className="w-5 h-5" style={iconStyle} />{t("siteLocations.qrCode")}</CardTitle></CardHeader>
          <CardContent className="flex flex-col items-center">
            {qrData ? (
              <>
                <img src={qrData.qrCodeUrl} alt={t("siteLocations.siteQrAlt")} className="w-48 h-48 border rounded" data-testid="img-qr-code" />
                <p className="text-xs text-muted-foreground mt-2">{t("siteLocations.portalLabel")} {qrData.portalUrl}</p>
              </>
            ) : (
              <Skeleton className="w-48 h-48" />
            )}
            <BrandPillButton
              className="mt-4"
              onClick={() => window.open(`${import.meta.env.BASE_URL}print-visitor-qr/${id}`, "_blank")}
              data-testid="button-print-visitor-qr"
            >
              <Printer className="w-4 h-4" />{t("siteLocations.printVisitorQr")}
            </BrandPillButton>

            <div className="w-full mt-6 pt-4 border-t">
              <div className="flex items-center gap-2 mb-3">
                <Users className="w-4 h-4" style={iconStyle} />
                <h4 className="text-sm font-semibold">{t("siteLocations.recentVisitorsTitle")}</h4>
              </div>
              {siteVisits === undefined ? (
                <div className="space-y-2">
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                </div>
              ) : siteVisits.length === 0 ? (
                <p className="text-xs text-muted-foreground" data-testid="text-no-recent-visitors">{t("siteLocations.noRecentVisitors")}</p>
              ) : (
                <ul className="space-y-2" data-testid="list-recent-visitors">
                  {siteVisits.slice(0, 5).map((v) => {
                    const checkIn = new Date(v.checkInTime);
                    const checkOut = v.checkOutTime ? new Date(v.checkOutTime) : null;
                    const durationMin = checkOut ? Math.max(0, Math.round((checkOut.getTime() - checkIn.getTime()) / 60000)) : null;
                    const dateStr = checkIn.toLocaleDateString();
                    const inStr = checkIn.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
                    const outStr = checkOut ? checkOut.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : null;
                    const durStr = durationMin == null
                      ? null
                      : durationMin >= 60
                        ? `${Math.floor(durationMin / 60)}h ${durationMin % 60}m`
                        : `${durationMin}m`;
                    return (
                      <li key={v.id}>
                        <button
                          type="button"
                          className="w-full text-left flex flex-col gap-1 p-2 rounded border hover:bg-muted/40 focus:outline-none focus:ring-2 focus:ring-ring"
                          onClick={() => navigate(`/visits/${v.id}`)}
                          data-testid={`recent-visitor-${v.id}`}
                        >
                          <span className="flex items-center justify-between gap-2">
                            <span className="text-sm font-medium truncate">{v.firstName} {v.lastName}</span>
                            <Badge variant="outline" className="text-[10px] capitalize shrink-0">{v.hostType}</Badge>
                          </span>
                          <span className="block text-xs text-muted-foreground">
                            {dateStr} · {inStr}
                            {outStr ? ` → ${outStr}` : ` · ${t("siteLocations.visitorActive")}`}
                            {durStr ? ` · ${durStr}` : ""}
                          </span>
                          {v.purpose && (
                            <span className="block text-xs truncate" title={v.purpose}>{v.purpose}</span>
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
              <BrandPillButton
                className="mt-3 w-full justify-center"
                onClick={() => navigate(`/visitors?siteLocationId=${id}`)}
                data-testid="button-view-full-visitors-log"
              >
                {t("siteLocations.viewFullVisitorsLog")}<ArrowRight className="w-4 h-4" />
              </BrandPillButton>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2"><Briefcase className="w-5 h-5" style={iconStyle} />{t("siteLocations.workAssignmentsCount", { count: isVendor && user?.vendorId ? (site.assignments ?? []).filter((a: any) => a.vendorId === user.vendorId).length : (site.assignments?.length ?? 0) })}</CardTitle>
          <div className="flex items-center gap-2">
            <Dialog open={expandOpen} onOpenChange={setExpandOpen}>
              <DialogTrigger asChild>
                <BrandPillButton tone="blue" onClick={handleOpenExpand} data-testid="button-expand-catalog"><ListChecks className="w-4 h-4" />{t("siteLocations.expandCatalog")}</BrandPillButton>
              </DialogTrigger>
              <DialogContent className="max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
                <DialogHeader>
                  <DialogTitle>{t("siteLocations.expandCatalog")}</DialogTitle>
                  <p className="text-sm text-muted-foreground">
                    {isVendor
                      ? t("siteLocations.expandCatalogVendorIntro")
                      : t("siteLocations.expandCatalogAdminIntro")}
                  </p>
                </DialogHeader>
                {!isVendor && (
                  <div>
                    <Label>{t("siteLocations.vendor")}</Label>
                    <Select value={expandVendorId} onValueChange={handleExpandVendorChange}>
                      <SelectTrigger data-testid="select-expand-vendor"><SelectValue placeholder={t("siteLocations.selectVendor")} /></SelectTrigger>
                      <SelectContent>
                        {vendors?.map((v) => <SelectItem key={v.id} value={String(v.id)}>{v.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                )}
                <div className="flex-1 overflow-y-auto space-y-4 pr-2">
                  {(() => {
                    const targetVendorId = isVendor && user?.vendorId ? user.vendorId : (expandVendorId ? parseInt(expandVendorId) : null);
                    const existingIds = new Set(
                      (site.assignments ?? []).filter((a: any) => a.vendorId === targetVendorId).map((a: any) => a.workTypeId),
                    );
                    const grouped: Record<string, typeof workTypes> = {};
                    (workTypes ?? []).forEach((wt) => {
                      const cat = wt.category || "Other";
                      if (!grouped[cat]) grouped[cat] = [];
                      grouped[cat]!.push(wt);
                    });
                    const categories = Object.keys(grouped).sort();
                    if (!targetVendorId && !isVendor) {
                      return <p className="text-sm text-muted-foreground py-4 text-center">{t("siteLocations.selectVendorPrompt")}</p>;
                    }
                    return categories.map((cat) => (
                      <div key={cat}>
                        {/* Category header + row hover use the active brand
                            primary color (CSS var set globally by useBrand)
                            so partner-branded, vendor-branded, and the
                            platform default all share the same accent
                            instead of a hard-coded amber. */}
                        <h4
                          className="text-xs font-bold uppercase tracking-wide mb-2"
                          style={{ color: brand.primary }}
                        >
                          {cat}
                        </h4>
                        <div className="space-y-2 pl-1">
                          {grouped[cat]!.map((wt) => {
                            const alreadyAssigned = existingIds.has(wt.id);
                            const checked = expandChecked.has(wt.id);
                            return (
                              <label
                                key={wt.id}
                                className={`flex items-center gap-2 text-sm py-1 ${alreadyAssigned ? "text-muted-foreground" : "cursor-pointer hover:text-[var(--brand-primary)]"}`}
                                data-testid={`row-expand-worktype-${wt.id}`}
                              >
                                <Checkbox
                                  checked={checked}
                                  disabled={alreadyAssigned}
                                  onCheckedChange={() => toggleExpandCheck(wt.id, alreadyAssigned)}
                                  data-testid={`checkbox-worktype-${wt.id}`}
                                />
                                <span>{wt.name}</span>
                                {alreadyAssigned && <span className="text-xs text-muted-foreground">{t("siteLocations.alreadyAssigned")}</span>}
                              </label>
                            );
                          })}
                        </div>
                      </div>
                    ));
                  })()}
                </div>
                <div className="flex gap-8 justify-end pt-3 border-t">
                  <LightGreyRedButton onClick={() => setExpandOpen(false)} data-testid="button-cancel-expand">{t("common.cancel")}</LightGreyRedButton>
                  {expandDirty ? (
                    <TogglePillButton color="green" onClick={handleSaveExpand} disabled={expandSaving} data-testid="button-save-expand">{expandSaving ? t("siteLocations.saving") : t("siteLocations.save")}</TogglePillButton>
                  ) : (
                    <TogglePillButton color="blue" onClick={handleSaveExpand} disabled={expandSaving} data-testid="button-save-expand">{expandSaving ? t("siteLocations.saving") : t("siteLocations.save")}</TogglePillButton>
                  )}
                </div>
              </DialogContent>
            </Dialog>
            {canManageAssignments && (
              <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild>
                <BrandPillButton tone="blue" data-testid="button-add-assignment"><Plus className="w-4 h-4" />{t("common.add", { defaultValue: "Add" })}</BrandPillButton>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>{t("siteLocations.addAssignmentTitle")}</DialogTitle></DialogHeader>
                <form onSubmit={handleAddAssignment} className="space-y-4">
                  <div>
                    <Label>{t("siteLocations.workType")}</Label>
                    <Select value={form.workTypeId} onValueChange={(v) => setForm({ ...form, workTypeId: v })}>
                      <SelectTrigger data-testid="select-work-type"><SelectValue placeholder={t("siteLocations.selectWorkType")} /></SelectTrigger>
                      <SelectContent>
                        {workTypes?.map((wt) => <SelectItem key={wt.id} value={String(wt.id)}>{wt.category} - {wt.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>{t("siteLocations.vendor")}</Label>
                    <Select value={form.vendorId} onValueChange={(v) => setForm({ ...form, vendorId: v })}>
                      <SelectTrigger data-testid="select-vendor"><SelectValue placeholder={t("siteLocations.selectVendor")} /></SelectTrigger>
                      <SelectContent>
                        {vendors?.map((v) => <SelectItem key={v.id} value={String(v.id)}>{v.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>{t("siteLocations.afeOptional")}</Label>
                    <Input
                      value={form.afe}
                      onChange={(e) => setForm({ ...form, afe: e.target.value })}
                      placeholder={t("siteLocations.afePlaceholder")}
                      data-testid="input-add-assignment-afe"
                    />
                  </div>
                  <TogglePillButton color="blue" type="submit" disabled={createAssignment.isPending} data-testid="button-submit-assignment" className="w-full">{createAssignment.isPending ? t("siteLocations.addingAssignment") : t("siteLocations.addAssignment")}</TogglePillButton>
                </form>
              </DialogContent>
            </Dialog>
            )}
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {(() => {
            const filteredAssignments = isVendor && user?.vendorId
              ? (site.assignments ?? []).filter((a: any) => a.vendorId === user.vendorId)
              : (site.assignments ?? []);
            return filteredAssignments.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("siteLocations.phaseOfWork")}</TableHead>
                    <TableHead>{t("siteLocations.workType")}</TableHead>
                    {!isVendor && <TableHead>{t("siteLocations.vendor")}</TableHead>}
                    <TableHead>{t("siteLocations.afeColumn")}</TableHead>
                    {canManageAssignments && <TableHead></TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredAssignments.map((a: any) => (
                    <TableRow key={a.id} data-testid={`row-assignment-${a.id}`}>
                      <TableCell><span className="text-sm text-muted-foreground">{a.workTypeCategory}</span></TableCell>
                      <TableCell><span className="font-medium">{a.workTypeName}</span></TableCell>
                      {!isVendor && <TableCell>{a.vendorName}</TableCell>}
                      <TableCell>
                        {editingAssignmentAfeId === a.id ? (
                          <div className="flex items-center gap-1">
                            <Input
                              value={editAssignmentAfe}
                              onChange={(e) => setEditAssignmentAfe(e.target.value)}
                              className="w-40 h-7 text-xs"
                              placeholder={t("siteLocations.afePlaceholder")}
                              data-testid={`input-edit-assignment-afe-${a.id}`}
                            />
                            <button className="text-green-600 hover:text-green-700" onClick={() => handleSaveAssignmentAfe(a.id)} data-testid={`button-save-assignment-afe-${a.id}`}><Save className="w-4 h-4" /></button>
                            <button className="text-muted-foreground hover:text-foreground" onClick={() => setEditingAssignmentAfeId(null)} data-testid={`button-cancel-assignment-afe-${a.id}`}><X className="w-4 h-4" /></button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2">
                            {a.afe ? (
                              <AfePill data-testid={`text-assignment-afe-${a.id}`}>{a.afe}</AfePill>
                            ) : (
                              <span className="text-xs italic text-muted-foreground" data-testid={`text-assignment-afe-empty-${a.id}`}>{t("siteLocations.afeNotSet")}</span>
                            )}
                            {canManageAssignments && (
                              <button
                                onClick={() => { setEditAssignmentAfe(a.afe ?? ""); setEditingAssignmentAfeId(a.id); }}
                                data-testid={`button-edit-assignment-afe-${a.id}`}
                              >
                                <Pencil className="w-3.5 h-3.5 text-muted-foreground hover:text-[var(--brand-primary)] transition-colors" />
                              </button>
                            )}
                          </div>
                        )}
                      </TableCell>
                      {canManageAssignments && (
                        <TableCell>
                          <PillButton color="image" className="min-w-[28px] px-0" onClick={() => handleDeleteAssignment(a.id)} data-testid={`button-delete-assignment-${a.id}`}>
                            <Trash2 className="w-4 h-4 text-muted-foreground hover:text-destructive transition-colors" />
                          </PillButton>
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <div className="p-6 space-y-3">
                {canManageAssignments && (
                  <div
                    className="rounded-md border border-blue-300 bg-blue-50 p-3 text-sm text-blue-900"
                    data-testid="banner-no-vendors-assigned"
                  >
                    {t("siteLocations.noVendorsAssignedBanner")}
                  </div>
                )}
                <div className="text-center text-muted-foreground text-sm">{t("siteLocations.noWorkAssignments")}</div>
              </div>
            );
          })()}
        </CardContent>
      </Card>

      {/* Direct Partner→Vendor work offers — partner picks a vendor + date
          range + scope and the vendor responds Commit / Pass. Surfaced for
          partner & admin (create + cancel) and vendor (read-only their
          row). Hidden for unrelated viewers. */}
      {/* Direct work offers section: partner/admin only. Vendors view
          their pending offers from the Dashboard, not from this page —
          the per-site GET endpoint is partner-scoped, so showing it
          here for vendors would just produce a 403. */}
      {canManageAssignments && (
        <Card data-testid="card-direct-assignments">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <Send className="w-5 h-5" style={iconStyle} />
              {t("directAssignment.sectionTitle")}
            </CardTitle>
            {canManageAssignments && (
              <Dialog open={directOpen} onOpenChange={setDirectOpen}>
                <DialogTrigger asChild>
                  <TogglePillButton color="blue" className="px-2" data-testid="button-add-direct-assignment">
                    <Plus className="w-4 h-4" />
                    {t("directAssignment.addButton")}
                  </TogglePillButton>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>{t("directAssignment.addDialogTitle")}</DialogTitle>
                  </DialogHeader>
                  <form onSubmit={handleSubmitDirectAssignment} className="space-y-4">
                    <div>
                      <Label>{t("directAssignment.vendorLabel")}</Label>
                      <Select
                        value={directForm.vendorId}
                        onValueChange={(v) => setDirectForm({ ...directForm, vendorId: v })}
                      >
                        <SelectTrigger data-testid="select-direct-vendor">
                          <SelectValue placeholder={t("siteLocations.selectVendor")} />
                        </SelectTrigger>
                        <SelectContent>
                          {vendors?.map((v) => (
                            <SelectItem key={v.id} value={String(v.id)}>{v.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Label>{t("directAssignment.startDateLabel")}</Label>
                        <Input
                          type="date"
                          value={directForm.startDate}
                          onChange={(e) => setDirectForm({ ...directForm, startDate: e.target.value })}
                          data-testid="input-direct-start-date"
                        />
                      </div>
                      <div>
                        <Label>{t("directAssignment.endDateLabel")}</Label>
                        <Input
                          type="date"
                          value={directForm.endDate}
                          onChange={(e) => setDirectForm({ ...directForm, endDate: e.target.value })}
                          data-testid="input-direct-end-date"
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Label>{t("directAssignment.priceLabel")}</Label>
                        <div className="relative">
                          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground pointer-events-none">$</span>
                          <Input
                            type="text"
                            inputMode="decimal"
                            className="pl-6"
                            value={directForm.price}
                            onChange={(e) => setDirectForm({ ...directForm, price: e.target.value })}
                            placeholder={t("directAssignment.pricePlaceholder")}
                            data-testid="input-direct-price"
                          />
                        </div>
                      </div>
                      <div>
                        <Label>{t("directAssignment.crewSizeLabel")}</Label>
                        <Input
                          type="number"
                          min={1}
                          value={directForm.crewSize}
                          onChange={(e) => setDirectForm({ ...directForm, crewSize: e.target.value })}
                          placeholder={t("directAssignment.crewSizePlaceholder")}
                          data-testid="input-direct-crew-size"
                        />
                      </div>
                    </div>
                    <div>
                      <Label>{t("directAssignment.priorityLabel")}</Label>
                      <Select
                        value={directForm.priority}
                        onValueChange={(v) => setDirectForm({ ...directForm, priority: v as "low" | "normal" | "high" })}
                      >
                        <SelectTrigger data-testid="select-direct-priority">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="low">{t("directAssignment.priorityLow")}</SelectItem>
                          <SelectItem value="normal">{t("directAssignment.priorityNormal")}</SelectItem>
                          <SelectItem value="high">{t("directAssignment.priorityHigh")}</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label>{t("directAssignment.scopeLabel")}</Label>
                      <textarea
                        className="w-full min-h-[96px] rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        value={directForm.scopeOfWork}
                        onChange={(e) => setDirectForm({ ...directForm, scopeOfWork: e.target.value })}
                        placeholder={t("directAssignment.scopePlaceholder")}
                        data-testid="textarea-direct-scope"
                      />
                    </div>
                    <TogglePillButton
                      color="blue"
                      type="submit"

                      className="w-full px-2"
                      disabled={createDirectAssignment.isPending}
                      data-testid="button-submit-direct-assignment"
                    >
                      {createDirectAssignment.isPending
                        ? t("directAssignment.sending")
                        : t("directAssignment.sendOffer")}
                    </TogglePillButton>
                  </form>
                </DialogContent>
              </Dialog>
            )}
          </CardHeader>
          <CardContent className="p-0">
            {directAssignmentsQuery.isLoading ? (
              <div className="p-6"><Skeleton className="h-24 w-full" /></div>
            ) : (directAssignmentsQuery.data ?? []).length === 0 ? (
              <div className="p-6 text-center text-muted-foreground text-sm">
                {t("directAssignment.empty")}
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("directAssignment.vendorCol")}</TableHead>
                    <TableHead>{t("directAssignment.datesCol")}</TableHead>
                    <TableHead>{t("directAssignment.scopeCol")}</TableHead>
                    <TableHead>{t("directAssignment.statusCol")}</TableHead>
                    {canManageAssignments && <TableHead></TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(directAssignmentsQuery.data ?? []).map((a) => {
                    const statusToneByStatus: Record<string, "amber" | "green" | "red"> = {
                      pending: "amber",
                      committed: "green",
                      passed: "red",
                    };
                    const statusTone = statusToneByStatus[a.status];
                    return (
                      <TableRow key={a.id} data-testid={`row-direct-assignment-${a.id}`}>
                        <TableCell className="font-medium">{a.vendorName}</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1 text-sm text-muted-foreground">
                            <CalendarDays className="w-3.5 h-3.5" />
                            <span>{a.startDate} → {a.endDate}</span>
                          </div>
                        </TableCell>
                        <TableCell className="max-w-xs">
                          <span className="text-sm">
                            {a.scopeOfWork
                              ? a.scopeOfWork
                              : <span className="italic text-muted-foreground">{t("directAssignment.noScope")}</span>}
                          </span>
                          {a.status === "passed" && a.passReason && (
                            <div className="mt-1 text-xs text-red-700">
                              {t("directAssignment.passReasonPrefix")}: {a.passReason}
                            </div>
                          )}
                        </TableCell>
                        <TableCell>
                          {statusTone ? (
                            <TogglePill color={statusTone} className="min-w-[90px]" data-testid={`badge-direct-status-${a.id}`}>
                              {t(`directAssignment.status.${a.status}`)}
                            </TogglePill>
                          ) : (
                            <TogglePill rest className="min-w-[90px]" data-testid={`badge-direct-status-${a.id}`}>
                              {t(`directAssignment.status.${a.status}`)}
                            </TogglePill>
                          )}
                        </TableCell>
                        {canManageAssignments && (
                          <TableCell className="text-right">
                            {a.status === "pending" && (
                              <PillButton
                                color="image"
                                className="min-w-[28px] px-0"
                                onClick={() => setCancelDirectId(a.id)}
                                data-testid={`button-cancel-direct-${a.id}`}
                              >
                                <X className="w-4 h-4 text-muted-foreground hover:text-destructive transition-colors" />
                              </PillButton>
                            )}
                          </TableCell>
                        )}
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}

      <Card data-testid="card-recent-activity">
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Clock className="w-5 h-5" style={iconStyle} />{t("siteLocations.recentActivityTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {ticketsLoading ? (
            <div className="p-6"><Skeleton className="h-32 w-full" /></div>
          ) : siteTickets && siteTickets.length > 0 ? (() => {
            const vendorFiltered = isVendor && user?.vendorId
              ? siteTickets.filter((t) => t.vendorId === user.vendorId)
              : siteTickets;
            if (vendorFiltered.length === 0) return <div className="p-6 text-center text-muted-foreground text-sm">{t("siteLocations.noRecentActivity")}</div>;
            const recent = [...vendorFiltered].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).slice(0, 10);
            const dir = recentSortDir === "asc" ? 1 : -1;
            const sorted = [...recent].sort((a, b) => {
              switch (recentSortKey) {
                case "tracking": return (a.id - b.id) * dir;
                case "workType": return (a.workTypeName || "").localeCompare(b.workTypeName || "") * dir;
                case "employee": return (a.fieldEmployeeName || "").localeCompare(b.fieldEmployeeName || "") * dir;
                case "status": return (a.status || "").localeCompare(b.status || "") * dir;
                case "date": return (new Date(a.updatedAt ?? a.createdAt).getTime() - new Date(b.updatedAt ?? b.createdAt).getTime()) * dir;
                default: return 0;
              }
            });
            const grouped: Record<string, typeof sorted> = {};
            sorted.forEach((t) => {
              const key = t.vendorName ?? "__UNKNOWN_VENDOR__";
              if (!grouped[key]) grouped[key] = [];
              grouped[key].push(t);
            });
            return (
              <div className="divide-y">
                {Object.entries(grouped).map(([vendorName, tickets]) => (
                  <div key={vendorName} className="px-6 py-4">
                    <h3 className="font-semibold text-sm mb-3">{vendorName === "__UNKNOWN_VENDOR__" ? t("siteLocations.unknownVendor") : vendorName}</h3>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <RecentSortableHead label={t("siteLocations.vndrlyTrackingCol")} column="tracking" />
                          <RecentSortableHead label={t("siteLocations.workType")} column="workType" />
                          <RecentSortableHead label={t("siteLocations.fieldEmployeeCol")} column="employee" />
                          <RecentSortableHead label={t("siteLocations.statusLabel").replace(":", "")} column="status" />
                          <RecentSortableHead label={t("siteLocations.dateCol")} column="date" />
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {tickets.map((t) => (
                          <TableRow key={t.id} className="cursor-pointer hover:bg-muted/50" onClick={() => navigate(`/tickets/${t.id}`)} data-testid={`row-recent-ticket-${t.id}`}>
                            <TableCell>
                              <div className="flex items-center gap-2">
                                <FileText className="w-4 h-4" style={iconStyle} />
                                #{String(t.id).padStart(8, '0')}
                              </div>
                            </TableCell>
                            <TableCell>{t.workTypeName}</TableCell>
                            <TableCell>{t.fieldEmployeeName || "-"}</TableCell>
                            <TableCell><TicketStatusTogglePill status={t.status} updatedAt={t.updatedAt ?? t.createdAt} className="min-w-[90px]" /></TableCell>
                            <TableCell className="text-sm text-muted-foreground">{new Date(t.updatedAt ?? t.createdAt).toLocaleDateString()}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                ))}
              </div>
            );
          })() : (
            <div className="p-6 text-center text-muted-foreground text-sm">{t("siteLocations.noRecentActivity")}</div>
          )}
        </CardContent>
      </Card>

      <AlertDialog
        open={cancelDirectId !== null}
        onOpenChange={(o) => {
          if (!o) setCancelDirectId(null);
        }}
      >
        <AlertDialogContent data-testid="dialog-cancel-direct-assignment">
          <AlertDialogHeader>
            <AlertDialogTitle>{t("directAssignment.cancelConfirmTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("directAssignment.cancelConfirmDesc")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              disabled={cancelDirectAssignment.isPending}
              data-testid="button-cancel-direct-back"
            >
              {t("common.back")}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                if (cancelDirectId !== null) handleCancelDirectAssignment(cancelDirectId);
              }}
              disabled={cancelDirectAssignment.isPending}
              data-testid="button-cancel-direct-confirm"
            >
              {cancelDirectAssignment.isPending
                ? t("directAssignment.cancelling")
                : t("directAssignment.confirmCancel")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={!!catalogConflict}
        onOpenChange={(o) => {
          if (!o) setCatalogConflict(null);
        }}
      >
        <AlertDialogContent data-testid="dialog-catalog-conflict">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("siteLocations.catalogConflictTitle", {
                defaultValue: "Add to vendor's services?",
              })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {catalogConflict
                ? t("siteLocations.catalogConflictDesc", {
                    defaultValue:
                      "{{vendor}} doesn't currently list \"{{workType}}\" in their services. Add it to their catalog so this assignment can be created? You can set pricing later from the vendor profile.",
                    vendor: catalogConflict.vendorName || `Vendor ${catalogConflict.vendorId}`,
                    workType: catalogConflict.workTypeName || `#${catalogConflict.workTypeId}`,
                  })
                : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              disabled={catalogConfirmSaving}
              data-testid="button-cancel-catalog-add"
            >
              {t("common.cancel", { defaultValue: "Cancel" })}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void handleConfirmCatalogAdd();
              }}
              disabled={catalogConfirmSaving}
              data-testid="button-confirm-catalog-add"
            >
              {catalogConfirmSaving
                ? t("siteLocations.catalogAdding", { defaultValue: "Adding..." })
                : t("siteLocations.catalogAddConfirm", {
                    defaultValue: "Add and continue",
                  })}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
