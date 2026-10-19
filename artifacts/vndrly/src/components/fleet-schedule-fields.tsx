import {
  FleetScheduleSchema,
  fleetInstantToWallTime,
  fleetWallTimeToInstant,
} from "@workspace/api-zod";
import type { z } from "zod/v4";
import { useTranslation } from "react-i18next";
import { fleetCopy } from "@/lib/fleet-copy";
export type FleetScheduleDraft = {
  start: string;
  end: string;
  timezone: string;
  source?: {
    start: string;
    end: string;
    timezone: string;
    value: z.infer<typeof FleetScheduleSchema>;
  };
};
export function fleetScheduleDraft(
  value: z.infer<typeof FleetScheduleSchema> | null | undefined,
): FleetScheduleDraft {
  const timezone =
    value?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const start = value
      ? (fleetInstantToWallTime(value.plannedStartAt, timezone) ?? "")
      : "",
    end = value
      ? (fleetInstantToWallTime(value.plannedEndAt, timezone) ?? "")
      : "";
  return {
    start,
    end,
    timezone,
    ...(value ? { source: { start, end, timezone, value: { ...value } } } : {}),
  };
}
export function parseFleetSchedule(value: FleetScheduleDraft) {
  if (!value.start && !value.end)
    return { valid: true as const, schedule: null };
  const resolve = (field: "start" | "end") =>
    value.source &&
    value.timezone === value.source.timezone &&
    value[field] === value.source[field]
      ? {
          status: "resolved" as const,
          instant:
            field === "start"
              ? value.source.value.plannedStartAt
              : value.source.value.plannedEndAt,
        }
      : fleetWallTimeToInstant(value[field], value.timezone);
  const start = resolve("start"),
    end = resolve("end");
  if (start.status !== "resolved" || end.status !== "resolved")
    return {
      valid: false as const,
      reason: start.status !== "resolved" ? start.status : end.status,
    };
  const parsed = FleetScheduleSchema.safeParse({
    plannedStartAt: start.instant,
    plannedEndAt: end.instant,
    timezone: value.timezone,
  });
  return parsed.success
    ? { valid: true as const, schedule: parsed.data }
    : { valid: false as const, reason: "invalid" as const };
}
export function FleetScheduleFields({
  value,
  onChange,
  disabled = false,
}: {
  value: FleetScheduleDraft;
  onChange: (value: FleetScheduleDraft) => void;
  disabled?: boolean;
}) {
  const { i18n } = useTranslation();
  const c = fleetCopy(i18n.language);
  const validation = parseFleetSchedule(value);
  return (
    <fieldset className="space-y-2 rounded border p-3">
      <legend>{c.plannedHours}</legend>
      <p className="text-xs">{c.plannedHoursHint}</p>
      <label>
        {c.plannedStart}
        <input
          className="block rounded border p-2"
          type="datetime-local"
          step="0.001"
          disabled={disabled}
          value={value.start}
          onChange={(event) =>
            onChange({ ...value, start: event.target.value })
          }
        />
      </label>
      <label>
        {c.plannedEnd}
        <input
          className="block rounded border p-2"
          type="datetime-local"
          step="0.001"
          disabled={disabled}
          value={value.end}
          onChange={(event) => onChange({ ...value, end: event.target.value })}
        />
      </label>
      <label>
        {c.timezone}
        <select
          aria-label={c.timezone}
          className="block rounded border p-2"
          disabled={disabled}
          value={value.timezone}
          onChange={(event) =>
            onChange({ ...value, timezone: event.target.value })
          }
        >
          {[
            ...new Set([
              value.timezone,
              "America/Chicago",
              "America/Denver",
              "UTC",
            ]),
          ].map((zone) => (
            <option key={zone} value={zone}>
              {zone}
            </option>
          ))}
        </select>
      </label>
      {!validation.valid && (value.start || value.end) && (
        <p role="alert">
          {validation.reason === "ambiguous" ||
          validation.reason === "nonexistent"
            ? c.plannedTimeTransition
            : c.plannedTimeInvalid}
        </p>
      )}
    </fieldset>
  );
}
