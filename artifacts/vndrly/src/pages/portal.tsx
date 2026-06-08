import { useState, useEffect, useCallback, useRef } from "react";
import {
  useGetPortalInfo,
  useGetPortalOpenTickets,
  useCreateTicket,
  useCheckInTicket,
  useCheckOutTicket,
  useGetTicket,
  useUpdateTicket,
  useGetTicketNoteLogs,
  useCreateTicketNoteLog,
  useGetTicketLineItems,
  getGetPortalInfoQueryKey,
  getGetPortalOpenTicketsQueryKey,
  getGetTicketQueryKey,
  getGetTicketNoteLogsQueryKey,
  getGetTicketLineItemsQueryKey,
} from "@workspace/api-client-react";
import {
  useEligibleVendorFieldEmployeesByVendorId,
  useClearStaleFieldEmployeeSelection,
} from "@/hooks/use-eligible-vendor-field-employees";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import TicketStatusBadge from "@/components/ticket-status-badge";
import TicketStatusStepper from "@/components/ticket-status-stepper";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import DarkLightToggle, { type ThemeMode } from "@/components/dark-light-toggle";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { MapPin, Plus, ArrowRight, Navigation, CheckCircle2, Clock, AlertTriangle, User, FileText, ClipboardList, Save, ChevronDown, DollarSign } from "lucide-react";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import SphereBackButton from "@/components/sphere-back-button";
import { VNDRLY_LOGO_SQUARE as vndrlyLogo } from "@/lib/vndrly-brand-assets";
import sidebarBg from "@assets/VNDRLY_Header_Blur_4_1776220762025.png";
import GreyButton from "@/components/grey-button";
import PortalButton from "@/components/portal-button";
import { PngPillButton } from "@/components/png-pill-rollover";
import AfePill from "@/components/afe-pill";
import {
  DEFAULT_BRAND_PRIMARY,
  DEFAULT_BRAND_ACCENT,
  brandStyleVars,
  type Brand,
} from "@/hooks/use-brand";

interface GpsCoords {
  latitude: number;
  longitude: number;
}

const statusLabels: Record<string, string> = {
  draft: "Draft",
  in_progress: "In Progress",
  pending_review: "Pending Review",
  completed: "Completed",
  submitted: "Submitted",
  kicked_back: "Kicked Back",
  awaiting_payment: "Awaiting Payment",
  funds_dispersed: "Funds Dispersed",
};

// Task #158: derive a partner brand from the portal payload so the QR
// landing reflects the SITE owner's branding regardless of which org the
// signed-in field employee belongs to. We can't lean on `useBrand` here
// because that hook is keyed on the viewer's auth org (typically the
// vendor) — at the portal we want the partner's chrome, not the vendor's.
// Falls back gracefully to the VNDRLY default when the partner has no
// brand assets configured. `partnerBrand` may be null when the site has
// no partner assigned at all (defensive — the schema requires partnerId
// today but a relaxed migration in the future could allow nulls).
function partnerBrandToBrand(
  partnerBrand: { brandPrimaryColor: string | null; brandAccentColor: string | null; logoUrl: string | null; logoSquareUrl: string | null; name: string } | null,
): Brand {
  if (!partnerBrand) {
    return {
      primary: DEFAULT_BRAND_PRIMARY,
      accent: DEFAULT_BRAND_ACCENT,
      logoUrl: null,
      logoSquareUrl: null,
      name: null,
      isOrgBranded: false,
    };
  }
  const primary = partnerBrand.brandPrimaryColor || DEFAULT_BRAND_PRIMARY;
  const accent = partnerBrand.brandAccentColor || primary;
  const logoUrl = partnerBrand.logoUrl?.trim() || null;
  const logoSquareUrl = partnerBrand.logoSquareUrl?.trim() || null;
  return {
    primary,
    accent,
    logoUrl,
    logoSquareUrl,
    name: partnerBrand.name || null,
    isOrgBranded: !!(partnerBrand.brandPrimaryColor || logoUrl || logoSquareUrl),
  };
}

