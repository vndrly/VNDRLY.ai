import React, { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Alert, AppState, Image, Platform, Text, TextInput, View } from "react-native";

import * as ImagePicker from "expo-image-picker";
import { router } from "expo-router";
import { useTranslation } from "react-i18next";
import ShiftPill from "@/components/ShiftPill";
import { useBrand } from "@/hooks/use-brand";
import TogglePillButton from "@/components/TogglePillButton";
import { useAuth } from "@/hooks/use-auth";
import { useColors } from "@/hooks/useColors";
import { useWorkHubDevicePresence } from "@/hooks/use-work-hub-device-presence";
import { captureAuthScope, isAuthScopeCurrent } from "@/lib/auth";
import { getDeviceId } from "@/lib/deviceId";
import { changeNativeDuty, changeNativeOnCall, designateNativeWorkPhone, readNativeOperations, readNativeRequest, respondNativeRequest, selectNativePrimaryTask, updateNativeConsent } from "@/lib/native-operations";
import { requestIsActionable, type NativeDeviceRequest, type NativeOperationsStatus } from "@/lib/native-operations-policy";
import { beginRequestedPhoto, requestedPhotoBackgroundAvailable, resumeRequestedPhoto, saveRequestedPhotoForeground } from "@/lib/requested-photo-upload";
import PendingRequestedPhotos from "./PendingRequestedPhotos";
import { refreshSelectedNativeWorkActivity, stopNativeWorkActivity } from "@/lib/native-live-work";
import NativeNoteDraft from "./NativeNoteDraft";
import { scanWorkTextDraft } from "@/lib/native-work-capture";


import NativeSystem from "../../modules/vndrly-system-surfaces/src/VndrlySystemSurfacesModule";

