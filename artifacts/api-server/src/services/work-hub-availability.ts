import {
  FleetAvailabilityReceiptSchema,
  WorkHubAvailabilityInputSchema,
  WorkHubAvailabilityReadSchema,
  WorkHubAvailabilityReceiptSchema,
} from "@workspace/api-zod";
import type { SessionPayload } from "../lib/session";
import type { FleetActor } from "./fleet-ops";
import {
  databaseFleetRepository,
  FleetError,
  type FleetRepository,
} from "./fleet-repository";
import { createAvailabilityManagementCore } from "./work-hub-availability-core";
import { z } from "zod/v4";
const internalReceipt = FleetAvailabilityReceiptSchema.extend({
  actorMembershipId: z.number().int().positive(),
  actorSessionVersion: z.number().int().positive(),
}).strict();
function actor(session: SessionPayload): FleetActor {
  if (
    session.role !== "field_employee" ||
    session.membershipRole !== "field_employee" ||
    !session.userId ||
    !session.vendorId ||
    !session.vendorPeopleId ||
    !session.activeMembershipId ||
    !session.sv
  )
    throw new FleetError("work_hub.forbidden", 403);
  return {
    userId: session.userId,
    companyId: session.vendorId,
    role: session.role,
    membershipRole: session.membershipRole,
    vendorPeopleId: session.vendorPeopleId,
    activeMembershipId: session.activeMembershipId,
    sv: session.sv,
  };
}
function publicReceipt(
  receipt: z.infer<typeof FleetAvailabilityReceiptSchema>,
) {
  const { driverUserId, ...rest } = internalReceipt.parse(receipt);
  return WorkHubAvailabilityReceiptSchema.parse({
    ...rest,
    userId: driverUserId,
  });
}
export function createWorkHubAvailabilityService(
  repository: FleetRepository = databaseFleetRepository,
) {
  const core = createAvailabilityManagementCore(
    (bound, operation) =>
      repository.transaction(bound.companyId, bound.userId, operation, bound),
    {
      access: (_state, bound, userId) => {
        if (userId !== bound.userId)
          throw new FleetError("work_hub.forbidden", 403);
        return true;
      },
      operationTarget: "work-hub-availability-operation",
      receiptSchema: internalReceipt,
      receiptContext: (bound) => ({
        actorMembershipId: bound.activeMembershipId,
        actorSessionVersion: bound.sv,
      }),
      validateReceipt: (raw, bound) => {
        const saved = internalReceipt.parse(raw);
        if (
          saved.actorMembershipId !== bound.activeMembershipId ||
          saved.actorSessionVersion !== bound.sv
        )
          throw new FleetError("work_hub.forbidden", 403);
      },
    },
  );
  return {
    read: async (session: SessionPayload) => {
      const a = actor(session),
        { driverUserId, ...rest } = await core.driverAvailability(a, a.userId);
      return WorkHubAvailabilityReadSchema.parse({
        ...rest,
        userId: driverUserId,
        companyId: a.companyId,
        actorMembershipId: a.activeMembershipId,
        actorSessionVersion: a.sv,
      });
    },
    save: async (session: SessionPayload, input: unknown) => {
      const a = actor(session),
        body = WorkHubAvailabilityInputSchema.parse(input);
      return publicReceipt(
        await core.recordDriverAvailability(a, {
          ...body,
          driverUserId: a.userId,
        }),
      );
    },
    readOperation: async (session: SessionPayload, operationId: string) => {
      const a = actor(session);
      const result = await core.driverAvailabilityOperation(
        a,
        a.userId,
        z.uuid().parse(operationId),
      );
      return { receipt: result.receipt ? publicReceipt(result.receipt) : null };
    },
  };
}
