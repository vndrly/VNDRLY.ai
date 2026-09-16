import { Feather } from "@expo/vector-icons";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as Location from "expo-location";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";

import AmberButton from "@/components/AmberButton";
import BrandTitleRow from "@/components/BrandTitleRow";
import PlateStatePicker from "@/components/PlateStatePicker";
import ScreenSafeArea from "@/components/ScreenSafeArea";
import VisitorHostPicker from "@/components/VisitorHostPicker";
import { useAuth } from "@/hooks/use-auth";
import { useColors } from "@/hooks/useColors";
import { translateApiError } from "@/lib/apiErrors";
import {
  pickDefaultGateHostKey,
  groupAssignedGateSitesByPartner,
  pickNearestAssignedGateSite,
  pickPreferredGateDefaultSite,
  resolveAssignedGateSites,
  shouldApplyDefaultGateSite,
} from "@/lib/gate-default-site";
import {
  fetchSiteContext,
  type ActiveVisit,
  type SiteContext,
} from "@/lib/guest";
import {
  fetchAssignedGateSites,
  fetchPreferredPlateStates,
  deleteGateEvidence,
  fetchGatekeeperRecentVisits,
  fetchGatekeeperVisits,
  gateAdmit,
  gatekeeperCheckOut,
  readGatePlate,
  submitGatekeeperVisit,
} from "@/lib/gatekeeper";
import { captureAndUploadImage } from "@/lib/photos";
import { formatPlateForDisplay } from "@/lib/plate-display";
import { createGateEventPoller } from "@/lib/gate-events";
import {
  matchGateCheckoutVisits,
  parseGateVoiceCommand,
  recoverGateVoiceCommand,
} from "@/lib/gate-voice-entry";
import {
  setGateVoiceListening,
  subscribeGateVoiceEntry,
} from "@/lib/gate-voice-launch";
import { isAskVNaturalVoiceEnabled } from "@/lib/askv-natural-voice";
import { subscribeAskVGatePrefill } from "@/lib/askv-client-tools";
import { transcribeAskVRecording } from "@/lib/askv-transcribe";
import {
  createPttRecorder,
  PttMicPermissionError,
  type PttRecorder,
} from "@/lib/ptt";
import { buildHostOptions } from "@/lib/visitorCheckin";
import {
  NATIONAL_PLATE_STATE_FALLBACK,
  PLATE_OCR_STATE_CONFIDENCE_THRESHOLD,
  normalizePlateState,
  plateMatchKey,
  reconcileAutomatedPlateUpdate,
  type PlateStateCode,
} from "@workspace/plate-state";
import {
  evaluateGpsFence,
  formatFenceMilesSentence,
  GATE_DURATION_CHIPS,
  onSiteDwell,
  type GpsLockState,
} from "@workspace/gate-booth";

type DriverNameField = "firstName" | "lastName";
type PlateAutoFillField =
  | "firstName"
  | "lastName"
  | "company"
  | "purpose"
  | "duration";
type PlateAutoFillSnapshot = {
  matchKey: string;
  values: Partial<Record<PlateAutoFillField, string>>;
};

