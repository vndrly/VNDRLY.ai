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
