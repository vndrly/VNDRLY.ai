import { FLEET_REPLACEMENT_ACTIONS } from "./fleet-replacement-tools";
import { FleetReplacementInputSchema, FleetReplacementActionSchema } from "@workspace/api-zod";
import { FLEET_CARGO_ACTIONS } from "./fleet-cargo-tools";
import { TICKET_RECORD_ACTIONS } from "./ticket-workflow-tools";
import { z } from "zod/v4";
import { FleetCargoTransferInputSchema, FleetCargoTransferActionSchema, FleetDraftEditSchema, AssetCustodyCommandSchema, CreateFleetRunSchema, FleetActionInputSchema, FleetSetupInputSchema, FleetWorkspacePreferenceInputSchema,FleetMaintenanceCreateSchema,FleetMaintenanceActionSchema,FleetSavedViewInputSchema,FleetGateLinkInputSchema } from "@workspace/api-zod";

/** Separate write consent never follows from a read grant. */
export const CHATGPT_WRITE_CAPABILITIES = {
  "fleet:maintenance": {label:"Prepare Fleet Manager maintenance and explicitly permitted hold release; no physical certification",tools:["manage_fleet_maintenance","report_fleet_defect"]},
  "fleet:admin":{label:"Prepare current company administrator Fleet settings and explicit role grants",tools:["manage_fleet_settings"]},
  "fleet:dispatch": { label: "Prepare explicitly authorized Fleet dispatch actions", tools: ["prepare_fleet_equipment_replacement","cancel_fleet_equipment_replacement","prepare_fleet_cargo_transfer","complete_fleet_cargo_transfer","cancel_fleet_cargo_transfer","edit_fleet_draft","manage_fleet_run","set_fleet_preferences","manage_fleet_saved_view","reconcile_fleet_gate_visit"] },
  "fleet:run": { label: "Prepare own assigned Fleet acknowledgement, user-reported inspection, stops, load/delivery and closeout", tools: ["accept_fleet_equipment_replacement","acknowledge_fleet_cargo_source","acknowledge_fleet_cargo_recipient","report_fleet_defect","acknowledge_fleet_assignment", "transition_fleet_run","set_fleet_preferences","manage_fleet_saved_view","reconcile_fleet_gate_visit"] },
  "fleet:review": { label: "Prepare Fleet Manager closeout review; no ticket or financial approval", tools: ["review_fleet_closeout"] },
  "finance:write": { label: "Prepare recording or reversing ticket payment records with current Accounts Payable authority; never transfer money", tools: ["record_ticket_payment", "reverse_ticket_payment_record"] },
  "workforce:write": { label: "Prepare authorized shift assignments, acknowledgements, and coverage evaluation or escalation", tools: ["confirm_workforce_coverage_action"] },
  "trips:write": { label: "Prepare authorized trip start, pause, driver resume, completion, or one approval-device location update; never start a device collector", tools: ["confirm_field_trips_action"] },
  "safety:write": { label: "Prepare authorized incident response, acknowledgement, evidence, escalation, and closure", tools: ["confirm_incident_response_action"] },
  "subscriptions:write": { label: "Prepare vendor administrator worker subscription creation, pause, termination, or reactivation", tools: ["confirm_worker_subscriptions_action"] },
  "assets:write": { label: "Prepare authorized asset creation, checkout, return, transfer, condition, and hold changes", tools: ["confirm_asset_custody_action"] },
  "invitations:write": { label: "Prepare vendor administrator account invitation creation, resends, and revocation", tools: ["confirm_account_invitations_action"] },
  "onboarding:write": { label: "Prepare your onboarding field changes and completion for authenticated approval", tools: ["start_onboarding", "set_onboarding_field", "complete_onboarding_step", "finalize_onboarding"] },
  "tickets:write": { label: "Prepare authorized ticket creation, edits, assignments, acknowledgements, line items, lifecycle changes, and role-appropriate review", tools: ["manage_ticket_record", "acknowledge_ticket_assignment", "schedule_ticket_crew", "set_ticket_flag", "post_ticket_comment", "set_ticket_lifecycle", "close_ticket_for_review"] },
  "operations:write": { label: "Prepare changes to your notification read status", tools: ["mark_notifications_read"] },
} as const;
export type ChatGptWriteCapabilityScope = keyof typeof CHATGPT_WRITE_CAPABILITIES;

