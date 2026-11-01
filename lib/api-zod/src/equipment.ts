import { z } from "zod/v4";
import { AssetAliasSchema, AssetConditionSchema } from "./implementation-a/assets";

export const EquipmentTypeSchema = z.enum(["truck", "cab", "trailer", "towed_rig", "booth", "other"]);
export const EquipmentActivitySchema = z.enum(["en_route", "on_run", "in_yard", "working", "unassigned"]);
export const EquipmentObservationSchema = z.object({
  latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180),
  observedAt: z.iso.datetime({ offset: true }), source: z.enum(["manual", "device", "phone_report"]),
  label: z.string().trim().max(250).optional(), reportedByUserId: z.number().int().positive().optional(),
}).strict();
const photoUrls = z.array(z.string().trim().min(1).max(2000)).max(20);
const identity = { name: z.string().trim().min(1).max(200), manufacturer: z.string().trim().max(200).optional(), model: z.string().trim().max(200).optional() };
export const CreateEquipmentSchema = z.object({ ...identity, operationId: z.uuid().optional(), legalOwner: z.string().trim().min(1).max(250), equipmentType: EquipmentTypeSchema, trackOnMap: z.boolean().default(false), photoUrls: photoUrls.default([]), aliases: z.array(AssetAliasSchema).max(50).default([]) }).strict();
const command = { operationId: z.uuid(), expectedVersion: z.number().int().positive() };
export const UpdateEquipmentSchema = z.object({ ...command, name: identity.name.optional(), manufacturer: identity.manufacturer, model: identity.model, equipmentType: EquipmentTypeSchema.optional(), trackOnMap: z.boolean().optional(), photoUrls: photoUrls.optional() }).strict();
export const EquipmentOperationSchema = z.object({
  ...command, action: z.enum(["assign", "checkout", "return", "connect", "disconnect", "location"]),
  assignedUserId: z.number().int().positive().nullable().optional(), ticketId: z.number().int().positive().nullable().optional(), taskId: z.uuid().nullable().optional(),
  parentAssetId: z.uuid().optional(), activity: EquipmentActivitySchema.optional(), location: EquipmentObservationSchema.optional(),
  condition: AssetConditionSchema.default("good"), photos: photoUrls.default([]), expectedReturnAt: z.iso.datetime({ offset: true }).optional(), note: z.string().trim().max(2000).optional(),
}).strict().superRefine((input, ctx) => {
  if (input.action === "connect" && !input.parentAssetId) ctx.addIssue({ code: "custom", path: ["parentAssetId"], message: "Choose the connected equipment" });
  if (input.action === "location" && !input.location && !input.activity) ctx.addIssue({ code: "custom", path: ["location"], message: "Provide a location or activity" });
});
export type EquipmentType = z.infer<typeof EquipmentTypeSchema>;
export type EquipmentActivity = z.infer<typeof EquipmentActivitySchema>;
export type EquipmentObservation = z.infer<typeof EquipmentObservationSchema>;
export type CreateEquipmentInput = z.input<typeof CreateEquipmentSchema>;
export type UpdateEquipmentInput = z.infer<typeof UpdateEquipmentSchema>;
export type EquipmentOperation = z.input<typeof EquipmentOperationSchema>;
export type EquipmentHistoryEvent = {
  operationId: string; action: string; actorUserId: number; occurredAt: string; note?: string;
  parentAssetId?: string | null; assignedUserId?: number | null; ticketId?: number | null; taskId?: string | null;
  activity?: EquipmentActivity; location?: EquipmentObservation | null;
};
export type EquipmentProfile = {
  equipmentType: EquipmentType; trackOnMap: boolean; photoUrls: string[];
  assignedUserId: number | null; ticketId: number | null; taskId: string | null; parentAssetId: string | null;
  activity: EquipmentActivity; location: EquipmentObservation | null; history: EquipmentHistoryEvent[];
};
export type EquipmentLocation = Omit<EquipmentObservation, "source"> & {
  source: "manual" | "device" | "phone_report" | "connected_equipment" | "holder_phone";
  freshness: "fresh" | "last_known"; viaAssetId?: string; holderUserId?: number;
};
export type EquipmentItem = {
  id: string; name: string; category: string; legalOwner: string; manufacturer?: string; model?: string;
  status: string; version: number; holderUserId: number | null; currentHolderDisplayName: string | null;
  aliases: z.infer<typeof AssetAliasSchema>[]; profile: EquipmentProfile; location: EquipmentLocation | null;
  holds: { id: string; reason: string }[];
  policy: { photosRequiredOnCheckout: boolean; photosRequiredOnReturn: boolean; expectedReturnRequired: boolean; supervisorApprovalRequired: boolean };
  capabilities: { canManage: boolean; canCheckout: boolean; canReturn: boolean; canOperate: boolean };
};
export type EquipmentListResponse = { equipment: EquipmentItem[]; capabilities: { canManage: boolean } };
export type EquipmentOptions = {
  people: { id: number; label: string }[]; tickets: { id: number; label: string }[]; tasks: { id: string; label: string }[];
  sites: { id: number; label: string; latitude: number | null; longitude: number | null }[];
};

