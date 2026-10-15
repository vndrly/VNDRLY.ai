import { it, expect } from "vitest";
import { AssignmentMetadataSchema } from "@workspace/api-zod";
import { libraryDueWork } from "./library-schedule";
const a = AssignmentMetadataSchema.parse({
  assignmentId: "10000000-0000-4000-8000-000000000001",
  sourceItemId: "10000000-0000-4000-8000-000000000002",
  contentVersion: 1,
  membershipId: 7,
  assignedAt: "2026-10-14T12:00:00Z",
  dueAt: "2026-11-13T12:00:00Z",
  delivery: {
    ownerUserId: 9,
    timezone: "America/Chicago",
    config: {
      reminderHours: 24,
      briefing: { enabled: true, hour: 8, minute: 0, push: false },
      escalationHours: 24,
    },
    nextReminderAt: "2026-10-15T12:00:00Z",
  },
});
it("keeps the thirty-day horizon and emits only one owner briefing per local date", () => {
  expect(
    libraryDueWork("policy", a, new Date("2026-10-14T12:59:00Z"))?.briefingDate,
  ).toBeNull();
  expect(
    libraryDueWork("policy", a, new Date("2026-10-14T13:00:00Z"))?.briefingDate,
  ).toBe("2026-10-14");
  expect(
    libraryDueWork(
      "policy",
      { ...a, delivery: { ...a.delivery!, lastBriefingDate: "2026-10-14" } },
      new Date("2026-10-14T20:00:00Z"),
    )?.briefingDate,
  ).toBeNull();
  expect(
    libraryDueWork("policy", a, new Date("2026-10-15T12:00:00Z"))?.reminder,
  ).toBe(true);
  expect(
    libraryDueWork("policy", a, new Date("2026-11-13T12:00:00Z"))?.escalate,
  ).toBe(false);
  expect(
    libraryDueWork("policy", a, new Date("2026-11-14T12:00:00Z"))?.escalate,
  ).toBe(true);
});
it("stops reminders for completed training and closed twenty-four-hour polls", () => {
  expect(
    libraryDueWork(
      "training",
      { ...a, status: "completed" },
      new Date("2026-10-16T12:00:00Z"),
    )?.reminder,
  ).toBe(false);
  expect(
    libraryDueWork(
      "poll",
      { ...a, dueAt: "2026-10-15T12:00:00Z" },
      new Date("2026-10-15T12:00:00Z"),
    )?.reminder,
  ).toBe(false);
});