/** Device telemetry and domain replay keys are supplied by the approval server. */
export function sanitizeChatGptActionInput(name: string, input: Record<string, unknown>): Record<string, unknown> {
  if (name === "manage_ticket_record") {
    const payload = input.payload && typeof input.payload === "object" && !Array.isArray(input.payload) ? input.payload as Record<string, unknown> : {};
    const serverFields = new Set(["latitude", "longitude", "checkInLatitude", "checkInLongitude", "accuracyMeters", "recordedAt", "operationId", "confirmed", "idempotencyKey", "locationSharingActive"]);
    return { ...input, payload: { ...Object.fromEntries(Object.entries(payload).filter(([key]) => !serverFields.has(key))), ...(input.action === "create" ? { initialState: "pending_arrival" } : {}) } };
  }
  if (!/^confirm_(field_trips|workforce_coverage|worker_subscriptions|incident_response|account_invitations)_action$/.test(name)) return input;
  const payload = input.payload && typeof input.payload === "object" && !Array.isArray(input.payload) ? input.payload as Record<string, unknown> : {};
  const fields = new Set(["operationId", "confirmed", ...(name === "confirm_incident_response_action" ? ["latitude", "longitude", "attachmentPaths"] : []), ...(name === "confirm_field_trips_action" ? ["latitude", "longitude", "accuracyMeters", "recordedAt", "speedMps"] : [])]);
  return { ...input, payload: Object.fromEntries(Object.entries(payload).filter(([key]) => !fields.has(key))) };
}

/** Legal acceptance and credential changes use the dedicated VNDRLY screens.
 * Model-supplied acceptance flags never stand in for the person's action.
 */
