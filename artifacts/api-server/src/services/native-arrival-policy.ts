import {haversineMeters} from "@workspace/map-utils";
import {NativeOperationError} from "./native-operations-policy";
export function requireMeasuredArrival(input:{latitude:number;longitude:number;accuracy:number;capturedAt:string},site:{latitude:number;longitude:number;siteRadiusMeters:number|null},now=Date.now()){
 const captured=Date.parse(input.capturedAt);
 if(!Number.isFinite(captured)||captured>now+5000||captured<now-60000||!Number.isFinite(input.accuracy)||input.accuracy<0)throw new NativeOperationError("native.arrival_location_stale",409);
 const radius=site.siteRadiusMeters??500;
 if(!Number.isFinite(input.latitude)||Math.abs(input.latitude)>90||!Number.isFinite(input.longitude)||Math.abs(input.longitude)>180||!Number.isFinite(site.latitude)||Math.abs(site.latitude)>90||!Number.isFinite(site.longitude)||Math.abs(site.longitude)>180||!Number.isFinite(radius)||radius<=0||haversineMeters(input.latitude,input.longitude,site.latitude,site.longitude)+input.accuracy>radius)throw new NativeOperationError("native.arrival_confirmation_required",409);
}
