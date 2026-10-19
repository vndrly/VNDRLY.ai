import {
  FleetWorkdayCommandSchema,
  FleetWorkdayEventSchema,
  FleetWorkdaySummarySchema,
  FleetWorkdaySnapshotSchema,
  FleetWorkdayReceiptSchema,
  type WorkdayEvent,
  type WorkdaySummary,
  type WorkdaySnapshot,
  type WorkdayReceipt,
} from "@workspace/api-zod";
import type { SessionPayload } from "../lib/session";
import type { FleetActor } from "./fleet-ops";
import { FleetError } from "./fleet-repository";
import { workdayService, WorkdayError } from "./workday";

function session(actor: FleetActor): SessionPayload {
  return {
    userId: actor.userId,
    vendorId: actor.companyId,
    partnerId: null,
    role: actor.role,
    sv: actor.sv,
    activeMembershipId: actor.activeMembershipId,
    membershipRole: actor.membershipRole,
    vendorPeopleId: actor.vendorPeopleId,
    publicDemo: actor.readOnly === true,
  };
}
function summary(value: WorkdaySummary) {
  const { owner, workerUserId, source: _source, ...rest } = value;
  return FleetWorkdaySummarySchema.parse({
    ...rest,
    companyId: owner.id,
    driverUserId: workerUserId,
    source: "driver_report",
  });
}
function event(value: WorkdayEvent) {
  const { owner, workerUserId, source: _source, ...rest } = value;
  return FleetWorkdayEventSchema.parse({
    ...rest,
    companyId: owner.id,
    driverUserId: workerUserId,
    source: "driver_report",
  });
}
function snapshot(value: WorkdaySnapshot) {
  return FleetWorkdaySnapshotSchema.parse({
    id: value.id,
    version: value.version,
    companyId: value.owner.id,
    driverUserId: value.workerUserId,
    timezone: value.timezone,
    summary: summary(value.summary),
  });
}
function receipt(value: WorkdayReceipt) {
  return FleetWorkdayReceiptSchema.parse({
    operationId: value.operationId,
    shiftId: value.shiftId,
    version: value.version,
    event: event(value.event),
    summary: summary(value.summary),
  });
}
async function canonical<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof WorkdayError)
      throw new FleetError(
        error.code.startsWith("workday.")
          ? `fleet.workday_${error.code.slice("workday.".length)}`
          : error.code,
        error.status,
      );
    throw error;
  }
}

/** Compatibility DTOs only. Every portal reads/writes the SAME Work Hub clock;
 * this adapter has no persistence, reservation or second shift mechanism. */
export function createFleetWorkdayOperations() {
  return {
    recordWorkday: (actor: FleetActor, raw: unknown) =>
      canonical(async () => {
        const input = FleetWorkdayCommandSchema.parse(raw),
          { companyId, userId, membershipId, sessionVersion } = input.scope;
        return receipt(
          await workdayService.record(session(actor), {
            ...input,
            scope: {
              owner: { type: "vendor", id: companyId },
              userId,
              membershipId,
              sessionVersion,
            },
          }),
        );
      }),
    workday: (actor: FleetActor, id: string) =>
      canonical(async () => {
        const value = await workdayService.read(session(actor), id);
        return { ...snapshot(value), events: value.events.map(event) };
      }),
    workdayOperation: (actor: FleetActor, id: string) =>
      canonical(async () =>
        receipt(await workdayService.operation(session(actor), id)),
      ),
    driverWorkdays: (actor: FleetActor, workerUserId: number, raw: unknown) =>
      canonical(async () => {
        const page = await workdayService.list(
          session(actor),
          workerUserId,
          raw,
        );
        return {
          ...page,
          items: page.items.map((value) => ({
            ...snapshot(value),
            reportedWorkMillisecondsInRange:
              value.reportedWorkMillisecondsInRange,
          })),
        };
      }),
  };
}
