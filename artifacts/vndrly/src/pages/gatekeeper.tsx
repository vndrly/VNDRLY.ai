import { useLinkedGates } from "@/hooks/use-linked-gates";
import WorkdayControls from "@/components/workday-controls";
import "@/components/gate-dashboard.css";
import { gateHistoryFromIso } from "@/lib/gate-history";
import "@/components/gate-presence-tabs.css";
import GateSiteGateSelect from "@/components/gate-site-gate-select";
import { GateArrivalsPanel, useGateArrivals } from "@/components/gate-arrivals-panel";
import { GateArrivalDetails } from "@/components/gate-arrival-details";
import { GateVisitDetails } from "@/components/gate-visit-details";
import { gateRecordFlags, gateDurationHHMM } from "@/lib/gate-record-flags";
import { GateTrafficRecord } from "@/components/gate-traffic-record";
import { isGateEntryCleared } from "@/lib/gate-entry-clearance";
import { Link } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { changeOverRequest } from "@/lib/change-over-api";
import {
  Camera,
  ClipboardList,
  History,
  Loader2,
  RefreshCw,
  Shield,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  NATIONAL_PLATE_STATE_FALLBACK,
  PLATE_OCR_STATE_CONFIDENCE_THRESHOLD,
  normalizePlateState,
  plateMatchKey,
  reconcileAutomatedPlateUpdate,
  type PlateStateCode,
} from "@workspace/plate-state";

import AmberButton from "@/components/amber-button";
import ContentPaneBackLink from "@/components/content-pane-back-link";
import BlueButton from "@/components/blue-button";
import { LiveConnectionPill } from "@/components/live-connection-pill";
import { GateMemoryInput } from "@/components/gate-memory-input";
import { interpretGateSpeech, registerGateVoiceForm, gateDraftMatches, recoverGateSpeechFields, notifyGateVoiceDraftChanged } from "@workspace/gate-booth";
import { PlateStatePicker } from "@/components/plate-state-picker";
import {
  BrandedSelect,
  WORK_HUB_BRANDED_FIELD_CLASS,
} from "@/components/work-hub/chrome";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CARD_INNER_TILE_CLASS,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/hooks/use-auth";
import { useBrand } from "@/hooks/use-brand";
import { useGateLiveMonitor } from "@/hooks/use-gate-live-monitor";
import { FIELD_OPS_PAGE_CLASS } from "@/lib/field-ops-content-pane";
import {
  latestVisitForPlate,
  toGateLogRows,
} from "@/lib/gatekeeper-log-export";
import {
  pickDefaultGateHostKey,
  resolveAssignedGateSites,
  shouldApplyDefaultGateSite,
} from "@/lib/gate-default-site";
import {
  applyGateMemorySuggestion,
  draftsEqual,
  evaluateGateMemory,
  fillFromVisit,
  mergeGateFill,
  type GateEntryDraft,
  type GateMemoryField,
  type GateMemorySuggestion,
} from "@/lib/gate-entry-memory";
import {
  createGateAudioSession,
  pickGateRecordingMimeType,
  type GateAudioRecorder,
} from "@/lib/gate-audio-session";
import {
  matchGateCheckoutVisits,
  parseGateVoiceCommand,
} from "@/lib/gate-voice-entry";

const GATE_SELECT_CONTENT_CLASS = "border-2 border-[color:var(--brand-primary)] bg-white text-gray-700";
const GATE_SELECT_ITEM_CLASS = "focus:bg-[var(--brand-primary)] focus:text-white data-[highlighted]:bg-[var(--brand-primary)] data-[highlighted]:text-white data-[state=checked]:bg-[var(--brand-primary)] data-[state=checked]:text-white";
const GATE_TALL_FIELD_CLASS = "min-h-20 w-full rounded-xl border-2 border-[color:var(--brand-primary)] bg-white px-3 py-2 text-sm text-gray-700 outline-none focus:ring-0 focus:shadow-none";
import {
  applyGateAskVTurn,
  evaluateGateAskVTurn,
  type GateAskVDraftContext,
} from "@/lib/gate-askv-context";
import {
  createGateSpeechSession,
  type GateSpeechRecognition,
} from "@/lib/gate-speech-session";
import {
  consumePendingGateVoiceEntry,
  setGateVoiceListening,
  subscribeGateVoiceEntry,
} from "@/lib/gate-voice-launch";
import { transcribeAskVRecording } from "@/lib/askv-transcribe";
import { formatPlateForDisplay } from "@/lib/plate-display";
import {
  listAllVisits,
  visitsApi,
  type SiteContext,
  type VisitorRow,
} from "@/lib/visits-api";
import {
  evaluateGpsFence,
  onSiteDwell,
  siteDisplayName,
  type GpsLockState,
} from "@workspace/gate-booth";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

function evidenceUrl(path: string): string {
  return path.startsWith("/objects/") ? `${BASE}/api/storage${path}` : path;
}

type Coordinates = { latitude: number; longitude: number };
type Translate = (key: string) => string;
type PlateAutoFillField =
  | "firstName"
  | "lastName"
  | "company"
  | "purpose"
  | "expectedDuration";
type PlateAutoFillSnapshot = {
  matchKey: string;
  values: Partial<Record<PlateAutoFillField, string>>;
};
const PLATE_AUTO_FILL_FIELDS: PlateAutoFillField[] = [
  "firstName",
  "lastName",
  "company",
  "purpose",
  "expectedDuration",
];

function currentPosition(
  required: boolean,
  t: Translate,
): Promise<Coordinates | undefined> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      if (required) reject(new Error(t("gatekeeper.locationUnavailable")));
      else resolve(undefined);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) =>
        resolve({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        }),
      () =>
        required
          ? reject(new Error(t("gatekeeper.locationDenied")))
          : resolve(undefined),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 },
    );
  });
}

async function uploadEvidence(file: File, t: Translate): Promise<string> {
  if (!file.type.startsWith("image/"))
    throw new Error(t("gatekeeper.selectImage"));
  if (file.size > 8 * 1024 * 1024)
    throw new Error(t("gatekeeper.photoTooLarge"));
  const request = await fetch(`${BASE}/api/storage/uploads/request-url`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: file.name || `gate-photo-${Date.now()}.jpg`,
      size: file.size,
      contentType: file.type || "image/jpeg",
    }),
  });
  if (!request.ok) throw new Error(t("gatekeeper.photoPrepareFailed"));
  const descriptor = (await request.json()) as {
    uploadURL: string;
    objectPath: string;
  };
  const uploadUrl = /^https?:\/\//i.test(descriptor.uploadURL)
    ? descriptor.uploadURL
    : `${BASE}${descriptor.uploadURL}`;
  const upload = await fetch(uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": file.type || "image/jpeg" },
    body: file,
  });
  if (!upload.ok)
    throw new Error(
      upload.status === 413
        ? t("gatekeeper.photoTooLarge")
        : t("gatekeeper.photoUploadFailed"),
    );
  const finalize = await fetch(`${BASE}/api/storage/uploads/finalize`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      objectURL: descriptor.uploadURL,
      visibility: "private",
      purpose: "gate-evidence",
    }),
  });
  if (!finalize.ok) throw new Error(t("gatekeeper.photoFinalizeFailed"));
  return descriptor.objectPath;
}

async function deleteUnattachedEvidence(
  objectPath: string | null,
): Promise<void> {
  if (!objectPath) return;
  await fetch(`${BASE}/api/storage/uploads`, {
    method: "DELETE",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ objectPath }),
  }).catch(() => undefined);
}

