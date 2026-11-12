import type { GateAreaTrafficResponse } from "@workspace/gate-booth";
import { changeOverRequest } from "./change-over-api";
export { parallelGateGroup, gateCheckInDestinationDefaults } from "@workspace/gate-booth";
export const readGateAreaTraffic = (siteId:number) => changeOverRequest<GateAreaTrafficResponse>('/movements?siteId=' + siteId);
export type GateMovementCommand = {siteId:number;gateId:string;visitId:number;operationId:string;kind:'enter'|'leave'|'route';destinationGateId?:string|null;destination?:'site_exit'|'remain';destinationId?:string};
/** Site exit uses gatekeeper checkout with GPS evidence, not an internal movement.
 * Keep operationId for a retry; never generate a second action on a timeout. */
export const recordGateMovement = (command:GateMovementCommand) => changeOverRequest('/movements', command);
