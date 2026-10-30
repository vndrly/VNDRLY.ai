import type { ComponentProps } from "react";
import { Input } from "@/components/ui/input";

export const TASK_DATE_TIME_FORMAT = "MM/DD/YY hh:mm AM/PM";
/** Local wall time, matching the calendar's existing device-timezone behavior. */
export function parseTaskDateTime(value: string): Date | null {
  const match = /^(\d{2})\/(\d{2})\/(\d{2}) (\d{2}):(\d{2}) (AM|PM)$/i.exec(value.trim());
  if (!match) return null;
  const [, mm, dd, yy, hh, min, period] = match;
  const month = Number(mm), day = Number(dd), year = 2000 + Number(yy), hour = Number(hh), minute = Number(min);
  if (month < 1 || month > 12 || day < 1 || hour < 1 || hour > 12 || minute > 59) return null;
  const hours = hour % 12 + (period.toUpperCase() === "PM" ? 12 : 0);
  const date = new Date(year, month - 1, day, hours, minute);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day && date.getHours() === hours && date.getMinutes() === minute ? date : null;
}

export function FormattedDateTimeInput({ onChange, ...props }: Omit<ComponentProps<typeof Input>, "type">) {
  return <Input {...props} type="text" placeholder={TASK_DATE_TIME_FORMAT} maxLength={20} autoComplete="off"
    onChange={event => {
      event.target.setCustomValidity(!event.target.value || parseTaskDateTime(event.target.value) ? "" : `Enter a valid date and time: ${TASK_DATE_TIME_FORMAT}`);
      onChange?.(event);
    }} />;
}
