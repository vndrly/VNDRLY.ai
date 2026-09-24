import { describe, expect, it } from "vitest";
import type { SessionPayload } from "./session";
import {
  GATE_NOTIFICATION_CATEGORIES,
  gateNotificationVisible,
  gatePreferenceKeys,
  isGateNotificationSession,
  resolveGateNotificationCategory,
} from "./gate-notification-policy";

describe("gate notification policy", () => {
  it("keeps the seven gate filters in display order", () => {
    expect(GATE_NOTIFICATION_CATEGORIES).toEqual([
      "schedule", "gate_crew", "messages", "handoffs", "tasks", "compliance", "alerts",
    ]);
  });

  it.each([
    ["work_hub_shift_assigned", "schedule"],
    ["work_hub_shift_changed", "schedule"],
    ["work_hub_meeting_invite", "schedule"],
    ["work_hub_meeting_changed", "schedule"],
    ["work_hub_announcement", "gate_crew"],
    ["work_hub_message", "messages"],
    ["work_hub_mention", "messages"],
    ["comment_mention", "messages"],
    ["gate_handoff_ready", "handoffs"],
    ["gate_handoff_revised", "handoffs"],
    ["gate_handoff_ack_required", "handoffs"],
    ["work_hub_task_assigned", "tasks"],
    ["work_hub_task_updated", "tasks"],
    ["cert_expiring", "compliance"],
    ["cert_expired", "compliance"],
    ["safety_stop_work", "alerts"],
    ["safety_event_hipo", "alerts"],
    ["gate_closed", "alerts"],
    ["gate_access_changed_urgent", "alerts"],
  ])("maps %s to %s independently of the stored category", (type, expected) => {
    const row = { type, category: "system", link: "/work-hub" };
    expect(resolveGateNotificationCategory(row)).toBe(expected);
    expect(gateNotificationVisible(row)).toBe(true);
  });

  it.each([
    { type: "hotlist_match", category: "hotlist", link: "/hotlist" },
    { type: "rating_received", category: "system", link: "/ratings" },
    { type: "safety_event_update", category: "safety", link: "/safety" },
    { type: "future_gate_notice", category: "alerts", link: "/gate" },
    { type: "toString", category: "alerts", link: "/gate" },
    { type: "__proto__", category: "alerts", link: "/gate" },
  ])("omits unmapped type $type even if category suggests otherwise", (row) => {
    expect(resolveGateNotificationCategory(row)).toBeNull();
    expect(gateNotificationVisible(row)).toBe(false);
  });

  it("recognizes direct gatekeeper and supervisor assignments", () => {
    expect(isGateNotificationSession({ vendorRole: "gatekeeper" })).toBe(true);
    expect(isGateNotificationSession({ vendorRole: "gate_supervisor" })).toBe(true);
  });

  it("recognizes a managed gate grant without a vendor role, even among other grants", () => {
    const session = {
      managedSubcontractor: {
        siteGrants: [
          { siteId: 1, role: "viewer" },
          { siteId: 3, role: "gate_supervisor" },
        ],
      },
    } as unknown as SessionPayload;
    expect(isGateNotificationSession(session)).toBe(true);
  });

  it("stops classifying a session as gate after its gate role or grants are removed", () => {
    expect(isGateNotificationSession({ vendorRole: "member" })).toBe(false);
    expect(isGateNotificationSession({ managedSubcontractor: { siteGrants: [] } })).toBe(false);
    expect(isGateNotificationSession(null)).toBe(false);
  });

  it.each([
    ["schedule", ["workHubScheduleEnabled", "workHubMeetingsEnabled"]],
    ["gate_crew", ["workHubAnnouncementsEnabled"]],
    ["messages", ["workHubMessagesEnabled", "commentsEnabled"]],
    ["handoffs", ["gateHandoffsEnabled"]],
    ["tasks", ["workHubTasksEnabled"]],
    ["compliance", ["complianceEnabled"]],
    ["alerts", ["gateAlertsEnabled"]],
  ] as const)("uses the exact preference keys for %s", (category, expected) => {
    expect(gatePreferenceKeys(category)).toEqual(expected);
  });
});
