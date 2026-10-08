import React, { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Alert, AppState, Image, Platform, Text, TextInput, View } from "react-native";
import DateTimePicker from "@react-native-community/datetimepicker";
import * as ImagePicker from "expo-image-picker";
import { router } from "expo-router";
import { useTranslation } from "react-i18next";
import TogglePillButton from "@/components/TogglePillButton";
import { useAuth } from "@/hooks/use-auth";
import { useColors } from "@/hooks/useColors";
import { useWorkHubDevicePresence } from "@/hooks/use-work-hub-device-presence";
import { captureAuthScope, isAuthScopeCurrent } from "@/lib/auth";
import { getDeviceId } from "@/lib/deviceId";
import { changeNativeDuty, designateNativeWorkPhone, readNativeOperations, readNativeRequest, respondNativeRequest, selectNativePrimaryTask, updateNativeConsent } from "@/lib/native-operations";
import { requestIsActionable, type NativeDeviceRequest, type NativeOperationsStatus } from "@/lib/native-operations-policy";
import { beginRequestedPhoto, requestedPhotoBackgroundAvailable, resumeRequestedPhoto, saveRequestedPhotoForeground } from "@/lib/requested-photo-upload";
import PendingRequestedPhotos from "./PendingRequestedPhotos";
import { refreshSelectedNativeWorkActivity, stopNativeWorkActivity } from "@/lib/native-live-work";
import NativeNoteDraft from "./NativeNoteDraft";
import { scanWorkTextDraft } from "@/lib/native-work-capture";
import { readNativeDeviceReadiness, requestNativeLocationPermissions } from "@/lib/native-device-readiness";
import * as Notifications from "expo-notifications";
import NativeSystem from "../../modules/vndrly-system-surfaces/src/VndrlySystemSurfacesModule";