function driverSuggestions(
  visits: ActiveVisit[],
  field: DriverNameField | null,
  query: string,
  company: string,
): ActiveVisit[] {
  if (!field || !query.trim()) return [];
  const needle = query.trim().toLowerCase();
  const companyNeedle = company.trim().toLowerCase();
  const seen = new Set<string>();
  return [...visits]
    .sort((a, b) => Date.parse(b.checkInTime) - Date.parse(a.checkInTime))
    .filter((visit) => {
      if (!(visit[field] ?? "").trim().toLowerCase().startsWith(needle))
        return false;
      if (
        companyNeedle &&
        (visit.company ?? "").trim().toLowerCase() !== companyNeedle
      )
        return false;
      const key = `${(visit.firstName ?? "").trim().toLowerCase()}|${(visit.lastName ?? "").trim().toLowerCase()}|${(visit.company ?? "").trim().toLowerCase()}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 6);
}

export default function GatekeeperScreen() {
  const colors = useColors();
  const { t } = useTranslation();
  const { user } = useAuth();
  const qc = useQueryClient();
  const gateEventPoller = useMemo(() => createGateEventPoller(), []);
  const appliedDefault = useRef(false);
  const voiceRecorderRef = useRef<PttRecorder | null>(null);
  const plateAutoFillRef = useRef<PlateAutoFillSnapshot | null>(null);
  const voiceOperationRef = useRef<Promise<void>>(Promise.resolve());
  const voiceMountedRef = useRef(true);
  const voiceToggleRef = useRef<() => Promise<void>>(async () => undefined);
  const [siteCode, setSiteCode] = useState("");
  const [confirmedCode, setConfirmedCode] = useState<string | null>(null);
  const [hostKey, setHostKey] = useState<string | null>(null);
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
  const [notes, setNotes] = useState("");
  const [checkOutNotes, setCheckOutNotes] = useState("");
  const [gps, setGps] = useState<GpsLockState>("searching");
  const [origin, setOrigin] = useState<{
    latitude: number;
    longitude: number;
  } | null>(null);
  const [duration, setDuration] = useState("60");
  const [platePhotoUrl, setPlatePhotoUrl] = useState<string | null>(null);
  const [vehiclePhotoUrl, setVehiclePhotoUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [activeNameField, setActiveNameField] =
    useState<DriverNameField | null>(null);
  const [voiceListening, setVoiceListening] = useState(false);
  const [voiceTranscribing, setVoiceTranscribing] = useState(false);
  const [voiceCheckInPending, setVoiceCheckInPending] = useState(false);
  const [voiceCheckoutMatches, setVoiceCheckoutMatches] = useState<ActiveVisit[]>([]);
  const [selectedPartnerId, setSelectedPartnerId] = useState<number | null>(null);
  const [partnerMenuOpen, setPartnerMenuOpen] = useState(false);
  const [siteMenuOpen, setSiteMenuOpen] = useState(false);

  const activeVisits = useQuery({
    queryKey: ["gatekeeper-visits"],
    queryFn: fetchGatekeeperVisits,
    refetchInterval: 30000,
    retry: false,
  });
  useEffect(() => subscribeAskVGatePrefill((prefill) => {
    const values = prefill.values;
    if (typeof values.firstName === "string") setFirstName(values.firstName);
    if (typeof values.lastName === "string") setLastName(values.lastName);
    if (typeof values.company === "string") setCompany(values.company);
    if (typeof values.vehiclePlate === "string") setVehiclePlate(values.vehiclePlate.toUpperCase());
    if (typeof values.plateState === "string") setPlateState(normalizePlateState(values.plateState));
    if (typeof values.purpose === "string") setPurpose(values.purpose);
    if (typeof values.notes === "string") setNotes(values.notes);
    if (values.expectedDurationMinutes != null) setDuration(String(values.expectedDurationMinutes));
    setPlateStateError(null);
    setOcrStateNotice(null);
    setActiveNameField(null);
    if (prefill.mode === "check-out") {
      const ids = new Set(prefill.matches.map((match) => match.id));
      setVoiceCheckInPending(false);
      setVoiceCheckoutMatches((activeVisits.data ?? []).filter((visit) => ids.has(visit.id)));
    } else {
      setVoiceCheckoutMatches([]);
      setVoiceCheckInPending(prefill.missing.length === 0);
    }
  }), [activeVisits.data]);
  const recentVisits = useQuery({
    queryKey: ["gatekeeper-recent-visits"],
    queryFn: fetchGatekeeperRecentVisits,
    retry: false,
  });
  const assigned = useQuery({
    queryKey: ["gatekeeper-assigned-sites", user?.vendorId],
    queryFn: () =>
      resolveAssignedGateSites({
        vendorId: user?.vendorId ?? null,
        listAssigned: fetchAssignedGateSites,
        getSiteContext: fetchSiteContext,
      }),
    retry: false,
  });
  const assignedSites = assigned.data?.sites ?? [];
  const assignedPartners = useMemo(() => groupAssignedGateSitesByPartner(assignedSites), [assignedSites]);
  const nearestSite = useMemo(() => pickNearestAssignedGateSite(assignedSites, origin), [assignedSites, origin]);
  const locationResolved = origin !== null || gps === "denied" || gps === "unavailable";
  const preferredSite = nearestSite ?? pickPreferredGateDefaultSite(assignedSites, assigned.data?.defaultSite ?? null);
  const defaultSiteCode = locationResolved ? preferredSite?.siteCode : undefined;
  const selectedAssignedSite = assignedSites.find((site) => site.siteCode === confirmedCode) ?? preferredSite;
  useEffect(() => {
    if (selectedPartnerId !== null || !selectedAssignedSite) return;
    setSelectedPartnerId(selectedAssignedSite.partnerId);
  }, [selectedAssignedSite, selectedPartnerId]);
  const ctxQuery = useQuery<SiteContext>({
    queryKey: ["gatekeeper-site-context", confirmedCode],
    queryFn: () => fetchSiteContext(confirmedCode!),
    enabled: !!confirmedCode,
    retry: false,
  });
  const selectedSiteId = ctxQuery.data?.site.id ?? null;
  useEffect(() => {
    if (!selectedSiteId) return;
    return gateEventPoller.start(selectedSiteId, () => {
      void Promise.all([
        qc.invalidateQueries({ queryKey: ["gatekeeper-visits"] }),
        qc.invalidateQueries({ queryKey: ["gatekeeper-recent-visits"] }),
      ]);
    });
  }, [gateEventPoller, qc, selectedSiteId]);
  const preferredPlateStates = useQuery({
    queryKey: ["preferred-plate-states", ctxQuery.data?.site.id, confirmedCode],
    queryFn: () =>
      fetchPreferredPlateStates(ctxQuery.data!.site.id, confirmedCode!),
    enabled: Boolean(ctxQuery.data?.site.id && confirmedCode),
    retry: false,
  });
  const orderedStatePreferences =
    preferredPlateStates.data?.preferred ?? NATIONAL_PLATE_STATE_FALLBACK;

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
    if (!defaultSiteCode) return;
    appliedDefault.current = true;
    setSiteCode(defaultSiteCode);
    setConfirmedCode(defaultSiteCode);
    setHostKey(null);
  }, [confirmedCode, defaultSiteCode, siteCode]);

  const hosts = useMemo(() => buildHostOptions(ctxQuery.data), [ctxQuery.data]);
  useEffect(() => {
    if (hostKey || hosts.length === 0) return;
    const next = pickDefaultGateHostKey(hosts);
    if (next) setHostKey(next);
  }, [hostKey, hosts]);

  const inputStyle = [
    styles.input,
    {
      borderColor: colors.border,
      color: colors.foreground,
      backgroundColor: colors.card,
    },
  ];
  const matchingDrivers = useMemo(
    () =>
      driverSuggestions(
        recentVisits.data ?? [],
        activeNameField,
        activeNameField === "firstName" ? firstName : lastName,
        company,
      ),
    [activeNameField, company, firstName, lastName, recentVisits.data],
  );

  const useDriver = (visit: ActiveVisit) => {
    plateAutoFillRef.current = null;
    setFirstName(visit.firstName ?? "");
    setLastName(visit.lastName ?? "");
    setCompany(visit.company ?? company);
    if (!vehiclePlate.trim()) {
      setVehiclePlate((visit.vehiclePlate ?? "").toUpperCase());
      if (!plateState) setPlateState(normalizePlateState(visit.plateState));
    }
    if (!purpose.trim()) setPurpose(visit.purpose ?? "");
    if (duration === "60" && visit.expectedDurationMinutes)
      setDuration(String(visit.expectedDurationMinutes));
    setActiveNameField(null);
  };

  const finishGateVoiceEntry = async () => {
    const recorder = voiceRecorderRef.current;
    voiceRecorderRef.current = null;
    if (voiceMountedRef.current) setVoiceListening(false);
    setGateVoiceListening(false);
    if (!recorder) return;
    try {
      const { uri, durationSeconds } = await recorder.stop();
      if (durationSeconds < 0.4) return;
      if (voiceMountedRef.current) setVoiceTranscribing(true);
      const transcript = await transcribeAskVRecording(uri);
      if (!voiceMountedRef.current) return;
      const command = parseGateVoiceCommand(transcript);
      const fill = command.fill;
      if (!Object.keys(fill).length) {
        if (voiceMountedRef.current) Alert.alert(t("visitor.error"), t("gatekeeper.voiceNotUnderstood"));
        return;
      }
      if (fill.firstName) setFirstName(fill.firstName);
      if (fill.lastName) setLastName(fill.lastName);
      if (fill.company) setCompany(fill.company);
      const automatedPlate = reconcileAutomatedPlateUpdate({
        currentPlate: vehiclePlate,
        currentState: plateState,
        automatedPlate: fill.vehiclePlate,
        automatedState: fill.plateState,
      });
      setVehiclePlate(automatedPlate.vehiclePlate ?? "");
      setPlateState(automatedPlate.plateState);
      setPlateStateError(null);
      setOcrStateNotice(null);
      if (fill.purpose) setPurpose(fill.purpose);
      if (fill.notes) setNotes(fill.notes);
      if (fill.duration) setDuration(fill.duration);
      plateAutoFillRef.current = null;
      setActiveNameField(null);
      if (command.intent === "check-out") {
        const matches = matchGateCheckoutVisits(
          (activeVisits.data ?? []).filter(
            (visit) =>
              selectedSiteId == null || visit.siteLocationId === selectedSiteId,
          ),
          fill,
        );
        setVoiceCheckInPending(false);
        setVoiceCheckoutMatches(matches);
        if (matches.length === 0 && voiceMountedRef.current) Alert.alert(t("visitor.error"), t("gatekeeper.voiceNoCheckoutMatch"));
      } else {
        setVoiceCheckoutMatches([]);
        const recovery = recoverGateVoiceCommand(
          command,
          (recentVisits.data ?? []).filter(
            (visit) =>
              selectedSiteId == null || visit.siteLocationId === selectedSiteId,
          ),
        );
        if (!recovery.ready) {
          setVoiceCheckInPending(false);
          if (voiceMountedRef.current && recovery.prompt) {
            Alert.alert(
              t("gatekeeper.voiceNeedsDetail"),
              t(`gatekeeper.voiceRecovery.${recovery.prompt}`),
            );
          }
          return;
        }
        setVoiceCheckInPending(true);
      }
    } catch (error) {
      if (voiceMountedRef.current) {
        Alert.alert(
          t("visitor.error"),
          error instanceof PttMicPermissionError
            ? t("foremanHome.pttMicDeniedBody")
            : t("gatekeeper.voiceNotUnderstood"),
        );
      }
    } finally {
      if (voiceMountedRef.current) setVoiceTranscribing(false);
      await recorder.dispose();
    }
  };

  const startGateVoiceEntry = async () => {
    if (voiceRecorderRef.current) return;
    let recorder: PttRecorder | null = null;
    try {
      recorder = await createPttRecorder();
      if (!voiceMountedRef.current) {
        await recorder.dispose();
        return;
      }
      voiceRecorderRef.current = recorder;
      await recorder.start();
      if (!voiceMountedRef.current || voiceRecorderRef.current !== recorder) {
        await recorder.dispose();
        return;
      }
      setVoiceListening(true);
      setGateVoiceListening(true);
    } catch (error) {
      if (voiceRecorderRef.current === recorder) voiceRecorderRef.current = null;
      setGateVoiceListening(false);
      await recorder?.dispose();
      if (voiceMountedRef.current) {
        setVoiceListening(false);
        Alert.alert(
          t("visitor.error"),
          error instanceof PttMicPermissionError
            ? t("foremanHome.pttMicDeniedBody")
            : t("gatekeeper.voiceNotUnderstood"),
        );
      }
    }
  };

  voiceToggleRef.current = async () => {
    if (voiceRecorderRef.current) await finishGateVoiceEntry();
    else await startGateVoiceEntry();
  };

  useEffect(() => {
    if (isAskVNaturalVoiceEnabled()) return;
    return subscribeGateVoiceEntry(() => {
      const toggle = () => voiceToggleRef.current();
      voiceOperationRef.current = voiceOperationRef.current.then(
        toggle,
        toggle,
      );
    });
  }, []);

  useEffect(() => {
    voiceMountedRef.current = true;
    return () => {
      voiceMountedRef.current = false;
      const recorder = voiceRecorderRef.current;
      voiceRecorderRef.current = null;
      setGateVoiceListening(false);
      void recorder?.dispose();
    };
  }, []);

  const resetForm = () => {
    plateAutoFillRef.current = null;
    setFirstName("");
    setLastName("");
    setCompany("");
    setVehiclePlate("");
    setPlateState(null);
    setPlateStateError(null);
    setOcrStateNotice(null);
    setPurpose("");
    setNotes("");
    setDuration("60");
    setPlatePhotoUrl(null);
    setVehiclePhotoUrl(null);
    setHostKey(null);
    setActiveNameField(null);
    setVoiceCheckInPending(false);
    setVoiceCheckoutMatches([]);
  };

  useEffect(() => {
    let cancelled = false;
    let subscription: { remove: () => void } | null = null;
    void (async () => {
      setGps("searching");
      try {
        const perm = await Location.requestForegroundPermissionsAsync();
        if (cancelled) return;
        if (perm.status !== "granted") {
          setGps("denied");
          return;
        }
        subscription = await Location.watchPositionAsync(
          { accuracy: Location.Accuracy.Balanced, distanceInterval: 8 },
          (pos) => {
            if (cancelled) return;
            setGps("locked");
            setOrigin({
              latitude: pos.coords.latitude,
              longitude: pos.coords.longitude,
            });
          },
        );
      } catch {
        if (!cancelled) setGps("unavailable");
      }
    })();
    return () => {
      cancelled = true;
      subscription?.remove();
    };
  }, []);

  const fence = evaluateGpsFence({
    gps,
    origin,
    site: ctxQuery.data
      ? {
          latitude: ctxQuery.data.site.latitude,
          longitude: ctxQuery.data.site.longitude,
          siteRadiusMeters: ctxQuery.data.site.siteRadiusMeters,
        }
      : null,
  });
  const fenceCopy = formatFenceMilesSentence(fence);
  const selectedActiveVisits = (activeVisits.data ?? []).filter(
    (visit) => selectedSiteId == null || visit.siteLocationId === selectedSiteId,
  );
  const pendingVisits = selectedActiveVisits.filter(
    (visit) => visit.admissionStatus === "pending",
  );
  const onSiteVisits = selectedActiveVisits.filter(
    (visit) => visit.admissionStatus !== "pending",
  );

  const fenceSentence =
    fenceCopy.kind === "searching"
      ? t("gatekeeper.gpsSearching")
      : fenceCopy.kind === "denied"
        ? t("gatekeeper.gpsDenied")
        : fenceCopy.kind === "unavailable"
          ? t("gatekeeper.gpsUnavailable")
          : fenceCopy.kind === "noSite"
            ? t("gatekeeper.gpsNoSite")
            : fenceCopy.kind === "inside"
              ? t("gatekeeper.gpsMilesInside", {
                  miles: fenceCopy.miles,
                  site: ctxQuery.data?.site.name ?? "",
                  radius: fenceCopy.radius,
                })
              : t("gatekeeper.gpsMilesTooFar", {
                  miles: fenceCopy.miles,
                  site: ctxQuery.data?.site.name ?? "",
                  radius: fenceCopy.radius,
                });

  const onCaptureEvidence = async (kind: "plate" | "vehicle") => {
    setBusy(true);
    try {
      const result = await captureAndUploadImage({
        maxBytes: 8 * 1024 * 1024,
        purpose: "gate-evidence",
      });
      if (!result) return;
      if (kind === "plate") {
        setOcrStateNotice(null);
        void deleteGateEvidence(platePhotoUrl).catch(() => undefined);
        setPlatePhotoUrl(result.objectPath);
        const candidate = await readGatePlate(result.objectPath).catch(
          () => null,
        );
        if (candidate?.plate) {
          const confidentState =
            candidate?.stateConfidence != null &&
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
          if (confidentState) {
            setOcrStateNotice({
              suggestedState: confidentState,
              selectedState: confidentState,
            });
          }
        }
      } else {
        void deleteGateEvidence(vehiclePhotoUrl).catch(() => undefined);
        setVehiclePhotoUrl(result.objectPath);
      }
    } catch (e) {
      Alert.alert(
        t("visitor.error"),
        translateApiError(e, t, t("tickets.errorAttachPhoto")),
      );
    } finally {
      setBusy(false);
    }
  };

  const forgetPlateAutoFill = (field: PlateAutoFillField) => {
    const snapshot = plateAutoFillRef.current;
    if (!snapshot) return;
    delete snapshot.values[field];
    if (Object.keys(snapshot.values).length === 0)
      plateAutoFillRef.current = null;
  };

  const currentPlateMatchKey = plateMatchKey(plateState, vehiclePlate);
  useEffect(() => {
    const snapshot = plateAutoFillRef.current;
    if (!snapshot || snapshot.matchKey === currentPlateMatchKey) return;
    if (snapshot.values.firstName === firstName) setFirstName("");
    if (snapshot.values.lastName === lastName) setLastName("");
    if (snapshot.values.company === company) setCompany("");
    if (snapshot.values.purpose === purpose) setPurpose("");
    if (snapshot.values.duration === duration) setDuration("60");
    plateAutoFillRef.current = null;
  }, [currentPlateMatchKey]);

  useEffect(() => {
    const normalized = vehiclePlate.toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (normalized.length < 3 || !plateState) return;
    const exactKey = plateMatchKey(plateState, vehiclePlate);
    const prior = [...(recentVisits.data ?? [])]
      .filter(
        (visit) =>
          selectedSiteId == null || visit.siteLocationId === selectedSiteId,
      )
      .filter((visit) => {
        if (
          (visit.vehiclePlate ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "") !==
          normalized
        )
          return false;
        if (!plateState) return true;
        const visitState = normalizePlateState(visit.plateState);
        return (
          !visitState ||
          plateMatchKey(visitState, visit.vehiclePlate) === exactKey
        );
      })
      .sort((a, b) => {
        const priority = (visit: ActiveVisit) =>
          exactKey &&
          plateMatchKey(visit.plateState, visit.vehiclePlate) === exactKey
            ? 0
            : 1;
        return (
          priority(a) - priority(b) ||
          Date.parse(b.checkInTime) - Date.parse(a.checkInTime)
        );
      })[0];
    if (!prior) return;
    const values =
      plateAutoFillRef.current?.matchKey === exactKey
        ? { ...plateAutoFillRef.current.values }
        : {};
    if (!firstName && prior.firstName) {
      values.firstName = prior.firstName;
      setFirstName(prior.firstName);
    }
    if (!lastName && prior.lastName) {
      values.lastName = prior.lastName;
      setLastName(prior.lastName);
    }
    if (!company && prior.company) {
      values.company = prior.company;
      setCompany(prior.company);
    }
    if (!purpose && prior.purpose) {
      values.purpose = prior.purpose;
      setPurpose(prior.purpose);
    }
    if (duration === "60" && prior.expectedDurationMinutes) {
      values.duration = String(prior.expectedDurationMinutes);
      setDuration(values.duration);
    }
    if (exactKey && Object.keys(values).length > 0) {
      plateAutoFillRef.current = { matchKey: exactKey, values };
    }
  }, [
    company,
    duration,
    firstName,
    lastName,
    plateState,
    purpose,
    recentVisits.data,
    vehiclePlate,
  ]);

  const onCheckIn = async () => {
    const ctx = ctxQuery.data;
    if (!ctx) {
      Alert.alert(t("visitor.error"), t("visitor.siteLookupFailed"));
      return;
    }
    setPlateStateError(null);
    setBusy(true);
    try {
      const result = await submitGatekeeperVisit({
        ctx,
        hostKey: hostKey ?? "",
        firstName,
        lastName,
        company,
        vehiclePlate,
        plateState,
        purpose,
        notes,
        durationStr: duration,
        platePhotoUrl: platePhotoUrl ?? undefined,
        vehiclePhotoUrl: vehiclePhotoUrl ?? undefined,
      });
      if (!result.ok) {
        const message =
          result.reason === "missing-name"
            ? t("gatekeeper.nameRequired")
            : result.reason === "missing-plate"
              ? t("gatekeeper.plateRequired")
              : result.reason === "no-host"
                ? t("visitor.pickHost")
                : t("visitor.locationDenied");
        Alert.alert(t("visitor.error"), message);
        return;
      }
      resetForm();
      await qc.invalidateQueries({ queryKey: ["gatekeeper-visits"] });
      await qc.invalidateQueries({ queryKey: ["gatekeeper-recent-visits"] });
      Alert.alert(
        t("gatekeeper.checkedInTitle"),
        t("gatekeeper.checkedInBody"),
      );
    } catch (e) {
      Alert.alert(
        t("visitor.error"),
        translateApiError(e, t, t("tickets.errorCheckIn")),
      );
    } finally {
      setBusy(false);
    }
  };

  const onAdmit = async (visitId: number) => {
    setBusy(true);
    try {
      await gateAdmit(visitId);
      await qc.invalidateQueries({ queryKey: ["gatekeeper-visits"] });
    } catch (e) {
      Alert.alert(
        t("visitor.error"),
        translateApiError(e, t, t("tickets.errorCheckIn")),
      );
    } finally {
      setBusy(false);
    }
  };

  const onCheckOut = async (visitId: number) => {
    setBusy(true);
    try {
      await gatekeeperCheckOut(visitId, checkOutNotes.trim() || undefined);
      setCheckOutNotes("");
      await qc.invalidateQueries({ queryKey: ["gatekeeper-visits"] });
      await qc.invalidateQueries({ queryKey: ["gatekeeper-recent-visits"] });
    } catch (e) {
      Alert.alert(
        t("visitor.error"),
        translateApiError(e, t, t("tickets.errorCheckOut")),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScreenSafeArea style={styles.flex}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.container}
          keyboardShouldPersistTaps="handled"
        >
          <BrandTitleRow
            title={t("gatekeeper.portal")}
            subtitle={t("gatekeeper.subtitle")}
            logoTestId="gate-brand-logo"
          />

          <View
            style={[
              styles.card,
              { borderColor: colors.border, backgroundColor: colors.card },
            ]}
          >
            <Text style={[styles.cardTitle, { color: colors.foreground }]}>
              {t("gatekeeper.activeNow")}
            </Text>
            {activeVisits.isLoading ? (
              <ActivityIndicator color={colors.primary} />
            ) : pendingVisits.length === 0 && onSiteVisits.length === 0 ? (
              <Text style={[styles.muted, { color: colors.mutedForeground }]}>
                {t("gatekeeper.noActive")}
              </Text>
            ) : (
              <>
                {pendingVisits.length > 0 ? (
                  <Text style={[styles.label, { color: colors.foreground }]}>
                    {t("gatekeeper.pendingAdmit")}
                  </Text>
                ) : null}
                {pendingVisits.map((visit) => (
                  <View
                    key={visit.id}
                    style={[styles.visitRow, { borderColor: colors.border }]}
                  >
                    <View style={styles.visitText}>
                      <Text
                        style={[styles.visitName, { color: colors.foreground }]}
                      >
                        {visit.firstName} {visit.lastName}
                      </Text>
                      <Text
                        style={[styles.muted, { color: colors.mutedForeground }]}
                      >
                        {[
                          visit.company,
                          formatPlateForDisplay(
                            visit.plateState,
                            visit.vehiclePlate,
                            t("gatekeeper.plateStateUnconfirmed"),
                          ),
                          visit.siteName,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </Text>
                    </View>
                    <TouchableOpacity
                      testID={`gate-admit-${visit.id}`}
                      disabled={busy}
                      onPress={() => onAdmit(visit.id)}
                      style={[styles.iconButton, { borderColor: colors.primary }]}
                    >
                      <Text style={[styles.admitLabel, { color: colors.primary }]}>
                        {t("gatekeeper.admit")}
                      </Text>
                    </TouchableOpacity>
                  </View>
                ))}
                {onSiteVisits.map((visit) => {
                  const dwell = onSiteDwell({
                    checkInTime: visit.checkInTime,
                    expectedDurationMinutes: visit.expectedDurationMinutes,
                  });
                  return (
                    <View
                      key={visit.id}
                      style={[styles.visitRow, { borderColor: colors.border }]}
                    >
                      <View style={styles.visitText}>
                        <Text
                          style={[styles.visitName, { color: colors.foreground }]}
                        >
                          {visit.firstName} {visit.lastName}
                          {visit.reconciliationState === "observed" ||
                          visit.reconciliationState === "needs_supervisor_review"
                            ? " · " +
                              t(
                                visit.reconciliationState === "needs_supervisor_review"
                                  ? "gatekeeper.reconciliationReview"
                                  : "gatekeeper.reconciliationObserved",
                              )
                            : ""}
                        </Text>
                        <Text
                          style={[styles.muted, { color: colors.mutedForeground }]}
                        >
                          {[
                            visit.company,
                            formatPlateForDisplay(
                              visit.plateState,
                              visit.vehiclePlate,
                              t("gatekeeper.plateStateUnconfirmed"),
                            ),
                            visit.siteName,
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </Text>
                        <Text
                          style={[styles.muted, { color: colors.mutedForeground }]}
                        >
                          {t("gatekeeper.minutesOnSite", {
                            minutes: dwell.minutesOnSite,
                          })}
                          {dwell.overdue
                            ? ` · ${t("gatekeeper.overdue", { minutes: dwell.overdueMinutes })}`
                            : ""}
                        </Text>
                      </View>
                      <TouchableOpacity
                        testID={`gate-checkout-${visit.id}`}
                        disabled={busy}
                        onPress={() => onCheckOut(visit.id)}
                        style={[styles.iconButton, { borderColor: colors.primary }]}
                      >
                        <Feather name="log-out" size={18} color={colors.primary} />
                      </TouchableOpacity>
                    </View>
                  );
                })}
              </>
            )}
            <Text style={[styles.label, { color: colors.foreground }]}>
              {t("gatekeeper.checkOutNotes")}
            </Text>
            <TextInput
              testID="gate-checkout-notes"
              value={checkOutNotes}
              onChangeText={setCheckOutNotes}
              style={inputStyle}
              placeholder={t("gatekeeper.notesPlaceholder")}
              placeholderTextColor={colors.mutedForeground}
            />
            {voiceCheckoutMatches.length > 0 ? (
              <View style={[styles.voiceConfirm, { borderColor: colors.primary }]}>
                <Text style={[styles.voiceConfirmTitle, { color: colors.foreground }]}>
                  {voiceCheckoutMatches.length === 1
                    ? t("gatekeeper.voiceConfirmCheckOut")
                    : t("gatekeeper.voiceChooseCheckout")}
                </Text>
                {voiceCheckoutMatches.map((visit) => (
                  <TouchableOpacity
                    key={visit.id}
                    testID={`gate-voice-confirm-checkout-${visit.id}`}
                    disabled={busy}
                    onPress={() => {
                      setVoiceCheckoutMatches([]);
                      void onCheckOut(visit.id);
                    }}
                    style={[styles.voiceActionButton, { backgroundColor: colors.primary }]}
                  >
                    <Text style={styles.voiceActionText}>
                      {t("gatekeeper.voiceCheckOutRecord", {
                        name: `${visit.firstName ?? ""} ${visit.lastName ?? ""}`.trim(),
                        plate: visit.vehiclePlate ?? "",
                      })}
                    </Text>
                  </TouchableOpacity>
                ))}
                <TouchableOpacity testID="gate-voice-cancel-checkout" onPress={() => setVoiceCheckoutMatches([])}>
                  <Text style={[styles.voiceCancelText, { color: colors.mutedForeground }]}>{t("common.cancel")}</Text>
                </TouchableOpacity>
              </View>
            ) : null}
          </View>

          <View
            style={[
              styles.card,
              { borderColor: colors.border, backgroundColor: colors.card },
            ]}
          >
            <Text style={[styles.cardTitle, { color: colors.foreground }]}>
              {t("gatekeeper.newEntry")}
            </Text>
            {voiceListening ? (
              <View
                style={[styles.voiceStatus, { borderColor: colors.primary }]}
              >
                <Feather name="mic" size={18} color={colors.primary} />
                <Text
                  style={[styles.voiceStatusText, { color: colors.primary }]}
                >
                  {t("gatekeeper.voiceListening")}
                </Text>
              </View>
            ) : null}
            {voiceTranscribing ? (
              <View style={[styles.voiceStatus, { borderColor: colors.primary }]}>
                <ActivityIndicator color={colors.primary} />
                <Text style={[styles.voiceStatusText, { color: colors.primary }]}>{t("gatekeeper.voiceTranscribing")}</Text>
              </View>
            ) : null}
            {voiceCheckInPending ? (
              <View style={[styles.voiceConfirm, { borderColor: colors.primary }]}>
                <Text style={[styles.voiceConfirmTitle, { color: colors.foreground }]}>{t("gatekeeper.voiceConfirmCheckIn")}</Text>
                <View style={styles.voiceConfirmActions}>
                  <TouchableOpacity testID="gate-voice-cancel-checkin" onPress={() => setVoiceCheckInPending(false)}>
                    <Text style={[styles.voiceCancelText, { color: colors.mutedForeground }]}>{t("common.cancel")}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    testID="gate-voice-confirm-checkin"
                    disabled={busy}
                    onPress={() => {
                      setVoiceCheckInPending(false);
                      void onCheckIn();
                    }}
                    style={[styles.voiceActionButton, { backgroundColor: colors.primary }]}
                  >
                    <Text style={styles.voiceActionText}>{t("gatekeeper.voiceConfirm")}</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : null}
            <Text style={[styles.muted, { color: colors.mutedForeground }]}>
              {t("gatekeeper.handsFreeHint")}
            </Text>
            <View style={styles.twoCol}>
              <TouchableOpacity
                testID="gate-capture-tag-photo"
                onPress={() => onCaptureEvidence("plate")}
                disabled={busy}
                style={[
                  styles.photoButton,
                  { borderColor: colors.border, opacity: busy ? 0.6 : 1 },
                ]}
              >
                <Feather
                  name={platePhotoUrl ? "check-circle" : "camera"}
                  size={16}
                  color={
                    platePhotoUrl ? colors.primary : colors.mutedForeground
                  }
                />
                <Text style={[styles.photoLabel, { color: colors.foreground }]}>
                  {t("gatekeeper.tagPhoto")}
                  {platePhotoUrl ? ` ${t("visitor.photoAttached")}` : ""}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                testID="gate-capture-vehicle-photo"
                onPress={() => onCaptureEvidence("vehicle")}
                disabled={busy}
                style={[
                  styles.photoButton,
                  { borderColor: colors.border, opacity: busy ? 0.6 : 1 },
                ]}
              >
                <Feather
                  name={vehiclePhotoUrl ? "check-circle" : "truck"}
                  size={16}
                  color={
                    vehiclePhotoUrl ? colors.primary : colors.mutedForeground
                  }
                />
                <Text style={[styles.photoLabel, { color: colors.foreground }]}>
                  {t("gatekeeper.vehiclePhoto")}
                  {vehiclePhotoUrl ? ` ${t("visitor.photoAttached")}` : ""}
                </Text>
              </TouchableOpacity>
            </View>
            <PlateStatePicker
              value={plateState}
              onChange={(state) => {
                setPlateState(state);
                setPlateStateError(null);
                setOcrStateNotice((notice) =>
                  notice ? { ...notice, selectedState: state } : null,
                );
              }}
              preferredStates={orderedStatePreferences}
              error={plateStateError ?? undefined}
            />
            {ocrStateNotice ? (
              <Text
                accessibilityLiveRegion="polite"
                style={[styles.muted, { color: colors.mutedForeground }]}
              >
                {t(
                  ocrStateNotice.selectedState === ocrStateNotice.suggestedState
                    ? "gatekeeper.plateStateSuggested"
                    : "gatekeeper.plateStateCorrected",
                  { state: ocrStateNotice.selectedState },
                )}
              </Text>
            ) : null}
            <Text style={[styles.label, { color: colors.foreground, fontSize: 18 }]}>
              {t("visitor.vehiclePlate")} *
            </Text>
            <TextInput
              testID="gate-vehicle-plate"
              value={vehiclePlate}
              onChangeText={(value) => setVehiclePlate(value.toUpperCase())}
              autoCapitalize="characters"
              style={[inputStyle, styles.plateInput]}
              placeholderTextColor={colors.mutedForeground}
            />
            <View style={styles.twoCol}>
              <View style={styles.field}>
                <Text style={[styles.label, { color: colors.foreground }]}>
                  {t("visitor.firstName")} *
                </Text>
                <TextInput
                  testID="gate-first-name"
                  value={firstName}
                  onFocus={() => setActiveNameField("firstName")}
                  onChangeText={(value) => {
                    forgetPlateAutoFill("firstName");
                    setActiveNameField("firstName");
                    setFirstName(value);
                  }}
                  style={inputStyle}
                  placeholderTextColor={colors.mutedForeground}
                />
              </View>
              <View style={styles.field}>
                <Text style={[styles.label, { color: colors.foreground }]}>
                  {t("visitor.lastName")} *
                </Text>
                <TextInput
                  testID="gate-last-name"
                  value={lastName}
                  onFocus={() => setActiveNameField("lastName")}
                  onChangeText={(value) => {
                    forgetPlateAutoFill("lastName");
                    setActiveNameField("lastName");
                    setLastName(value);
                  }}
                  style={inputStyle}
                  placeholderTextColor={colors.mutedForeground}
                />
              </View>
            </View>
            {matchingDrivers.length > 0 ? (
              <View
                style={[
                  styles.suggestions,
                  { borderColor: colors.border, backgroundColor: colors.card },
                ]}
              >
                {matchingDrivers.map((visit) => (
                  <TouchableOpacity
                    key={`${visit.firstName}-${visit.lastName}-${visit.company ?? ""}-${visit.id}`}
                    testID={`gate-driver-suggestion-${visit.id}`}
                    onPress={() => useDriver(visit)}
                    style={[
                      styles.suggestionRow,
                      { borderColor: colors.border },
                    ]}
                  >
                    <Text
                      style={[
                        styles.suggestionName,
                        { color: colors.foreground },
                      ]}
                    >
                      {visit.firstName} {visit.lastName}
                    </Text>
                    <Text
                      style={[styles.muted, { color: colors.mutedForeground }]}
                    >
                      {[
                        visit.company,
                        formatPlateForDisplay(
                          visit.plateState,
                          visit.vehiclePlate,
                          t("gatekeeper.plateStateUnconfirmed"),
                        ),
                      ]
                        .filter(Boolean)
                        .join(" - ")}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            ) : null}
            <Text style={[styles.label, { color: colors.foreground }]}>
              {t("visitor.company")}
            </Text>
            <TextInput
              testID="gate-company"
              value={company}
              onChangeText={(value) => {
                forgetPlateAutoFill("company");
                setCompany(value);
              }}
              style={inputStyle}
              placeholderTextColor={colors.mutedForeground}
            />

            <Text style={[styles.label, { color: colors.foreground }]}>
              {t("gatekeeper.currentLocation")}
            </Text>
            <Text
              testID="gate-gps-pill"
              style={[styles.muted, { color: colors.mutedForeground }]}
            >
              {fenceSentence}
            </Text>
            <TouchableOpacity testID="gate-partner-selector" onPress={() => setPartnerMenuOpen((open) => !open)} style={[styles.siteOption, { borderColor: colors.border, backgroundColor: colors.card }]}>
              <Text style={[styles.siteOptionName, { color: colors.foreground }]}>{assignedPartners.find((group) => group.partnerId === selectedPartnerId)?.partnerName ?? "Select company"}</Text>
            </TouchableOpacity>
            {partnerMenuOpen && assignedPartners.map((group) => (
              <TouchableOpacity key={group.partnerId} onPress={() => { setSelectedPartnerId(group.partnerId); setPartnerMenuOpen(false); setSiteMenuOpen(true); }} style={[styles.siteOption, { borderColor: colors.border, backgroundColor: colors.card }]}>
                <Text style={[styles.siteOptionName, { color: colors.foreground }]}>{group.partnerName}</Text>
              </TouchableOpacity>
            ))}
            <View testID={selectedAssignedSite ? `gate-site-option-${selectedAssignedSite.siteCode}` : undefined}>
              <TouchableOpacity testID="gate-site-selector" onPress={() => setSiteMenuOpen((open) => !open)} style={[styles.siteOption, { borderColor: colors.border, backgroundColor: colors.card }]}>
                <Text style={[styles.siteOptionName, { color: colors.foreground }]}>{selectedAssignedSite?.name ?? "Select site"}</Text>
              </TouchableOpacity>
            </View>
            {siteMenuOpen && (assignedPartners.find((group) => group.partnerId === selectedPartnerId)?.sites ?? []).map((site) => {
              const selected = confirmedCode === site.siteCode;
              return (
                <TouchableOpacity
                  key={site.siteCode}
                  testID={`gate-site-option-${site.siteCode}`}
                  onPress={() => {
                    appliedDefault.current = true;
                    setSiteCode(site.siteCode);
                    setConfirmedCode(site.siteCode);
                    setHostKey(null);
                    setSiteMenuOpen(false);
                  }}
                  style={[
                    styles.siteOption,
                    {
                      borderColor: selected ? colors.primary : colors.border,
                      backgroundColor: colors.card,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.siteOptionName,
                      { color: colors.foreground, fontSize: 20 },
                    ]}
                  >
                    {site.name}
                  </Text>
                </TouchableOpacity>
              );
            })}
            {ctxQuery.isLoading ? (
              <View style={styles.loading}>
                <ActivityIndicator color={colors.primary} />
              </View>
            ) : ctxQuery.error ? (
              <Text style={[styles.error, { color: colors.destructive }]}>
                {t("visitor.siteLookupFailed")}
              </Text>
            ) : ctxQuery.data ? (
              <VisitorHostPicker
                ctx={ctxQuery.data}
                hostKey={hostKey}
                onSelectHost={setHostKey}
                purpose={purpose}
                onPurposeChange={(value) => {
                  forgetPlateAutoFill("purpose");
                  setPurpose(value);
                }}
                notes={notes}
                onNotesChange={setNotes}
                duration={duration}
                onDurationChange={(value) => {
                  forgetPlateAutoFill("duration");
                  setDuration(value);
                }}
                durationChips={GATE_DURATION_CHIPS.map((chip) => ({
                  id: chip.id,
                  minutes: chip.minutes,
                  label: t(
                    `gatekeeper.duration${chip.id === "30m" ? "30m" : chip.id === "2h" ? "2h" : chip.id === "allDay" ? "AllDay" : "Overnight"}`,
                  ),
                }))}
                extraSubmitDisabled={!fence.canSubmit}
                busy={busy}
                onSubmit={onCheckIn}
                onChangeSite={() => {
                  setConfirmedCode(null);
                  setHostKey(null);
                }}
                labels={{
                  changeSite: t("visitor.changeSite"),
                  whoVisiting: t("visitor.whoVisiting"),
                  noHosts: t("visitor.noHosts"),
                  purpose: t("visitor.purpose"),
                  purposePlaceholder: t("visitor.purposePlaceholder"),
                  notes: t("gatekeeper.notes"),
                  notesPlaceholder: t("gatekeeper.notesPlaceholder"),
                  expectedMinutes: t("visitor.expectedMinutes"),
                  checkIn: t("visitor.checkIn"),
                  geofenceNote: t("gatekeeper.gpsRequiredToSubmit"),
                }}
              />
            ) : null}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </ScreenSafeArea>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: { gap: 14, padding: 20, paddingBottom: 40 },
  title: { fontFamily: "Inter_700Bold", fontSize: 24 },
  subtitle: { fontFamily: "Inter_400Regular", fontSize: 13, marginTop: -8 },
  card: { borderWidth: 1, borderRadius: 12, gap: 10, padding: 14 },
  cardTitle: { fontFamily: "Inter_600SemiBold", fontSize: 17 },
  plateInput: { fontFamily: "Inter_700Bold", fontSize: 22, minHeight: 56 },
  admitLabel: { fontFamily: "Inter_700Bold", fontSize: 13 },
  twoCol: { flexDirection: "row", gap: 10 },
  field: { flex: 1, minWidth: 0 },
  photoButton: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 12,
  },
  photoLabel: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 12,
    textAlign: "center",
  },
  label: {
    fontFamily: "Inter_500Medium",
    fontSize: 13,
    marginBottom: 6,
    marginTop: 6,
  },
  input: {
    borderRadius: 10,
    borderWidth: 1,
    fontFamily: "Inter_400Regular",
    fontSize: 15,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  lookupRow: { alignItems: "center", flexDirection: "row", gap: 8 },
  siteOption: {
    borderRadius: 10,
    borderWidth: 1,
    gap: 2,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  siteOptionName: { fontFamily: "Inter_600SemiBold", fontSize: 15 },
  iconButton: {
    alignItems: "center",
    borderRadius: 10,
    borderWidth: 1.5,
    justifyContent: "center",
    minHeight: 44,
    minWidth: 44,
  },
  loading: { marginTop: 10 },
  error: { fontFamily: "Inter_500Medium", fontSize: 13, marginTop: 10 },
  visitRow: {
    alignItems: "center",
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: 10,
    paddingTop: 10,
  },
  visitText: { flex: 1, minWidth: 0 },
  visitName: { fontFamily: "Inter_600SemiBold", fontSize: 14 },
  muted: { fontFamily: "Inter_400Regular", fontSize: 12, marginTop: 2 },
  suggestions: { borderRadius: 10, borderWidth: 1, overflow: "hidden" },
  suggestionRow: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  suggestionName: { fontFamily: "Inter_600SemiBold", fontSize: 14 },
  voiceStatus: {
    alignItems: "center",
    borderRadius: 10,
    borderWidth: 1,
    flexDirection: "row",
    gap: 8,
    padding: 10,
  },
  voiceStatusText: { fontFamily: "Inter_600SemiBold", fontSize: 13 },
  voiceConfirm: { borderRadius: 10, borderWidth: 1, gap: 10, padding: 12 },
  voiceConfirmTitle: { fontFamily: "Inter_600SemiBold", fontSize: 14 },
  voiceConfirmActions: { alignItems: "center", flexDirection: "row", justifyContent: "flex-end", gap: 14 },
  voiceActionButton: { borderRadius: 9, paddingHorizontal: 14, paddingVertical: 10 },
  voiceActionText: { color: "#FFFFFF", fontFamily: "Inter_600SemiBold", fontSize: 13, textAlign: "center" },
  voiceCancelText: { fontFamily: "Inter_600SemiBold", fontSize: 13, padding: 8, textAlign: "center" },
});
