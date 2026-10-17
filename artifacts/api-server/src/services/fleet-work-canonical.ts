import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod/v4";
import {
  FleetWorkMappingSchema,
  FleetWorkScopeSchema,
  FleetRunSchema,
  FleetDestinationReceiptSchema,
  type FleetWorkCommand,
  type FleetWorkReference,
  type FleetWorkReceipt,
} from "@workspace/api-zod";
import { createFleetService } from "./fleet-ops";
import { FleetError, type FleetRepository } from "./fleet-repository";
import type { FleetWorkExecutionContext } from "./fleet-work-repository";
import type { FleetWorkExecution } from "./fleet-work";
import {
  createWorkdayService,
  withVerifiedWorkdayClient,
  WorkdayError,
} from "./workday";

type Canonical = Extract<FleetWorkReference, { type: "canonical" }>;
const mappingSchema = z
  .object({ scope: FleetWorkScopeSchema, mapping: FleetWorkMappingSchema })
  .strict();
/** These are existing business operations under the enclosing real transaction,
 * not a second permissive implementation. New handler kinds stay unavailable
 * until their authoritative path is implemented; no v2 UI is activated yet. */
export async function executeFleetWorkCommand(
  context: FleetWorkExecutionContext,
  command: FleetWorkCommand,
): Promise<FleetWorkExecution> {
  const { actor, state, client } = context,
    afterCommit: Array<() => Promise<unknown>> = [];
  const bound: FleetRepository = {
    async transaction(companyId, userId, operation, authority) {
      if (
        companyId !== actor.companyId ||
        userId !== actor.userId ||
        authority?.sv !== actor.sv ||
        authority?.activeMembershipId !== actor.activeMembershipId
      )
        throw new FleetError("fleet.work_scope_changed", 403);
      if (
        authority?.schedulingDriverUserIds?.some(
          (id) =>
            id !== actor.userId && !actor.schedulingDriverUserIds?.includes(id),
        )
      )
        throw new FleetError("fleet.work_scheduling_context_required", 409);
      return operation(state, client);
    },
  };
  const service = createFleetService(bound, {
    afterCommit: (effect) => {
      afterCommit.push(effect);
    },
  });
  const result = (
    canonicalReferences: Canonical[] = [],
    mappings: Extract<FleetWorkReceipt, { status: "applied" }>["mappings"] = [],
  ): FleetWorkExecution => ({ canonicalReferences, mappings, afterCommit });
  const mapped = async (ref: FleetWorkReference): Promise<Canonical> => {
    if (ref.type === "canonical") return ref;
    const rows = await client.query(
      "SELECT user_id,tool_output FROM assistant_action_audit WHERE vendor_id=$1 AND target_type='fleet-work-mapping' AND target_id=$2 ORDER BY id DESC LIMIT 1",
      [
        actor.companyId,
        `${command.scope.provisioningId}:${ref.kind}:${ref.id}`,
      ],
    );
    const row = rows.rows[0],
      parsed = mappingSchema.safeParse(row?.tool_output);
    if (
      row?.user_id !== actor.userId ||
      !parsed.success ||
      !isDeepStrictEqual(parsed.data.scope, command.scope) ||
      !isDeepStrictEqual(parsed.data.mapping.local, ref)
    )
      throw new FleetError("fleet.work_dependency_unresolved", 409);
    return parsed.data.mapping.canonical;
  };
  const activity = async (ref: FleetWorkReference) => {
    const target = await mapped(ref);
    if (target.kind !== "activity" || typeof target.id !== "string")
      throw new FleetError("fleet.invalid_request", 400);
    if (!state.runs.some((run) => run.id === target.id)) {
      const rows = await client.query(
        "SELECT tool_output FROM assistant_action_audit WHERE vendor_id=$1 AND target_type='fleet-run' AND target_id=$2 ORDER BY id DESC LIMIT 1",
        [actor.companyId, target.id],
      );
      if (rows.rows.length)
        state.runs.push(FleetRunSchema.parse(rows.rows[0].tool_output));
    }
    return {
      reference: target,
      run: await service.detail({ ...actor }, target.id),
    };
  };
  switch (command.kind) {
    case "location.save": {
      const { localReference, ...payload } = command.payload;
      const saved = FleetDestinationReceiptSchema.parse(
          await service.saveDestination({ ...actor }, payload),
        ),
        canonical: Canonical = {
          type: "canonical",
          kind: "location",
          id: saved.destination.id,
          version: saved.destination.revision,
        };
      return result(
        [canonical],
        localReference
          ? [
              {
                local: {
                  type: "local",
                  kind: "location",
                  id: String(localReference.id),
                },
                canonical,
              },
            ]
          : [],
      );
    }
    case "detail.save": {
      const saved = await service.saveFleetDetail(
          { ...actor },
          command.payload,
        ),
        canonical: Canonical = {
          type: "canonical",
          kind: "detail",
          id: saved.id,
          version: saved.version,
        };
      return result(
        [canonical],
        command.payload.expectedVersion === 0
          ? [
              {
                local: {
                  type: "local",
                  kind: "detail",
                  id: command.payload.detail.id,
                },
                canonical,
              },
            ]
          : [],
      );
    }
    case "rig_package.save": {
      const saved = await service.saveFleetRigPackage(
          { ...actor },
          command.payload,
        ),
        canonical: Canonical = {
          type: "canonical",
          kind: "rig_package",
          id: saved.id,
          version: saved.version,
        };
      return result(
        [canonical],
        command.payload.expectedVersion === 0
          ? [
              {
                local: {
                  type: "local",
                  kind: "rig_package",
                  id: command.payload.package.id,
                },
                canonical,
              },
            ]
          : [],
      );
    }
    case "run_order.save": {
      const saved = await service.saveFleetRunOrder(
          { ...actor },
          command.payload,
        ),
        canonical: Canonical = {
          type: "canonical",
          kind: "run_order",
          id: saved.id,
          version: saved.version,
        };
      return result(
        [canonical],
        command.payload.expectedVersion === 0
          ? [
              {
                local: {
                  type: "local",
                  kind: "run_order",
                  id: command.payload.order.id,
                },
                canonical,
              },
            ]
          : [],
      );
    }
    case "activity.note": {
      const current = await activity(command.payload.activity),
        ticket = await mapped(command.payload.ticket);
      if (ticket.kind !== "ticket" || current.run.linkedTicketId !== ticket.id)
        throw new FleetError("fleet.ticket_link_changed", 409);
      if (current.run.version !== current.reference.version)
        throw new FleetError("fleet.version_conflict", 409);
      await client.query(
        "INSERT INTO assistant_action_audit(user_id,vendor_id,client_surface,input_mode,provider,tool_name,action_type,target_type,target_id,tool_output,result_status) VALUES($1,$2,'fleet','typed','canonical','fleet_work_note','note','fleet-work-fact',$3,$4::jsonb,'completed')",
        [
          actor.userId,
          actor.companyId,
          command.operationId,
          JSON.stringify({
            version: 2,
            kind: "note",
            activityId: current.run.id,
            ticketId: ticket.id,
            actorUserId: actor.userId,
            capturedAt: command.capturedAt,
            timeZone: command.timeZone,
            receivedAt: new Date().toISOString(),
            notes: command.payload.notes,
          }),
        ],
      );
      return result([
        {
          type: "canonical",
          kind: "activity",
          id: current.run.id,
          version: current.run.version,
        },
      ]);
    }
    case "activity.action": {
      const current = await activity(command.payload.activity),
        ticket = await mapped(command.payload.ticket);
      if (ticket.kind !== "ticket" || current.run.linkedTicketId !== ticket.id)
        throw new FleetError("fleet.ticket_link_changed", 409);
      if (
        !isDeepStrictEqual(
          current.run.resourceAssignment?.snapshot,
          command.payload.baseAssignment,
        )
      )
        throw new FleetError("fleet.assignment_changed", 409);
      const saved = await service.action(
        { ...actor },
        current.run.id,
        command.payload.action,
      );
      return result([
        {
          type: "canonical",
          kind: "activity",
          id: saved.id,
          version: saved.version,
        },
      ]);
    }
    case "activity.legacy_action": {
      const payload = command.payload,
        old = await client.query(
          "SELECT tool_output FROM assistant_action_audit WHERE vendor_id=$1 AND target_type='fleet-operation' AND target_id=$2 ORDER BY id DESC LIMIT 1",
          [actor.companyId, command.operationId],
        );
      if (old.rows.length) {
        const record = old.rows[0].tool_output,
          fingerprint = createHash("sha256")
            .update(
              JSON.stringify({ runId: payload.base.runId, ...payload.action }),
            )
            .digest("hex");
        if (
          record.actorUserId !== actor.userId ||
          record.fingerprint !== fingerprint ||
          record.runId !== payload.base.runId
        )
          throw new FleetError("fleet.operation_conflict");
        const saved = FleetRunSchema.parse(record.result);
        if (saved.linkedTicketId !== payload.ticket.id)
          throw new FleetError("fleet.ticket_link_changed");
        return result([
          {
            type: "canonical",
            kind: "activity",
            id: saved.id,
            version: saved.version,
          },
        ]);
      }
      if (payload.legacyState !== "unsynced")
        throw new FleetError("fleet.assignment_changed");
      const current = await activity(payload.activity),
        run = current.run;
      if (
        run.companyId !== payload.base.companyId ||
        run.driverUserId !== payload.base.driverUserId ||
        run.vehicleAssetId !== payload.base.vehicleAssetId ||
        run.trailerAssetId !== payload.base.trailerAssetId ||
        run.linkedTicketId !== payload.ticket.id
      )
        throw new FleetError("fleet.assignment_changed");
      if (run.version !== payload.base.version)
        throw new FleetError("fleet.version_conflict");
      const saved = await service.action({ ...actor }, run.id, payload.action);
      return result([
        {
          type: "canonical",
          kind: "activity",
          id: saved.id,
          version: saved.version,
        },
      ]);
    }
    case "compliance.receive":
      if (command.payload.documentReference?.type === "local")
        throw new FleetError("fleet.work_dependency_unresolved", 409);
      await service.saveFleetComplianceEvidence(
        { ...actor },
        command.payload.source,
      );
      return result();
    case "compliance.review":
      await service.verifyFleetComplianceEvidence(
        { ...actor },
        command.payload,
      );
      return result();
    case "compliance.facts":
      await service.recordFleetComplianceFacts({ ...actor }, command.payload);
      return result();
    case "requirements.adopt":
      await service.adoptFleetRequirement({ ...actor }, command.payload);
      return result();
    case "workday.event": {
      const clock = createWorkdayService((session, work) =>
        withVerifiedWorkdayClient(session, client, work),
      );
      try {
        const saved = await clock.record(
          {
            userId: actor.userId,
            vendorId: actor.companyId,
            partnerId: null,
            role: actor.role,
            sv: actor.sv,
            activeMembershipId: actor.activeMembershipId,
            membershipRole: actor.membershipRole,
            vendorPeopleId: actor.vendorPeopleId,
            publicDemo: actor.readOnly === true,
          },
          command.payload,
        );
        return result([
          {
            type: "canonical",
            kind: "shift",
            id: saved.shiftId,
            version: saved.version,
          },
        ]);
      } catch (error) {
        if (error instanceof WorkdayError)
          throw new FleetError(error.code, error.status);
        throw error;
      }
    }
    default:
      throw new FleetError("fleet.work_kind_unavailable", 503);
  }
}
