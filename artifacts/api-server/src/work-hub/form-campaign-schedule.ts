type Config = {
  kind: string;
  timezone: string;
  briefing: { enabled: boolean; hour: number; minute: number };
  audience: { rolling: boolean };
  escalation: { delayHours: number; userId: number } | null;
};
type State = {
  status: string;
  publishedAt?: string | null;
  deadline?: string | null;
  nextReminderAt?: string | null;
  nextAudienceAt?: string | null;
  lastBriefingDate?: string | null;
  escalatedAt?: string | null;
  closedAt?: string | null;
};
function local(date: Date, timeZone: string) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(date)
      .map((x) => [x.type, x.value]),
  );
  return {
    date: `${p.year}-${p.month}-${p.day}`,
    minutes: Number(p.hour) * 60 + Number(p.minute),
  };
}
export function campaignDueWork(config: Config, state: State, now: Date) {
  const inactive = !["published", "closed"].includes(state.status),
    deadline = state.deadline ? Date.parse(state.deadline) : Infinity,
    closedPoll =
      config.kind === "poll" &&
      (state.status === "closed" || now.getTime() >= deadline),
    current = local(now, config.timezone),
    published = state.publishedAt
      ? local(new Date(state.publishedAt), config.timezone)
      : null,
    target = config.briefing.hour * 60 + config.briefing.minute;
  const briefingDate =
    !inactive &&
    config.briefing.enabled &&
    !closedPoll &&
    current.minutes >= target &&
    state.lastBriefingDate !== current.date &&
    (!published ||
      current.date !== published.date ||
      published.minutes < target)
      ? current.date
      : null;
  return {
    briefingDate,
    close:
      !inactive &&
      config.kind === "poll" &&
      state.status !== "closed" &&
      now.getTime() >= deadline,
    reminder:
      !inactive &&
      !closedPoll &&
      !!state.nextReminderAt &&
      now.getTime() >= Date.parse(state.nextReminderAt),
    expand:
      !inactive &&
      !closedPoll &&
      config.audience.rolling &&
      now.getTime() < deadline &&
      !!state.nextAudienceAt &&
      now.getTime() >= Date.parse(state.nextAudienceAt),
    escalate:
      !inactive &&
      config.kind !== "poll" &&
      !!config.escalation &&
      !state.escalatedAt &&
      now.getTime() >= deadline + config.escalation.delayHours * 3600000,
    deadlineNotice: !inactive && now.getTime() >= deadline,
  };
}

export function campaignPushAfterQuietHours(
  at: Date,
  start: number,
  end: number,
  timezone: string,
): Date {
  if (start === end) return at;
  const format = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "2-digit",
    hourCycle: "h23",
  });
  const quiet = (date: Date) => {
    const h = Number(format.format(date));
    return start < end ? h >= start && h < end : h >= start || h < end;
  };
  if (!quiet(at)) return at;
  for (
    let next = new Date(Math.floor(at.getTime() / 60000) * 60000 + 60000),
      i = 0;
    i < 26 * 60;
    i++, next = new Date(next.getTime() + 60000)
  )
    if (!quiet(next)) return next;
  throw Error("Unable to determine quiet-hour delivery time");
}
