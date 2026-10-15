import { campaignDueWork } from "./form-campaign-schedule";
import type { AssignmentMetadata } from "@workspace/api-zod";
export function libraryDueWork(kind: string, a: AssignmentMetadata, now: Date) {
  const d = a.delivery;
  if (!d) return null;
  return campaignDueWork(
    {
      kind,
      timezone: d.timezone,
      briefing: d.config.briefing,
      audience: { rolling: false },
      escalation: d.config.escalationHours
        ? { delayHours: d.config.escalationHours, userId: d.ownerUserId }
        : null,
    },
    {
      status: ["cancelled", "exempted"].includes(a.status)
        ? "paused"
        : "published",
      publishedAt: a.assignedAt,
      deadline: a.dueAt,
      nextReminderAt: ["completed", "cancelled", "exempted"].includes(a.status)
        ? null
        : d.nextReminderAt,
      lastBriefingDate: d.lastBriefingDate,
      escalatedAt: d.escalatedAt,
    },
    now,
  );
}
