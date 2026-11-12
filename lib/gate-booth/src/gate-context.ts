import {haversineMeters} from '@workspace/map-utils';
export type GateLocationCandidate={id:string;siteId:number;active?:boolean;latitude?:number|null;longitude?:number|null;geofenceRadiusM?:number|null};
export type GateLocationObservation={latitude:number;longitude:number;accuracy:number;observedAt:number};
/** A suggestion only: assignment/watch authorization remains server-side. */
export function suggestGateFromGps(gates:GateLocationCandidate[],gps:GateLocationObservation|null,now=Date.now()){
 if(!gps||![gps.latitude,gps.longitude,gps.accuracy,gps.observedAt].every(Number.isFinite)||gps.accuracy<0||gps.accuracy>100||now-gps.observedAt>60000||gps.observedAt>now+5000)return null;
 const candidates=gates.filter(g=>g.active!==false&&g.latitude!=null&&g.longitude!=null&&haversineMeters(gps.latitude,gps.longitude,g.latitude,g.longitude)+gps.accuracy<=(g.geofenceRadiusM??500));
 return candidates.length===1?candidates[0]:null;
}
