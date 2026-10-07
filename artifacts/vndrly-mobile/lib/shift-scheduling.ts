import { z } from "zod/v4";
export { localMeetingTime } from "./meeting-scheduling";
const payloadSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    startsAt: z.iso.datetime(),
    endsAt: z.iso.datetime(),
    timezone: z.string().min(3).max(80),
    assigneeUserIds: z.array(z.number().int().positive()).max(100),
    open: z.literal(false),
    qualificationCodes: z.array(z.string().trim().min(1).max(80)).max(50),
    siteLocationId: z.number().int().positive().optional(),
    gateStationId: z.uuid().optional(),
    requiredStaffCount: z.number().int().min(1).max(20).optional(),
    workStartPolicy: z.enum(["on_site", "paid_travel"]).optional(),
  })
  .strict();
export type ShiftAttempt = {
  actorUserId: number;
  body: {
    operationId: string;
    owner: { type: "vendor" | "partner"; id: number };
    context: { kind: "organization" | "gate"; id: number };
    expectedVersion: null;
    payloadVersion: 1;
    payload: z.infer<typeof payloadSchema>;
  };
};
export function makeShiftAttempt(
  actorUserId: number,
  owner: ShiftAttempt["body"]["owner"],
  raw: unknown,
  operationId: string,
): ShiftAttempt {
  const payload = payloadSchema.parse(raw);
  z.uuid().parse(operationId);
  if (Date.parse(payload.endsAt) <= Date.parse(payload.startsAt))
    throw Error("invalid_interval");
  new Intl.DateTimeFormat("en", { timeZone: payload.timezone }).format();
  const gate = [
    payload.siteLocationId,
    payload.gateStationId,
    payload.requiredStaffCount,
    payload.workStartPolicy,
  ];
  if (gate.some((x) => x !== undefined) && gate.some((x) => x === undefined))
    throw Error("incomplete_gate_context");
  return {
    actorUserId,
    body: {
      operationId,
      owner,
      expectedVersion: null,
      payloadVersion: 1,
      context: {
        kind: payload.siteLocationId ? "gate" : "organization",
        id: payload.siteLocationId ?? owner.id,
      },
      payload: {
        ...payload,
        assigneeUserIds: [...new Set(payload.assigneeUserIds)].sort(
          (a, b) => a - b,
        ),
      },
    },
  };
}
const shiftSchema = z.object({
  id: z.uuid(),
  ownerOrgType: z.enum(["vendor", "partner"]),
  ownerOrgId: z.number().int().positive(),
  createdById: z.number().int().positive(),
  title: z.string(),
  startsAt: z.iso.datetime(),
  endsAt: z.iso.datetime(),
  timezone: z.string(),
  version: z.number().int().positive(),
  open: z.boolean(),
  assigneeUserIds: z.array(z.number().int().positive()).max(100),
  siteLocationId: z.number().int().positive().nullish(),
  gateStationId: z.uuid().nullish(),
  requiredStaffCount: z.number().int().positive().nullish(),
  workStartPolicy: z.enum(["on_site", "paid_travel"]).nullish(),
  qualificationCodes: z.array(z.string()).nullish(),
  milestoneStatus: z.string().optional(),
});
function match(raw: unknown, a: ShiftAttempt) {
  const s = shiftSchema.parse(raw),
    p = a.body.payload;
  if (
    s.ownerOrgType !== a.body.owner.type ||
    s.ownerOrgId !== a.body.owner.id ||
    s.createdById !== a.actorUserId ||
    s.title !== p.title ||
    s.open !== p.open ||
    JSON.stringify([...new Set(s.assigneeUserIds)].sort((a, b) => a - b)) !==
      JSON.stringify(p.assigneeUserIds) ||
    s.timezone !== p.timezone ||
    Date.parse(s.startsAt) !== Date.parse(p.startsAt) ||
    Date.parse(s.endsAt) !== Date.parse(p.endsAt) ||
    (s.siteLocationId ?? undefined) !== p.siteLocationId ||
    (s.gateStationId ?? undefined) !== p.gateStationId ||
    (s.requiredStaffCount ?? undefined) !== p.requiredStaffCount ||
    (s.workStartPolicy ?? undefined) !== p.workStartPolicy ||
    JSON.stringify(s.qualificationCodes) !==
      JSON.stringify(p.qualificationCodes) ||
    s.milestoneStatus === "cancelled"
  )
    throw Error("shift_differs_from_review");
  return s;
}
export function matchingShift(raw: unknown, a: ShiftAttempt) {
  return match(
    z
      .object({
        source: z.literal("vndrly"),
        authority: z.literal("work_hub_shift"),
        item: z.unknown(),
      })
      .parse(raw).item,
    a,
  ).id;
}
export function createdShiftId(raw: unknown, a: ShiftAttempt) {
  const r = z
    .object({
      operationId: z.uuid(),
      appliedAt: z.iso.datetime(),
      replayed: z.boolean(),
      resource: z.unknown(),
    })
    .parse(raw);
  if (r.operationId !== a.body.operationId) throw Error("operation_mismatch");
  return match(r.resource, a).id;
}

export async function recoverCreatedShift(
  a: ShiftAttempt,
  request: (path: string) => Promise<unknown>,
  current: () => boolean,
) {
  const guard = () => {
    if (!current()) throw Error("account_changed");
  };
  guard();
  const read = z
    .object({ receipt: z.unknown().nullable() })
    .strict()
    .parse(
      await request("/api/work-hub/shifts/operations/" + a.body.operationId),
    );
  guard();
  if (!read.receipt) throw Error("creation_receipt_absent");
  const id = createdShiftId(read.receipt, a);
  const snapshot = await request("/api/work-hub/calendar/items/shift/" + id);
  guard();
  if (matchingShift(snapshot, a) !== id) throw Error("shift_id_mismatch");
  return id;
}
