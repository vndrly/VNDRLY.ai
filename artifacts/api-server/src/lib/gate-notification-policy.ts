import type { GateRole, SessionPayload } from "./session";

export const GATE_NOTIFICATION_CATEGORIES = [
  "schedule", "gate_crew", "messages", "handoffs", "tasks", "compliance", "alerts",
] as const;
export type GateNotificationCategory = (typeof GATE_NOTIFICATION_CATEGORIES)[number];

const GATE_ROLES: readonly GateRole[] = ["gatekeeper", "gate_supervisor"];

/** A managed site grant is sufficient even when the active vendor role is absent. */
export function isGateNotificationSession(session: SessionPayload | null | undefined): boolean {
  return GATE_ROLES.some((role) => role === session?.vendorRole) ||
    (session?.managedSubcontractor?.siteGrants?.some((grant) =>
      GATE_ROLES.some((role) => role === grant.role)) ?? false);
}

const GATE_TYPE_CATEGORY: Readonly<Record<string, GateNotificationCategory>> = {
  work_hub_shift_assigned: "schedule",
  work_hub_shift_changed: "schedule",
  work_hub_meeting_invite: "schedule",
  work_hub_meeting_changed: "schedule",
  work_hub_announcement: "gate_crew",
  work_hub_message: "messages",
  work_hub_mention: "messages",
  comment_mention: "messages",
  gate_handoff_ready: "handoffs",
  gate_handoff_revised: "handoffs",
  gate_handoff_ack_required: "handoffs",
  work_hub_task_assigned: "tasks",
  work_hub_task_updated: "tasks",
  cert_expiring: "compliance",
  cert_expired: "compliance",
  safety_stop_work: "alerts",
  safety_event_hipo: "alerts",
  gate_closed: "alerts",
  gate_access_changed_urgent: "alerts",
};

export function resolveGateNotificationCategory(row: { type: string }): GateNotificationCategory | null {
  return Object.prototype.hasOwnProperty.call(GATE_TYPE_CATEGORY, row.type)
    ? GATE_TYPE_CATEGORY[row.type]
    : null;
}

export function gateNotificationVisible(row: { type: string }): boolean {
  return resolveGateNotificationCategory(row) !== null;
}

const GATE_PREFERENCE_KEYS = {
  schedule: ["workHubScheduleEnabled", "workHubMeetingsEnabled"],
  gate_crew: ["workHubAnnouncementsEnabled"],
  messages: ["workHubMessagesEnabled", "commentsEnabled"],
  handoffs: ["gateHandoffsEnabled"],
  tasks: ["workHubTasksEnabled"],
  compliance: ["complianceEnabled"],
  alerts: ["gateAlertsEnabled"],
} as const satisfies Record<GateNotificationCategory, readonly string[]>;

export function gatePreferenceKeys(category: GateNotificationCategory) {
  return GATE_PREFERENCE_KEYS[category];
}