export default function GatekeeperPage() {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const brand = useBrand();
  const entryCardRef = useRef<HTMLDivElement>(null);
  const [entryCardHeight, setEntryCardHeight] = useState<number | null>(null);
  const iconStyle = { color: brand.isOrgBranded ? brand.primary : "#f59e0b" };
  const queryClient = useQueryClient();
  const plateInput = useRef<HTMLInputElement>(null);
  const vehicleInput = useRef<HTMLInputElement>(null);
  const appliedDefault = useRef(false);
  const plateAutoFillRef = useRef<PlateAutoFillSnapshot | null>(null);
  const [siteCode, setSiteCode] = useState("");
  const [confirmedCode, setConfirmedCode] = useState<string | null>(null);
  const [resolvedPrefillSiteId, setResolvedPrefillSiteId] = useState<number | null>(null);
  const [hostKey, setHostKey] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [company, setCompany] = useState("");
  const [vehiclePlate, setVehiclePlate] = useState("");
  const [plateState, setPlateState] = useState<PlateStateCode | null>(null);
  const [plateStateError, setPlateStateError] = useState<string | null>(null);
  const [ocrStateNotice, setOcrStateNotice] = useState<{
    suggestedState: PlateStateCode;
    selectedState: PlateStateCode;
  } | null>(null);
  const [purpose, setPurpose] = useState("");
  const [entryCategory, setEntryCategory] = useState<"" | "visitor" | "routine_vendor_work" | "partner_admin" | "vendor_admin">("");
  const [notes, setNotes] = useState("");
  const [presenceView, setPresenceView] = useState<"arrivals" | "active" | "departures">("active");
  const [detailVisitId, setDetailVisitId] = useState<number | null>(null);
  const [detailRunId, setDetailRunId] = useState<string | null>(null);
  const [duration, setDuration] = useState("240");
  const [gps, setGps] = useState<GpsLockState>("searching");
  const [origin, setOrigin] = useState<Coordinates | null>(null);
  const [platePhotoUrl, setPlatePhotoUrl] = useState<string | null>(null);
  const [vehiclePhotoUrl, setVehiclePhotoUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [voiceListening, setVoiceListening] = useState(false);
  const [voiceTranscribing, setVoiceTranscribing] = useState(false);
  const [voiceCheckInPending, setVoiceCheckInPending] = useState(false);
  const [voiceCheckoutMatches, setVoiceCheckoutMatches] = useState<VisitorRow[]>([]);
  const [voiceResponse, setVoiceResponse] = useState<{
    messageKey: string;
    params?: Record<string, string>;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeMemoryField, setActiveMemoryField] =
    useState<GateMemoryField | null>(null);
  const [memoryDeleting, setMemoryDeleting] = useState(false);
  const [plateOcrStatus, setPlateOcrStatus] = useState<
    "idle" | "reading" | "read" | "unreadable"
  >("idle");
  const [ocrPlate, setOcrPlate] = useState<string | null>(null);
  const displayPlate = (
    state: string | null | undefined,
    plate: string | null | undefined,
  ) =>
    formatPlateForDisplay(state, plate, t("gatekeeper.plateStateUnconfirmed"));

  useEffect(() => {
    const card = entryCardRef.current;
    if (!card) return;
    // Follow the form as fields wrap, validation appears, or the viewport changes.
    const update = () => {
      const height = card.getBoundingClientRect().height;
      if (height > 0) setEntryCardHeight(height);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(card);
    return () => observer.disconnect();
  }, []);

  const visits = useQuery({
    queryKey: ["gatekeeper-visits"],
    queryFn: () => visitsApi.list({ activeOnly: true, limit: 1000 }),
    refetchInterval: 30000,
    retry: false,
  });
  const recentVisits = useQuery({
    queryKey: ["gatekeeper-recent-visits"],
    queryFn: () => listAllVisits(),
    retry: false,
  });
  const assigned = useQuery({
    queryKey: ["gatekeeper-assigned-sites", user?.vendorId],
    queryFn: () =>
      resolveAssignedGateSites({
        vendorId: user?.vendorId ?? null,
        listAssigned: () => visitsApi.listAssignedGateSites(),
        getSiteContext: (code) => visitsApi.getSiteContext(code),
      }),
    retry: false,
  });
  const site = useQuery<SiteContext>({
    queryKey: ["gatekeeper-site-context", confirmedCode],
    queryFn: () => visitsApi.getSiteContext(confirmedCode!),
    enabled: !!confirmedCode,
    retry: false,
  });
  const linkedGates = useLinkedGates(site.data?.site.id);
  const sharedSiteIds = linkedGates.data?.siteIds ?? (site.data?.site.id ? [site.data.site.id] : []);
  const departures = useQuery({
    queryKey: ["gatekeeper-departures", user?.userId, user?.activeMembershipId, user?.vendorId, user?.partnerId, sharedSiteIds],
    queryFn: async () => (await Promise.all(sharedSiteIds.map(siteLocationId => listAllVisits({ siteLocationId, from: gateHistoryFromIso(), overlap: true })))).flat(),
    enabled: presenceView === "departures" && Boolean(site.data?.site.id),
    refetchInterval: presenceView === "departures" ? 30000 : false,
    retry: false,
  });
  const recentDepartures = useMemo(() => (departures.data ?? []).filter(row => sharedSiteIds.includes(row.siteLocationId) && Boolean(row.checkOutTime)).sort((a,b) => Date.parse(b.checkOutTime!) - Date.parse(a.checkOutTime!)).slice(0, 100), [departures.data, sharedSiteIds.join(",")]);
  const arrivals = useGateArrivals(site.data?.site.id, sharedSiteIds);
  useEffect(() => {
    setDetailVisitId(null);
    setDetailRunId(null);
  }, [site.data?.site.id, user?.activeMembershipId]);
  const gateLocations = useQuery({
    queryKey: ["gate-visit-locations", user?.vendorId, site.data?.site.id],
    queryFn: () => changeOverRequest<{ stations: { id: string; name: string; latitude?: number | null; longitude?: number | null; geofenceRadiusM?: number }[] }>(`/stations?siteId=${site.data!.site.id}`),
    enabled: !!site.data?.site.id,
    retry: false,
  });
  const [gateLocationId, setGateLocationId] = useState("");
  const selectedGateLocation = gateLocations.data?.stations.find(gate => gate.id === gateLocationId) ?? (gateLocations.data?.stations.length === 1 ? gateLocations.data.stations[0] : undefined);
  const gateLocationOptionsRef = useRef(gateLocations.data?.stations ?? []);
  gateLocationOptionsRef.current = gateLocations.data?.stations ?? [];
  const preferredPlateStates = useQuery({
    queryKey: ["preferred-plate-states", site.data?.site.id, confirmedCode],
    queryFn: () =>
      visitsApi.listPreferredPlateStates(site.data!.site.id, confirmedCode!),
    enabled: Boolean(site.data?.site.id && confirmedCode),
    retry: false,
  });
  const orderedStatePreferences =
    preferredPlateStates.data?.preferred ?? NATIONAL_PLATE_STATE_FALLBACK;
  const activeVisits = visits.data ?? [];
  const live = useGateLiveMonitor({
    enabled: Boolean(user),
    siteLocationId: site.data?.site.id ?? null,
    visits: (visits.data ?? []).map((visit) => ({
      id: visit.id,
      firstName: visit.firstName,
      lastName: visit.lastName,
      company: visit.company,
      vehiclePlate: visit.vehiclePlate,
      plateState: visit.plateState,
      platePhotoUrl: visit.platePhotoUrl,
      siteName: visit.siteName,
      siteLocationId: visit.siteLocationId,
    })),
    queryKey: ["gatekeeper-visits"],
  });
  const exportRows = useMemo(
    () => toGateLogRows(recentVisits.data ?? []),
    [recentVisits.data],
  );
  const previousPlateVisit = useMemo(
    () =>
      plateState
        ? latestVisitForPlate(recentVisits.data ?? [], plateState, vehiclePlate)
        : null,
    [plateState, vehiclePlate, recentVisits.data],
  );
  const entryDraft = useMemo<GateEntryDraft>(
    () => ({
      firstName,
      lastName,
      company,
      vehiclePlate,
      plateState,
      purpose,
      notes,
      expectedDuration: duration,
    }),
    [company, duration, firstName, lastName, notes, plateState, purpose, vehiclePlate],
  );
  const entryDraftRef = useRef(entryDraft);
  const submitVoiceDraftRef = useRef<() => Promise<void>>(async () => {});
  const checkoutVoiceRef = useRef<(id: number) => Promise<void>>(async () => {});
  const resetVoiceDraftRef = useRef<() => void>(() => {});
  const gateSaveInFlightRef = useRef(false);
  const activeVisitsRef = useRef(activeVisits);
  const translateRef = useRef(t);
  entryDraftRef.current = entryDraft;
  activeVisitsRef.current = activeVisits;
  translateRef.current = t;
  const memory = useMemo(
    () =>
      evaluateGateMemory({
        visits: recentVisits.data ?? [],
        draft: entryDraft,
        activeField: activeMemoryField,
        isDeleting: memoryDeleting,
      }),
    [activeMemoryField, entryDraft, memoryDeleting, recentVisits.data],
  );
  const displayMemorySuggestions = memory.suggestions.map((suggestion) => {
    const rawPlate = suggestion.visit.vehiclePlate?.trim();
    const displayedPlate = displayPlate(suggestion.visit.plateState, rawPlate);
    if (!rawPlate || !displayedPlate) return suggestion;
    return {
      ...suggestion,
      label:
        activeMemoryField === "vehiclePlate"
          ? displayedPlate
          : suggestion.label,
      detail:
        activeMemoryField === "vehiclePlate"
          ? suggestion.detail
          : suggestion.detail.replace(rawPlate, displayedPlate),
    };
  });

  const applyEntryDraft = (next: GateEntryDraft) => {
    entryDraftRef.current = next;
    setFirstName(next.firstName);
    setLastName(next.lastName);
    setCompany(next.company);
    setVehiclePlate(next.vehiclePlate.toUpperCase());
    setPlateState(next.plateState);
    setPurpose(next.purpose);
    if (next.notes != null) setNotes(next.notes);
    if (next.expectedDuration) setDuration(next.expectedDuration);
  };
  const forgetPlateAutoFill = (field: PlateAutoFillField) => {
    const snapshot = plateAutoFillRef.current;
    if (!snapshot) return;
    delete snapshot.values[field];
    if (Object.keys(snapshot.values).length === 0)
      plateAutoFillRef.current = null;
  };
  const applyEntryDraftRef = useRef(applyEntryDraft);
  applyEntryDraftRef.current = applyEntryDraft;
  useEffect(() => {
    const listener = (event: Event) => {
      const detail = (event as CustomEvent<{ mode?: string; values?: Record<string, unknown>; matches?: Array<{ id?: unknown }>; missing?: unknown[] }>).detail;
      if (!detail) return;
      const values = detail.values ?? {};
      if (typeof values.siteLocationId === "number" && Number.isSafeInteger(values.siteLocationId)) {
        setResolvedPrefillSiteId(values.siteLocationId);
      }
      if (typeof values.gateStationId === "string" && gateLocationOptionsRef.current.some((gate) => gate.id === values.gateStationId)) {
        setGateLocationId(values.gateStationId);
      }
      const requestedHostKey = values.hostType === "partner" && typeof values.hostPartnerId === "number"
        ? `partner:${values.hostPartnerId}`
        : values.hostType === "vendor" && typeof values.hostVendorId === "number"
          ? `vendor:${values.hostVendorId}`
          : null;
      if (requestedHostKey && gateHostOptionsRef.current.some((host) => host.key === requestedHostKey)) {
        setHostKey(requestedHostKey);
      }
      if (["visitor", "routine_vendor_work", "partner_admin", "vendor_admin"].includes(String(values.entryCategory ?? ""))) {
        setEntryCategory(values.entryCategory as typeof entryCategory);
      }
      const current = entryDraftRef.current;
      const next: GateEntryDraft = {
        ...current,
        ...(typeof values.firstName === "string" ? { firstName: values.firstName } : {}),
        ...(typeof values.lastName === "string" ? { lastName: values.lastName } : {}),
        ...(typeof values.company === "string" ? { company: values.company } : {}),
        ...(typeof values.vehiclePlate === "string" ? { vehiclePlate: values.vehiclePlate.toUpperCase() } : {}),
        ...(typeof values.plateState === "string" ? { plateState: normalizePlateState(values.plateState) } : {}),
        ...(typeof values.purpose === "string" ? { purpose: values.purpose } : {}),
        ...(typeof values.notes === "string" ? { notes: values.notes } : {}),
        ...(values.expectedDurationMinutes != null ? { expectedDuration: String(values.expectedDurationMinutes) } : {}),
      };
      entryDraftRef.current = next;
      applyEntryDraftRef.current(next);
      if (detail.mode === "check-out") {
        const ids = new Set((detail.matches ?? []).map((match) => Number(match.id)).filter(Number.isSafeInteger));
        setVoiceCheckInPending(false);
        setVoiceCheckoutMatches(activeVisitsRef.current.filter((visit) => ids.has(visit.id)));
      } else {
        setVoiceCheckoutMatches([]);
        setVoiceCheckInPending((detail.missing ?? []).length === 0);
      }
      setError(null);
    };
    window.addEventListener("askv:gate-prefill", listener);
    return () => window.removeEventListener("askv:gate-prefill", listener);
  }, []);
  const gateAskVContextRef = useRef<GateAskVDraftContext>({
    selectedSite: null,
    draft: {
      firstName: "",
      lastName: "",
      company: "",
      vehiclePlate: "",
      plateState: null,
      purpose: "",
      notes: "",
      expectedDurationMinutes: null,
    },
    selectedHost: null,
    authorizedHosts: [],
  });
  const gateAskVContextEpochRef = useRef(0);
  const gateAskVCaptureContextEpochRef = useRef(0);
  const gateVoiceCaptureIdRef = useRef(0);
  const gateHostOptionsRef = useRef<
    Array<{ key: string; label: string; type: "partner" | "vendor" }>
  >([]);
  const lastVoiceTurnRef = useRef("");
  const processVoiceTranscriptRef = useRef<
    (transcript: string, contextEpoch?: number, deliveryId?: string) => void
  >(
    () => undefined,
  );
  processVoiceTranscriptRef.current = (
    transcript,
    contextEpoch = gateAskVContextEpochRef.current,
    deliveryId = `capture:${gateVoiceCaptureIdRef.current}`,
  ) => {
    const turnKey = `${deliveryId}:\0${transcript.trim().toLocaleLowerCase()}`;
    if (lastVoiceTurnRef.current === turnKey) return;
    lastVoiceTurnRef.current = turnKey;
    const localTurn = applyGateAskVTurn(
      evaluateGateAskVTurn(transcript, gateAskVContextRef.current, contextEpoch),
      gateAskVContextEpochRef.current,
    );
    if (localTurn.kind === "stale") {
      setVoiceResponse({ messageKey: "gatekeeper.askvContextChanged" });
      return;
    }
    if (localTurn.kind !== "unhandled") {
      if (localTurn.kind === "host-selection") {
        const matchingHost = gateHostOptionsRef.current.filter(
          (host) =>
            host.label === localTurn.host.label &&
            host.type === localTurn.host.type,
        );
        if (matchingHost.length !== 1) {
          setVoiceResponse({ messageKey: "gatekeeper.askvContextChanged" });
          return;
        }
        setHostKey(matchingHost[0].key);
      }
      setVoiceResponse({
        messageKey: localTurn.messageKey,
        params: localTurn.params,
      });
      setVoiceCheckInPending(false);
      setVoiceCheckoutMatches([]);
      setError(null);
      return;
    }
    setVoiceResponse(null);
    if (gateSaveInFlightRef.current) return;
    const speech = interpretGateSpeech(transcript);
    if (speech.reset) resetVoiceDraftRef.current();
    if (speech.action === "cancel") { setError(null); return; }
    const command = parseGateVoiceCommand(transcript);
    const fill = command.fill;
    if (Object.keys(fill).length === 0 && !speech.submit) {
      setError(translateRef.current("gatekeeper.voiceNotUnderstood"));
      return;
    }
    const currentDraft = entryDraftRef.current;
    const automatedPlate = reconcileAutomatedPlateUpdate({
      currentPlate: currentDraft.vehiclePlate,
      currentState: currentDraft.plateState,
      automatedPlate: fill.vehiclePlate,
      automatedState: fill.plateState,
    });
    const nextDraft: GateEntryDraft = {
      ...currentDraft,
      ...fill,
      vehiclePlate: automatedPlate.vehiclePlate ?? "",
      plateState: automatedPlate.plateState,
    };
    if (command.intent !== "check-out") {
      const recovered = recoverGateSpeechFields(nextDraft, (recentVisits.data ?? []).filter(visit => visit.siteLocationId === site.data?.site.id));
      Object.assign(nextDraft, recovered, { plateState: nextDraft.plateState ?? normalizePlateState(recovered.plateState) });
    }
    entryDraftRef.current = nextDraft;
    applyEntryDraftRef.current(nextDraft);
    setPlateStateError(null);
    setOcrStateNotice(null);
    plateAutoFillRef.current = null;
    if (command.intent === "check-out") {
      const matches = matchGateCheckoutVisits(
        activeVisitsRef.current,
        nextDraft,
      ).filter(
        (visit) =>
          !fill.plateState ||
          normalizePlateState(visit.plateState) === fill.plateState,
      );
      setVoiceCheckInPending(false);
      setVoiceCheckoutMatches(matches);
      if (matches.length === 0)
        setError(translateRef.current("gatekeeper.voiceNoCheckoutMatch"));
      else setError(null);
      if (speech.submit && matches.length === 1) void checkoutVoiceRef.current(matches[0].id);
      return;
    }
    setVoiceCheckoutMatches([]);
    setVoiceCheckInPending(true);
    setError(null);
    if (speech.submit) void submitVoiceDraftRef.current();
  };
  const onMemoryFieldChange = (field: GateMemoryField, value: string) => {
    const nextValue = field === "vehiclePlate" ? value.toUpperCase() : value;
    if (field !== "vehiclePlate") forgetPlateAutoFill(field);
    setMemoryDeleting(nextValue.length < entryDraft[field].length);
    setActiveMemoryField(field);
    if (field === "firstName") setFirstName(nextValue);
    else if (field === "lastName") setLastName(nextValue);
    else if (field === "company") setCompany(nextValue);
    else setVehiclePlate(nextValue);
  };
  const onMemoryPick = (suggestion: GateMemorySuggestion) => {
    plateAutoFillRef.current = null;
    setMemoryDeleting(false);
    applyEntryDraft(applyGateMemorySuggestion(entryDraft, suggestion, activeMemoryField));
    if (suggestion.mode === "company") setActiveMemoryField("firstName");
  };

  useEffect(() => {
    let disposed = false;
    let processing = false;
    const win = window as typeof window & {
      SpeechRecognition?: new () => GateSpeechRecognition;
      webkitSpeechRecognition?: new () => GateSpeechRecognition;
    };
    const publishListening = (listening: boolean) => {
      if (!disposed) {
        setVoiceListening(listening);
      }
      setGateVoiceListening(listening);
    };
    const reportVoiceError = (code: string) => {
      if (disposed) return;
      const key = code === "not-allowed"
        ? "gatekeeper.voicePermissionDenied"
        : code === "unavailable" || code === "service-not-allowed" || code === "audio-capture" || code === "start-failed"
          ? "gatekeeper.voiceUnavailable"
          : "gatekeeper.voiceNotUnderstood";
      setError(translateRef.current(key));
    };
    const supportsRecording = Boolean(navigator.mediaDevices?.getUserMedia) && typeof MediaRecorder !== "undefined";
    const session: {
      dispose: () => void | Promise<void>;
      isListening: () => boolean;
      toggle: () => void | Promise<void>;
    } = supportsRecording
      ? createGateAudioSession({
          getStream: () => navigator.mediaDevices.getUserMedia({ audio: true }),
          createRecorder: (stream, mimeType) => new MediaRecorder(
            stream as MediaStream,
            mimeType ? { mimeType } : undefined,
          ) as unknown as GateAudioRecorder,
          mimeType: pickGateRecordingMimeType(),
          onAudio: async (audio) => {
            processing = true;
            if (!disposed) setVoiceTranscribing(true);
            try {
              const transcript = await transcribeAskVRecording(audio);
              if (disposed) return;
              if (!transcript) {
                setError(translateRef.current("gatekeeper.voiceNotUnderstood"));
                return;
              }
              processVoiceTranscriptRef.current(
                transcript,
                gateAskVCaptureContextEpochRef.current,
                `capture:${gateVoiceCaptureIdRef.current}`,
              );
            } catch (reason) {
              if (disposed) return;
              const code = reason instanceof Error ? reason.message : "";
              setError(translateRef.current(
                code === "assistant.transcribe_unavailable"
                  ? "gatekeeper.voiceUnavailable"
                  : "gatekeeper.voiceNotUnderstood",
              ));
            } finally {
              processing = false;
              if (!disposed) setVoiceTranscribing(false);
            }
          },
          onListeningChange: publishListening,
          onError: reportVoiceError,
        })
      : createGateSpeechSession({
          createRecognition: () => {
            const Recognition = win.SpeechRecognition ?? win.webkitSpeechRecognition;
            return Recognition ? new Recognition() : null;
          },
          onTranscript: (transcript, deliveryId) =>
            processVoiceTranscriptRef.current(
              transcript,
              gateAskVContextEpochRef.current,
              `recognition:${deliveryId}`,
            ),
          onListeningChange: publishListening,
          onError: reportVoiceError,
        });
    const launch = () => {
      if (processing) return;
      setError(null);
      if (!session.isListening()) {
        gateAskVCaptureContextEpochRef.current = gateAskVContextEpochRef.current;
        gateVoiceCaptureIdRef.current += 1;
      }
      void session.toggle();
    };
    const unsubscribe = subscribeGateVoiceEntry(launch);
    if (consumePendingGateVoiceEntry()) {
      window.setTimeout(launch, 50);
    }
    return () => {
      disposed = true;
      unsubscribe();
      void session.dispose();
      setGateVoiceListening(false);
    };
  }, []);

  const hosts = useMemo(() => {
    if (!site.data) return [];
    return [
      ...(site.data.partner
        ? [
            {
              key: `partner:${site.data.partner.id}`,
              id: site.data.partner.id,
              type: "partner" as const,
              label: site.data.partner.name,
            },
          ]
        : []),
      ...site.data.vendors.map((vendor) => ({
        key: `vendor:${vendor.id}`,
        id: vendor.id,
        type: "vendor" as const,
        label: vendor.name,
      })),
    ];
  }, [site.data]);
  const selectedHost = hosts.find((host) => host.key === hostKey) ?? null;
  gateHostOptionsRef.current = hosts;
  gateAskVContextRef.current = {
    selectedSite: site.data
      ? { name: siteDisplayName(site.data.site), address: site.data.site.address }
      : null,
    draft: {
      firstName,
      lastName,
      company,
      vehiclePlate,
      plateState,
      purpose,
      notes,
      expectedDurationMinutes: /^\d+$/.test(duration) ? Number(duration) : null,
    },
    selectedHost: selectedHost
      ? { label: selectedHost.label, type: selectedHost.type }
      : null,
    authorizedHosts: hosts.map((host) => ({
      label: host.label,
      type: host.type,
    })),
  };
  useEffect(() => {
    gateAskVContextEpochRef.current += 1;
    lastVoiceTurnRef.current = "";
    setVoiceResponse(null);
  }, [
    confirmedCode,
    site.data?.site.name,
    user?.partnerId,
    user?.role,
    user?.userId,
    user?.vendorId,
  ]);
  const assignedSites = assigned.data?.sites ?? [];
  useEffect(() => {
    if (resolvedPrefillSiteId == null || assignedSites.length === 0) return;
    const resolvedSite = assignedSites.find((row) => row.id === resolvedPrefillSiteId);
    if (resolvedSite) {
      appliedDefault.current = true;
      setSiteCode(resolvedSite.siteCode);
      setConfirmedCode(resolvedSite.siteCode);
    }
    setResolvedPrefillSiteId(null);
  }, [assignedSites, resolvedPrefillSiteId]);
  const defaultSiteCode = assigned.data?.defaultSite?.siteCode ?? assignedSites[0]?.siteCode;
  const showPreviousBanner = Boolean(
    previousPlateVisit &&
    (!firstName.trim() ||
      !lastName.trim() ||
      firstName !== previousPlateVisit.firstName ||
      lastName !== previousPlateVisit.lastName),
  );

  useEffect(() => {
    if (appliedDefault.current) return;
    if (
      !shouldApplyDefaultGateSite({
        confirmedCode,
        typedCode: siteCode,
        defaultSiteCode,
      })
    )
      return;
    appliedDefault.current = true;
    setSiteCode(defaultSiteCode!);
    setConfirmedCode(defaultSiteCode!);
    setHostKey("");
  }, [confirmedCode, defaultSiteCode, siteCode]);

  useEffect(() => {
    if (hostKey || hosts.length === 0) return;
    const next = pickDefaultGateHostKey(hosts);
    if (next) setHostKey(next);
  }, [hostKey, hosts]);

  useEffect(() => {
    if (!navigator.geolocation) {
      setGps("unavailable");
      return;
    }
    setGps("searching");
    const watch = navigator.geolocation.watchPosition(
      (position) => {
        setGps("locked");
        setOrigin({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        });
      },
      (error) => {
        setOrigin(null);
        setGps(error.code === error.PERMISSION_DENIED ? "denied" : "unavailable");
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 10000 },
    );
    return () => navigator.geolocation.clearWatch(watch);
  }, []);

  const fence = evaluateGpsFence({
    gps,
    origin,
    site: selectedGateLocation?.latitude != null && selectedGateLocation?.longitude != null
      ? {
          latitude: selectedGateLocation.latitude,
          longitude: selectedGateLocation.longitude,
          siteRadiusMeters: selectedGateLocation.geofenceRadiusM ?? 500,
        }
      : null,
  });
  const gpsStatus = fence.milesToSite == null ? "unavailable" : fence.insideFence ? "verified" : "mismatch";
  const gpsLabel = !selectedGateLocation ? t("gatekeeper.selectGateLocation")
    : gpsStatus === "verified" ? t("gatekeeper.gpsAtSelectedLocation")
    : gpsStatus === "mismatch" ? t("gatekeeper.gpsOutsideGeofence")
    : gps === "searching" ? t("gatekeeper.gpsSearching") : t("gatekeeper.gpsUnavailable");
  const gpsDetail = gps === "locked" && selectedGateLocation && fence.milesToSite == null
    ? t("gatekeeper.gpsGateUnconfigured")
    : fence.milesToSite != null ? t("gatekeeper.gpsDistanceEvidence", { miles: fence.milesToSite.toFixed(1), radius: fence.radiusMiles?.toFixed(1) })
    : t("gatekeeper.gpsRequiredToSubmit");
  const pendingVisits = activeVisits.filter(
    (visit) => sharedSiteIds.includes(visit.siteLocationId) && !visit.checkOutTime && visit.reconciliationState !== "confirmed_off_site" && visit.admissionStatus === "pending",
  ).slice(0, 100);
  const onSiteVisits = activeVisits.filter(
    (visit) => sharedSiteIds.includes(visit.siteLocationId) && !visit.checkOutTime && visit.reconciliationState !== "confirmed_off_site" && visit.admissionStatus !== "pending",
  ).slice(0, 100);

  const currentPlateMatchKey = plateMatchKey(plateState, vehiclePlate);
  useEffect(() => {
    const snapshot = plateAutoFillRef.current;
    if (!snapshot || snapshot.matchKey === currentPlateMatchKey) return;
    const next = { ...entryDraft };
    const replacement = previousPlateVisit
      ? fillFromVisit(previousPlateVisit)
      : null;
    const replacementValues: Partial<Record<PlateAutoFillField, string>> = {};
    for (const field of PLATE_AUTO_FILL_FIELDS) {
      const autoFilledValue = snapshot.values[field];
      if (autoFilledValue == null || entryDraft[field] !== autoFilledValue)
        continue;
      const replacementValue =
        replacement?.[field] || (field === "expectedDuration" ? "240" : "");
      next[field] = replacementValue;
      if (replacement?.[field]) replacementValues[field] = replacementValue;
    }
    plateAutoFillRef.current =
      currentPlateMatchKey && Object.keys(replacementValues).length > 0
        ? { matchKey: currentPlateMatchKey, values: replacementValues }
        : null;
    if (!draftsEqual(next, entryDraft)) applyEntryDraft(next);
  }, [currentPlateMatchKey, entryDraft, previousPlateVisit]);

  useEffect(() => {
    if (!memory.fill) return;
    const next = mergeGateFill(entryDraft, memory.fill);
    if (draftsEqual(next, entryDraft)) return;
    if (currentPlateMatchKey) {
      const values =
        plateAutoFillRef.current?.matchKey === currentPlateMatchKey
          ? { ...plateAutoFillRef.current.values }
          : {};
      for (const field of PLATE_AUTO_FILL_FIELDS) {
        if (next[field] !== entryDraft[field]) values[field] = next[field];
      }
      if (Object.keys(values).length > 0) {
        plateAutoFillRef.current = { matchKey: currentPlateMatchKey, values };
      }
    }
    setMemoryDeleting(false);
    applyEntryDraft(next);
  }, [currentPlateMatchKey, entryDraft, memory.fill]);

  const resetEntry = () => {
    entryDraftRef.current = { firstName: "", lastName: "", company: "", vehiclePlate: "", plateState: null, purpose: "", notes: "", expectedDuration: "240" };
    plateAutoFillRef.current = null;
    setFirstName("");
    setLastName("");
    setCompany("");
    setVehiclePlate("");
    setPurpose("");
    setEntryCategory("");
    setNotes("");
    setDuration("240");
    setHostKey("");
    setPlateState(null);
    setPlateStateError(null);
    setOcrStateNotice(null);
    setPlatePhotoUrl(null);
    setVehiclePhotoUrl(null);
    setActiveMemoryField(null);
    setMemoryDeleting(false);
    setPlateOcrStatus("idle");
    setOcrPlate(null);
    setVoiceCheckInPending(false);
    setVoiceCheckoutMatches([]);
  };
  resetVoiceDraftRef.current = resetEntry;
  const voiceSiteRef = useRef(site.data?.site.id);
  voiceSiteRef.current = site.data?.site.id;
  useEffect(() => registerGateVoiceForm({
    read: () => ({
      ...entryDraftRef.current,
      expectedDurationMinutes: Number(entryDraftRef.current.expectedDuration),
      siteLocationId: voiceSiteRef.current,
      ...(selectedHost ? {
        hostType: selectedHost.type,
        ...(selectedHost.type === "partner" ? { hostPartnerId: selectedHost.id } : { hostVendorId: selectedHost.id }),
      } : {}),
      gateStationId: selectedGateLocation?.id,
      entryCategory: entryCategory || undefined,
      platePhotoUrl: platePhotoUrl ?? undefined,
      vehiclePhotoUrl: vehiclePhotoUrl ?? undefined,
      latitude: origin?.latitude,
      longitude: origin?.longitude,
    }),
    saved: submitted => {
      if (gateDraftMatches({ ...entryDraftRef.current, siteLocationId: voiceSiteRef.current }, submitted)) resetVoiceDraftRef.current();
    },
  }), [entryCategory, origin?.latitude, origin?.longitude, platePhotoUrl, selectedGateLocation?.id, selectedHost, vehiclePhotoUrl]);
  useEffect(() => notifyGateVoiceDraftChanged(), [entryCategory, entryDraft, origin?.latitude, origin?.longitude, platePhotoUrl, selectedGateLocation?.id, selectedHost, site.data?.site.id, vehiclePhotoUrl]);

  const usePreviousPlateDetails = () => {
    if (!previousPlateVisit) return;
    plateAutoFillRef.current = null;
    setMemoryDeleting(false);
    applyEntryDraft(
      mergeGateFill(entryDraft, {
        firstName: previousPlateVisit.firstName,
        lastName: previousPlateVisit.lastName,
        company: previousPlateVisit.company ?? "",
        vehiclePlate: previousPlateVisit.vehiclePlate ?? "",
        plateState: previousPlateVisit.plateState,
        purpose: previousPlateVisit.purpose ?? "",
        expectedDuration:
          previousPlateVisit.expectedDurationMinutes?.toString() ?? "240",
      }),
    );
  };

  const capture = async (file: File | undefined, kind: "plate" | "vehicle") => {
    if (!file) return;
    setBusy(true);
    setError(null);
    if (kind === "plate") {
      setPlateOcrStatus("reading");
      setOcrStateNotice(null);
    }
    try {
      if (kind === "vehicle") {
        const next = await uploadEvidence(file, t);
        void deleteUnattachedEvidence(vehiclePhotoUrl);
        setVehiclePhotoUrl(next);
        return;
      }
      const objectPath = await uploadEvidence(file, t);
      const candidate = await visitsApi
        .readPlate({ objectPath })
        .catch(() => null);
      void deleteUnattachedEvidence(platePhotoUrl);
      setPlatePhotoUrl(objectPath);
      if (candidate?.plate) {
        setMemoryDeleting(false);
        const confidentPlate =
          candidate.plateConfidence != null &&
          candidate.plateConfidence >= PLATE_OCR_STATE_CONFIDENCE_THRESHOLD;
        const confidentState =
          candidate.stateConfidence != null &&
          candidate.stateConfidence >= PLATE_OCR_STATE_CONFIDENCE_THRESHOLD
            ? normalizePlateState(candidate.state)
            : null;
        // History identity autofill from OCR requires the same confident
        // plate+state pair used by the established state-correction flow.
        // A plate alone remains visible for manual confirmation without
        // guessing who is driving it.
        setActiveMemoryField(
          confidentPlate && confidentState ? "vehiclePlate" : null,
        );
        const automatedPlate = reconcileAutomatedPlateUpdate({
          currentPlate: vehiclePlate,
          currentState: plateState,
          automatedPlate: candidate.plate,
          automatedState: confidentState,
        });
        setVehiclePlate(automatedPlate.vehiclePlate ?? "");
        setPlateState(automatedPlate.plateState);
        setPlateStateError(null);
        setOcrPlate(automatedPlate.vehiclePlate);
        if (confidentState) {
          setOcrStateNotice({
            suggestedState: confidentState,
            selectedState: confidentState,
          });
        }
        setPlateOcrStatus("read");
      } else {
        setPlateOcrStatus("unreadable");
      }
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : t("gatekeeper.photoUploadFailed"),
      );
      if (kind === "plate") setPlateOcrStatus("unreadable");
    } finally {
      setBusy(false);
    }
  };

  const checkIn = async () => {
    if (gateSaveInFlightRef.current) return;
    const { firstName, lastName, company, vehiclePlate, plateState, purpose, notes, expectedDuration: duration } = entryDraftRef.current;
    const context = site.data;
    if (
      !context ||
      !firstName.trim() ||
      !lastName.trim() ||
      !vehiclePlate.trim()
    ) {
      setError(t("gatekeeper.requiredFields"));
      return;
    }
    if ((gateLocations.data?.stations.length ?? 0) > 1 && !selectedGateLocation) {
      setError(t("gatekeeper.selectGateLocation"));
      return;
    }
    setPlateStateError(null);
    gateSaveInFlightRef.current = true;
    setBusy(true);
    setError(null);
    try {
      const minutes = Number.parseInt(duration, 10);
      await visitsApi.gateCheckIn({
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        company: company.trim() || undefined,
        vehiclePlate: vehiclePlate.trim() || undefined,
        plateState: plateState ?? undefined,
        purpose: purpose.trim() || undefined,
        entryCategory: entryCategory || null,
        notes: notes.trim() || undefined,
        expectedDurationMinutes:
          Number.isFinite(minutes) && minutes > 0 ? minutes : undefined,
        siteLocationId: context.site.id,
        platePhotoUrl: platePhotoUrl ?? undefined,
        vehiclePhotoUrl: vehiclePhotoUrl ?? undefined,
        latitude: origin?.latitude,
        longitude: origin?.longitude,
        gateStationId: selectedGateLocation?.id,
      });
      resetEntry();
      setVoiceResponse({ messageKey: "gatekeeper.checkedInTitle" });
      await queryClient.invalidateQueries({ queryKey: ["gatekeeper-visits"] });
      await queryClient.invalidateQueries({ queryKey: ["gatekeeper-departures"] });
      await queryClient.invalidateQueries({
        queryKey: ["gatekeeper-recent-visits"],
      });
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : t("gatekeeper.checkInFailed"),
      );
    } finally {
      gateSaveInFlightRef.current = false;
      setBusy(false);
    }
  };
  submitVoiceDraftRef.current = checkIn;

  const checkOut = async (id: number) => {
    if (gateSaveInFlightRef.current) return;
    gateSaveInFlightRef.current = true;
    setBusy(true);
    setError(null);
    try {
      const coords = origin;
      await visitsApi.gateCheckOut(
        id,
        coords?.latitude,
        coords?.longitude,
        undefined,
        selectedGateLocation?.id,
      );
        resetEntry();
      await queryClient.invalidateQueries({ queryKey: ["gatekeeper-visits"] });
      await queryClient.invalidateQueries({ queryKey: ["gatekeeper-departures"] });
      await queryClient.invalidateQueries({
        queryKey: ["gatekeeper-recent-visits"],
      });
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : t("gatekeeper.checkOutFailed"),
      );
    } finally {
      gateSaveInFlightRef.current = false;
      setBusy(false);
    }
  };
  checkoutVoiceRef.current = checkOut;

  const admitVisit = async (id: number) => {
    setBusy(true);
    setError(null);
    try {
      await visitsApi.gateAdmit(id);
      await queryClient.invalidateQueries({ queryKey: ["gatekeeper-visits"] });
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : t("gatekeeper.checkInFailed"),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={FIELD_OPS_PAGE_CLASS} data-testid="gatekeeper-page">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <ContentPaneBackLink href="/gate/change-over" ariaLabel={t("nav.dashboard")} testId="button-back" />
          <ClipboardList aria-hidden="true" data-testid="gate-header-icon" className="h-5 w-5 shrink-0 text-[var(--brand-primary)]" />
          <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            {t("gatekeeper.title")}
          </h1>
          {voiceListening && (
            <p role="status" aria-live="polite" className="mt-1 text-sm font-medium text-[color:var(--brand-primary)]">
              {t("gatekeeper.voiceListening")}
            </p>
          )}
          {voiceTranscribing && (
            <p role="status" aria-live="polite" className="mt-1 text-sm font-medium text-[color:var(--brand-primary)]">
              {t("gatekeeper.voiceTranscribing")}
            </p>
          )}
          {voiceResponse && (
            <p
              className="mt-1 text-sm font-medium text-[color:var(--brand-primary)]"
              data-testid="gate-askv-response"
              role="status"
            >
              {t(voiceResponse.messageKey, voiceResponse.params)}
            </p>
          )}
          </div>
        </div>
      </div>

      <WorkdayControls watchControl={
        <GateSiteGateSelect sites={assignedSites.map(row => ({ id: row.id, name: siteDisplayName(row) }))}
          siteId={site.data?.site.id ?? 0} gate={selectedGateLocation}
          testId="select-gate-current-location" gpsStatus={gpsStatus} gpsLabel={gpsLabel} gpsDetail={gpsDetail}
          onChange={(nextSiteId, nextGateId) => {
            const nextSite = assignedSites.find(row => row.id === nextSiteId);
            if (!nextSite) return;
            setSiteCode(nextSite.siteCode); setConfirmedCode(nextSite.siteCode);
            setGateLocationId(nextGateId);
            if (nextSite.siteCode !== confirmedCode) setHostKey("");
          }} />
      } />

      {live.flash && (
        <div
          className="flex items-center gap-4 rounded-xl border-2 border-amber-500 bg-amber-50 p-4 text-foreground shadow-md dark:bg-amber-100/80"
          data-testid="gate-live-flash"
          role="status"
        >
          {live.flash.platePhotoUrl ? (
            <img
              src={evidenceUrl(live.flash.platePhotoUrl)}
              alt=""
              className="h-16 w-24 shrink-0 rounded-md object-cover"
            />
          ) : (
            <Shield className="h-10 w-10 shrink-0" style={iconStyle} />
          )}
          <div className="min-w-0 flex-1">
            <p className="text-lg font-bold leading-tight">
              {live.flash.kind === "checked_in"
                ? t("gatekeeper.liveCheckedIn", {
                    name: `${live.flash.firstName} ${live.flash.lastName}`.trim(),
                  })
                : t("gatekeeper.liveCheckedOut", {
                    name: `${live.flash.firstName} ${live.flash.lastName}`.trim(),
                  })}
            </p>
            <p className="mt-1 truncate text-sm text-muted-foreground">
              {[
                live.flash.company,
                displayPlate(live.flash.plateState, live.flash.vehiclePlate),
                live.flash.siteName,
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </div>
          <LiveConnectionPill
            status={live.liveStatus}
            compact
            onRefresh={() => void visits.refetch()}
          />
        </div>
      )}

      <div className="grid items-start gap-6 lg:grid-cols-2">
        <Card
          ref={entryCardRef}
          className="!border-[color:var(--brand-primary)]"
          data-testid="gate-new-entry-card"
          data-brand-outline="true"
          style={{ borderColor: brand.primary }}
        >
          <CardHeader>
            <CardTitle>{t("gatekeeper.newEntry")}</CardTitle>
            <p className="text-sm text-muted-foreground">
              {t("gatekeeper.memoryHint")}
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            {error && (
              <div
                role="alert"
                className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
              >
                {error}
              </div>
            )}
            {voiceCheckInPending && (
              <div
                className={`${CARD_INNER_TILE_CLASS} space-y-3 border-[color:var(--brand-primary)]`}
                data-testid="gate-voice-checkin-confirmation"
              >
                <p className="text-sm font-semibold text-foreground">
                  {t("gatekeeper.voiceConfirmCheckIn")}
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <BlueButton onClick={() => setVoiceCheckInPending(false)}>
                    {t("common.cancel")}
                  </BlueButton>
                  <AmberButton
                    disabled={busy || !site.data}
                    data-testid="button-gate-voice-confirm-checkin"
                    onClick={() => {
                      setVoiceCheckInPending(false);
                      void checkIn();
                    }}
                  >
                    {t("gatekeeper.voiceConfirm")}
                  </AmberButton>
                </div>
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="gate-vehicle-plate" className="text-base font-bold">{t("gatekeeper.vehiclePlate")} *</Label>
              <div className="grid grid-cols-2 gap-3">
                <button type="button"
                  className="gate-history-filter flex w-full items-center justify-center text-sm"
                  onClick={() => plateInput.current?.click()}
                  disabled={busy}
                  data-testid="button-gate-read-plate"
                  aria-pressed={Boolean(platePhotoUrl)}
                >
                  <Camera className="mr-2 h-4 w-4" aria-hidden="true" />
                  {platePhotoUrl
                    ? t("gatekeeper.plateAttached")
                    : t("gatekeeper.capturePlate")}
                </button>
                <button type="button"
                  className="gate-history-filter flex w-full items-center justify-center text-sm"
                  onClick={() => vehicleInput.current?.click()}
                  disabled={busy}
                  data-testid="button-gate-vehicle-photo"
                  aria-pressed={Boolean(vehiclePhotoUrl)}
                >
                  <Camera className="mr-2 h-4 w-4" aria-hidden="true" />
                  {vehiclePhotoUrl
                    ? t("gatekeeper.vehicleAttached")
                    : t("gatekeeper.vehiclePhoto")}
                </button>
              </div>
              <GateMemoryInput
                id="gate-vehicle-plate"
                required
                aria-required="true"
                value={vehiclePlate}
                suggestions={
                  activeMemoryField === "vehiclePlate"
                    ? displayMemorySuggestions
                    : []
                }
                suggestionsLabel={t("gatekeeper.memorySuggestions")}
                onPick={onMemoryPick}
                onChange={(event) =>
                  onMemoryFieldChange("vehiclePlate", event.target.value)
                }
                onFocus={() => setActiveMemoryField("vehiclePlate")}
                data-testid="input-gate-plate"
                className={`${WORK_HUB_BRANDED_FIELD_CLASS} font-bold tracking-widest`}
              />
              <PlateStatePicker
                value={plateState}
                onChange={(stateCode) => {
                  setPlateState(stateCode);
                  setPlateStateError(null);
                  setOcrStateNotice((notice) =>
                    notice ? { ...notice, selectedState: stateCode } : null,
                  );
                }}
                preferredStates={orderedStatePreferences}
                error={plateStateError ?? undefined}
              />
              <p className="text-xs text-muted-foreground">
                {t("gatekeeper.plateStateOptionalHint")}
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="gate-first-name">{t("gatekeeper.firstName")} * </Label>
                <GateMemoryInput
                  id="gate-first-name"
                  required
                  aria-required="true"
                  value={firstName}
                  suggestions={
                    activeMemoryField === "firstName"
                      ? displayMemorySuggestions
                      : []
                  }
                  suggestionsLabel={t("gatekeeper.memorySuggestions")}
                  onPick={onMemoryPick}
                  onChange={(event) =>
                    onMemoryFieldChange("firstName", event.target.value)
                  }
                  onFocus={() => setActiveMemoryField("firstName")}
                  data-testid="input-gate-first-name"
                  className={WORK_HUB_BRANDED_FIELD_CLASS}
                />
              </div>
              <div>
                <Label htmlFor="gate-last-name">{t("gatekeeper.lastName")} *</Label>
                <GateMemoryInput
                  id="gate-last-name"
                  required
                  aria-required="true"
                  value={lastName}
                  suggestions={
                    activeMemoryField === "lastName"
                      ? displayMemorySuggestions
                      : []
                  }
                  suggestionsLabel={t("gatekeeper.memorySuggestions")}
                  onPick={onMemoryPick}
                  onChange={(event) =>
                    onMemoryFieldChange("lastName", event.target.value)
                  }
                  onFocus={() => setActiveMemoryField("lastName")}
                  data-testid="input-gate-last-name"
                  className={WORK_HUB_BRANDED_FIELD_CLASS}
                />
              </div>
            </div>
            <div>
              <Label htmlFor="gate-company">{t("gatekeeper.company")}</Label>
              <GateMemoryInput
                id="gate-company"
                value={company}
                suggestions={
                  activeMemoryField === "company"
                    ? displayMemorySuggestions
                    : []
                }
                suggestionsLabel={t("gatekeeper.memorySuggestions")}
                onPick={onMemoryPick}
                onChange={(event) =>
                  onMemoryFieldChange("company", event.target.value)
                }
                onFocus={() => setActiveMemoryField("company")}
                data-testid="input-gate-company"
                className={WORK_HUB_BRANDED_FIELD_CLASS}
              />
            </div>
            {showPreviousBanner && previousPlateVisit && (
              <div
                className={`${CARD_INNER_TILE_CLASS} flex items-center justify-between gap-3 text-sm`}
              >
                <span>
                  {t("gatekeeper.previousVisit", {
                    firstName: previousPlateVisit.firstName,
                    lastName: previousPlateVisit.lastName,
                  })}
                </span>
                <BlueButton onClick={usePreviousPlateDetails}>
                  {t("gatekeeper.useDetails")}
                </BlueButton>
              </div>
            )}
            {previousPlateVisit && firstName.trim() && lastName.trim() && (
              <p
                className="text-sm text-muted-foreground"
                data-testid="gate-last-driver-hint"
              >
                {t("gatekeeper.lastDriverHint", {
                  firstName: previousPlateVisit.firstName,
                  lastName: previousPlateVisit.lastName,
                  company: previousPlateVisit.company
                    ? ` · ${previousPlateVisit.company}`
                    : "",
                })}
              </p>
            )}
            {plateOcrStatus === "reading" && (
              <p className="text-sm text-muted-foreground">
                {t("gatekeeper.plateReading")}
              </p>
            )}
            {plateOcrStatus === "read" && ocrPlate && (
              <p className="text-sm text-muted-foreground">
                {t("gatekeeper.plateRead", { plate: ocrPlate })}
              </p>
            )}
            {plateOcrStatus === "unreadable" && (
              <p className="text-sm text-muted-foreground">
                {t("gatekeeper.plateUnreadable")}
              </p>
            )}
            {ocrStateNotice ? (
              <p className="text-sm text-muted-foreground" role="status">
                {t(
                  ocrStateNotice.selectedState === ocrStateNotice.suggestedState
                    ? "gatekeeper.plateStateSuggested"
                    : "gatekeeper.plateStateCorrected",
                  { state: ocrStateNotice.selectedState },
                )}
              </p>
            ) : null}
            {site.isLoading && (
              <Loader2 className="animate-spin text-muted-foreground" />
            )}
            {site.error && (
              <p className="text-sm text-destructive">
                {t("gatekeeper.siteNotFound")}
              </p>
            )}
            <div>
              <Label htmlFor="gate-purpose">{t("gatekeeper.purpose")}</Label>
              <Textarea
                id="gate-purpose"
                data-testid="input-gate-purpose"
                className={GATE_TALL_FIELD_CLASS}
                value={purpose}
                onChange={(e) => {
                  forgetPlateAutoFill("purpose");
                  setPurpose(e.target.value);
                }}
              />
            </div>
            <div>
              <Label htmlFor="gate-entry-category">{t("gateReport.category")}</Label>
              <BrandedSelect id="gate-entry-category" value={entryCategory} onChange={e => setEntryCategory(e.target.value as typeof entryCategory)}>
                {["", "visitor", "routine_vendor_work", "partner_admin", "vendor_admin"].map(value => <option key={value} value={value}>{t(`gateReport.${value || "unclassified"}`)}</option>)}
              </BrandedSelect>
            </div>
            <div>
              <Label htmlFor="gate-notes">{t("gatekeeper.notes")}</Label>
              <Textarea
                id="gate-notes"
                data-testid="input-gate-notes"
                className={GATE_TALL_FIELD_CLASS}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder={t("gatekeeper.notesPlaceholder")}
              />
            </div>
            <div>
              <Label htmlFor="gate-expected-duration">{i18n?.language?.startsWith("es") ? "Tiempo previsto" : "Expected Time"}</Label>
              <BrandedSelect id="gate-expected-duration" data-testid="input-gate-duration"
                value={Number(duration) <= 240 ? "240" : Number(duration) <= 600 ? "600" : "720"}
                onChange={e => { forgetPlateAutoFill("expectedDuration"); setDuration(e.target.value); }}>
                <option value="240">{i18n?.language?.startsWith("es") ? "Menos de 4 horas" : "Less than 4hrs"}</option>
                <option value="600">{t("gatekeeper.durationAllDay")}</option>
                <option value="720">{t("gatekeeper.durationOvernight")}</option>
              </BrandedSelect>
            </div>
            <input
              ref={plateInput}
              data-askv-camera="plate"
              className="hidden"
              type="file"
              accept="image/*"
              capture="environment"
              onChange={(e) => void capture(e.target.files?.[0], "plate")}
            />
            <input
              ref={vehicleInput}
              data-askv-camera="vehicle"
              className="hidden"
              type="file"
              accept="image/*"
              capture="environment"
              onChange={(e) => void capture(e.target.files?.[0], "vehicle")}
            />
            <button type="button"
              className="gate-history-filter w-full"
              onClick={() => void checkIn()}
              disabled={busy || !site.data}
              data-testid="button-gate-check-in"
            >
              {busy ? t("gatekeeper.working") : t("gatekeeper.checkInVisitor")}
            </button>
          </CardContent>
        </Card>
        <div className="min-w-0 space-y-3">
        <Card
          className="flex min-h-0 flex-col overflow-hidden !border-[color:var(--brand-primary)]"
          data-testid="gate-on-site-card"
          data-brand-outline="true"
          style={{
            borderColor: brand.primary,
            height: entryCardHeight ?? 560,
          }}
        >
          <CardHeader className="gate-presence-header flex-row items-center justify-between gap-2 space-y-0 px-4">
            <CardTitle className="gate-presence-tabs" role="group" aria-label={t("gatekeeper.activityViews")}>
              <button type="button" className={`gate-presence-tab${arrivals.newInboundIds.size ? " gate-arrivals-alert" : ""}`} aria-pressed={presenceView === "arrivals"} onClick={() => setPresenceView("arrivals")}>
                {t("gatekeeper.arrivalsTab")}
              </button>
              <span className="gate-presence-divider" aria-hidden="true">|</span>
              <button type="button" className="gate-presence-tab" aria-pressed={presenceView === "active"} onClick={() => setPresenceView("active")}>
                {t("gatekeeper.onSiteTab")}
              </button>
              <span className="gate-presence-divider" aria-hidden="true">|</span>
              <button type="button" className="gate-presence-tab" aria-pressed={presenceView === "departures"} onClick={() => setPresenceView("departures")}>
                {t("gatekeeper.departuresTab")}
              </button>
            </CardTitle>
            <div className="ml-auto flex items-center gap-2">
              <button
                type="button"
                className="gate-presence-refresh"
                onClick={() => void (presenceView === "arrivals" ? Promise.all([arrivals.refetch(), visits.refetch()]) : presenceView === "departures" ? departures.refetch() : visits.refetch())}
                disabled={presenceView === "arrivals" ? arrivals.isFetching || visits.isFetching : presenceView === "departures" ? departures.isFetching : visits.isFetching}
                data-testid="button-gate-refresh"
                aria-label={t("common.refresh")}
                title={t("common.refresh")}
              >
                <RefreshCw className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          </CardHeader>
          <CardContent className="flex min-h-0 flex-1 flex-col gap-3">
            <div
              className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1"
              data-testid={presenceView === "arrivals" ? "gate-arrivals" : presenceView === "departures" ? "gate-recent-departures" : "gate-on-site-entries"}
              role="region"
              aria-label={t(presenceView === "arrivals" ? "gatekeeper.arrivalsTab" : presenceView === "departures" ? "gatekeeper.departuresTab" : "gatekeeper.onSiteTab")}
            >
            {presenceView === "arrivals" ? <>
            {pendingVisits.length > 0 && <div className="space-y-2" data-testid="gate-pending-visitors">
              <p className="text-sm font-semibold text-foreground">{t("gatekeeper.pendingAdmit")}</p>
              {pendingVisits.map(visit => <GateTrafficRecord key={visit.id} name={`${visit.firstName} ${visit.lastName}`}
                description={[visit.company, displayPlate(visit.plateState, visit.vehiclePlate), visit.siteName].filter(Boolean).join(" · ")}
                flags={gateRecordFlags({ ...visit, expectedMinutes: visit.expectedDurationMinutes }, i18n?.language?.startsWith("es"))}
                status={isGateEntryCleared(visit) ? (i18n?.language?.startsWith("es") ? "Autorizado" : "Admitted") : t("gatekeeper.pendingAdmit")} className={isGateEntryCleared(visit) ? "gate-traffic-approved" : "gate-traffic-pending"} onOpen={() => setDetailVisitId(visit.id)}
                footer={<span data-testid={`gate-reconciliation-status-${visit.id}`}>{isGateEntryCleared(visit) ? (i18n?.language?.startsWith("es") ? "Puede entrar · esperando llegada" : "Cleared to enter · awaiting arrival") : visit.reconciliationState === "needs_supervisor_review" ? t("gatekeeper.reconciliationReview") : visit.reconciliationState === "observed" ? t("gatekeeper.reconciliationObserved") : t("gatekeeper.pendingAdmit")}</span>}
                action={!isGateEntryCleared(visit) && <button type="button" className="gate-history-filter" onClick={() => void admitVisit(visit.id)} disabled={busy} data-testid={`button-gate-admit-${visit.id}`}>{t("gatekeeper.admit")}</button>} />)}
            </div>}
            <GateArrivalsPanel query={arrivals} onOpen={setDetailRunId} limit={100 - pendingVisits.length} hideEmpty={pendingVisits.length > 0} /></> : presenceView === "departures" ? (
              departures.isLoading || site.isLoading ? <Loader2 className="animate-spin text-muted-foreground" />
              : departures.isError ? <p role="alert" className="text-sm text-destructive">{t("gatekeeper.departuresLoadFailed")}</p>
              : recentDepartures.length === 0 ? <p className="text-sm text-muted-foreground">{t("gatekeeper.noRecentDepartures")}</p>
              : recentDepartures.map(visit => <GateTrafficRecord key={visit.id} testId="gate-recent-departure"
                  name={`${visit.firstName} ${visit.lastName}`} description={[visit.company, displayPlate(visit.plateState, visit.vehiclePlate)].filter(Boolean).join(" · ")}
                  status={t("gatekeeper.departuresTab")} onOpen={() => setDetailVisitId(visit.id)}
                  flags={gateRecordFlags({ ...visit, expectedMinutes: visit.expectedDurationMinutes }, i18n?.language?.startsWith("es"))}
                  action={<Link className="gate-history-filter" aria-label={`View: ${visit.firstName} ${visit.lastName}`} href={`/gate/history?siteId=${visit.siteLocationId}&recordType=check_outs&recordId=visit%3A${visit.id}`}>{i18n?.language?.startsWith("es") ? "Ver" : "View"}</Link>}>
                  <span className="text-xs text-muted-foreground">{t("gatekeeper.historyCheckedIn")} · {new Date(visit.checkInTime).toLocaleString()}</span>
                  <span className="text-xs text-muted-foreground">{t("gatekeeper.historyCheckedOut")} · {new Date(visit.checkOutTime!).toLocaleString()}</span>
                  <span className="text-xs text-muted-foreground">{i18n?.language?.startsWith("es") ? "Tiempo en el sitio" : "Time On Site"}: {gateDurationHHMM(Date.parse(visit.checkOutTime!) - Date.parse(visit.checkInTime))}</span>
                  {visit.checkOutNotes && <span className="whitespace-pre-wrap text-xs text-muted-foreground">{visit.checkOutNotes}</span>}
                </GateTrafficRecord>)
            ) : <>
            {visits.isLoading ? <Loader2 className="animate-spin text-muted-foreground" /> : onSiteVisits.length === 0 ? <p className="text-sm text-muted-foreground">{t("gatekeeper.noActive")}</p> : onSiteVisits.map(visit => {
              const dwell = onSiteDwell({ checkInTime: visit.checkInTime, expectedDurationMinutes: visit.expectedDurationMinutes });
              return <GateTrafficRecord key={visit.id} name={`${visit.firstName} ${visit.lastName}`}
                description={[visit.company, displayPlate(visit.plateState, visit.vehiclePlate), visit.siteName].filter(Boolean).join(" · ")}
                status={t("gatekeeper.onSiteTab")} overdue={dwell.overdue} onOpen={() => setDetailVisitId(visit.id)}
                className={live.flash?.visitId === visit.id ? "ring-2 ring-amber-500" : ""}
                flags={gateRecordFlags({ ...visit, expectedMinutes: visit.expectedDurationMinutes }, i18n?.language?.startsWith("es"))}
                action={<button type="button" className="gate-history-filter" onClick={() => void checkOut(visit.id)} disabled={busy}>{t("gatekeeper.checkOut")}</button>}>
                <span className="text-xs text-muted-foreground">{t("gatekeeper.historyCheckedIn")} · {new Date(visit.checkInTime).toLocaleString()}</span>
                {(visit.reconciliationState === "observed" || visit.reconciliationState === "needs_supervisor_review") && <span className="text-xs text-amber-400" data-testid={`gate-reconciliation-status-${visit.id}`}>{t(visit.reconciliationState === "observed" ? "gatekeeper.reconciliationObserved" : "gatekeeper.reconciliationReview")}</span>}
              </GateTrafficRecord>;
            })}
            {voiceCheckoutMatches.length > 0 && (
              <div className={`${CARD_INNER_TILE_CLASS} space-y-3 border-[color:var(--brand-primary)]`} data-testid="gate-voice-checkout-confirmation">
                <p className="text-sm font-semibold text-foreground">
                  {voiceCheckoutMatches.length === 1
                    ? t("gatekeeper.voiceConfirmCheckOut")
                    : t("gatekeeper.voiceChooseCheckout")}
                </p>
                <div className="space-y-2">
                  {voiceCheckoutMatches.map((visit) => (
                    <AmberButton
                      key={visit.id}
                      className="w-full"
                      disabled={busy}
                      data-testid={`button-gate-voice-checkout-${visit.id}`}
                      onClick={() => {
                        setVoiceCheckoutMatches([]);
                        void checkOut(visit.id);
                      }}
                    >
                      {t("gatekeeper.voiceCheckOutRecord", {
                        name: `${visit.firstName ?? ""} ${visit.lastName ?? ""}`.trim(),
                        plate: visit.vehiclePlate ?? "",
                      })}
                    </AmberButton>
                  ))}
                </div>
                <BlueButton className="w-full" onClick={() => setVoiceCheckoutMatches([])}>
                  {t("common.cancel")}
                </BlueButton>
              </div>
            )}
            </>}
            </div>
            {site.data ? <div className="flex shrink-0 justify-end pt-1">
              <Link className="gate-log-text-link"
                href={`/gate/history?siteLocationId=${site.data.site.id}`}
                data-testid="button-gate-full-history"
              >
                <History className="h-4 w-4" aria-hidden="true" />
                {t("gatekeeper.fullGateHistory")}
              </Link>
            </div> : null}
          </CardContent>
        </Card>
        <GateVisitDetails visitId={detailVisitId} onClose={() => setDetailVisitId(null)} onOpenRun={runId => { setDetailVisitId(null); setDetailRunId(runId); }} />
        <GateArrivalDetails siteId={arrivals.data?.arrivals.find(row => row.runId === detailRunId)?.siteLocationId ?? site.data?.site.id} runId={detailRunId} onClose={() => setDetailRunId(null)} />
        </div>
      </div>
    </div>
  );
}
