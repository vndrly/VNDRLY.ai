import {readFleetServiceTemplate} from "./fleet-service-template";
import { reviewFleetActivityCharges, finalizeFleetTicketV2, adjustFleetReviewedCharge,resolveFleetActivityPrice } from "./fleet-charge-review";
import {resolveFleetReconciliation} from "./fleet-reconciliation";
import {
  resolveFleetWorkReference,
  authorizeFleetOriginalDriverActivity,
} from "./fleet-work-references";
export { resolveFleetWorkReference } from "./fleet-work-references";
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod/v4";
import {
  FleetWorkScopeSchema,
  FleetRunSchema,
  FleetDestinationReceiptSchema,
  FleetEvidenceUploadSessionSchema,
  fleetRouteOperationalStops,
  fleetDetailSnapshotIdentityMatches,
  type FleetRouteLocation,
  type FleetWorkCommand,
  type FleetWorkReference,
  type FleetWorkReceipt,
} from "@workspace/api-zod";
import { createFleetService, type FleetServiceOptions } from "./fleet-ops";
import { FleetError, type FleetRepository } from "./fleet-repository";
import type { FleetWorkExecutionContext } from "./fleet-work-repository";
import type { FleetWorkExecution } from "./fleet-work";
import { fleetWorkFingerprint } from "./fleet-work";
import { reviewFleetQuantityEvidence } from "./fleet-quantity-review";
import {
  createWorkdayService,
  withVerifiedWorkdayClient,
  WorkdayError,
} from "./workday";

type Canonical = Extract<FleetWorkReference, { type: "canonical" }>;
/** These are existing business operations under the enclosing real transaction,
 * not a second permissive implementation. New handler kinds stay unavailable
 * until their authoritative path is implemented; no v2 UI is activated yet. */