export default function NativeOperations({ requestId, action, systemRequestId, compact = false, settingsOnly = false }: { compact?: boolean; settingsOnly?: boolean; requestId?: string; action?: string; systemRequestId?: string }) {
  const { user } = useAuth();
  const { t } = useTranslation();
  const colors = useColors();
  const brand = useBrand();
  const [status, setStatus] = useState<NativeOperationsStatus | null>(null);
  const [shiftNotice, setShiftNotice] = useState<"start" | "end" | null>(null);
  useEffect(() => { if (!shiftNotice) return; const timer = setTimeout(() => setShiftNotice(null), 2500); return () => clearTimeout(timer); }, [shiftNotice]);
  const [deviceId, setDeviceId] = useState("");
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [review, setReview] = useState<{ request: NativeDeviceRequest; asset: ImagePicker.ImagePickerAsset; source: "camera" | "library"; capturedAt: string | null } | null>(null);
  const working = useRef(false), handledAction = useRef("");
  const scope = useRef(captureAuthScope());
  useWorkHubDevicePresence("/work-hub/native-operations", !!user);
  const refresh = useCallback(async () => {
    const captured = captureAuthScope();
    const value = await readNativeOperations(captured);
    if (isAuthScopeCurrent(captured)) { setStatus(value); setDeviceId(await getDeviceId()); setError(""); }
    return value;
  }, []);
  useEffect(() => {
    scope.current = captureAuthScope(); setStatus(null); setReview(null); setShiftNotice(null);
    let alive = true;
    const poll = async () => {
      if (!alive || AppState.currentState !== "active") return;
      try {
        const value = await refresh();
      } catch { if (alive) setError(t("nativeOperations.unavailable")); }
    };
    void poll(); const timer = setInterval(() => { void poll(); }, 15_000);
    const subscription = AppState.addEventListener("change", () => { void poll(); });
    return () => { alive = false; clearInterval(timer); subscription.remove(); };
  }, [user?.id, user?.activeMembershipId, refresh, t]);
  async function run(operation: () => Promise<unknown>) {
    if (working.current) return;
    working.current = true; setBusy(true); setError("");
    const captured = captureAuthScope();
    try { await operation(); if (isAuthScopeCurrent(captured)) await refresh(); }
    catch (e) {
      if (isAuthScopeCurrent(captured)) {
        const message = e instanceof Error ? e.message : "";
        setError(message && !/^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$/i.test(message) ? message : t("nativeOperations.unavailable"));
      }
    }
    finally { working.current = false; if (isAuthScopeCurrent(captured)) setBusy(false); }
  }
  async function finishSystemAction(saved: boolean) {
    if (systemRequestId && /^[0-9a-f-]{36}$/i.test(systemRequestId)) await NativeSystem?.completeSystemAction(systemRequestId, saved).catch(() => undefined);
  }
  async function dutyAction(action: "start" | "end", options?: Parameters<typeof changeNativeDuty>[1]) {
    const captured = captureAuthScope();
    try {
      if (action === "end") await Promise.all([changeNativeDuty(action), stopNativeWorkActivity()]);
      else await changeNativeDuty(action, options);
      const canonical = await readNativeOperations(captured);
      const saved = canonical.duty?.active === (action === "start");
      await finishSystemAction(saved);
      if (!saved) throw new Error(t("nativeOperations.unavailable"));
      if (isAuthScopeCurrent(captured)) { setStatus(canonical); setShiftNotice(action); }
    } catch (error) { await finishSystemAction(false); throw error; }
  }
  function startDuty(options?: Parameters<typeof changeNativeDuty>[1]) {
    void run(() => dutyAction("start", options));
  }
  function endDuty() {
    const captured = captureAuthScope();
    const confirm = () => { if (isAuthScopeCurrent(captured)) void run(() => dutyAction("end")); };
    if (Platform.OS === "web") { if (window.confirm(t("nativeOperations.endConfirm"))) confirm(); else void finishSystemAction(false); return; }
    Alert.alert(t("nativeOperations.end"), t("nativeOperations.endConfirm"), [
      { text: t("nativeOperations.cancel"), style: "cancel", onPress: () => { void finishSystemAction(false); } },
      { text: t("nativeOperations.end"), onPress: confirm },
    ]);
  }
  useEffect(() => {
    if (!status || busy || !action || handledAction.current === action) return;
    handledAction.current = action;
    if (action === "start-duty") startDuty();
    if (action === "end-duty") endDuty();
    if (action === "scan") void run(async () => { const result = await scanWorkTextDraft(); if (isAuthScopeCurrent(scope.current)) setDraft(result.text); });
  }, [status, action]);
  async function capture(request: NativeDeviceRequest, source: "camera" | "library") {
    await run(async () => {
      const current = await readNativeRequest(request.id);
      if (!requestIsActionable(current) || (source === "library" && !current.allowLibrary)) throw new Error(t("nativeOperations.expired"));
      await respondNativeRequest(request.id, { state: "opened" });
      if (source === "camera") {
        const permission = await ImagePicker.requestCameraPermissionsAsync();
        if (!permission.granted) throw new Error(t("nativeOperations.cameraPermission"));
      }
      const result = source === "camera"
        ? await ImagePicker.launchCameraAsync({ quality: 0.6, allowsEditing: false })
        : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.6, exif: true });
      if (!result.canceled && result.assets[0] && isAuthScopeCurrent(scope.current)) {
        const asset = result.assets[0];
        const rawDate = asset.exif?.DateTimeOriginal;
        const offset = asset.exif?.OffsetTimeOriginal;
        const suppliedDate = typeof rawDate === "string" && typeof offset === "string" && /^[+-]\d{2}:\d{2}$/.test(offset)
          ? `${rawDate.replace(/^(\d{4}):(\d{2}):(\d{2}) /, "$1-$2-$3T")}${offset}` : "";
        const capturedAt = source === "camera" ? new Date().toISOString() : suppliedDate && Number.isFinite(Date.parse(suppliedDate)) ? new Date(suppliedDate).toISOString() : null;
        setReview({ request: current, asset, source, capturedAt });
      }
    });
  }
  async function savePhoto() {
    if (!review || !user || !review.request.ticketId) return;
    const selected = review, captured = captureAuthScope();
    await run(async () => {
      const current = await readNativeRequest(selected.request.id, captured);
      if (!requestIsActionable(current)) throw new Error(t("nativeOperations.expired"));
      if (requestedPhotoBackgroundAvailable()) {
        await beginRequestedPhoto(current, selected.asset.uri, selected.asset.mimeType || "image/jpeg", selected.source, selected.capturedAt);
        if (!isAuthScopeCurrent(captured)) return;
        setReview(null); await resumeRequestedPhoto(current.id);
      } else { await saveRequestedPhotoForeground(current, selected.asset, selected.source, selected.capturedAt); if (isAuthScopeCurrent(captured)) setReview(null); }
    });
  }
  function decline(request: NativeDeviceRequest) {
    const choices = ["unsafe_now", "inaccessible_subject", "wrong_ticket", "other"] as const;
    Alert.alert(t("nativeOperations.decline"), t("nativeOperations.declineReason"), choices.map(reason => ({
      text: t(`nativeOperations.${reason}`), onPress: () => { void run(() => respondNativeRequest(request.id, { state: "declined", declineReason: reason })); },
    })));
  }
  const textStyle = { color: colors.text, fontSize: 15 };
  const button = (label: string, onPress: () => void) => <TogglePillButton accessibilityLabel={label} onPress={onPress} disabled={busy}>{label}</TogglePillButton>;
  if (!user) return null;
  const onCall = status?.onCallActive === true || status?.onCallWindows?.some(window => Date.parse(window.startsAt) <= Date.now() && Date.parse(window.endsAt) > Date.now()) === true;
  const controls = <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 12 }}>
    <ShiftPill active={status?.duty?.active === true} disabled={busy || !status} label={t(shiftNotice === "start" && status?.duty?.active ? "nativeOperations.shiftStarted" : shiftNotice === "end" && !status?.duty?.active ? "nativeOperations.shiftEnded" : status?.duty?.active ? "nativeOperations.onShift" : "nativeOperations.start")} onPress={() => status?.duty?.active ? endDuty() : startDuty()} />
    <ShiftPill active={onCall} disabled={busy || !status} label={t("nativeOperations.onCallOn")} onPress={() => { void run(() => changeNativeOnCall(!onCall, status?.duty?.active === true)); }} />
  </View>;
  if (compact) return <View style={{ backgroundColor: colors.card, borderColor: brand.primary, borderWidth: 1, borderRadius: 12, padding: 12 }}>{status ? controls : <ActivityIndicator accessibilityLabel={t("nativeOperations.loading")} />}{error ? <Text accessibilityRole="alert" style={textStyle}>{error}</Text> : null}</View>;
  if (settingsOnly) return <View style={{ gap: 10 }}>{status ? <>
    <Text style={textStyle}>{t(status.designatedDeviceId === deviceId ? "nativeOperations.workPhone" : "nativeOperations.viewer")}</Text>
    {button(t("nativeOperations.designate"), () => { void run(designateNativeWorkPhone); })}
    {button(t(status.consent.locationSharing ? "nativeOperations.sharingOff" : "nativeOperations.sharingOn"), () => { void run(() => updateNativeConsent(!status.consent.locationSharing)); })}
    {status.policy.automaticArrival ? button(t(status.consent.automaticArrival ? "nativeArrival.disable" : "nativeArrival.enable"), () => { void run(() => updateNativeConsent(status.consent.locationSharing, !status.consent.automaticArrival)); }) : null}
  </> : <ActivityIndicator />}{error ? <Text accessibilityRole="alert" style={textStyle}>{error}</Text> : null}</View>;
  return <View style={{ backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1, borderRadius: 16, padding: 16, gap: 12 }}>
    <Text accessibilityRole="header" style={{ ...textStyle, fontSize: 19, fontWeight: "700" }}>{t("nativeOperations.title")}</Text>
    {error ? <Text accessibilityRole="alert" style={textStyle}>{error}</Text> : null}
    <PendingRequestedPhotos />
    {!status ? <ActivityIndicator accessibilityLabel={t("nativeOperations.loading")} /> : !status.policy.enabled ? <Text style={textStyle}>{t("nativeOperations.disabled")}</Text> : <>
      {controls}
      {status.tasks?.map(task => <View key={`${task.kind}:${task.id}`} style={{ gap: 8 }}>
        <Text style={textStyle}>{task.identifier} · {task.site} · {task.status}</Text>
        {button(t(status.selectedTask?.kind === task.kind && status.selectedTask.id === task.id ? "nativeOperations.selectedTask" : "nativeOperations.selectTask"), () => { void run(async () => { await selectNativePrimaryTask(task.kind, task.id); await refreshSelectedNativeWorkActivity(); }); })}
        {button(t("nativeOperations.openTask"), () => router.push((task.kind === "ticket" ? `/ticket/${task.id}` : task.kind === "gate" ? "/(tabs)/gate" : `/(tabs)/fleet?runId=${task.id}`) as never))}
      </View>)}
      {button(t("nativeOperations.scan"), () => { void run(async () => { const result = await scanWorkTextDraft(); if (isAuthScopeCurrent(scope.current)) setDraft(result.text); }); })}
      <TextInput accessibilityLabel={t("nativeOperations.scanned")} value={draft} onChangeText={setDraft} multiline style={{ ...textStyle, borderColor: colors.border, borderWidth: 1, borderRadius: 8, padding: 12, minHeight: 80 }} />
      <NativeNoteDraft value={draft} onChange={setDraft} disabled={busy} onBusy={setBusy} />
      <Text style={{ color: colors.mutedForeground }}>{t("nativeOperations.scanned")} {t("nativeOperations.manual")}</Text>
      {status.requests.filter(item => !requestId || item.id === requestId).map(request => <View key={request.id} style={{ borderTopWidth: 1, borderColor: colors.border, paddingTop: 12, gap: 10 }}>
        <Text style={textStyle}>{request.purpose}</Text>
        {button(t("nativeOperations.acknowledge"), () => { void run(() => import("@/lib/api").then(({ apiFetch }) => apiFetch(`/api/native-operations/requests/${request.id}/acknowledge`, { method: "POST", body: "{}" }))); })}
        <Text style={textStyle}>{t("nativeOperations.requestState", { state: request.state, time: new Date(request.expiresAt).toLocaleString() })}</Text>
        {request.result?.late ? <Text accessibilityRole="alert" style={textStyle}>{t("nativePhotoTransfer.late")}</Text> : null}
        {request.ticketId ? button(t("nativeOperations.openTicket", { id: request.ticketId }), () => router.push(`/ticket/${request.ticketId}` as never)) : null}
        {request.kind === "photo" && requestIsActionable(request) && status.designatedDeviceId === deviceId && request.ticketId ? <>
          {button(t("nativeOperations.camera"), () => { void capture(request, "camera"); })}
          {request.allowLibrary ? button(t("nativeOperations.library"), () => { void capture(request, "library"); }) : null}
          {button(t("nativeOperations.decline"), () => decline(request))}
        </> : null}
      </View>)}
      {review ? <View style={{ gap: 12 }}>
        <Text style={textStyle}>{t("nativeOperations.review", { id: review.request.ticketId })}</Text>
        <Text style={textStyle}>{t("nativePhotoTransfer.sourceTime", { source: review.source, time: review.capturedAt ? new Date(review.capturedAt).toLocaleString() : t("nativePhotoTransfer.unknownTime") })}</Text>
        <Image source={{ uri: review.asset.uri }} accessibilityLabel={t("nativeOperations.preview")} style={{ height: 220, width: "100%" }} resizeMode="contain" />
        {button(t("nativeOperations.save"), () => { void savePhoto(); })}
        {button(t("nativeOperations.cancel"), () => setReview(null))}
      </View> : null}
    </>}
  </View>;
}
