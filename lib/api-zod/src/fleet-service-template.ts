import {z} from "zod/v4";
import {FleetOperationalProfileSchema,type FleetOperationalProfile} from "./fleet-planning";
import {FleetPricingBasisSchema} from "./fleet-pricing";
export const FLEET_WORK_FAMILIES=["crude_condensate","water_brine_flowback","vacuum_pump_recovery","equipment_heavy_haul","hotshot_materials","bulk_aggregate","support_resupply","authorized_waste_disposal","towing_recovery","vendor_defined"] as const;
export const FleetWorkFamilySchema=z.enum(FLEET_WORK_FAMILIES);
const words=z.array(z.string().trim().min(1).max(120)).max(50);
/** A starting configuration for an existing offered catalog service. Neither an
 * offering, a negotiated rate, regulatory classification nor an access grant. */
export const FleetServiceTemplateSchema=z.object({serviceId:z.number().int().positive(),revision:z.number().int().nonnegative(),family:FleetWorkFamilySchema,name:z.string().trim().min(1).max(100),enabled:z.boolean(),commodities:words,capabilities:words,preferredBasis:FleetPricingBasisSchema.nullable(),profile:FleetOperationalProfileSchema}).strict();
export type FleetServiceTemplate=z.infer<typeof FleetServiceTemplateSchema>;
export function fleetServiceTemplateBasisLabel(basis:z.infer<typeof FleetPricingBasisSchema>,language="en"){
 const es:Record<z.infer<typeof FleetPricingBasisSchema>,string>={per_job:"Por trabajo",per_hour:"Por hora",per_day:"Por día",lump_sum:"Suma global",per_load:"Por carga",per_mile:"Por milla",per_barrel:"Por barril",per_us_gallon:"Por galón estadounidense",per_short_ton:"Por tonelada corta"};
 return language.startsWith("es")?es[basis]:basis.replaceAll("_"," ");
}
export const FleetServiceTemplateSaveSchema=z.object({operationId:z.uuid(),expectedRevision:z.number().int().nonnegative(),template:FleetServiceTemplateSchema}).strict();
export const FleetServiceTemplatePageSchema=z.object({services:z.array(z.object({serviceId:z.number().int().positive(),name:z.string(),template:FleetServiceTemplateSchema.nullable()}).strict()),canManage:z.boolean()}).strict();
const defaults:Record<typeof FLEET_WORK_FAMILIES[number],{commodities:string[];capabilities:string[];preferredBasis:z.infer<typeof FleetPricingBasisSchema>|null}>={
 crude_condensate:{commodities:["Crude","Condensate"],capabilities:["Tank transport"],preferredBasis:"per_barrel"},
 water_brine_flowback:{commodities:["Water","Produced water","Brine","Flowback"],capabilities:["Tank transport"],preferredBasis:"per_barrel"},
 vacuum_pump_recovery:{commodities:[],capabilities:["Vacuum","Pump"],preferredBasis:"per_hour"},
 equipment_heavy_haul:{commodities:["Equipment"],capabilities:["Equipment transport"],preferredBasis:"per_load"},
 hotshot_materials:{commodities:["Parts","Materials"],capabilities:["Cargo securement"],preferredBasis:"per_job"},
 bulk_aggregate:{commodities:["Sand","Aggregate"],capabilities:["Bulk transport"],preferredBasis:"per_short_ton"},
 support_resupply:{commodities:[],capabilities:["Service","Resupply"],preferredBasis:"per_hour"},
 authorized_waste_disposal:{commodities:[],capabilities:["Reviewed disposal authorization"],preferredBasis:"per_load"},
 towing_recovery:{commodities:[],capabilities:["Recovery","Towing"],preferredBasis:"per_job"},
 vendor_defined:{commodities:[],capabilities:[],preferredBasis:null},
};
export function buildFleetServiceTemplate(input:{family:typeof FLEET_WORK_FAMILIES[number];serviceId:number;serviceName:string}):FleetServiceTemplate{return FleetServiceTemplateSchema.parse({serviceId:input.serviceId,revision:0,family:input.family,name:input.serviceName,enabled:false,...defaults[input.family],profile:{name:input.serviceName,inspectionItems:[{id:"vehicle_condition",label:"Truck and rig condition",required:false},{id:"load_securement",label:"Load securement / containment",required:false}],manifestFields:[{id:"material",label:"Actual reported material",required:false},{id:"reference",label:"Load / delivery reference",required:false}],evidenceRequirements:[{id:"condition_photo",label:"Condition photos",required:false,kind:"photo",scope:"run"},{id:"delivery_receipt",label:"Delivery receipt",required:false,kind:"receipt",scope:"each_load"}]}});}
/** Union requirements; a service template cannot clear an existing mandatory
 * group item or reinterpret the same evidence identity as a different kind. */
