import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import { apiFetch } from "./api";
import { captureAuthScope, isAuthScopeCurrent, type StoredUser } from "./auth";
import { captureAndUploadImage } from "./photos";

export type TicketPhotoAttempt = {
  account: string;
  ticketId: number;
  operationId: string;
  objectPath: string;
};
export type TicketPhotoReceipt = {
  ticketId: number;
  noteId: number;
  operationId: string;
  objectPath: string;
  status: "applied";
  physicalCaptureVerified: false;
};
export function ticketPhotoAccount(user: StoredUser): string {
  return [
    user.id,
    user.role,
    user.activeMembershipId ?? "",
    user.vendorId ?? "",
    user.partnerId ?? "",
  ].join(".");
}
export async function readTicketPhotoAttempt(
  user: StoredUser,
  ticketId: number,
): Promise<TicketPhotoAttempt | null> {
  const key = `vndrly.ticket-photo.${ticketPhotoAccount(user)}.${ticketId}`;
  const raw =
    Platform.OS === "web"
      ? globalThis.localStorage.getItem(key)
      : await SecureStore.getItemAsync(key);
  return raw ? (JSON.parse(raw) as TicketPhotoAttempt) : null;
}
type Dependencies = {
  current(): boolean;
  read(): Promise<TicketPhotoAttempt | null>;
  write(attempt: TicketPhotoAttempt): Promise<void>;
  clear(): Promise<void>;
  capture(): Promise<{ objectPath: string } | null>;
  operationId(): string;
  get(attempt: TicketPhotoAttempt): Promise<TicketPhotoReceipt>;
  post(attempt: TicketPhotoAttempt): Promise<TicketPhotoReceipt>;
};
/** An unknown association is retained, never recaptured or assigned a new operation. */
export async function associateTicketPhoto(
  account: string,
  ticketId: number,
  dependencies: Dependencies,
): Promise<TicketPhotoReceipt | null> {
  const current = () => {
    if (!dependencies.current())
      throw Object.assign(new Error("Request authorization changed"), {
        name: "AbortError",
      });
  };
  current();
  let attempt = await dependencies.read();
  current();
  if (attempt && (attempt.account !== account || attempt.ticketId !== ticketId))
    throw new Error("Photo attempt belongs to another account or ticket");
  if (
    attempt &&
    (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      attempt.operationId,
    ) ||
      !/^\/objects\/uploads\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        attempt.objectPath,
      ))
  )
    throw new Error("Invalid saved photo attempt");
  if (!attempt) {
    const upload = await dependencies.capture();
    current();
    if (!upload) return null;
    if (!/^\/objects\/uploads\/[0-9a-f-]{36}$/i.test(upload.objectPath))
      throw new Error("Invalid private photo upload");
    attempt = {
      account,
      ticketId,
      operationId: dependencies.operationId(),
      objectPath: upload.objectPath,
    };
    await dependencies.write(attempt);
    current();
  } else {
    try {
      const receipt = await dependencies.get(attempt);
      current();
      verifyReceipt(attempt, receipt);
      await dependencies.clear();
      return receipt;
    } catch (error) {
      current();
      if ((error as { status?: number }).status !== 404) throw error;
      // Only the exact association-not-found response permits an exact retry.
      if (
        (error as { code?: string }).code !==
        "ticket.photo_association_not_found"
      )
        throw error;
    }
  }
  const receipt = await dependencies.post(attempt);
  current();
  verifyReceipt(attempt, receipt);
  await dependencies.clear();
  return receipt;
}
function verifyReceipt(
  attempt: TicketPhotoAttempt,
  receipt: TicketPhotoReceipt,
) {
  if (
    receipt.status !== "applied" ||
    receipt.ticketId !== attempt.ticketId ||
    receipt.operationId !== attempt.operationId ||
    receipt.objectPath !== attempt.objectPath ||
    !Number.isInteger(receipt.noteId) ||
    receipt.noteId <= 0
  )
    throw new Error("Photo association was not verified");
}
export function createTicketPhotoClient(user: StoredUser, ticketId: number, reviewedCapture?: () => Promise<{ objectPath: string } | null>, requestId?: string) {
  if (requestId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(requestId)) throw new Error("Invalid photo request binding");
  const account = ticketPhotoAccount(user),
    scope = captureAuthScope();
  const key = `vndrly.ticket-photo.${account}.${ticketId}${requestId ? `.${requestId}` : ""}`;
  const set = (value: string) =>
    Platform.OS === "web"
      ? Promise.resolve(globalThis.localStorage.setItem(key, value))
      : SecureStore.setItemAsync(key, value, {
          keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
        });
  const clear = () =>
    Platform.OS === "web"
      ? Promise.resolve(globalThis.localStorage.removeItem(key))
      : SecureStore.deleteItemAsync(key);
  const dependencies: Dependencies = {
    current: () => isAuthScopeCurrent(scope),
    read: requestId ? async () => {
      const raw = Platform.OS === "web" ? globalThis.localStorage.getItem(key) : await SecureStore.getItemAsync(key);
      return raw ? JSON.parse(raw) as TicketPhotoAttempt : null;
    } : () => readTicketPhotoAttempt(user, ticketId),
    write: (attempt) => set(JSON.stringify(attempt)),
    clear,
    capture: reviewedCapture ?? (() =>
      captureAndUploadImage({ authScope: scope, maxBytes: 10 * 1024 * 1024 })
    ),
    operationId: () => requestId ?? Crypto.randomUUID(),
    get: (attempt) =>
      apiFetch(
        `/api/tickets/${ticketId}/photo-associations/${attempt.operationId}`,
        {},
        scope,
      ),
    post: (attempt) =>
      apiFetch(
        `/api/tickets/${ticketId}/photo-associations`,
        {
          method: "POST",
          body: JSON.stringify({
            operationId: attempt.operationId,
            objectPath: attempt.objectPath,
          }),
        },
        scope,
      ),
  };
  return {
    pending: dependencies.read,
    associate: async () => {
      if (requestId) {
        // A lost response after ticket save is reconciled before any new capture/upload.
        try {
          const receipt = await apiFetch<TicketPhotoReceipt>(`/api/tickets/${ticketId}/photo-associations/${requestId}`, {}, scope);
          if (!isAuthScopeCurrent(scope)) throw new Error("Request authorization changed");
          verifyReceipt({ account, ticketId, operationId: requestId, objectPath: receipt.objectPath }, receipt);
          await clear();
          return receipt;
        } catch (error) {
          if ((error as { status?: number }).status !== 404 || (error as { code?: string }).code !== "ticket.photo_association_not_found") throw error;
        }
      }
      return associateTicketPhoto(account, ticketId, dependencies);
    },
  };
}
