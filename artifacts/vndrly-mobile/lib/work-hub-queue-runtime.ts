import * as FileSystem from "expo-file-system/legacy";
import { getToken, type StoredUser } from "./auth";
import { apiFetch, getApiBase } from "./api";
import {
  enqueueWorkHubCommand,
  enqueueWorkHubUpload,
  flushWorkHubCommands,
  type QueuedWorkHubItem,
  type WorkHubQueueScope,
} from "./work-hub-queue";

async function nativeStore() {
  return (await import("./work-hub-queue-native")).getNativeWorkHubQueueStore();
}

export function workHubQueueScope(user: StoredUser | null | undefined): WorkHubQueueScope | null {
  if (!user?.id) return null;
  const membership = user.availableMemberships?.find((candidate) => candidate.id === user.activeMembershipId);
  if (membership) return { userId: user.id, ownerOrgType: membership.orgType, ownerOrgId: membership.orgId };
  if (user.vendorId) return { userId: user.id, ownerOrgType: "vendor", ownerOrgId: user.vendorId };
  if (user.partnerId) return { userId: user.id, ownerOrgType: "partner", ownerOrgId: user.partnerId };
  return null;
}

export function isOfflineWorkHubFailure(cause: unknown) {
  return (cause as { code?: string } | undefined)?.code === "network.unreachable";
}

export async function queueNativeWorkHubRequest(
  user: StoredUser,
  path: string,
  method: "POST" | "PUT" | "PATCH" | "DELETE",
  payload: unknown,
  explicitOperationId?: string,
) {
  const scope = workHubQueueScope(user);
  if (!scope) throw new Error("An active Work Hub organization is required");
  const operationId = explicitOperationId ?? (typeof payload === "object" && payload !== null && "operationId" in payload && typeof payload.operationId === "string"
    ? payload.operationId
    : undefined);
  return enqueueWorkHubCommand(await nativeStore(), scope, { path, method, payload, operationId });
}

export async function queueNativeWorkHubUpload(
  user: StoredUser,
  path: string,
  fileUri: string,
  contentType: string,
  dependsOn: string[] = [],
  headers: Record<string, string> = {},
  removeAfterSend = false,
  operationId?: string,
) {
  const scope = workHubQueueScope(user);
  if (!scope) throw new Error("An active Work Hub organization is required");
  return enqueueWorkHubUpload(await nativeStore(), scope, { path, fileUri, contentType, dependsOn, headers, removeAfterSend, operationId });
}

async function replay(item: QueuedWorkHubItem) {
  if (item.kind === "command") {
    await apiFetch(item.path, {
      method: item.method,
      body: JSON.stringify(item.payload),
      headers: { "x-operation-id": item.operationId },
    });
    return;
  }
  const token = await getToken();
  if (!token) throw Object.assign(new Error("Authorization is unavailable"), { status: 401 });
  const response = await FileSystem.uploadAsync(`${getApiBase()}${item.path}`, item.fileUri, {
    httpMethod: item.method,
    uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
    headers: {
      ...item.headers,
      Authorization: `Bearer ${token}`,
      "x-vndrly-client": "ios",
      "x-operation-id": item.operationId,
      "Content-Type": item.contentType,
    },
  });
  if (response.status < 200 || response.status >= 300) throw Object.assign(new Error("Upload failed"), { status: response.status });
  if (item.removeAfterSend) await FileSystem.deleteAsync(item.fileUri, { idempotent: true }).catch(() => undefined);
}

export async function flushNativeWorkHubQueue(user: StoredUser) {
  const scope = workHubQueueScope(user);
  if (!scope) return { sent: 0, remaining: 0, revoked: false };
  return flushWorkHubCommands(await nativeStore(), scope, replay);
}
