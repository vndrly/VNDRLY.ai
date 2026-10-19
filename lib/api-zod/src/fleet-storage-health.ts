import {z} from "zod/v4";
export const FLEET_STORAGE_RESERVE_BYTES=64*1024*1024;
const bytes=z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const FleetStorageHealthSchema=z.object({state:z.enum(["ready","low","unknown"]),availableBytes:bytes.nullable(),reserveBytes:bytes,retainedEvidenceBytes:bytes,evidenceCount:bytes}).strict();
export type FleetStorageHealth=z.infer<typeof FleetStorageHealthSchema>;
export function assessFleetStorageHealth(input:Omit<FleetStorageHealth,"state">):FleetStorageHealth{
 return FleetStorageHealthSchema.parse({...input,state:input.availableBytes===null?"unknown":input.availableBytes<input.reserveBytes?"low":"ready"});
}
export function fleetStorageHealthMessage(health:FleetStorageHealth,language="en"){
 if(health.state==="ready")return "";
 if(language.startsWith("es"))return health.state==="low"?"Poco espacio en el dispositivo. No se borra trabajo pendiente. Puede seguir registrando datos mientras se puedan guardar; una foto solo se confirma después de guardar sus bytes.":"No se pudo medir el espacio disponible. Se conserva el trabajo pendiente; los datos nuevos solo se confirman después de guardarse.";
 return health.state==="low"?"Device storage is low. Pending work is never deleted. Keep recording facts while storage permits; a photo is confirmed only after its bytes are saved.":"Available storage could not be measured. Pending work remains retained; new facts are confirmed only after storage commits.";
}