export function validateChatGptActionInput(name: string, input: Record<string, unknown>): void {
  if(name==="reconcile_fleet_gate_visit"){z.uuid().parse(input.runId);FleetGateLinkInputSchema.parse({operationId:"00000000-0000-4000-8000-000000000001",expectedVersion:input.expectedVersion,stopId:input.stopId,visitId:input.visitId,reason:input.reason});}
  if(name==="manage_fleet_saved_view")FleetSavedViewInputSchema.parse({operationId:"00000000-0000-4000-8000-000000000001",viewId:input.viewId,expectedVersion:input.expectedVersion,action:input.action,name:input.name,filters:input.filters});
  if(["report_fleet_defect","manage_fleet_maintenance"].includes(name)){
    const operationId="00000000-0000-4000-8000-000000000001";
    if(name==="report_fleet_defect"||input.action==="create")FleetMaintenanceCreateSchema.parse({operationId,fleetId:input.fleetId,assetId:input.assetId,runId:input.runId,kind:name==="report_fleet_defect"?"defect":"scheduled_service",title:input.title,notes:input.notes,dueAt:input.dueAt});
    else {z.uuid().parse(input.maintenanceId);FleetMaintenanceActionSchema.parse({operationId,expectedVersion:input.expectedVersion,action:input.action,notes:input.notes});}
  }
  if (name === "prepare_fleet_equipment_replacement") { z.uuid().parse(input.runId); FleetReplacementInputSchema.parse({ operationId: "00000000-0000-4000-8000-000000000001", expectedVersion: input.expectedVersion, vehicleAssetId: input.vehicleAssetId, trailerAssetId: input.trailerAssetId, reason: input.reason }); }
  if (FLEET_REPLACEMENT_ACTIONS[name]) { if (input.action !== undefined && input.action !== FLEET_REPLACEMENT_ACTIONS[name]) throw new Error("Named replacement operation conflicts with supplied action."); z.uuid().parse(input.runId); z.uuid().parse(input.replacementId); FleetReplacementActionSchema.parse({ operationId: "00000000-0000-4000-8000-000000000001", expectedVersion: input.expectedVersion, runExpectedVersion: input.runExpectedVersion, notes: input.notes, action: FLEET_REPLACEMENT_ACTIONS[name] }); }
  if(name==="prepare_fleet_cargo_transfer"){const {operationId,confirmed,...fields}=input;FleetCargoTransferInputSchema.parse({...fields,operationId:"00000000-0000-4000-8000-000000000001"});}
  if(FLEET_CARGO_ACTIONS[name]){if(input.action!==undefined&&input.action!==FLEET_CARGO_ACTIONS[name])throw new Error("Named cargo operation conflicts with supplied action.");z.uuid().parse(input.transferId);FleetCargoTransferActionSchema.parse({operationId:"00000000-0000-4000-8000-000000000001",expectedVersion:input.expectedVersion,sourceExpectedVersion:input.sourceExpectedVersion,targetExpectedVersion:input.targetExpectedVersion,notes:input.notes,action:FLEET_CARGO_ACTIONS[name]});}
  if(name==="edit_fleet_draft"){ z.uuid().parse(input.runId);FleetDraftEditSchema.parse({operationId:"00000000-0000-4000-8000-000000000001",expectedVersion:input.expectedVersion,title:input.title,schedule:input.schedule,stops:input.stops}); }
  if(name==="set_fleet_preferences")FleetWorkspacePreferenceInputSchema.parse({expectedVersion:input.expectedVersion,defaultWorkspace:input.defaultWorkspace,selectedFleetId:input.selectedFleetId});
  if(name==="manage_fleet_settings")FleetSetupInputSchema.parse({expectedVersion:input.expectedVersion,enabled:input.enabled,fleets:input.fleets,grants:input.grants,supportGrants:input.supportGrants});
  if(["manage_fleet_run","acknowledge_fleet_assignment","transition_fleet_run","review_fleet_closeout"].includes(name)){
    const keys=["expectedVersion","action","fleetId","title","driverUserId","vehicleAssetId","trailerAssetId","stops","schedule","inspectionResponses","manifestValues","reason","stopId","inspectionOutcome","notes","loadId","commodity","quantity","unit","manifestReference","deliveryReference","decision","capturedAt","source","reading","ticketId"];
    const fields=Object.fromEntries(keys.filter(key=>input[key]!==undefined).map(key=>[key,input[key]]));
    const operationId="00000000-0000-4000-8000-000000000001";
    if(name==="manage_fleet_run"&&input.action==="create"){const {action,expectedVersion,...create}=fields;CreateFleetRunSchema.parse({...create,operationId});}
    else { z.uuid().parse(input.runId);FleetActionInputSchema.parse({...fields,operationId,action:name==="acknowledge_fleet_assignment"?"acknowledge":name==="review_fleet_closeout"?"review":input.action}); }
  }
  const allowed: Record<string, readonly string[]> = {
    manage_fleet_run: ["create","dispatch","reassign","cancel","link_ticket"],
    transition_fleet_run: ["inspect","start","arrive_stop","depart_stop","record_load","record_delivery","submit_closeout","pause","resume","record_fuel","record_meter"],
    manage_ticket_record: TICKET_RECORD_ACTIONS,
    confirm_workforce_coverage_action: ["assign", "acknowledge", "evaluate", "escalate"],
    confirm_field_trips_action: ["start", "location", "pause", "resume", "complete"],
    confirm_incident_response_action: ["report", "create", "escalate", "acknowledge", "evidence", "hold", "close"],
    confirm_worker_subscriptions_action: ["create", "pause", "terminate", "reactivate"],
    confirm_account_invitations_action: ["create", "resend", "revoke"],
  };
  if (allowed[name] && !allowed[name].includes(String(input.action))) throw new Error("Unsupported VNDRLY action");
  if (name === "confirm_incident_response_action" && input.action === "report") {
    const payload = input.payload && typeof input.payload === "object" && !Array.isArray(input.payload) ? input.payload as Record<string, unknown> : {};
    if (!z.object({ siteLocationId: z.number().int().positive(), title: z.string().trim().min(1).max(200), description: z.string().max(4000).optional(), isStopWork: z.boolean().optional(), isHighPotential: z.boolean().optional(), isAnonymous: z.boolean().optional(), ticketId: z.number().int().positive().optional(), vendorId: z.number().int().positive().optional(), eventType: z.enum(["near_miss", "unsafe_condition", "unsafe_act", "injury", "property_damage", "observation"]) }).safeParse(payload).success) throw new Error("Supply the actual site, report title and supported event type before preparing a safety report.");
  }
  if (name === "confirm_asset_custody_action" && input.action === "release_hold") {
    const payload = input.payload as Record<string, unknown> | undefined;
    z.uuid().parse(input.assetId ?? input.resourceId); z.uuid().parse(payload?.holdId);
    if (!Number.isSafeInteger(input.expectedVersion) || Number(input.expectedVersion) < 1 || typeof payload?.reason !== "string" || !payload.reason.trim() || payload.reason.trim().length > 2000) throw new Error("Supply current asset version, exact Inventory hold and actual release reason.");
  }
  if (name === "confirm_asset_custody_action" && ["checkout", "return", "transfer", "verify-issued"].includes(String(input.action))) {
    const payload = input.payload && typeof input.payload === "object" && !Array.isArray(input.payload) ? input.payload as Record<string, unknown> : {};
    const custody = AssetCustodyCommandSchema.omit({ operationId: true, confirmed: true });
    const schema = input.action === "transfer" ? custody.extend({ toHolderUserId: z.number().int().positive() }) : custody;
    if (!schema.safeParse({ ...payload, expectedVersion: input.expectedVersion }).success) throw new Error("Supply the current asset version and an explicitly known condition before preparing custody changes. Ask for missing condition; never invent it. Check required photos and return time against the actual asset policy.");
  }
  if (input.action === "create" && (name === "manage_work_hub_meeting" || (name === "manage_work_hub_calendar_item" && ["meeting", "event"].includes(String(input.kind))))) {
    const payload = input.payload && typeof input.payload === "object" && !Array.isArray(input.payload) ? input.payload as Record<string, unknown> : {};
    const timestamp = (value: unknown) => z.iso.datetime().safeParse(value).success;
    if ("startAt" in payload || "endAt" in payload || !timestamp(payload.startsAt) || (payload.endsAt != null && !timestamp(payload.endsAt))) throw new Error("Use payload.startsAt and optional payload.endsAt as UTC ISO timestamps ending in Z; startAt/endAt are not supported");
    if (typeof payload.title !== "string" || !payload.title.trim() || payload.title.trim().length > 200 || typeof payload.timezone !== "string" || payload.timezone.length < 3 || payload.timezone.length > 80) throw new Error("Supply the exact meeting title and timezone before preparing it");
    if (payload.endsAt != null && Date.parse(String(payload.endsAt)) <= Date.parse(String(payload.startsAt))) throw new Error("The meeting end must follow its start");
  }
  if (name === "complete_onboarding_step" && input.step === "set-password") throw new Error("Complete password setup on the VNDRLY credential screen");
  if (name !== "set_onboarding_field") return;
  const path = input.path;
  if (typeof path !== "string" || !path || path.split(".").some(part =>
    !part || ["__proto__", "prototype", "constructor"].includes(part) ||
    /password|secret|token|credential/i.test(part))) throw new Error("Invalid onboarding field");
  if (["platformEula", "legalConsent"].includes(path.split(".")[0])) {
    throw new Error("Complete legal and messaging consent on the VNDRLY onboarding screen");
  }
  const value = input.value;
  const primitive = (item: unknown) => typeof item === "string" || typeof item === "boolean" || (typeof item === "number" && Number.isFinite(item));
  if (!primitive(value) && !(Array.isArray(value) && value.every(primitive))) throw new Error("Supply one exact onboarding field value");
}

