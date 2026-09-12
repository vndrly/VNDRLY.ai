import type {
  DeviceActor,
  DeviceConnectionRecord,
  DeviceRecord,
} from "../work-hub/device-coordinator";
import { databaseDeviceCoordinatorStore, SURFACE_TTL_MS } from "../work-hub/device-coordinator";
import { deviceCoordinator } from "../work-hub/device-coordinator";
import type { SessionPayload } from "../lib/session";

export type AskVDeviceContextRequest = {
  sourceDeviceId?: string | null;
  targetDeviceId?: string | null;
  reference?: string | null;
  entityType?: string | null;
  entityId?: string | number | null;
};

export type AskVDeviceContextChoice = {
  deviceId: string;
  deviceName: string;
  path: string;
  entityType: string | null;
  entityId: string | null;
};

export type AskVDeviceContextResult =
  | ({ status: "resolved" } & AskVDeviceContextChoice)
  | { status: "ambiguous"; choices: AskVDeviceContextChoice[] }
  | { status: "none" };

type ContextStore = {
  listDevices(actor: DeviceActor): Promise<DeviceRecord[]>;
  listConnections(deviceIds: string[]): Promise<DeviceConnectionRecord[]>;
};

function inferredEntityType(reference: string | null | undefined): string | null {
  const value = reference?.trim().toLowerCase() ?? "";
  if (/\b(ticket|job)\b/.test(value)) return "ticket";
  if (/\b(meeting|call)\b/.test(value)) return "meeting";
  if (/\b(invoice|bill)\b/.test(value)) return "invoice";
  if (/\b(site|location|well)\b/.test(value)) return "site_location";
  if (/\b(visitor|gate|check[- ]?in)\b/.test(value)) return "gate";
  return null;
}

function sameOwner(actor: DeviceActor, device: DeviceRecord): boolean {
  return device.userId === actor.userId && device.owner.type === actor.owner.type && device.owner.id === actor.owner.id;
}

/** Resolves a fresh, authorized screen independently from the device that owns audio. */
export function createAuthorizedDeviceContextResolver(store: ContextStore, clock = () => new Date()) {
  return async function resolveAuthorizedDeviceContext(
    actor: DeviceActor,
    conversationId: number,
    request: AskVDeviceContextRequest,
  ): Promise<AskVDeviceContextResult> {
    if (!Number.isSafeInteger(conversationId) || conversationId <= 0) return { status: "none" };
    const devices = (await store.listDevices(actor)).filter(device => sameOwner(actor, device) && !device.revokedAt);
    const byId = new Map(devices.map(device => [device.id, device]));
    if (request.targetDeviceId && !byId.has(request.targetDeviceId)) return { status: "none" };
    const threshold = clock().getTime() - SURFACE_TTL_MS;
    const wantedType = request.entityType?.trim().toLowerCase() || inferredEntityType(request.reference);
    const wantedId = request.entityId == null ? null : String(request.entityId);
    const candidates = (await store.listConnections(devices.map(device => device.id)))
      .filter(connection => {
        const device = byId.get(connection.deviceId);
        const surface = connection.surface;
        if (!device || !surface || connection.seenAt.getTime() < threshold || surface.updatedAt < threshold) return false;
        if (request.targetDeviceId && connection.deviceId !== request.targetDeviceId) return false;
        if (wantedType && surface.entityType?.toLowerCase() !== wantedType) return false;
        if (wantedId && surface.entityId !== wantedId) return false;
        return true;
      })
      .sort((a, b) => Number(b.foreground) - Number(a.foreground) || b.surface!.updatedAt - a.surface!.updatedAt || b.seenAt.getTime() - a.seenAt.getTime());
    if (!candidates.length) return { status: "none" };
    const top = candidates[0]!;
    const equallyFresh = candidates.filter(candidate => candidate.foreground === top.foreground && candidate.surface!.updatedAt === top.surface!.updatedAt);
    const toChoice = (connection: DeviceConnectionRecord): AskVDeviceContextChoice => ({
      deviceId: connection.deviceId,
      deviceName: byId.get(connection.deviceId)!.friendlyName,
      path: connection.surface!.path,
      entityType: connection.surface!.entityType,
      entityId: connection.surface!.entityId,
    });
    if (equallyFresh.length > 1) return { status: "ambiguous", choices: equallyFresh.slice(0, 5).map(toChoice) };
    return { status: "resolved", ...toChoice(top) };
  };
}

export const resolveAuthorizedDeviceContext = createAuthorizedDeviceContextResolver(databaseDeviceCoordinatorStore);

export function deviceActorFromSession(session: SessionPayload): DeviceActor | null {
  if (!session.userId) return null;
  if (session.vendorId) return { userId: session.userId, owner: { type: "vendor", id: session.vendorId } };
  if (session.partnerId) return { userId: session.userId, owner: { type: "partner", id: session.partnerId } };
  return null;
}

export async function publishAskVDeviceEvent(
  session: SessionPayload,
  eventType: "work_hub.askv.conversation_changed" | "work_hub.askv.confirmation_changed" | "work_hub.askv.action_changed",
  conversationId: number,
  payload: Record<string, unknown> = {},
): Promise<void> {
  const actor = deviceActorFromSession(session);
  if (!actor || !Number.isSafeInteger(conversationId) || conversationId <= 0) return;
  await deviceCoordinator.publishUserEvent(actor, {
    eventType,
    payload: {
      context: { kind: "organization", id: actor.owner.id },
      subject: { type: "askv_conversation", id: conversationId },
      conversationId,
      ...payload,
    },
  });
}