export function createFleetWorkCanonicalService(
  context: FleetWorkExecutionContext,
  options: FleetServiceOptions = {},
) {
  const { actor, state, client } = context;
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
  return createFleetService(bound, options);
}
export async function executeFleetWorkCommand(
  context: FleetWorkExecutionContext,
  command: FleetWorkCommand,
  options: Omit<FleetServiceOptions, "afterCommit"> = {},
): Promise<FleetWorkExecution> {
  const { actor, state, client } = context,
    afterCommit: Array<() => Promise<unknown>> = [];
  const service = createFleetWorkCanonicalService(context, {
    ...options,
    originalWorkOperationId: command.operationId,
    originalWorkCapture: { capturedAt: command.capturedAt, timeZone: command.timeZone },
    afterCommit: (effect) => {
      afterCommit.push(effect);
    },
  });
  const result = (
    canonicalReferences: Canonical[] = [],
    mappings: Extract<FleetWorkReceipt, { status: "applied" }>["mappings"] = [],
  ): FleetWorkExecution => ({ canonicalReferences, mappings, afterCommit });
  const mapped = (ref: FleetWorkReference) =>
    resolveFleetWorkReference(context, command.scope, ref);
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
    case "monitoring.save":await service.saveFleetTrigger({...actor},command.payload);return result();
    case "service_template.save":await service.saveServiceTemplate({...actor},command.payload);return result();
    case "replacement.propose":case "replacement.action":case "cargo.propose":case "cargo.action": {
      const p=command.payload,target=await activity(p.activity),ticket=await mapped(p.ticket),run=state.runs.find(row=>row.id===target.run.id)!;
      if(target.reference.version!==run.version||run.linkedTicketId!==ticket.id||!run.resourceAssignment||!fleetDetailSnapshotIdentityMatches(run.resourceAssignment.snapshot,p.baseAssignment))throw new FleetError("fleet.work_assignment_changed",409);
      if(command.kind==="replacement.propose")await service.proposeReplacement({...actor},run.id,command.payload.input);
      else if(command.kind==="replacement.action")await service.replacementAction({...actor},run.id,command.payload.replacementId,command.payload.input);
      else if(command.kind==="cargo.propose"){
        const recipient=await activity(command.payload.target),recipientTicket=await mapped(command.payload.targetTicket);
        if(command.payload.input.sourceRunId!==run.id||command.payload.input.targetRunId!==recipient.run.id||recipient.run.linkedTicketId!==recipientTicket.id||command.payload.input.targetExpectedVersion!==recipient.run.version)throw new FleetError("fleet.version_conflict",409);
        await service.prepareCargoTransfer({...actor},command.payload.input);
      }else{
        const transfer=await service.cargoTransfer({...actor},command.payload.transferId);
        if(transfer.sourceRunId!==run.id&&transfer.targetRunId!==run.id)throw new FleetError("fleet.action_forbidden",403);
        await service.cargoAction({...actor},command.payload.transferId,command.payload.input);
      }
      await client.query("INSERT INTO assistant_action_audit(user_id,vendor_id,client_surface,input_mode,provider,tool_name,action_type,target_type,target_id,tool_output,result_status) VALUES($1,$2,'fleet','typed','canonical','fleet_work','original-capture-retained','fleet-work-capture',$3,$4::jsonb,'completed')",[actor.userId,actor.companyId,command.operationId,JSON.stringify({version:2,activityId:run.id,kind:command.kind,capturedAt:command.capturedAt,timeZone:command.timeZone,receivedAt:new Date().toISOString(),source:"user_report"})]);
      return result([{type:"canonical",kind:"activity",id:run.id,version:run.version}]);
    }
    case "activity.reconcile":return resolveFleetReconciliation(context,command,(adopted)=>executeFleetWorkCommand(context,adopted,options));
    case "price.resolve": {
      const target=await activity(command.payload.activity),ticket=await mapped(command.payload.ticket);
      if(target.run.version!==command.payload.expectedVersion||target.reference.version!==command.payload.expectedVersion||target.run.linkedTicketId!==ticket.id)throw new FleetError("fleet.version_conflict");
      const run=state.runs.find(row=>row.id===target.run.id)!;const saved=await resolveFleetActivityPrice(context,command,run);
      return result([{type:"canonical",kind:"activity",id:run.id,version:run.version},{type:"canonical",kind:"ticket",id:Number(ticket.id),version:saved.ticketVersion}]);
    }
    case "charge.review": {
      const target=await activity(command.payload.activity),ticket=await mapped(command.payload.ticket);
      if(target.reference.version!==command.payload.expectedVersion||target.run.version!==command.payload.expectedVersion||target.run.linkedTicketId!==ticket.id)throw new FleetError("fleet.version_conflict");
      const run=state.runs.find(r=>r.id===target.run.id)!;
      const saved=await reviewFleetActivityCharges(context,command,run);
      return result([{type:"canonical",kind:"activity",id:run.id,version:run.version},{type:"canonical",kind:"ticket",id:Number(ticket.id),version:saved.ticketVersion}]);
    }
    case "charge.adjust": {
      const target=await activity(command.payload.activity),ticket=await mapped(command.payload.ticket);
      if(target.reference.version!==target.run.version||target.run.linkedTicketId!==ticket.id)throw new FleetError("fleet.version_conflict");
      const run=state.runs.find(r=>r.id===target.run.id)!;const saved=await adjustFleetReviewedCharge(context,command,run);
      return result([{type:"canonical",kind:"activity",id:run.id,version:run.version},{type:"canonical",kind:"ticket",id:Number(ticket.id),version:saved.ticketVersion}]);
    }
    case "ticket.finalize": {
      const ticket=await mapped(command.payload.ticket);if(typeof ticket.id!=="number"||ticket.version!==command.payload.expectedVersion)throw new FleetError("fleet.version_conflict");
      const saved=await finalizeFleetTicketV2(context,command,ticket.id);return result([{type:"canonical",kind:"ticket",id:ticket.id,version:saved.ticketVersion}]);
    }

    case "quantity.review": {
      const current = await activity(command.payload.activity), ticket = await mapped(command.payload.ticket);
      if (ticket.kind !== "ticket" || current.run.linkedTicketId !== ticket.id)
        throw new FleetError("fleet.ticket_link_changed");
      if (current.run.version !== current.reference.version)
        throw new FleetError("fleet.version_conflict");
      await reviewFleetQuantityEvidence(context, command, current.run);
      return result([current.reference]);
    }
    case "activity.create": {
      const p = command.payload, detailRef = await mapped(p.detailReference);
      if (detailRef.kind !== "detail" || typeof detailRef.id !== "string")
        throw new FleetError("fleet.invalid_request", 400);
      // Resolve current permission/resource records without trusting cached
      // display labels or the time at which a client read its snapshot.
      let snapshot;
      try {
        snapshot = await service.fleetDetailSnapshot({ ...actor }, detailRef.id, p.detailSnapshot.detail.driverUserId);
      } catch (error) {
        if (error instanceof FleetError && ["fleet.driver_grant_required", "fleet.detail_revision_conflict"].includes(error.code))
          throw new FleetError("fleet.work_assignment_changed");
        throw error;
      }
      if (
        snapshot.detail.version !== detailRef.version ||
        !fleetDetailSnapshotIdentityMatches(snapshot, {
          ...p.detailSnapshot, detail: { ...p.detailSnapshot.detail, id: detailRef.id },
        })
      ) throw new FleetError("fleet.work_assignment_changed");
      let runOrderSelection: { id: string; version: number } | undefined;
      let orderGroups: string[] | undefined;
      if (p.runOrderReference) {
        const ref = await mapped(p.runOrderReference);
        if (ref.kind !== "run_order" || typeof ref.id !== "string")
          throw new FleetError("fleet.invalid_request", 400);
        const order = await service.fleetRunOrder({ ...actor }, ref.id);
        if (order.version !== ref.version || order.archivedAt)
          throw new FleetError("fleet.run_order_revision_conflict");
        runOrderSelection = { id: ref.id, version: ref.version };
        orderGroups = order.accessGroupIds;
      }
      if (p.billing.billingSiteId === null || p.billing.serviceId === null)
        throw new FleetError("fleet.price_context_unresolved");
      const grant = state.grants.find(g => g.userId === actor.userId);
      const ownUnplanned=snapshot.detail.driverUserId===actor.userId&&!!grant?.roles.includes("driver")&&(actor.fleetCapabilities===undefined||actor.fleetCapabilities.has("self_dispatch"));
      const groups = state.fleets.filter(group =>
        (!p.accessGroupId||group.id===p.accessGroupId)&&grant?.fleetIds.includes(group.id) &&
        snapshot.detail.accessGroupIds.includes(group.id) &&
        (!orderGroups || orderGroups.includes(group.id)) &&
        group.siteIds.includes(p.billing.billingSiteId ?? 0) &&
        (ownUnplanned||grant.siteIds.includes(p.billing.billingSiteId ?? 0)),
      ).sort((a, b) => a.id.localeCompare(b.id));
      if (!groups.length) throw new FleetError("fleet.dispatch_required", 403);
      const billing = p.billing.choice === "new_ticket" ? p.billing : {
        ...p.billing, ticket: await mapped(p.billing.ticket),
      };
      // A provisional place is resolved only through this original scope's
      // explicit mapping. A mistyped canonical place is never auto-created.
      const resolvePlace = async (place: FleetRouteLocation): Promise<FleetRouteLocation> => {
        if (place.type === "canonical") return place;
        const ref = await mapped({ type: "local", kind: "location", id: place.localId });
        const directory = await service.commercialSettings({ ...actor }, p.billing.billingSiteId!);
        const current = directory.destinations.find(d => d.id === ref.id && d.revision === ref.version);
        if (!current) throw new FleetError("fleet.route_location_unresolved");
        return { type: "canonical", location: current };
      };
      const route = { ...p.route, origin: await resolvePlace(p.route.origin),
        base: p.route.base ? await resolvePlace(p.route.base) : null,
        stops: await Promise.all(p.route.stops.map(async stop => ({ ...stop, location: await resolvePlace(stop.location) }))),
      };
      const prior = await client.query(
        "SELECT id FROM assistant_action_audit WHERE vendor_id=$1 AND target_type='fleet-operation' AND target_id=$2 LIMIT 1",
        [actor.companyId, command.operationId],
      );
      if (prior.rows.length || state.operations.some(op => op.id === command.operationId))
        throw new FleetError("fleet.operation_conflict");
      const digest = createHash("sha256").update(`${command.operationId}:origin`).digest("hex");
      const originId = p.originStopId??`${digest.slice(0,8)}-${digest.slice(8,12)}-4${digest.slice(13,16)}-8${digest.slice(17,20)}-${digest.slice(20,32)}`;
      if(p.serviceTemplate){const saved=await readFleetServiceTemplate(client,actor.companyId,p.billing.serviceId!,p.serviceTemplate.revision);if(!saved||!saved.enabled||saved.serviceId!==p.billing.serviceId||!isDeepStrictEqual(saved,p.serviceTemplate))throw new FleetError("fleet.template_revision_conflict",409);}
      const creator = createFleetWorkCanonicalService(context, {
        ...options,
        originalWorkOperationId: command.operationId,
        afterCommit: effect => { afterCommit.push(effect); },
        billingV2Create: { ...(p.serviceTemplate?{serviceTemplate:p.serviceTemplate}:{}),ownUnplanned, operationId: command.operationId, timeZone: command.timeZone, intent: billing,
          capture: { workAt: command.capturedAt, pricingIntent: p.pricingIntent } },
      });
      let run = await creator.create({ ...actor }, {
        operationId: command.operationId, fleetId: groups[0].id, title: p.title,
        driverUserId: snapshot.detail.driverUserId, vehicleAssetId: snapshot.detail.vehicleAssetId,
        trailerAssetId: snapshot.rigPackage?.components.find(c => c.role === "trailer")?.assetId ?? null,
        detailSelection: { version: 2, detailId: detailRef.id, detailVersion: detailRef.version,
          timeZone: command.timeZone, returnPolicy: route.returnPolicy },
        ...(runOrderSelection ? { runOrderSelection } : {}), routePlan: route,
        schedule: route.plannedWindow ? { plannedStartAt: new Date(route.plannedWindow.startAt).toISOString(),
          plannedEndAt: new Date(route.plannedWindow.endAt).toISOString(), timezone: route.plannedWindow.timeZone } : null,
        stops: fleetRouteOperationalStops(route, p.billing.billingSiteId, originId),
        billing: billing.choice === "new_ticket"
          ? { mode: "new_ticket", workTypeId: p.billing.serviceId, afeNumber: billing.afeNumber, workDate: billing.workDate }
          : { mode: "existing_ticket", workTypeId:p.billing.serviceId,ticketId: billing.ticket.id, afeNumber: billing.afeNumber, workDate: billing.workDate },
      });
      if(p.dispatchAfterCreate){
        const h=createHash("sha256").update(`${command.operationId}:confirmed-dispatch`).digest("hex"),dispatchId=`${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-8${h.slice(17,20)}-${h.slice(20,32)}`;
        run=await createFleetWorkCanonicalService(context,{...options,originalWorkOperationId:dispatchId,afterCommit:effect=>{afterCommit.push(effect);}}).action({...actor},run.id,{operationId:dispatchId,expectedVersion:run.version,action:"dispatch",source:"user_report",capturedAt:command.capturedAt});
      }
      const canonical: Canonical = { type: "canonical", kind: "activity", id: run.id, version: run.version };
      // Operational projection can omit private pricing; the trusted durable
      // result supplies the actual parent revision for the mapping receipt.
      const saved = state.runs.find(row => row.id === run.id)!;
      if (!saved.billingV2) throw new FleetError("fleet.billing_ticket_mismatch");
      const ticket: Canonical = { type: "canonical", kind: "ticket", id: saved.billingV2.ticketId,
        version: saved.billingV2.ticketRevisionAtBinding };
      return result([canonical, ticket], [
        { local: { type: "local", kind: "activity", id: p.activityId }, canonical },
        ...(billing.choice === "new_ticket" ? [{ local: p.billing.ticket as Extract<FleetWorkReference, {type: "local"}>, canonical: ticket }] : []),
      ]);
    }
    case "quantity.record": {
      const {
        original,
        ticket,
        activity: reference,
      } = await authorizeFleetOriginalDriverActivity(
        context,
        command.scope,
        command.payload.activity,
        command.payload.ticket,
      );
      const evidence = command.payload.evidence,
        fingerprint = fleetWorkFingerprint(command);
      const prior = await client.query(
        "SELECT user_id,tool_output FROM assistant_action_audit WHERE vendor_id=$1 AND target_type='fleet-work-quantity' AND target_id=$2 ORDER BY id DESC LIMIT 1",
        [actor.companyId, evidence.id],
      );
      if (prior.rows.length) {
        if (
          prior.rows[0].user_id !== actor.userId ||
          prior.rows[0].tool_output.fingerprint !== fingerprint
        )
          throw new FleetError("fleet.operation_conflict");
        return result([reference]);
      }
      const receivedAt = new Date().toISOString();
      const fact = {
        version: 2,
        scope: command.scope,
        operationId: command.operationId,
        fingerprint,
        activityId: original.id,
        activityVersion: original.version,
        ticketId: ticket.id,
        assignment: original.resourceAssignment?.snapshot??original.recoveredWork!.snapshot,
        evidence,
        capturedAt: command.capturedAt,
        timeZone: command.timeZone,
        receivedAt,
        clockStatus:
          Date.parse(command.capturedAt) > Date.parse(receivedAt) + 300000
            ? "ahead_of_server"
            : "reported_capture_time",
        officeReviewRequired: true,
        quantitySourceVerified: false,
      };
      await client.query(
        "INSERT INTO assistant_action_audit(user_id,vendor_id,client_surface,input_mode,provider,tool_name,action_type,target_type,target_id,tool_output,result_status) VALUES($1,$2,'fleet','typed','canonical','fleet_work','quantity-reported','fleet-work-quantity',$3,$4::jsonb,'completed')",
        [actor.userId, actor.companyId, evidence.id, JSON.stringify(fact)],
      );
      // Capturing a reported billable/accepted/conversion value is not its
      // office endorsement, a charge, a physical event or ticket reopening.
      return result([reference]);
    }
    case "evidence.stage":
    case "compliance.document.stage": {
      const pointerRows = await client.query(
        "SELECT user_id,tool_output FROM assistant_action_audit WHERE vendor_id=$1 AND target_type='fleet-evidence-upload-operation' AND target_id=$2 ORDER BY id DESC LIMIT 1",
        [actor.companyId, command.operationId],
      );
      const pointer = pointerRows.rows[0];
      if (!pointer) throw new FleetError("fleet.work_dependency_unresolved");
      const binding = z
        .object({ scope: FleetWorkScopeSchema, sessionId: z.uuid() })
        .strict()
        .parse(pointer.tool_output);
      if (
        pointer.user_id !== actor.userId ||
        !isDeepStrictEqual(binding.scope, command.scope)
      )
        throw new FleetError("fleet.work_scope_changed", 403);
      const rows = await client.query(
        "SELECT user_id,tool_output FROM assistant_action_audit WHERE vendor_id=$1 AND target_type='fleet-evidence-upload-session' AND target_id=$2 ORDER BY id DESC LIMIT 1",
        [actor.companyId, binding.sessionId],
      );
      const row = rows.rows[0];
      if (!row) throw new FleetError("fleet.work_dependency_unresolved");
      const upload = FleetEvidenceUploadSessionSchema.parse(row.tool_output);
      if (
        row.user_id !== actor.userId ||
        !isDeepStrictEqual(upload.scope, command.scope)
      )
        throw new FleetError("fleet.work_scope_changed", 403);
      if (
        upload.fingerprint !== fleetWorkFingerprint(command) ||
        command.payload.evidence.type !== "local" ||
        command.payload.evidence.id !== upload.localEvidenceId
      )
        throw new FleetError("fleet.operation_conflict");
      if (!upload.completion)
        throw new FleetError("fleet.work_dependency_unresolved");
      const canonical: Canonical = {
        type: "canonical",
        kind: "evidence",
        id: upload.canonicalEvidenceId,
        version: 1,
      };
      return result(
        [canonical],
        [
          {
            local: {
              type: "local",
              kind: "evidence",
              id: upload.localEvidenceId,
            },
            canonical,
          },
        ],
      );
    }
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
    case "activity.edit": {
      const current = await activity(command.payload.activity), ticket = await mapped(command.payload.ticket);
      if (ticket.kind !== "ticket" || current.run.linkedTicketId !== ticket.id)
        throw new FleetError("fleet.ticket_link_changed", 409);
      // A local mapping retains its creation receipt forever. The original
      // edit carries its own exact CAS revision; do not rewrite that mapping
      // or mistake its initial version for every later queued edit's version.
      if ((command.payload.activity.type === "canonical" && current.run.version !== current.reference.version) || current.run.version !== command.payload.edit.expectedVersion)
        throw new FleetError("fleet.version_conflict", 409);
      if (!fleetDetailSnapshotIdentityMatches(current.run.resourceAssignment?.snapshot, command.payload.baseAssignment))
        throw new FleetError("fleet.assignment_changed", 409);
      const saved = await service.editDraft({ ...actor }, current.run.id, command.payload.edit);
      return result([{ type: "canonical", kind: "activity", id: saved.id, version: saved.version }]);
    }
    case "activity.action": {
      const current = await activity(command.payload.activity),
        ticket = await mapped(command.payload.ticket);
      if (ticket.kind !== "ticket" || current.run.linkedTicketId !== ticket.id)
        throw new FleetError("fleet.ticket_link_changed", 409);
      if (
        !fleetDetailSnapshotIdentityMatches(
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
      const original=(await client.query("SELECT tool_output FROM assistant_action_audit WHERE vendor_id=$1 AND target_type='fleet-run' AND target_id=$2 AND tool_output->>'version'=$3 ORDER BY id DESC LIMIT 1",[actor.companyId,run.id,String(payload.base.version)])).rows[0]?.tool_output;
      const originalRun=original?FleetRunSchema.parse(original):run.version===payload.base.version?run:null;
      if(!originalRun||originalRun.driverUserId!==payload.base.driverUserId||originalRun.vehicleAssetId!==payload.base.vehicleAssetId||originalRun.trailerAssetId!==payload.base.trailerAssetId||originalRun.linkedTicketId!==payload.ticket.id||run.version!==payload.action.expectedVersion)
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
    case "compliance.receive": {
      const source = structuredClone(command.payload.source),
        document = command.payload.documentReference;
      if (document) {
        if (source.reusePriorDocument)
          throw new FleetError("fleet.document_choice_required", 400);
        const reference = await mapped(document);
        const rows = await client.query(
          "SELECT tool_output FROM assistant_action_audit WHERE vendor_id=$1 AND target_type='fleet-evidence-upload-session' AND tool_output->>'canonicalEvidenceId'=$2 ORDER BY id DESC LIMIT 1",
          [actor.companyId, reference.id],
        );
        if (!rows.rows.length)
          throw new FleetError("fleet.work_dependency_unresolved");
        const upload = FleetEvidenceUploadSessionSchema.parse(
          rows.rows[0].tool_output,
        );
        if (
          upload.scope.owner.type !== "vendor" ||
          upload.scope.owner.id !== actor.companyId ||
          upload.binding.kind !== "compliance" ||
          upload.binding.recordId !== source.record.evidence.id ||
          !isDeepStrictEqual(
            upload.binding.subject,
            source.record.evidence.subject,
          )
        )
          throw new FleetError("fleet.evidence_identity_conflict");
        if (upload.binding.expectedRecordVersion !== source.expectedVersion)
          throw new FleetError("fleet.version_conflict");
        if (!upload.completion)
          throw new FleetError("fleet.work_dependency_unresolved");
        if (
          source.record.evidence.privateDocumentRef !== null &&
          source.record.evidence.privateDocumentRef !==
            upload.completion.objectPath
        )
          throw new FleetError("fleet.evidence_identity_conflict");
        source.record.evidence.privateDocumentRef =
          upload.completion.objectPath;
      }
      await service.saveFleetComplianceEvidence({ ...actor }, source);
      return result();
    }
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