/** Audit the changed field, without copying private onboarding values into logs. */
export function chatGptActionAuditInput(name: string, input: Record<string, unknown>): Record<string, unknown> {
  if (name === "confirm_incident_response_action") return { action: input.action, resourceId: input.resourceId ?? input.eventId, payload: "[redacted]" };
  return name === "set_onboarding_field" ? { path: input.path, value: "[redacted]" } : input;
}
export function chatGptActionResult(name: string, output: unknown): unknown {
  if (name === "confirm_incident_response_action" && output && typeof output === "object" && !Array.isArray(output)) {
    const record = output as Record<string, unknown>;
    if (record.success === true && record.data && typeof record.data === "object" && !Array.isArray(record.data)) {
      const event = record.data as Record<string, unknown>;
      return { ok: true, ...Object.fromEntries(["id", "eventNumber", "status", "isStopWork", "siteLocationId"].filter(key => key in event).map(key => [key, event[key]])) };
    }
    return Object.fromEntries(["ok", "error", "code", "status", "id", "eventId", "responseId", "persisted", "responseStatus", "severity", "acknowledgedAt", "closedAt"].filter(key => key in record).map(key => [key, record[key]]));
  }
  if (name === "confirm_field_trips_action" && output && typeof output === "object" && !Array.isArray(output)) return { ...output, trackingCollectorStarted: false };
  if (name === "finalize_onboarding" && output && typeof output === "object" && !Array.isArray(output)) {
    const record = output as Record<string, unknown>;
    let response: unknown;
    try { response = typeof record.response === "string" ? JSON.parse(record.response) : record.response ?? record.progress; } catch { response = null; }
    const progress = response && typeof response === "object" && !Array.isArray(response) ? response as Record<string, unknown> : {};
    return { ...Object.fromEntries(["ok", "error", "code"].filter(key => key in record).map(key => [key, record[key]])),
      progress: Object.fromEntries(["orgType", "currentStep", "completedSteps", "skippedSteps", "completedAt"].filter(key => key in progress).map(key => [key, progress[key]])) };
  }
  if (name !== "set_onboarding_field" || !output || typeof output !== "object" || Array.isArray(output)) return output;
  const { value: _value, ...result } = output as Record<string, unknown>;
  return result;
}

