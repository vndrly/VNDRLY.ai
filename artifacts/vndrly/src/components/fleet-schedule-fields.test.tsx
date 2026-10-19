import { useState } from "react";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import {
  FleetScheduleFields,
  fleetScheduleDraft,
  parseFleetSchedule,
  type FleetScheduleDraft,
} from "./fleet-schedule-fields";
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ i18n: { language: "en" } }),
}));
afterEach(cleanup);
it("opens saved hours in the saved operating zone instead of relabeling device-local time", () => {
  const zone =
    Intl.DateTimeFormat().resolvedOptions().timeZone === "Asia/Kathmandu"
      ? "America/Chicago"
      : "Asia/Kathmandu";
  const start =
      zone === "America/Chicago"
        ? "2026-07-01T15:00:00Z"
        : "2026-07-01T04:15:00Z",
    end =
      zone === "America/Chicago"
        ? "2026-07-01T16:00:00Z"
        : "2026-07-01T05:15:00Z";
  const draft = fleetScheduleDraft({
    plannedStartAt: start,
    plannedEndAt: end,
    timezone: zone,
  });
  expect(draft).toMatchObject({
    start: "2026-07-01T10:00",
    end: "2026-07-01T11:00",
    timezone: zone,
  });
  expect(parseFleetSchedule(draft)).toEqual({
    valid: true,
    schedule: { plannedStartAt: start, plannedEndAt: end, timezone: zone },
  });
});
it("preserves known saved DST instants and subsecond precision while independently editing the other boundary", () => {
  const value = {
    plannedStartAt: "2026-11-01T07:30:00.123Z",
    plannedEndAt: "2026-11-01T08:30:00.456Z",
    timezone: "America/Chicago",
  };
  const draft = fleetScheduleDraft(value);
  expect(parseFleetSchedule(draft)).toEqual({ valid: true, schedule: value });
  expect(
    parseFleetSchedule({ ...draft, end: "2026-11-01T03:30:00.456" }),
  ).toEqual({
    valid: true,
    schedule: { ...value, plannedEndAt: "2026-11-01T09:30:00.456Z" },
  });
  expect(
    parseFleetSchedule({
      start: "2026-11-01T01:30",
      end: "2026-11-01T03:30",
      timezone: "America/Chicago",
    }).valid,
  ).toBe(false);
});
it("lets dispatch choose the operating zone and explains ambiguous or missing daylight-saving clock times", () => {
  function Form() {
    const [value, setValue] = useState<FleetScheduleDraft>({
      start: "2026-11-01T01:30",
      end: "2026-11-01T03:30",
      timezone: "America/Chicago",
    });
    return <FleetScheduleFields value={value} onChange={setValue} />;
  }
  render(<Form />);
  expect(screen.getByRole("alert").textContent).toMatch(
    /daylight|twice|exist/i,
  );
  fireEvent.change(screen.getByLabelText("Timezone"), {
    target: { value: "UTC" },
  });
  expect(screen.queryByRole("alert")).toBeNull();
});
