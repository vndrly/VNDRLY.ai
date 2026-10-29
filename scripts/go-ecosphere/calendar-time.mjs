/** CompanyGo civil-time helpers. Calendar days must survive the November DST change. */
export const ZONE = "America/Chicago";
export function dayKey(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}
export function civilTime(day, offset = 0, hour = 0, minute = 0) {
  const target = new Date(`${day}T00:00:00Z`);
  target.setUTCDate(target.getUTCDate() + offset);
  target.setUTCHours(0, hour * 60 + minute);
  const wanted = +target;
  let guess = wanted + 6 * 3600000;
  for (let n = 0; n < 4; n++) {
    const p = Object.fromEntries(
      new Intl.DateTimeFormat("en-US", {
        timeZone: ZONE,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hourCycle: "h23",
      })
        .formatToParts(new Date(guess))
        .filter((x) => x.type !== "literal")
        .map((x) => [x.type, x.value]),
    );
    const rendered = Date.UTC(
      +p.year,
      +p.month - 1,
      +p.day,
      +p.hour,
      +p.minute,
      +p.second,
    );
    const delta = wanted - rendered;
    if (!delta) return new Date(guess);
    guess += delta;
  }
  throw Error("Ambiguous or unavailable civil time");
}
