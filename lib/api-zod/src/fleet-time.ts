/** IANA wall-time conversion without interpreting the browser/device's local
 * zone. Missing and repeated DST clock times require an explicit choice. */
export type FleetWallTimeResult =
  | { status: "resolved"; instant: string }
  | { status: "ambiguous"; candidates: string[] }
  | { status: "nonexistent" | "invalid" };

function formatter(timeZone: string) {
  try {
    return new Intl.DateTimeFormat("en-US-u-ca-gregory-nu-latn", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
  } catch {
    return null;
  }
}
function fields(date: Date, format: Intl.DateTimeFormat) {
  const parts: Record<string, string> = {};
  for (const part of format.formatToParts(date)) parts[part.type] = part.value;
  const minute = `${parts.year.padStart(4, "0")}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
  const second = parts.second,
    milliseconds = String(date.getUTCMilliseconds()).padStart(3, "0");
  return {
    minute,
    second,
    milliseconds,
    canonical: `${minute}:${second}.${milliseconds}Z`,
  };
}
export function fleetInstantToWallTime(
  instant: string,
  timeZone: string,
): string | null {
  const date = new Date(instant),
    format = formatter(timeZone);
  if (!format || !Number.isFinite(date.getTime())) return null;
  const value = fields(date, format);
  return (
    value.minute +
    (value.second !== "00" || value.milliseconds !== "000"
      ? `:${value.second}${value.milliseconds !== "000" ? `.${value.milliseconds}` : ""}`
      : "")
  );
}
export function fleetWallTimeToInstant(
  wallTime: string,
  timeZone: string,
): FleetWallTimeResult {
  const match =
      /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/.exec(
        wallTime,
      ),
    format = formatter(timeZone);
  if (!match || !format) return { status: "invalid" };
  const canonical = `${match[1]}:${match[2] ?? "00"}.${(match[3] ?? "").padEnd(3, "0")}Z`,
    naive = Date.parse(canonical);
  if (!Number.isFinite(naive) || new Date(naive).toISOString() !== canonical)
    return { status: "invalid" };
  const offsets = new Set<number>();
  // Sampling on either side obtains both offsets at a transition. Every
  // candidate is then checked against the original calendar/time fields.
  for (const delta of [-36, 0, 36]) {
    const sample = new Date(naive + delta * 3600000),
      offset = Date.parse(fields(sample, format).canonical) - sample.getTime();
    if (Number.isFinite(offset)) offsets.add(offset);
  }
  const candidates = [
    ...new Set(
      [...offsets]
        .map((offset) => new Date(naive - offset))
        .filter((date) => fields(date, format).canonical === canonical)
        .map((date) => date.toISOString()),
    ),
  ].sort();
  if (candidates.length === 1)
    return { status: "resolved", instant: candidates[0] };
  return candidates.length
    ? { status: "ambiguous", candidates }
    : { status: "nonexistent" };
}