export function mergeFleetTemplateProfile(base:FleetOperationalProfile|undefined,template:FleetOperationalProfile):FleetOperationalProfile{
 if(!base)return FleetOperationalProfileSchema.parse(structuredClone(template));
 const merge=<T extends {id:string;label:string;required:boolean}>(prior:readonly T[],next:readonly T[]):T[]=>{
  const rows=new Map(prior.map(row=>[row.id,structuredClone(row)]));for(const row of next){const old=rows.get(row.id);if(old){if(old.label!==row.label||("kind" in old&&"kind" in row&&old.kind!==row.kind)||("scope" in old&&"scope" in row&&old.scope!==row.scope))throw Error("Template requirement identity conflicts with an existing requirement");rows.set(row.id,{...row,required:old.required||row.required});}else rows.set(row.id,structuredClone(row));}return [...rows.values()];
 };
 return FleetOperationalProfileSchema.parse({name:`${base.name} / ${template.name}`.slice(0,100),inspectionItems:merge(base.inspectionItems,template.inspectionItems),manifestFields:merge(base.manifestFields,template.manifestFields),evidenceRequirements:merge(base.evidenceRequirements??[],template.evidenceRequirements??[])});
}
export function fleetServiceTemplateLabels(language="en"){
 const es=language.startsWith("es");return {title:es?"Plantillas de trabajo":"Work templates",service:es?"Servicio ofrecido":"Offered service",choose:es?"Elegir":"Choose",family:es?"Punto de partida":"Starting family",name:es?"Nombre de plantilla":"Template name",material:es?"Materiales (uno por línea)":"Commodities (one per line)",capabilities:es?"Capacidades (una por línea)":"Capabilities (one per line)",basis:es?"Base sugerida (no aprobada)":"Suggested basis (not approved)",enabled:es?"Usar en nuevas actividades de este servicio":"Use on new activities for this service",save:es?"Revisar y guardar plantilla":"Review and save template",retry:es?"Reintentar la misma plantilla":"Retry the same template",read:es?"Actualizar plantillas":"Refresh templates",pending:es?"Guardada en el dispositivo; pendiente de confirmación del servidor.":"Saved on this device; canonical confirmation is pending.",saved:es?"Revisión de plantilla verificada. Los recorridos anteriores no cambian.":"Template revision verified. Earlier runs are unchanged.",unavailable:es?"No se pudieron verificar las plantillas. Los originales se conservan.":"Templates could not be verified. Originals remain retained.",noServices:es?"Primero agregue el servicio a su catálogo. Las plantillas no crean ofertas ni permisos.":"Add the service to your catalog first. Templates never create offerings or permissions.",hint:es?"Puntos de partida desactivados. Edite material, capacidad, evidencia y base por separado. No aprueban tarifas ni clasifican legalmente la carga.":"Starting points are disabled. Edit commodity, capability, evidence and basis separately. They neither approve rates nor legally classify cargo.",connect:es?"Se necesita el contexto autorizado de Fleet para guardar. No se envía una solicitud alternativa.":"Saving needs the authorized Fleet work context. No alternative request is sent.",families:Object.fromEntries(FLEET_WORK_FAMILIES.map((id,index)=>[id,(es?["Crudo y condensado","Agua, salmuera y retorno","Vacío, bombeo y recuperación","Equipo y transporte pesado","Refacciones y materiales","Granel y agregados","Apoyo y reabastecimiento","Residuos y disposición autorizada","Remolque y recuperación","Definida por el proveedor"]:["Crude and condensate","Water, brine and flowback","Vacuum, pump and recovery","Equipment and heavy haul","Hotshot, parts and materials","Bulk and aggregate","Support and resupply","Authorized waste and disposal","Towing and recovery","Vendor defined"])[index]]))};
}
