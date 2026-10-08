import * as TaskManager from "expo-task-manager";
import * as Notifications from "expo-notifications";
import { AppState, Platform } from "react-native";
import { answerForegroundLocation, readNativeOperations, readNativeRequest } from "./native-operations";
import { captureAuthScope, getToken, getUser, isAuthScopeCurrent } from "./auth";
import { nativeRequestRoute, requestIsActionable } from "./native-operations-policy";
import { isExpoGo } from "./runtime";
import { refreshSelectedNativeWorkActivity } from "./native-live-work";
import { readNativeDeviceReadiness } from "./native-device-readiness";
import { synchronizeNativeJournal } from "./native-operation-journal-runtime";
import { readPendingRequestedPhotos, requestedPhotoBackgroundAvailable, resumeRequestedPhoto } from "./requested-photo-upload";
import { readTicketPhotoDrafts, resumeTicketPhoto } from "./ticket-photo-journal";

export const NATIVE_OPERATIONS_PUSH_TASK = "vndrly-native-operations-request";
let pending: Promise<void> | null = null;
let lastPoll = 0;
/** Payload selects only an opaque request. Current server authority supplies all work context. */
export async function executeNativeLocationPush(data: unknown) {
  if (!data || typeof data !== "object") return;
  const payload = data as Record<string, unknown>;
  const id = payload.nativeRequestId ?? payload.requestId;
  const silentPointer = Object.keys(payload).length === 1 && typeof payload.nativeRequestId === "string";
  if ((!silentPointer && !["native_operation", "native_operations_request", "native_location_request"].includes(String(payload.type))) || !nativeRequestRoute(id)) return;
  const user = await getUser();
  if (!user || user.requiresContextChoice || !await getToken()) return;
  const scope = captureAuthScope();
  const request = await readNativeRequest(String(id), scope);
  if (request.kind === "location" && requestIsActionable(request) && isAuthScopeCurrent(scope)) await answerForegroundLocation(request, scope);
}
async function pollCurrentRequests() {
  if (pending || AppState.currentState !== "active") return;
  pending = (async () => {
    const user = await getUser();
    if (!user || user.requiresContextChoice || !await getToken()) return;
    const readiness = await readNativeDeviceReadiness().catch(() => null);
    if (Date.now() - lastPoll < (readiness?.lowPower ? 60_000 : 10_000)) return;
    lastPoll = Date.now();
    const scope = captureAuthScope(), status = await readNativeOperations(scope);
    for (const request of status.requests.filter(item => item.kind === "location" && requestIsActionable(item))) {
      if (!isAuthScopeCurrent(scope)) return;
      await answerForegroundLocation(request, scope);
    }
    if (isAuthScopeCurrent(scope)) await synchronizeNativeJournal(user).catch(() => undefined);
    if (isAuthScopeCurrent(scope) && requestedPhotoBackgroundAvailable()) {
      for (const photo of await readPendingRequestedPhotos()) {
        if (!isAuthScopeCurrent(scope)) return;
        if (!photo.paused) await resumeRequestedPhoto(photo.requestId).catch(() => undefined);
      }
      for (const photo of await readTicketPhotoDrafts()) {
        if (!isAuthScopeCurrent(scope)) return;
        await resumeTicketPhoto(photo.operationId).catch(() => undefined);
      }
    }
  })();
  try { await pending; } finally { pending = null; }
}
if (!isExpoGo && Platform.OS !== "web" && !TaskManager.isTaskDefined(NATIVE_OPERATIONS_PUSH_TASK)) {
  TaskManager.defineTask(NATIVE_OPERATIONS_PUSH_TASK, async ({ data, error }) => {
    if (error) return;
    // Expo delivers the notification under data.data, while some native deliveries provide content directly.
    const value = data as { data?: unknown; notification?: { request?: { content?: { data?: unknown } } } } | undefined;
    try { await executeNativeLocationPush(value?.notification?.request?.content?.data ?? value?.data ?? data); } catch { /* expiry records unavailable server-side; never queues a GPS request */ }
  });
}
export async function startNativeOperationsRuntime() {
  if (Platform.OS === "web" || isExpoGo) return () => undefined;
  if (await TaskManager.isAvailableAsync()) await Notifications.registerTaskAsync(NATIVE_OPERATIONS_PUSH_TASK).catch(() => undefined);
  const receive = Notifications.addNotificationReceivedListener(notification => {
    void executeNativeLocationPush(notification.request.content.data).catch(() => undefined);
  });
  const state = AppState.addEventListener("change", () => { void pollCurrentRequests().catch(() => undefined); });
  const timer = setInterval(() => { void pollCurrentRequests().catch(() => undefined); }, 15_000);
  void pollCurrentRequests().catch(() => undefined);
  const activityTimer = setInterval(() => { if (AppState.currentState === "active") void refreshSelectedNativeWorkActivity().catch(() => undefined); }, 60_000);
  void refreshSelectedNativeWorkActivity().catch(() => undefined);
  return () => { receive.remove(); state.remove(); clearInterval(timer); clearInterval(activityTimer); };
}