export default function NativeOperations({ requestId, action, systemRequestId }: { requestId?: string; action?: string; systemRequestId?: string }) {
  const { user } = useAuth();
  const { t } = useTranslation();
  const colors = useColors();
  const [status, setStatus] = useState<NativeOperationsStatus | null>(null);
  const [deviceId, setDeviceId] = useState("");
  const [draft, setDraft] = useState("");
  const [onCallStart, setOnCallStart] = useState(""), [onCallEnd, setOnCallEnd] = useState("");
  const [onCallPicker, setOnCallPicker] = useState<"start" | "end" | null>(null);
  const [readiness, setReadiness] = useState<Awaited<ReturnType<typeof readNativeDeviceReadiness>> | null>(null);
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
    scope.current = captureAuthScope(); setStatus(null); setReview(null);
    let alive = true;
    void readNativeDeviceReadiness().then(value => { if (alive) setReadiness(value); }).catch(() => undefined);
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
    catch (e) { if (isAuthScopeCurrent(captured)) setError(e instanceof Error ? e.message : t("nativeOperations.unavailable")); }
    finally { working.current = false; if (isAuthScopeCurrent(captured)) setBusy(false); }
  }
  async function finishSystemAction(saved: boolean) {
    if (systemRequestId && /^[0-9a-f-]{36}$/i.test(systemRequestId)) await NativeSystem?.completeSystemAction(systemRequestId, saved).catch(() => undefined);
  }
  async function dutyAction(action: "start" | "end", options?: Parameters<typeof changeNativeDuty>[1]) {
    try {
      if (action === "end") await Promise.all([changeNativeDuty(action), stopNativeWorkActivity()]);
      else await changeNativeDuty(action, options);
      const canonical = await readNativeOperations();
      const saved = canonical.duty?.active === (action === "start");
      await finishSystemAction(saved);
      if (!saved) throw new Error(t("nativeOperations.unavailable"));
    } catch (error) { await finishSystemAction(false); throw error; }
  }
  function startDuty(options?: Parameters<typeof changeNativeDuty>[1]) {
    Alert.alert(t("nativeOperations.start"), t("nativeOperations.startConfirm"), [
      { text: t("nativeOperations.cancel"), style: "cancel", onPress: () => { void finishSystemAction(false); } },
      { text: t("nativeOperations.start"), onPress: () => { void run(() => dutyAction("start", options)); } },
    ]);
  }
  useEffect(() => {
    if (!status || busy || !action || handledAction.current === action) return;
    handledAction.current = action;
    if (action === "start-duty") startDuty();
    if (action === "end-duty") void run(() => dutyAction("end"));
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
  return <View style={{ backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1, borderRadius: 16, padding: 16, gap: 12 }}>
    <Text accessibilityRole="header" style={{ ...textStyle, fontSize: 19, fontWeight: "700" }}>{t("nativeOperations.title")}</Text>
    {error ? <Text accessibilityRole="alert" style={textStyle}>{error}</Text> : null}
    <PendingRequestedPhotos />
    {!status ? <ActivityIndicator accessibilityLabel={t("nativeOperations.loading")} /> : !status.policy.enabled ? <Text style={textStyle}>{t("nativeOperations.disabled")}</Text> : <>
      <Text style={textStyle}>{t(status.duty?.active ? "nativeOperations.onDuty" : "nativeOperations.offDuty")}</Text>
      <Text style={textStyle}>{t(status.designatedDeviceId === deviceId ? "nativeOperations.workPhone" : "nativeOperations.viewer")}</Text>
      {readiness ? <>
        <Text style={textStyle}>{t(readiness.notifications ? "nativeOperations.notificationsReady" : "nativeOperations.notificationsMissing")}</Text>
        {readiness.lowPower || readiness.backgroundRefresh === false ? <Text accessibilityRole="alert" style={textStyle}>{t("nativeOperations.degraded")}</Text> : null}
        {!readiness.notifications ? button(t("nativeOperations.enableNotifications"), () => { void run(async () => { await Notifications.requestPermissionsAsync(); setReadiness(await readNativeDeviceReadiness()); }); }) : null}
        {status.consent.locationSharing && (!readiness.location || !readiness.backgroundLocation) ? button(t("nativeOperations.enableLocation"), () => { void run(async () => { await requestNativeLocationPermissions(true); setReadiness(await readNativeDeviceReadiness()); }); }) : null}
      </> : null}
      {status.designatedDeviceId !== deviceId ? button(t("nativeOperations.designate"), () => { void run(designateNativeWorkPhone); }) : null}
      {status.duty?.active ? button(t("nativeOperations.end"), () => { void run(() => dutyAction("end")); }) : <>
        {button(t("nativeOperations.start"), () => startDuty())}
        {status.policy.dutyModes?.includes("ticket") ? status.tasks?.filter(task => task.kind === "ticket" && ["in_progress", "on_site"].includes(task.status)).map(task => <View key={`duty:${task.id}`}>{button(t("nativeOperations.ticketDuty", { id: task.identifier }), () => startDuty({ mode: "ticket", ticketId: Number(task.id) }))}</View>) : null}
        {status.policy.dutyModes?.includes("scheduled") ? status.shifts?.filter(shift => Date.parse(shift.startsAt) <= Date.now() && Date.parse(shift.endsAt) > Date.now()).map(shift => <View key={`shift:${shift.id}`}>{button(t("nativeOperations.shiftDuty", { title: shift.title }), () => startDuty({ mode: "scheduled", shiftId: shift.id }))}</View>) : null}
      </>}
      {button(t(status.consent.locationSharing ? "nativeOperations.sharingOff" : "nativeOperations.sharingOn"), () => { void run(() => updateNativeConsent(!status.consent.locationSharing)); })}
      {status.policy.automaticArrival ? button(t(status.consent.automaticArrival ? "nativeArrival.disable" : "nativeArrival.enable"), () => { void run(() => updateNativeConsent(status.consent.locationSharing, !status.consent.automaticArrival)); }) : null}
      <Text style={textStyle}>{t("nativeOperations.onCallExplanation")}</Text>
      {Platform.OS === "ios" ? <>
        {button(`${t("nativeOperations.onCallStart")}: ${onCallStart ? new Date(onCallStart).toLocaleString() : t("nativeOperations.chooseTime")}`, () => setOnCallPicker("start"))}
        {button(`${t("nativeOperations.onCallEnd")}: ${onCallEnd ? new Date(onCallEnd).toLocaleString() : t("nativeOperations.chooseTime")}`, () => setOnCallPicker("end"))}
        {onCallPicker ? <DateTimePicker accessibilityLabel={t(onCallPicker === "start" ? "nativeOperations.onCallStart" : "nativeOperations.onCallEnd")} mode="datetime" value={new Date((onCallPicker === "start" ? onCallStart : onCallEnd) || Date.now())} onChange={(_, date) => { if (date) (onCallPicker === "start" ? setOnCallStart : setOnCallEnd)(date.toISOString()); }} /> : null}
      </> : <>
        <TextInput accessibilityLabel={t("nativeOperations.onCallStart")} placeholder={t("nativeOperations.onCallStart")} value={onCallStart} onChangeText={setOnCallStart} style={{ ...textStyle, borderWidth: 1, borderColor: colors.border, padding: 10 }} />
        <TextInput accessibilityLabel={t("nativeOperations.onCallEnd")} placeholder={t("nativeOperations.onCallEnd")} value={onCallEnd} onChangeText={setOnCallEnd} style={{ ...textStyle, borderWidth: 1, borderColor: colors.border, padding: 10 }} />
      </>}
      {button(t("nativeOperations.onCallSave"), () => {
        if (!Number.isFinite(Date.parse(onCallStart)) || !Number.isFinite(Date.parse(onCallEnd)) || Date.parse(onCallEnd) <= Date.parse(onCallStart)) { setError(t("nativeOperations.onCallInvalid")); return; }
        Alert.alert(t("nativeOperations.onCallSave"), t("nativeOperations.onCallExplanation"), [
          { text: t("nativeOperations.cancel"), style: "cancel" },
          { text: t("nativeOperations.onCallSave"), onPress: () => { void run(() => import("@/lib/api").then(({ apiFetch }) => apiFetch("/api/native-operations/on-call", { method: "PUT", body: JSON.stringify({ windows: [{ startsAt: new Date(onCallStart).toISOString(), endsAt: new Date(onCallEnd).toISOString(), consent: true }] }) }))); } },
        ]);
      })}
      {button(t("nativeOperations.onCallClear"), () => { void run(() => import("@/lib/api").then(({ apiFetch }) => apiFetch("/api/native-operations/on-call", { method: "PUT", body: JSON.stringify({ windows: [] }) }))); })}
      <Text style={{ color: colors.mutedForeground }}>{t("nativeOperations.freshness")}</Text>
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
