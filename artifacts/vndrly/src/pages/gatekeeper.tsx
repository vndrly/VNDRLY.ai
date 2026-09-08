import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  Camera,
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
import BlueButton from "@/components/blue-button";
import GreenButton from "@/components/green-button";
import { LiveConnectionPill } from "@/components/live-connection-pill";
import { GateMemoryInput } from "@/components/gate-memory-input";
import { PlateStatePicker } from "@/components/plate-state-picker";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CARD_INNER_TILE_CLASS,
  CARD_TITLE_ICON_CLASS,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
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
  groupAssignedGateSitesByPartner,
  pickNearestAssignedGateSite,
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
import {
  createGateSpeechSession,
  type GateSpeechRecognition,
} from "@/lib/gate-speech-session";
import {
  consumePendingGateVoiceEntry,
  setGateVoiceListening,
  subscribeGateVoiceEntry,
} from "@/lib/gate-voice-launch";
import { isAskVNaturalVoiceEnabled } from "@/lib/askv-natural-voice";
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
  formatFenceMilesSentence,
  GATE_DURATION_CHIPS,
  minutesForDurationChip,
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
  const { t } = useTranslation();
  const { user } = useAuth();
  const brand = useBrand();
  const iconStyle = { color: brand.isOrgBranded ? brand.primary : "#f59e0b" };
  const queryClient = useQueryClient();
  const plateInput = useRef<HTMLInputElement>(null);
  const vehicleInput = useRef<HTMLInputElement>(null);
  const appliedDefault = useRef(false);
  const plateAutoFillRef = useRef<PlateAutoFillSnapshot | null>(null);
  const [siteCode, setSiteCode] = useState("");
  const [confirmedCode, setConfirmedCode] = useState<string | null>(null);
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
  const [checkOutNotes, setCheckOutNotes] = useState("");
  const [duration, setDuration] = useState("60");
  const [gps, setGps] = useState<GpsLockState>("searching");
  const [origin, setOrigin] = useState<Coordinates | null>(null);
  const [platePhotoUrl, setPlatePhotoUrl] = useState<string | null>(null);
  const [vehiclePhotoUrl, setVehiclePhotoUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [voiceListening, setVoiceListening] = useState(false);
  const [voiceTranscribing, setVoiceTranscribing] = useState(false);
  const [voiceCheckInPending, setVoiceCheckInPending] = useState(false);
  const [voiceCheckoutMatches, setVoiceCheckoutMatches] = useState<VisitorRow[]>([]);
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
  const processVoiceTranscriptRef = useRef<(transcript: string) => void>(
    () => undefined,
  );
  processVoiceTranscriptRef.current = (transcript) => {
    const command = parseGateVoiceCommand(transcript);
    const fill = command.fill;
    if (Object.keys(fill).length === 0) {
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
    entryDraftRef.current = nextDraft;
    applyEntryDraftRef.current(nextDraft);
    setPlateStateError(null);
    setOcrStateNotice(null);
    plateAutoFillRef.current = null;
    if (command.intent === "check-out") {
      const matches = matchGateCheckoutVisits(
        activeVisitsRef.current,
        fill,
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
      return;
    }
    setVoiceCheckoutMatches([]);
    setVoiceCheckInPending(true);
    setError(null);
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
  };

  useEffect(() => {
    if (isAskVNaturalVoiceEnabled()) return;
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
              processVoiceTranscriptRef.current(transcript);
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
          onTranscript: (transcript) => processVoiceTranscriptRef.current(transcript),
          onListeningChange: publishListening,
          onError: reportVoiceError,
        });
    const launch = () => {
      if (processing) return;
      setError(null);
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
  const assignedSites = assigned.data?.sites ?? [];
  const assignedPartners = useMemo(() => groupAssignedGateSitesByPartner(assignedSites), [assignedSites]);
  const nearestSite = useMemo(() => pickNearestAssignedGateSite(assignedSites, origin), [assignedSites, origin]);
  const locationResolved = origin !== null || gps === "denied" || gps === "unavailable";
  const defaultSiteCode = locationResolved ? (nearestSite ?? assigned.data?.defaultSite)?.siteCode : undefined;
  const selectedAssignedSite = assignedSites.find((row) => row.siteCode === confirmedCode) ?? nearestSite ?? assigned.data?.defaultSite ?? null;
  const [selectedPartnerId, setSelectedPartnerId] = useState<string>("");
  useEffect(() => {
    if (selectedPartnerId || !selectedAssignedSite) return;
    setSelectedPartnerId(String(selectedAssignedSite.partnerId));
  }, [selectedAssignedSite, selectedPartnerId]);
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
        setGps(error.code === error.PERMISSION_DENIED ? "denied" : "searching");
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 10000 },
    );
    return () => navigator.geolocation.clearWatch(watch);
  }, []);

  const fence = evaluateGpsFence({
    gps,
    origin,
    site: site.data
      ? {
          latitude: site.data.site.latitude,
          longitude: site.data.site.longitude,
          siteRadiusMeters: site.data.site.siteRadiusMeters,
        }
      : null,
  });
  const fenceCopy = formatFenceMilesSentence(fence);
  const pendingVisits = activeVisits.filter(
    (visit) => visit.admissionStatus === "pending",
  );
  const onSiteVisits = activeVisits.filter(
    (visit) => visit.admissionStatus !== "pending",
  );

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
        replacement?.[field] || (field === "expectedDuration" ? "60" : "");
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
    plateAutoFillRef.current = null;
    setFirstName("");
    setLastName("");
    setCompany("");
    setVehiclePlate("");
    setPurpose("");
    setEntryCategory("");
    setNotes("");
    setCheckOutNotes("");
    setDuration("60");
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
          previousPlateVisit.expectedDurationMinutes?.toString() ?? "60",
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
        setActiveMemoryField("vehiclePlate");
        const confidentState =
          candidate.stateConfidence != null &&
          candidate.stateConfidence >= PLATE_OCR_STATE_CONFIDENCE_THRESHOLD
            ? normalizePlateState(candidate.state)
            : null;
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
    const context = site.data;
    const host = hosts.find((candidate) => candidate.key === hostKey);
    if (
      !context ||
      !host ||
      !firstName.trim() ||
      !lastName.trim() ||
      !vehiclePlate.trim()
    ) {
      setError(t("gatekeeper.requiredFields"));
      return;
    }
    if (!fence.canSubmit || !origin) {
      setError(t("gatekeeper.gpsRequiredToSubmit"));
      return;
    }
    setPlateStateError(null);
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
        hostType: host.type,
        hostPartnerId: host.type === "partner" ? host.id : undefined,
        hostVendorId: host.type === "vendor" ? host.id : undefined,
        platePhotoUrl: platePhotoUrl ?? undefined,
        vehiclePhotoUrl: vehiclePhotoUrl ?? undefined,
        latitude: origin.latitude,
        longitude: origin.longitude,
      });
      resetEntry();
      await queryClient.invalidateQueries({ queryKey: ["gatekeeper-visits"] });
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
      setBusy(false);
    }
  };

  const checkOut = async (id: number) => {
    setBusy(true);
    setError(null);
    try {
      const coords = await currentPosition(false, t);
      await visitsApi.gateCheckOut(
        id,
        coords?.latitude,
        coords?.longitude,
        checkOutNotes.trim() || undefined,
      );
      setCheckOutNotes("");
      await queryClient.invalidateQueries({ queryKey: ["gatekeeper-visits"] });
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
      setBusy(false);
    }
  };

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
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            {t("gatekeeper.title")}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("gatekeeper.subtitle")}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("gatekeeper.handsFreeHint")}
          </p>
          {voiceListening && (
            <p className="mt-1 text-sm font-medium text-[color:var(--brand-primary)]">
              {t("gatekeeper.voiceListening")}
            </p>
          )}
          {voiceTranscribing && (
            <p className="mt-1 text-sm font-medium text-[color:var(--brand-primary)]">
              {t("gatekeeper.voiceTranscribing")}
            </p>
          )}
        </div>
        <Link
          href="/gate/history"
          className="inline-flex shrink-0 items-center gap-2 text-sm font-semibold text-foreground underline-offset-4 hover:underline"
          data-testid="link-gate-history"
        >
          <History className="h-4 w-4" />
          {t("gatekeeper.history")}
        </Link>
      </div>

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

      <div className="grid gap-6 lg:grid-cols-[0.9fr_1.1fr]">
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle className="flex items-center gap-2">
              <Shield className={CARD_TITLE_ICON_CLASS} style={iconStyle} />
              {t("gatekeeper.onSiteNow")}
            </CardTitle>
            <div className="flex items-center gap-2">
              {!live.flash && (
                <LiveConnectionPill
                  status={live.liveStatus}
                  compact
                  onRefresh={() => void visits.refetch()}
                />
              )}
              <BlueButton
                onClick={() => void visits.refetch()}
                disabled={visits.isFetching}
                data-testid="button-gate-refresh"
              >
                <RefreshCw className="h-4 w-4" />
              </BlueButton>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {pendingVisits.length > 0 && (
              <div className="space-y-2" data-testid="gate-pending-visitors">
                <p className="text-sm font-semibold text-foreground">
                  {t("gatekeeper.pendingAdmit")}
                </p>
                {pendingVisits.map((visit) => (
                  <div
                    key={visit.id}
                    className={`${CARD_INNER_TILE_CLASS} flex items-center justify-between gap-3`}
                  >
                    <div className="min-w-0">
                      <p className="font-semibold text-foreground">
                        {visit.firstName} {visit.lastName}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {[
                          visit.company,
                          displayPlate(visit.plateState, visit.vehiclePlate),
                          visit.siteName,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                    </div>
                    <GreenButton
                      onClick={() => void admitVisit(visit.id)}
                      disabled={busy}
                      data-testid={`button-gate-admit-${visit.id}`}
                    >
                      {t("gatekeeper.admit")}
                    </GreenButton>
                  </div>
                ))}
              </div>
            )}
            {visits.isLoading ? (
              <Loader2 className="animate-spin text-muted-foreground" />
            ) : onSiteVisits.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {t("gatekeeper.noActive")}
              </p>
            ) : (
              onSiteVisits.map((visit) => {
                const dwell = onSiteDwell({
                  checkInTime: visit.checkInTime,
                  expectedDurationMinutes: visit.expectedDurationMinutes,
                });
                return (
                <div
                  key={visit.id}
                  className={`${CARD_INNER_TILE_CLASS} flex items-center justify-between gap-3 ${live.flash?.visitId === visit.id ? "ring-2 ring-amber-500" : ""}`}
                >
                  <div className="min-w-0">
                    <p className="font-semibold text-foreground">
                      {visit.firstName} {visit.lastName}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {[
                        visit.company,
                        displayPlate(visit.plateState, visit.vehiclePlate),
                        visit.siteName,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {t("gatekeeper.minutesOnSite", { minutes: dwell.minutesOnSite })}
                      {dwell.overdue
                        ? ` · ${t("gatekeeper.overdue", { minutes: dwell.overdueMinutes })}`
                        : ""}
                    </p>
                  </div>
                  <AmberButton
                    onClick={() => void checkOut(visit.id)}
                    disabled={busy}
                  >
                    {t("gatekeeper.checkOut")}
                  </AmberButton>
                </div>
                );
              })
            )}
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
            <div>
              <Label>{t("gatekeeper.checkOutNotes")}</Label>
              <Textarea
                value={checkOutNotes}
                onChange={(e) => setCheckOutNotes(e.target.value)}
                placeholder={t("gatekeeper.notesPlaceholder")}
                data-testid="input-gate-checkout-notes"
              />
            </div>
          </CardContent>
        </Card>

        <Card>
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
              <Label className="text-base font-bold">{t("gatekeeper.vehiclePlate")} *</Label>
              <div className="grid grid-cols-2 gap-3">
                <BlueButton
                  className="h-14 text-base"
                  onClick={() => plateInput.current?.click()}
                  disabled={busy}
                  data-testid="button-gate-read-plate"
                >
                  <Camera className="mr-2 h-5 w-5" />
                  {platePhotoUrl
                    ? t("gatekeeper.plateAttached")
                    : t("gatekeeper.capturePlate")}
                </BlueButton>
                <BlueButton
                  className="h-14 text-base"
                  onClick={() => vehicleInput.current?.click()}
                  disabled={busy}
                >
                  <Camera className="mr-2 h-5 w-5" />
                  {vehiclePhotoUrl
                    ? t("gatekeeper.vehicleAttached")
                    : t("gatekeeper.vehiclePhoto")}
                </BlueButton>
              </div>
              <GateMemoryInput
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
                className="h-14 text-lg font-bold tracking-widest"
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
                <Label>{t("gatekeeper.firstName")} * </Label>
                <GateMemoryInput
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
                />
              </div>
              <div>
                <Label>{t("gatekeeper.lastName")} *</Label>
                <GateMemoryInput
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
                />
              </div>
            </div>
            <div>
              <Label>{t("gatekeeper.company")}</Label>
              <GateMemoryInput
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
            <div className={`${CARD_INNER_TILE_CLASS} space-y-3`} data-testid="gate-selected-location">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {t("gatekeeper.selectedLocation")}
              </p>
              {assignedSites.length > 0 ? (
                <div className="grid gap-3 sm:grid-cols-2">
                <Select value={selectedPartnerId} onValueChange={(value) => { setSelectedPartnerId(value); setHostKey(""); }}>
                  <SelectTrigger data-testid="select-gate-partner" className="h-14 text-lg font-bold"><SelectValue placeholder="Select company" /></SelectTrigger>
                  <SelectContent>{assignedPartners.map((group) => <SelectItem key={group.partnerId} value={String(group.partnerId)}>{group.partnerName}</SelectItem>)}</SelectContent>
                </Select>
                <Select
                  value={
                    assignedSites.some((row) => row.siteCode === confirmedCode)
                      ? confirmedCode!
                      : ""
                  }
                  onValueChange={(code) => {
                    setSiteCode(code);
                    setConfirmedCode(code);
                    setHostKey("");
                  }}
                >
                  <SelectTrigger data-testid="select-gate-current-location" className="h-14 text-lg font-bold">
                    <SelectValue placeholder={t("gatekeeper.selectSite")} />
                  </SelectTrigger>
                  <SelectContent>
                    {(assignedPartners.find((group) => String(group.partnerId) === selectedPartnerId)?.sites ?? []).map((row) => (
                      <SelectItem key={row.siteCode} value={row.siteCode}>
                        {siteDisplayName(row)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                </div>
              ) : null}
              {site.data && (
                <p className="text-2xl font-black leading-tight text-foreground">
                  {siteDisplayName(site.data.site)}
                </p>
              )}
              <p
                className="text-sm font-semibold"
                data-testid="gate-gps-pill"
                data-gps={gps}
              >
                {gps === "locked"
                  ? t("gatekeeper.gpsLocked")
                  : gps === "denied"
                    ? t("gatekeeper.gpsDenied")
                    : gps === "unavailable"
                      ? t("gatekeeper.gpsUnavailable")
                      : t("gatekeeper.gpsSearching")}
                {fenceCopy.kind === "inside" && site.data
                  ? ` · ${t("gatekeeper.gpsMilesInside", { miles: fenceCopy.miles, site: siteDisplayName(site.data.site), radius: fenceCopy.radius })}`
                  : fenceCopy.kind === "tooFar" && site.data
                    ? ` · ${t("gatekeeper.gpsMilesTooFar", { miles: fenceCopy.miles, site: siteDisplayName(site.data.site), radius: fenceCopy.radius })}`
                    : fenceCopy.kind === "noSite"
                      ? ` · ${t("gatekeeper.gpsNoSite")}`
                      : ""}
              </p>
            </div>
            {site.isLoading && (
              <Loader2 className="animate-spin text-muted-foreground" />
            )}
            {site.error && (
              <p className="text-sm text-destructive">
                {t("gatekeeper.siteNotFound")}
              </p>
            )}
            {site.data && (
              <>
                <p className={`${CARD_INNER_TILE_CLASS} text-sm`}>
                  <strong>{site.data.site.name}</strong>
                  <br />
                  <span className="text-muted-foreground">
                    {site.data.site.address}
                  </span>
                </p>
                <div>
                  <Label>{t("gatekeeper.host")} *</Label>
                  <Select value={hostKey} onValueChange={setHostKey}>
                    <SelectTrigger>
                      <SelectValue placeholder={t("gatekeeper.selectHost")} />
                    </SelectTrigger>
                    <SelectContent>
                      {hosts.map((host) => (
                        <SelectItem key={host.key} value={host.key}>
                          {host.label} ({host.type})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </>
            )}
            <div>
              <Label>{t("gatekeeper.purpose")}</Label>
              <Textarea
                data-testid="input-gate-purpose"
                value={purpose}
                onChange={(e) => {
                  forgetPlateAutoFill("purpose");
                  setPurpose(e.target.value);
                }}
              />
            </div>
            <div>
              <Label htmlFor="gate-entry-category">{t("gateReport.category")}</Label>
              <select id="gate-entry-category" className="h-10 w-full rounded-md border bg-background px-2" value={entryCategory} onChange={e => setEntryCategory(e.target.value as typeof entryCategory)}>
                {["", "visitor", "routine_vendor_work", "partner_admin", "vendor_admin"].map(value => <option key={value} value={value}>{t(`gateReport.${value || "unclassified"}`)}</option>)}
              </select>
            </div>
            <div>
              <Label>{t("gatekeeper.notes")}</Label>
              <Textarea
                data-testid="input-gate-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder={t("gatekeeper.notesPlaceholder")}
              />
            </div>
            <div>
              <Label>{t("gatekeeper.expectedMinutes")}</Label>
              <div className="mb-2 grid grid-cols-4 gap-2">
                {GATE_DURATION_CHIPS.map((chip) => (
                  <BlueButton
                    key={chip.id}
                    className="h-10 text-xs"
                    data-testid={`button-gate-duration-${chip.id}`}
                    onClick={() => {
                      forgetPlateAutoFill("expectedDuration");
                      setDuration(String(minutesForDurationChip(chip.id)));
                    }}
                  >
                    {t(`gatekeeper.duration${chip.id === "30m" ? "30m" : chip.id === "2h" ? "2h" : chip.id === "allDay" ? "AllDay" : "Overnight"}`)}
                  </BlueButton>
                ))}
              </div>
              <Input
                inputMode="numeric"
                value={duration}
                onChange={(e) => {
                  forgetPlateAutoFill("expectedDuration");
                  setDuration(e.target.value);
                }}
              />
            </div>
            <input
              ref={plateInput}
              className="hidden"
              type="file"
              accept="image/*"
              capture="environment"
              onChange={(e) => void capture(e.target.files?.[0], "plate")}
            />
            <input
              ref={vehicleInput}
              className="hidden"
              type="file"
              accept="image/*"
              capture="environment"
              onChange={(e) => void capture(e.target.files?.[0], "vehicle")}
            />
            <AmberButton
              className="h-14 w-full text-lg"
              onClick={() => void checkIn()}
              disabled={busy || !site.data || !fence.canSubmit}
              data-testid="button-gate-check-in"
            >
              {busy ? t("gatekeeper.working") : t("gatekeeper.checkInVisitor")}
            </AmberButton>
            <p className="text-center text-xs text-muted-foreground">
              {t("gatekeeper.gpsRequiredToSubmit")}
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