export const EquipmentHistoryEventSchema = z.object({ operationId: z.uuid(), action: z.string(), actorUserId: z.number().int(), occurredAt: z.iso.datetime({ offset: true }), note: z.string().optional(), parentAssetId: z.uuid().nullable().optional(), assignedUserId: z.number().int().nullable().optional(), ticketId: z.number().int().nullable().optional(), taskId: z.uuid().nullable().optional(), activity: EquipmentActivitySchema.optional(), location: EquipmentObservationSchema.nullable().optional() });
export const EquipmentProfileSchema = z.object({ equipmentType: EquipmentTypeSchema, trackOnMap: z.boolean(), photoUrls, assignedUserId: z.number().int().nullable(), ticketId: z.number().int().nullable(), taskId: z.uuid().nullable(), parentAssetId: z.uuid().nullable(), activity: EquipmentActivitySchema, location: EquipmentObservationSchema.nullable(), history: z.array(EquipmentHistoryEventSchema) });
export const EquipmentLocationSchema = EquipmentObservationSchema.omit({ source: true }).extend({ source: z.enum(["manual", "device", "phone_report", "connected_equipment", "holder_phone"]), freshness: z.enum(["fresh", "last_known"]), viaAssetId: z.uuid().optional(), holderUserId: z.number().int().optional() });
export const EquipmentItemSchema = z.object({ id: z.uuid(), name: z.string(), category: z.string(), legalOwner: z.string(), manufacturer: z.string().optional(), model: z.string().optional(), status: z.string(), version: z.number().int(), holderUserId: z.number().int().nullable(), currentHolderDisplayName: z.string().nullable(), aliases: z.array(AssetAliasSchema), profile: EquipmentProfileSchema, location: EquipmentLocationSchema.nullable(), holds: z.array(z.object({ id: z.uuid(), reason: z.string() })), policy: z.object({ photosRequiredOnCheckout: z.boolean(), photosRequiredOnReturn: z.boolean(), expectedReturnRequired: z.boolean(), supervisorApprovalRequired: z.boolean() }), capabilities: z.object({ canManage: z.boolean(), canCheckout: z.boolean(), canReturn: z.boolean(), canOperate: z.boolean() }) });
export const EquipmentListResponseSchema = z.object({ equipment: z.array(EquipmentItemSchema), capabilities: z.object({ canManage: z.boolean() }) });
export const EquipmentOptionsSchema = z.object({ people: z.array(z.object({ id: z.number().int(), label: z.string() })), tickets: z.array(z.object({ id: z.number().int(), label: z.string() })), tasks: z.array(z.object({ id: z.uuid(), label: z.string() })), sites: z.array(z.object({ id: z.number().int(), label: z.string(), latitude: z.number().nullable(), longitude: z.number().nullable() })) });