export default function Portal({ siteCode }: { siteCode: string }) {
  const { data: portal, isLoading } = useGetPortalInfo(siteCode, { query: { enabled: !!siteCode, queryKey: getGetPortalInfoQueryKey(siteCode) } });
  const partnerBrand = partnerBrandToBrand(portal?.partnerBrand ?? null);
  const partnerBrandStyle = brandStyleVars(partnerBrand);
  const partnerHeaderLogo = partnerBrand.logoSquareUrl ?? partnerBrand.logoUrl;
  const [selectedVendorId, setSelectedVendorId] = useState<string>("");
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string>("");
  // Pill-family login selectors: wire up open state + click-outside
  // for the vendor/employee PngPillButton dropdowns so they read
  // as part of the same toolbar system as Tracking/Field Employees.
  const [vendorMenuOpen, setVendorMenuOpen] = useState(false);
  const [employeeMenuOpen, setEmployeeMenuOpen] = useState(false);
  const vendorMenuRef = useRef<HTMLDivElement>(null);
  const employeeMenuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (vendorMenuRef.current && !vendorMenuRef.current.contains(e.target as Node)) setVendorMenuOpen(false);
      if (employeeMenuRef.current && !employeeMenuRef.current.contains(e.target as Node)) setEmployeeMenuOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);
  const vendorIdNum = selectedVendorId ? parseInt(selectedVendorId) : undefined;
  // Task #523: source the eligible roster through the shared hook. It
  // keeps the active-only + vendor-scoped defense Task #515 added inline
  // here, but pinned to the QR-selected vendor (the portal isn't a
  // logged-in vendor session so we can't derive vendorId from auth).
  const {
    eligibleForemen: vendorFieldEmployees,
    fieldEmployees: vendorFieldEmployeesRaw,
  } = useEligibleVendorFieldEmployeesByVendorId(vendorIdNum);
  const { data: openTickets } = useGetPortalOpenTickets(siteCode, { vendorId: vendorIdNum }, {
    query: { enabled: !!siteCode && !!vendorIdNum, queryKey: getGetPortalOpenTicketsQueryKey(siteCode, { vendorId: vendorIdNum }) },
  });
  const createTicket = useCreateTicket();
  const checkInTicket = useCheckInTicket();
  const checkOutTicket = useCheckOutTicket();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [gps, setGps] = useState<GpsCoords | null>(null);
  const [gpsError, setGpsError] = useState<string>("");
  const [view, setView] = useState<"main" | "new-ticket" | "ticket-detail">("main");
  const [newTicketForm, setNewTicketForm] = useState({ workTypeId: "", description: "" });
  const [selectedTicketId, setSelectedTicketId] = useState<number | null>(null);
  const { data: ticketDetail } = useGetTicket(selectedTicketId ?? 0, { query: { enabled: !!selectedTicketId, queryKey: getGetTicketQueryKey(selectedTicketId ?? 0) } });
  const { data: ticketNoteLogs } = useGetTicketNoteLogs(selectedTicketId ?? 0, { query: { enabled: !!selectedTicketId, queryKey: getGetTicketNoteLogsQueryKey(selectedTicketId ?? 0) } });
  const { data: ticketLineItems } = useGetTicketLineItems(selectedTicketId ?? 0, { query: { enabled: !!selectedTicketId, queryKey: getGetTicketLineItemsQueryKey(selectedTicketId ?? 0) } });
  const updateTicket = useUpdateTicket();
  const createNoteLog = useCreateTicketNoteLog();
  const [editDescription, setEditDescription] = useState("");
  const [noteContent, setNoteContent] = useState("");
  const [workCompleted, setWorkCompleted] = useState(false);
  const [checkoutConfirmOpen, setCheckoutConfirmOpen] = useState(false);

  useEffect(() => {
    if (ticketDetail) {
      setEditDescription(ticketDetail.description || "");
    }
  }, [ticketDetail]);

  // Task #523: route the cleanup through the shared helper so the portal
  // sign-in dropdown gets the same defense the tickets-page pickers do —
  // if the employee leaves the eligible set (deactivation, soft-delete,
  // or a vendor switch) before they tap Start, we drop the pick instead
  // of POSTing a fieldEmployeeId the Task #507 server tenancy guard
  // would reject.
  useClearStaleFieldEmployeeSelection({
    selectedId: selectedEmployeeId,
    eligibleForemen: vendorFieldEmployees,
    fieldEmployees: vendorFieldEmployeesRaw,
    onClear: () => setSelectedEmployeeId(""),
  });

  useEffect(() => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => setGps({ latitude: pos.coords.latitude, longitude: pos.coords.longitude }),
        (err) => setGpsError("GPS access denied. Location tracking is required."),
        { enableHighAccuracy: true },
      );
    } else {
      setGpsError("Geolocation is not supported by this browser.");
    }
  }, []);

  const getCurrentGps = useCallback((): Promise<GpsCoords> => {
    return new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve({ latitude: pos.coords.latitude, longitude: pos.coords.longitude }),
        (err) => reject(err),
        { enableHighAccuracy: true },
      );
    });
  }, []);

  const uniqueVendors = portal?.availableWorkTypes
    ? Array.from(new Map(portal.availableWorkTypes.map((a) => [a.vendorId, { id: a.vendorId, name: a.vendorName }])).values())
    : [];

  const vendorWorkTypes = portal?.availableWorkTypes?.filter((a) => String(a.vendorId) === selectedVendorId) ?? [];

  const handleCreateTicket = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const coords = await getCurrentGps();
      createTicket.mutate(
        {
          data: {
            siteLocationId: portal!.siteLocation.id,
            vendorId: parseInt(selectedVendorId),
            fieldEmployeeId: parseInt(selectedEmployeeId),
            workTypeId: parseInt(newTicketForm.workTypeId),
            description: newTicketForm.description || null,
            checkInLatitude: coords.latitude,
            checkInLongitude: coords.longitude,
          },
        },
        {
          onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: getGetPortalOpenTicketsQueryKey(siteCode, { vendorId: vendorIdNum }) });
            setView("main");
            setNewTicketForm({ workTypeId: "", description: "" });
            toast({ title: "Tracking created and checked in" });
          },
        },
      );
    } catch {
      toast({ title: "GPS required", description: "Please enable location services", variant: "destructive" });
    }
  };

  const handleCheckIn = async (ticketId: number) => {
    try {
      const coords = await getCurrentGps();
      checkInTicket.mutate(
        { id: ticketId, data: { latitude: coords.latitude, longitude: coords.longitude } },
        {
          onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: getGetPortalOpenTicketsQueryKey(siteCode, { vendorId: vendorIdNum }) });
            if (selectedTicketId) queryClient.invalidateQueries({ queryKey: getGetTicketQueryKey(selectedTicketId) });
            toast({ title: "Checked in successfully" });
          },
        },
      );
    } catch {
      toast({ title: "GPS required", variant: "destructive" });
    }
  };

  const handleCheckOut = async (ticketId: number) => {
    try {
      const coords = await getCurrentGps();
      checkOutTicket.mutate(
        { id: ticketId, data: { latitude: coords.latitude, longitude: coords.longitude, workCompleted } },
        {
          onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: getGetPortalOpenTicketsQueryKey(siteCode, { vendorId: vendorIdNum }) });
            if (selectedTicketId) queryClient.invalidateQueries({ queryKey: getGetTicketQueryKey(selectedTicketId) });
            toast({ title: workCompleted ? "Work completed & checked out" : "Checked out successfully" });
            setWorkCompleted(false);
          },
        },
      );
    } catch {
      toast({ title: "GPS required", variant: "destructive" });
    }
  };

  const handleSaveDescription = () => {
    if (!selectedTicketId) return;
    updateTicket.mutate(
      { id: selectedTicketId, data: { description: editDescription || null } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetTicketQueryKey(selectedTicketId) });
          queryClient.invalidateQueries({ queryKey: getGetPortalOpenTicketsQueryKey(siteCode, { vendorId: vendorIdNum }) });
          toast({ title: "Description updated" });
        },
      },
    );
  };

  const handleLogNote = () => {
    if (!selectedTicketId || !noteContent.trim()) return;
    createNoteLog.mutate(
      { id: selectedTicketId, data: { content: noteContent.trim() } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetTicketNoteLogsQueryKey(selectedTicketId) });
          setNoteContent("");
          toast({ title: "Note logged" });
        },
      },
    );
  };

  const openTicketDetail = (ticketId: number) => {
    setSelectedTicketId(ticketId);
    setNoteContent("");
    setWorkCompleted(false);
    setView("ticket-detail");
  };

  const lineItemSubtotal = ticketLineItems?.reduce((sum, item) => sum + (parseFloat(item.quantity) * parseFloat(item.unitPrice)), 0) ?? 0;

  // Site portal honors the same Dark/Light surface toggle as the
  // vendor sign-in family. Defaults to dark; switching to light
  // swaps the page bg from #3a3d42 (matching the sidebar token /
  // vdark preset) to white.
  const [themeMode, setThemeMode] = useState<ThemeMode>("dark");
  const isDark = themeMode === "dark";
  const portalBg = isDark ? "#3a3d42" : "#ffffff";

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center relative" style={{ backgroundColor: portalBg }}>
        <div className="absolute top-4 left-4 z-20">
          <DarkLightToggle mode={themeMode} onChange={setThemeMode} variant={isDark ? "dark" : "light"} />
        </div>
        <Skeleton className="h-64 w-full max-w-md" />
      </div>
    );
  }

  if (!portal) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4 relative" style={{ backgroundColor: portalBg }}>
        <div className="w-full max-w-md text-center">
          <img src={vndrlyLogo} alt="VNDRLY" className="w-16 h-16 rounded-xl mx-auto mb-4" draggable={false} />
          <AlertTriangle className="w-12 h-12 mx-auto mb-4 text-amber-500" />
          <h2 className="text-xl font-bold text-gray-900">Site Not Found</h2>
          <p className="text-gray-500 mt-2">This QR code is not associated with a valid site location.</p>
        </div>
      </div>
    );
  }

  const selectedEmployee = vendorFieldEmployees?.find((fe) => String(fe.id) === selectedEmployeeId);
  const isLoggedIn = !!selectedVendorId && !!selectedEmployeeId;
  const formReady = isLoggedIn;

  return (
    <div
      className="min-h-screen"
      data-testid="portal-page"
      // Scope partner brand colors to this page so var(--brand-primary)
      // resolves to the SITE owner's color for everything inside (icons,
      // accent strips, PortalButton). Outside this wrapper, the global
      // value set by BrandProvider (the viewer's vendor brand) still
      // applies, which is what we want for things like the toaster.
      style={{ ...partnerBrandStyle, backgroundColor: portalBg }}
    >
      <div className="absolute top-4 left-4 z-30">
        <DarkLightToggle mode={themeMode} onChange={setThemeMode} variant={isDark ? "dark" : "light"} />
      </div>
      <div className="relative overflow-hidden" style={{ backgroundColor: "hsl(220 10% 25%)" }}>
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            backgroundImage: `url(${sidebarBg})`,
            backgroundSize: "cover",
            backgroundPosition: "center top",
            opacity: 0.85,
            maskImage: "linear-gradient(to bottom, black 0%, transparent 100%)",
            WebkitMaskImage: "linear-gradient(to bottom, black 0%, transparent 100%)",
          }}
        />
        <div className="relative z-10 p-5 max-w-md mx-auto">
          <div className="flex items-start gap-3 mb-3" data-testid="portal-header-brand">
            {partnerHeaderLogo ? (
              // Partner-branded variant: the partner logo replaces the
              // VNDRLY square so field employees recognize who owns the
              // site at a glance. We keep a small "Powered by VNDRLY"
              // label in the subtitle area below for attribution. The
              // square crop wins when present (1:1 fits the badge
              // bounding box cleanly); we fall back to the wide logo
              // letterboxed inside the same box otherwise.
              <img
                src={partnerHeaderLogo}
                alt={partnerBrand.name ? `${partnerBrand.name} logo` : "Partner logo"}
                className="w-10 h-10 rounded-lg shrink-0 mt-[2px] bg-white object-contain p-0.5"
                draggable={false}
                data-testid="img-portal-partner-logo"
              />
            ) : (
              <img src={vndrlyLogo} alt="VNDRLY Logo" className="w-10 h-10 rounded-lg shrink-0 mt-[2px]" draggable={false} />
            )}
            <div>
              <h1 className="text-xl font-bold tracking-tight leading-none text-white" data-testid="text-portal-brand-name">
                {partnerBrand.name ?? "VNDRLY"}
              </h1>
              <p className="text-xs text-white/60 leading-tight">
                Field Employee Portal{partnerBrand.name ? " · Powered by VNDRLY" : ""}
              </p>
            </div>
          </div>
          <div className="border-t border-white/15 pt-3">
            <h2 className="text-base font-semibold text-white" data-testid="text-portal-site-name">{portal.siteLocation.name}</h2>
            <p className="text-sm text-white/70">{portal.siteLocation.address}</p>
            <div className="flex items-center gap-2 mt-2">
              <Navigation className="w-3 h-3 text-white/50" />
              <span className="text-xs text-white/50">
                {gps ? `${gps.latitude.toFixed(4)}, ${gps.longitude.toFixed(4)}` : gpsError || "Getting location..."}
              </span>
            </div>
          </div>
          {isLoggedIn && selectedEmployee && (
            <div className="flex items-center gap-2 mt-3 pt-3 border-t border-white/15">
              <User className="w-3 h-3" style={{ color: "var(--brand-primary)" }} />
              <span className="text-xs text-white/80 font-medium">{selectedEmployee.firstName} {selectedEmployee.lastName}</span>
              <button
                className="text-xs underline underline-offset-2 ml-auto"
                style={{ color: "var(--brand-primary)" }}
                onClick={() => { setSelectedEmployeeId(""); setSelectedVendorId(""); setView("main"); }}
              >
                Switch
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="w-full h-[3px]" style={{ backgroundColor: "var(--brand-primary)" }} />

      <div className="p-5 max-w-md mx-auto space-y-5">
        {!isLoggedIn ? (
          <div>
            <h3 className="text-lg font-bold text-gray-900 mb-1">Field Employee Check-In</h3>
            <p className="text-sm text-gray-500 mb-5">Select your company and name to continue.</p>
            <div
              className="border-2 rounded-xl p-5 shadow-lg transition-colors duration-300"
              style={{ borderColor: formReady ? "var(--brand-primary)" : "#d1d5db" }}
            >
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label className="text-gray-700">Select Your Company</Label>
                  <div className="relative" ref={vendorMenuRef}>
                    <PngPillButton
                      color="blue"
                     
                      onClick={() => setVendorMenuOpen((v) => !v)}
                      className="w-full justify-between"
                      data-testid="select-portal-vendor"
                    >
                      <span className="flex-1 text-left truncate">
                        {uniqueVendors.find((v) => String(v.id) === selectedVendorId)?.name ?? "Choose your company"}
                      </span>
                      <ChevronDown className="w-4 h-4" />
                    </PngPillButton>
                    {vendorMenuOpen && (
                      <div className="absolute left-0 right-0 top-[48px] z-50 bg-white border rounded-lg shadow-lg p-2 max-h-60 overflow-y-auto flex flex-col gap-1.5">
                        {uniqueVendors.map((v) => (
                          <PngPillButton
                            key={v.id}
                            color="blue"
                            attention={String(v.id) === selectedVendorId}
                            height={28}
                            className="w-full justify-start"
                            onClick={() => {
                              setSelectedVendorId(String(v.id));
                              setSelectedEmployeeId("");
                              setVendorMenuOpen(false);
                            }}
                            data-testid={`portal-vendor-option-${v.id}`}
                          >
                            <span className="truncate">{v.name}</span>
                          </PngPillButton>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
                {selectedVendorId && (
                  <div className="space-y-2">
                    <Label className="text-gray-700">Select Your Name</Label>
                    <div className="relative" ref={employeeMenuRef}>
                      <PngPillButton
                        color="blue"
                       
                        onClick={() => setEmployeeMenuOpen((v) => !v)}
                        className="w-full justify-between"
                        data-testid="select-portal-employee"
                      >
                        <span className="flex-1 text-left truncate">
                          {(() => {
                            const fe = vendorFieldEmployees.find((e) => String(e.id) === selectedEmployeeId);
                            return fe ? `${fe.firstName} ${fe.lastName}` : "Choose your name";
                          })()}
                        </span>
                        <ChevronDown className="w-4 h-4" />
                      </PngPillButton>
                      {employeeMenuOpen && (
                        <div className="absolute left-0 right-0 top-[48px] z-50 bg-white border rounded-lg shadow-lg p-2 max-h-60 overflow-y-auto flex flex-col gap-1.5">
                          {vendorFieldEmployees.length === 0 ? (
                            <div
                              className="px-2 py-1.5 text-sm text-muted-foreground"
                              data-testid="empty-portal-employee-list"
                            >
                              No active field employees on your vendor.
                            </div>
                          ) : (
                            vendorFieldEmployees.map((fe) => (
                              <PngPillButton
                                key={fe.id}
                                color="blue"
                                attention={String(fe.id) === selectedEmployeeId}
                                height={28}
                                className="w-full justify-start"
                                onClick={() => {
                                  setSelectedEmployeeId(String(fe.id));
                                  setEmployeeMenuOpen(false);
                                }}
                                data-testid={`portal-employee-option-${fe.id}`}
                              >
                                <span className="truncate">{fe.firstName} {fe.lastName}</span>
                              </PngPillButton>
                            ))
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
            <div className="mt-5 text-center">
              <div className="text-xs text-gray-500 mb-2">Not a field employee?</div>
              <a
                href={`/visit/${siteCode}`}
                data-testid="link-portal-visitor"
                className="inline-flex items-center gap-2 text-sm font-semibold hover:underline hover:opacity-80"
                style={{ color: "var(--brand-primary)" }}
              >
                Sign in as Visitor / Guest
                <ArrowRight className="w-4 h-4" />
              </a>
            </div>
          </div>
        ) : view === "ticket-detail" && ticketDetail ? (
          <div>
            <button
              type="button"
              className="group flex items-center gap-2 text-sm font-medium mb-4"
              style={{ color: "var(--brand-primary)" }}
              onClick={() => { setView("main"); setSelectedTicketId(null); }}
            >
              <SphereBackButton size={24} />Back to Tickets
            </button>
            <h3 className="text-lg font-bold text-gray-900 mb-1">
              Ticket #{String(ticketDetail.id).padStart(8, '0')}
            </h3>
            <p className="text-sm text-gray-500 mb-5">{ticketDetail.workTypeName}</p>

            <div className="space-y-4">
              <div className="border-2 rounded-xl p-5 shadow-lg space-y-4" style={{ borderColor: "var(--brand-primary)" }}>
                <div className="flex items-center gap-2 mb-1">
                  <ClipboardList className="w-4 h-4" style={{ color: "var(--brand-primary)" }} />
                  <span className="text-sm font-bold text-gray-700">Details</span>
                  <div className="ml-auto"><TicketStatusBadge status={ticketDetail.status} /></div>
                </div>
                <div className="pt-1 pb-2">
                  <TicketStatusStepper status={ticketDetail.status} />
                </div>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div><span className="text-gray-400">Vendor:</span><br/><span className="font-medium text-gray-900">{ticketDetail.vendorName}</span></div>
                  <div>
                    <span className="text-gray-400">Work Type:</span><br/>
                    <span className="font-medium text-gray-900">{ticketDetail.workTypeName}</span>
                    {ticketDetail.afe && (
                      <div className="mt-1">
                        <AfePill data-testid="text-portal-tracking-afe">
                          <code className="font-mono text-white">{ticketDetail.afe}</code>
                        </AfePill>
                      </div>
                    )}
                  </div>
                  <div><span className="text-gray-400">Employee:</span><br/><span className="font-medium text-gray-900">{ticketDetail.fieldEmployeeName || "-"}</span></div>
                  <div><span className="text-gray-400">Created:</span><br/><span className="font-medium text-gray-900">{new Date(ticketDetail.createdAt).toLocaleDateString()}</span></div>
                </div>

                {ticketDetail.kickbackReason && (
                  // Kickback callout intentionally keeps the amber warning color
                  // across all partners — it conveys "needs attention" semantics,
                  // not brand identity.
                  <div
                    className="flex items-start gap-3 p-3 rounded border border-gray-500"
                    style={{ background: "linear-gradient(180deg, #6b7280 0%, #4b5563 100%)" }}
                  >
                    <AlertTriangle className="w-4 h-4 mt-0.5 text-amber-400 shrink-0" />
                    <div>
                      <p className="text-sm font-semibold" style={{ color: "var(--brand-primary)" }}>Kickback Reason</p>
                      <p className="text-xs text-white/90 mt-0.5">{ticketDetail.kickbackReason}</p>
                    </div>
                  </div>
                )}

                <div className="space-y-2">
                  <Label className="text-gray-700">Description</Label>
                  <Textarea
                    value={editDescription}
                    onChange={(e) => setEditDescription(e.target.value)}
                    placeholder="Describe the work performed..."
                    className="min-h-[80px]"
                    data-testid="input-edit-description"
                  />
                  {editDescription !== (ticketDetail.description || "") && (
                    <PortalButton onClick={handleSaveDescription} disabled={updateTicket.isPending} testId="button-save-description">
                      <Save className="w-4 h-4 mr-2" />{updateTicket.isPending ? "Saving..." : "Save Description"}
                    </PortalButton>
                  )}
                </div>
              </div>

              <div className="border-2 border-gray-200 rounded-xl p-5 space-y-3">
                <div className="flex items-center gap-2 mb-1">
                  <MapPin className="w-4 h-4" style={{ color: "var(--brand-primary)" }} />
                  <span className="text-sm font-bold text-gray-700">Check In / Out</span>
                </div>
                {ticketDetail.checkInTime && (
                  <div className="flex items-center gap-3 p-3 rounded-lg bg-green-50 border border-green-200">
                    <CheckCircle2 className="w-4 h-4 text-green-600 shrink-0" />
                    <div>
                      <p className="text-sm font-medium text-green-700">Checked In</p>
                      <p className="text-xs text-gray-500">{new Date(ticketDetail.checkInTime).toLocaleString()}</p>
                    </div>
                  </div>
                )}
                {ticketDetail.checkOutTime && (
                  <div className="flex items-center gap-3 p-3 rounded-lg bg-red-50 border border-red-200">
                    <Clock className="w-4 h-4 text-red-600 shrink-0" />
                    <div>
                      <p className="text-sm font-medium text-red-700">Checked Out</p>
                      <p className="text-xs text-gray-500">{new Date(ticketDetail.checkOutTime).toLocaleString()}</p>
                    </div>
                  </div>
                )}
                <div className="pt-1 space-y-3">
                  {ticketDetail.status === "kicked_back" && (
                    <PortalButton onClick={() => handleCheckIn(ticketDetail.id)} disabled={checkInTicket.isPending} testId="button-detail-checkin">
                      <ArrowRight className="w-4 h-4 mr-2" />{checkInTicket.isPending ? "Checking In..." : "Re-Check In"}
                    </PortalButton>
                  )}
                  {ticketDetail.status === "in_progress" && (
                    <>
                      <label className="flex items-center gap-3 p-3 rounded-lg border-2 cursor-pointer transition-colors select-none"
                        style={{
                          borderColor: workCompleted ? "var(--brand-primary)" : "#e5e7eb",
                          backgroundColor: workCompleted ? "color-mix(in srgb, var(--brand-primary) 8%, white)" : "transparent",
                        }}
                        data-testid="checkbox-work-completed"
                      >
                        <input
                          type="checkbox"
                          checked={workCompleted}
                          onChange={(e) => setWorkCompleted(e.target.checked)}
                          className="w-5 h-5 rounded"
                          style={{ accentColor: "var(--brand-primary)" }}
                        />
                        <div>
                          <span className="font-semibold text-sm text-gray-900">Work Completed</span>
                          <p className="text-xs text-gray-500 mt-0.5">Check this if all work is finished and ready for vendor review</p>
                        </div>
                      </label>
                      <PortalButton onClick={() => setCheckoutConfirmOpen(true)} disabled={checkOutTicket.isPending} testId="button-detail-checkout">
                        <Clock className="w-4 h-4 mr-2" />{checkOutTicket.isPending ? "Checking Out..." : workCompleted ? "Complete & Check Out" : "Check Out"}
                      </PortalButton>
                      <Dialog open={checkoutConfirmOpen} onOpenChange={setCheckoutConfirmOpen}>
                        <DialogContent className="max-w-sm">
                          <DialogHeader>
                            <DialogTitle>Are you sure you're ready to Check Out?</DialogTitle>
                          </DialogHeader>
                          <div className="space-y-3 mt-1">
                            <div className="rounded-lg bg-gray-50 border p-3 space-y-2 text-sm">
                              <div className="flex justify-between">
                                <span className="text-gray-500">Ticket</span>
                                <span className="font-medium text-gray-900">#{String(ticketDetail.id).padStart(8, '0')}</span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-gray-500">Work Type</span>
                                <span className="font-medium text-gray-900">{ticketDetail.workTypeName}</span>
                              </div>
                              {ticketDetail.checkInTime && (
                                <>
                                  <div className="flex justify-between">
                                    <span className="text-gray-500">Checked In</span>
                                    <span className="font-medium text-gray-900">{new Date(ticketDetail.checkInTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                                  </div>
                                  <div className="flex justify-between border-t pt-2">
                                    <span className="text-gray-500 font-semibold">Time On Site</span>
                                    <span className="font-bold" style={{ color: "var(--brand-primary)" }}>
                                      {(() => {
                                        const diffMs = Date.now() - new Date(ticketDetail.checkInTime).getTime();
                                        const totalMin = Math.floor(diffMs / 60000);
                                        const hrs = Math.floor(totalMin / 60);
                                        const mins = totalMin % 60;
                                        return `${hrs}:${String(mins).padStart(2, '0')}`;
                                      })()}
                                    </span>
                                  </div>
                                </>
                              )}
                              {workCompleted && (
                                <div className="flex items-center gap-2 pt-1 border-t text-green-700">
                                  <CheckCircle2 className="w-4 h-4" />
                                  <span className="font-medium text-sm">Work Completed</span>
                                </div>
                              )}
                            </div>
                            <p className="text-sm text-muted-foreground">
                              {workCompleted
                                ? "This will check you out and mark the work as completed for vendor review."
                                : "This will check you out of the current job site. You can check back in later if needed."}
                            </p>
                          </div>
                          <div className="flex gap-3 justify-end mt-2">
                            <PngPillButton onClick={() => setCheckoutConfirmOpen(false)} data-testid="button-checkout-cancel">
                              No, Go Back
                            </PngPillButton>
                            <PortalButton
                              onClick={() => { setCheckoutConfirmOpen(false); handleCheckOut(ticketDetail.id); }}
                              disabled={checkOutTicket.isPending}
                              fullWidth={false}
                              testId="button-checkout-confirm"
                            >
                              <Clock className="w-4 h-4 mr-1" />Yes, Check Out
                            </PortalButton>
                          </div>
                        </DialogContent>
                      </Dialog>
                    </>
                  )}
                </div>
              </div>

              {ticketLineItems && ticketLineItems.length > 0 && (
                <div className="border-2 border-gray-200 rounded-xl p-5 space-y-3">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <DollarSign className="w-4 h-4" style={{ color: "var(--brand-primary)" }} />
                    <span className="text-sm font-bold text-gray-700">Parts & Labor</span>
                  </div>
                  <div className="space-y-2">
                    {ticketLineItems.map((item) => (
                      <div key={item.id} className="flex items-center justify-between text-sm p-2 rounded bg-gray-50 border">
                        <div>
                          <span className="font-medium text-gray-900">{item.description}</span>
                          <span className="text-gray-400 ml-2 text-xs">{item.type}</span>
                        </div>
                        <span className="font-medium text-gray-900">${(parseFloat(item.quantity) * parseFloat(item.unitPrice)).toFixed(2)}</span>
                      </div>
                    ))}
                  </div>
                  <div className="flex justify-between text-sm font-bold pt-2 border-t">
                    <span>Subtotal</span>
                    <span>${lineItemSubtotal.toFixed(2)}</span>
                  </div>
                </div>
              )}

              <div className="border-2 border-gray-200 rounded-xl p-5 space-y-3">
                <div className="flex items-center gap-2 mb-1">
                  <FileText className="w-4 h-4" style={{ color: "var(--brand-primary)" }} />
                  <span className="text-sm font-bold text-gray-700">Notes</span>
                </div>
                <Textarea
                  value={noteContent}
                  onChange={(e) => setNoteContent(e.target.value)}
                  placeholder="Add a note..."
                  className="min-h-[70px]"
                  data-testid="input-portal-note"
                />
                <div>
                  {noteContent.trim() ? (
                    <PortalButton onClick={handleLogNote} disabled={createNoteLog.isPending} testId="button-log-note">
                      <FileText className="w-4 h-4 mr-2" />{createNoteLog.isPending ? "Logging..." : "Log Note"}
                    </PortalButton>
                  ) : (
                    <PngPillButton disabled className="w-full h-10" data-testid="button-log-note">
                      <FileText className="w-4 h-4 mr-2" />Log Note
                    </PngPillButton>
                  )}
                </div>
                {ticketNoteLogs && ticketNoteLogs.length > 0 && (
                  <div className="space-y-2 mt-3 pt-3 border-t">
                    {ticketNoteLogs.map((log) => (
                      <div key={log.id} className="p-3 rounded bg-gray-50 border text-sm">
                        <p className="text-gray-900">{log.content}</p>
                        <p className="text-xs text-gray-400 mt-1">
                          {log.createdByName ? (
                            <>
                              <span className="font-medium text-gray-600">{log.createdByName}</span>
                              {log.createdByRole ? <span className="capitalize"> · {log.createdByRole}</span> : null}
                              {" · "}
                            </>
                          ) : null}
                          {new Date(log.createdAt).toLocaleString()}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : view === "new-ticket" ? (
          <div>
            <h3 className="text-lg font-bold text-gray-900 mb-1">Initiate New Ticket</h3>
            <p className="text-sm text-gray-500 mb-5">Select the work type and check in with GPS.</p>
            <div
              className="border-2 rounded-xl p-5 shadow-lg"
              style={{ borderColor: "var(--brand-primary)" }}
            >
              <form onSubmit={handleCreateTicket} className="space-y-4">
                <div className="space-y-2">
                  <Label className="text-gray-700">Work Type</Label>
                  <Select value={newTicketForm.workTypeId} onValueChange={(v) => setNewTicketForm({ ...newTicketForm, workTypeId: v })}>
                    <SelectTrigger data-testid="select-work-type" className="h-11"><SelectValue placeholder="Select work type" /></SelectTrigger>
                    <SelectContent>
                      {vendorWorkTypes.map((wt) => (
                        <SelectItem key={wt.id} value={String(wt.workTypeId)}>{wt.workTypeName}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label className="text-gray-700">Description (optional)</Label>
                  <Textarea data-testid="input-description" value={newTicketForm.description} onChange={(e) => setNewTicketForm({ ...newTicketForm, description: e.target.value })} placeholder="Describe the work..." className="min-h-[80px]" />
                </div>
                <div className="flex items-center gap-2 p-3 rounded-lg bg-gray-50 border text-sm text-gray-600">
                  <MapPin className="w-4 h-4" style={{ color: "var(--brand-primary)" }} />
                  <span>GPS will be captured on check-in</span>
                </div>
                <div className="pt-1">
                  {newTicketForm.workTypeId ? (
                    <PortalButton
                      type="submit"
                      disabled={createTicket.isPending}
                     
                      testId="button-checkin-new"
                    >
                      <CheckCircle2 className="w-4 h-4 mr-2" />{createTicket.isPending ? "Checking In..." : "Check In & Create Ticket"}
                    </PortalButton>
                  ) : (
                    <PngPillButton type="submit" disabled className="w-full h-11" data-testid="button-checkin-new">
                      <CheckCircle2 className="w-4 h-4 mr-2" />Check In & Create Ticket
                    </PngPillButton>
                  )}
                </div>
                <PngPillButton type="button" className="w-full h-11" onClick={() => setView("main")} data-testid="button-cancel-new">
                  Back
                </PngPillButton>
              </form>
            </div>
          </div>
        ) : (
          <>
            <div>
              <h3 className="text-lg font-bold text-gray-900 mb-4">What would you like to do?</h3>
              <div className="space-y-3">
                <PortalButton onClick={() => setView("new-ticket")} testId="button-new-ticket">
                  <Plus className="w-5 h-5 mr-2" />Initiate New Ticket
                </PortalButton>
                {openTickets && openTickets.length > 0 ? (
                  <PngPillButton
                    onClick={() => {
                      const el = document.getElementById("open-tickets-section");
                      if (el) el.scrollIntoView({ behavior: "smooth" });
                    }}
                    className="w-full h-14"
                    data-testid="button-continue-ticket"
                  >
                    <ChevronDown className="w-5 h-5 mr-2" />Continue Existing Ticket ({openTickets.length})
                  </PngPillButton>
                ) : (
                  <PngPillButton disabled className="w-full h-14" data-testid="button-continue-ticket">
                    <ChevronDown className="w-5 h-5 mr-2" />Continue Existing Ticket
                  </PngPillButton>
                )}
              </div>
            </div>

            {openTickets && openTickets.length > 0 && (
              <div id="open-tickets-section">
                <h4 className="text-sm font-bold text-gray-700 mb-3">Open Tickets</h4>
                <div className="space-y-3">
                  {openTickets.map((t) => (
                    <div
                      key={t.id}
                      className="border-2 rounded-xl p-4 space-y-2 cursor-pointer transition-colors hover:brightness-95 hover:opacity-80"
                      style={{ borderColor: "color-mix(in srgb, var(--brand-primary) 70%, white)" }}
                      onClick={() => openTicketDetail(t.id)}
                      data-testid={`card-open-ticket-${t.id}`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-sm text-gray-900">#{String(t.id).padStart(8, '0')} - {t.workTypeName}</span>
                        <TicketStatusBadge status={t.status} />
                      </div>
                      {t.description && <p className="text-sm text-gray-500">{t.description}</p>}
                      <p className="text-xs text-gray-400">
                        Created: {new Date(t.createdAt).toLocaleString()}
                      </p>
                      <div className="flex items-center justify-between pt-1">
                        <span className="text-xs font-medium" style={{ color: "var(--brand-primary)" }}>Tap to open</span>
                        <ArrowRight className="w-4 h-4" style={{ color: "var(--brand-primary)" }} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
