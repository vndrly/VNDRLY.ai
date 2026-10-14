import { expect, it } from "vitest";
import { campaignDueWork } from "./form-campaign-schedule";
const config = {
  kind: "acknowledgement",
  timezone: "America/Chicago",
  briefing: { enabled: true, hour: 8, minute: 0 },
  audience: { rolling: true },
  escalation: { delayHours: 24, userId: 7 },
};
const state = {
  status: "published",
  publishedAt: "2026-10-14T13:30:00Z",
  deadline: "2026-11-13T13:30:00Z",
  nextReminderAt: "2026-10-15T13:30:00Z",
  nextAudienceAt: "2026-10-14T13:31:00Z",
  lastBriefingDate: null,
};
it("waits until the next scheduled briefing after publication and suppresses duplicate local dates", () => {
  expect(
    campaignDueWork(config, state, new Date("2026-10-14T15:00:00Z"))
      .briefingDate,
  ).toBeNull();
  expect(
    campaignDueWork(config, state, new Date("2026-10-15T13:00:00Z"))
      .briefingDate,
  ).toBe("2026-10-15");
  expect(
    campaignDueWork(
      config,
      { ...state, lastBriefingDate: "2026-10-15" },
      new Date("2026-10-15T15:00:00Z"),
    ).briefingDate,
  ).toBeNull();
});
it("follows local 8am across daylight saving and stops rolling audience at the deadline", () => {
  expect(
    campaignDueWork(config, state, new Date("2026-11-02T13:59:00Z"))
      .briefingDate,
  ).toBeNull();
  expect(
    campaignDueWork(config, state, new Date("2026-11-02T14:00:00Z"))
      .briefingDate,
  ).toBe("2026-11-02");
  expect(campaignDueWork(config, state, new Date(state.deadline)).expand).toBe(
    false,
  );
});
it("closes polls exactly at deadline, permits acknowledgement follow-up and pauses all schedules", () => {
  const at = new Date(state.deadline);
  expect(campaignDueWork({ ...config, kind: "poll" }, state, at).close).toBe(
    true,
  );
  expect(campaignDueWork(config, state, at).close).toBe(false);
  expect(
    campaignDueWork(config, { ...state, status: "paused" }, at).reminder,
  ).toBe(false);
  expect(
    campaignDueWork(config, state, new Date("2026-11-14T13:30:00Z")).escalate,
  ).toBe(true);
});

import { campaignPushAfterQuietHours } from "./form-campaign-schedule";
it("respects company quiet hours across DST without using server local time", () => {
  expect(
    campaignPushAfterQuietHours(
      new Date("2026-11-01T07:30:00Z"),
      22,
      8,
      "America/Chicago",
    ).toISOString(),
  ).toBe("2026-11-01T14:00:00.000Z");
  expect(
    campaignPushAfterQuietHours(
      new Date("2026-10-14T15:00:00Z"),
      22,
      8,
      "America/Chicago",
    ).toISOString(),
  ).toBe("2026-10-14T15:00:00.000Z");
});
