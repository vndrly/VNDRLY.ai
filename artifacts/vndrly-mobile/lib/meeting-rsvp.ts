import {
  WorkHubCalendarResponseInputSchema,
  WorkHubCalendarResponseResultSchema,
  type WorkHubCalendarResponseInput,
} from "@workspace/api-zod";
export type RsvpAttempt = Readonly<{
  input: WorkHubCalendarResponseInput;
  body: string;
  actorUserId: number;
  commandFingerprint: string;
}>;
export function makeRsvpAttempt(
  raw: unknown,
  actorUserId: number,
  commandFingerprint: string,
): RsvpAttempt {
  const input = WorkHubCalendarResponseInputSchema.parse(raw);
  if (
    !Number.isInteger(actorUserId) ||
    actorUserId < 1 ||
    !/^[a-f0-9]{64}$/.test(commandFingerprint)
  )
    throw Error("Invalid response identity");
  return Object.freeze({
    input: Object.freeze(input),
    body: JSON.stringify(input),
    actorUserId,
    commandFingerprint,
  });
}
export async function submitRsvpAttempt(
  attempt: RsvpAttempt,
  retry: boolean,
  api: (
    path: string,
    init: { method: string; body: string },
  ) => Promise<unknown>,
  current: () => boolean,
) {
  const check = () => {
    if (!current()) throw Error("Account changed");
  };
  const verify = (raw: unknown) => {
    const result = WorkHubCalendarResponseResultSchema.parse(raw);
    const r = result.receipt;
    if (
      r &&
      (r.operationId !== attempt.input.operationId ||
        r.occurrenceId !== attempt.input.occurrenceId ||
        r.actorUserId !== attempt.actorUserId ||
        r.commandFingerprint !== attempt.commandFingerprint ||
        r.scheduleFingerprint !== attempt.input.expectedFingerprint ||
        r.response !== attempt.input.response)
    )
      throw Error("Response receipt mismatch");
    return r;
  };
  const send = async (action: string) => {
    check();
    const raw = await api("/api/work-hub/calendar-response/" + action, {
      method: "POST",
      body: attempt.body,
    });
    check();
    return verify(raw);
  };
  if (retry) {
    const saved = await send("readback");
    if (saved) return saved;
  }
  const saved = await send("execute");
  if (!saved) throw Error("Response not verified");
  return saved;
}
