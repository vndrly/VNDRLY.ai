import { FleetScheduleSchema } from "@workspace/api-zod";
import type { z } from "zod/v4";
import { useTranslation } from "react-i18next";
import { fleetCopy } from "@/lib/fleet-copy";
export type FleetScheduleDraft = {
  start: string;
  end: string;
  timezone: string;
};
export function fleetScheduleDraft(
  value: z.infer<typeof FleetScheduleSchema> | null | undefined,
): FleetScheduleDraft {
  const local = (date: string) => {
    const time = new Date(date);
    return new Date(time.getTime() - time.getTimezoneOffset() * 60000)
      .toISOString()
      .slice(0, 16);
  };
  return {
    start: value ? local(value.plannedStartAt) : "",
    end: value ? local(value.plannedEndAt) : "",
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  };
}
export function parseFleetSchedule(value: FleetScheduleDraft) {
  if (!value.start && !value.end)
    return { valid: true as const, schedule: null };
  const start = Date.parse(value.start),
    end = Date.parse(value.end);
  if (!Number.isFinite(start) || !Number.isFinite(end))
    return { valid: false as const };
  const parsed = FleetScheduleSchema.safeParse({
    plannedStartAt: new Date(start).toISOString(),
    plannedEndAt: new Date(end).toISOString(),
    timezone: value.timezone,
  });
  return parsed.success
    ? { valid: true as const, schedule: parsed.data }
    : { valid: false as const };
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
  return (
    <fieldset className="space-y-2 rounded border p-3">
      <legend>{c.plannedHours}</legend>
      <p className="text-xs">{c.plannedHoursHint}</p>
      <label>
        {c.plannedStart}
        <input
          className="block rounded border p-2"
          type="datetime-local"
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
          disabled={disabled}
          value={value.end}
          onChange={(event) => onChange({ ...value, end: event.target.value })}
        />
      </label>
      <p>
        {c.timezone}: {value.timezone}
      </p>
    </fieldset>
  );
}
