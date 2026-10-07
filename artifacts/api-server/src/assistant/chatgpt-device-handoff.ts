import type { SessionPayload } from "../lib/session";
import { organizationKeyFromSession } from "./askv-pending-confirmation";

export type FileDeviceHandoff = {
  kind: "file-device-handoff";
  userId: number;
  sv: number;
  activeMembershipId: number | null;
  organizationKey: string;
  grantConsentHash: string;
  expires: number;
};

/** A handoff is navigation, never a new login, upload, or authorization grant. */
export function fileDeviceHandoff(session: SessionPayload, grantConsentHash: string): FileDeviceHandoff {
  if (!session.userId) throw new Error("Authenticated file handoff required");
  return { kind: "file-device-handoff", userId: session.userId, sv: session.sv ?? 0,
    activeMembershipId: session.activeMembershipId ?? null, organizationKey: organizationKeyFromSession(session),
    grantConsentHash, expires: Date.now() + 30 * 60_000 };
}

export function requireMatchingFileDevice(handoff: FileDeviceHandoff, current: SessionPayload) {
  if (handoff.kind !== "file-device-handoff" || !Number.isFinite(handoff.expires) || handoff.expires <= Date.now() ||
      !current.userId || handoff.userId !== current.userId || handoff.sv !== (current.sv ?? 0) ||
      handoff.activeMembershipId !== (current.activeMembershipId ?? null) || handoff.organizationKey !== organizationKeyFromSession(current)) {
    throw new Error("Sign into the same VNDRLY account and organization used by this ChatGPT connection, then request a fresh file link");
  }
}

export type MeetingDeviceHandoff = Omit<FileDeviceHandoff, "kind"> & { kind: "meeting-device-handoff"; occurrenceId: string };

export function meetingDeviceHandoff(session: SessionPayload, grantConsentHash: string, occurrenceId: string): MeetingDeviceHandoff {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(occurrenceId)) throw new Error("A saved meeting occurrence is required");
  return { ...fileDeviceHandoff(session, grantConsentHash), kind: "meeting-device-handoff", occurrenceId };
}

export function requireMatchingMeetingDevice(handoff: MeetingDeviceHandoff, current: SessionPayload): string {
  if (handoff.kind !== "meeting-device-handoff" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(handoff.occurrenceId)) throw new Error("A valid meeting handoff is required");
  requireMatchingFileDevice({ ...handoff, kind: "file-device-handoff" }, current);
  return "/work-hub/meetings?meeting=" + encodeURIComponent(handoff.occurrenceId);
}

export const TICKET_ENTRY_KINDS = ["photo", "parts", "labor", "mileage"] as const;
export type GateDeviceHandoff = Omit<FileDeviceHandoff, "kind"> & { kind: "gate-device-handoff"; stationId: string };

export function gateDeviceHandoff(session: SessionPayload, grantConsentHash: string, stationId: unknown): GateDeviceHandoff {
  if (typeof stationId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(stationId)) throw new Error("A saved Gate station is required");
  return { ...fileDeviceHandoff(session, grantConsentHash), kind: "gate-device-handoff", stationId };
}

export function requireMatchingGateDevice(handoff: GateDeviceHandoff, current: SessionPayload): string {
  if (handoff.kind !== "gate-device-handoff") throw new Error("A valid Gate handoff is required");
  gateDeviceHandoff(current, handoff.grantConsentHash, handoff.stationId);
  requireMatchingFileDevice({ ...handoff, kind: "file-device-handoff" }, current);
  return "/gate/change-over?stationId=" + encodeURIComponent(handoff.stationId);
}
export const GATE_DEVICE_TOOL = {
  name: "v_open_gate_handoff",
  description: "Open the account-bound Change Over device screen for an authorized saved Gate station. Incoming-worker authentication and acceptance happen on that screen. This link does not transfer a shift, accept a handoff, or end duty. Read the saved station state afterward before claiming completion.",
  inputSchema: { type: "object" as const, properties: { stationId: { type: "string", format: "uuid" } }, required: ["stationId"], additionalProperties: false },
  annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
};
type TicketEntryKind = typeof TICKET_ENTRY_KINDS[number];
export type TicketDeviceHandoff = Omit<FileDeviceHandoff, "kind"> & { kind: "ticket-device-handoff"; ticketId: number; entry: TicketEntryKind };

export function ticketDeviceHandoff(session: SessionPayload, grantConsentHash: string, ticketId: unknown, entry: unknown): TicketDeviceHandoff {
  if (typeof ticketId !== "number" || !Number.isSafeInteger(ticketId) || ticketId <= 0 || !TICKET_ENTRY_KINDS.includes(entry as TicketEntryKind)) throw new Error("A saved ticket and supported entry type are required");
  return { ...fileDeviceHandoff(session, grantConsentHash), kind: "ticket-device-handoff", ticketId, entry: entry as TicketEntryKind };
}

export function requireMatchingTicketDevice(handoff: TicketDeviceHandoff, current: SessionPayload): string {
  if (handoff.kind !== "ticket-device-handoff") throw new Error("A valid ticket handoff is required");
  ticketDeviceHandoff(current, handoff.grantConsentHash, handoff.ticketId, handoff.entry);
  requireMatchingFileDevice({ ...handoff, kind: "file-device-handoff" }, current);
  return `/tickets/${handoff.ticketId}?askvEntry=${handoff.entry}`;
}

export const TICKET_DEVICE_TOOL = {
  name: "v_open_ticket_entry",
  description: "Open an account-bound device screen for photo, parts, labor, or mileage entry on a ticket this account can read. The device rechecks editing permissions and lifecycle. This link does not upload, save entries, start tracking, or grant microphone/camera access. Read back the saved ticket afterward before claiming completion.",
  inputSchema: { type: "object" as const, properties: { ticketId: { type: "integer", minimum: 1 }, entry: { type: "string", enum: [...TICKET_ENTRY_KINDS] } }, required: ["ticketId", "entry"], additionalProperties: false },
  annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
};
