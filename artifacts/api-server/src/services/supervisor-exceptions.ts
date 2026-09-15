export type SupervisorExceptionKind =
  | "field_mode_exception"
  | "gate_exception";
export type SupervisorExceptionReason =
  | "end_work_unanswered"
  | "extended_stop_unanswered"
  | "unresolved_gate_observation";

export type SupervisorExceptionInput = {
  actorUserId: number;
  owner: { type: "vendor" | "partner"; id: number };
  eventId: string;
  kind: SupervisorExceptionKind;
  reason: SupervisorExceptionReason;
};

export type SupervisorExceptionDependencies = {
  claim: (dedupeKey: string) => Promise<boolean>;
  writeAudit: (input: SupervisorExceptionInput) => Promise<unknown>;
  resolveRecipients: (input: SupervisorExceptionInput) => Promise<number[]>;
  notify: (
    userIds: number[],
    input: SupervisorExceptionInput,
    dedupeKey: string,
  ) => Promise<number>;
};

const ALLOWED = new Set<string>([
  "field_mode_exception:end_work_unanswered",
  "field_mode_exception:extended_stop_unanswered",
  "gate_exception:unresolved_gate_observation",
]);

function invalidEvent(): never {
  throw Object.assign(new Error("Unsupported operations event"), {
    status: 400,
    code: "operations_health.invalid_event",
  });
}

export async function recordSupervisorException(
  input: SupervisorExceptionInput,
  deps: SupervisorExceptionDependencies,
): Promise<{ created: boolean; notified: number }> {
  if (
    !Number.isSafeInteger(input.actorUserId) ||
    input.actorUserId <= 0 ||
    !Number.isSafeInteger(input.owner.id) ||
    input.owner.id <= 0 ||
    !input.eventId.trim() ||
    !ALLOWED.has(`${input.kind}:${input.reason}`)
  )
    invalidEvent();
  const dedupeKey = [
    input.owner.type,
    input.owner.id,
    input.actorUserId,
    input.kind,
    input.reason,
    input.eventId.trim(),
  ].join(":");
  if (!(await deps.claim(dedupeKey))) return { created: false, notified: 0 };
  await deps.writeAudit(input);
  const recipients = [
    ...new Set((await deps.resolveRecipients(input)).filter((id) => id > 0)),
  ];
  const notified = await deps.notify(recipients, input, dedupeKey);
  return { created: true, notified };
}
