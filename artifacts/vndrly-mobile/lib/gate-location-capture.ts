import * as Location from "expo-location";
/** Bounds permission prompts as well as GPS lookup; cancellation ignores late OS results. */
export function captureGateObservation(signal:AbortSignal,timeoutMs=15000):Promise<{latitude:number;longitude:number;accuracy:number;observedAt:number}>{
 return new Promise((resolve,reject)=>{
  let settled=false;const finish=(error?:Error,value?:{latitude:number;longitude:number;accuracy:number;observedAt:number})=>{if(settled)return;settled=true;clearTimeout(timer);signal.removeEventListener("abort",cancel);error?reject(error):resolve(value!);};
  const cancel=()=>finish(new Error("cancelled"));const timer=setTimeout(()=>finish(new Error("timeout")),timeoutMs);signal.addEventListener("abort",cancel,{once:true});if(signal.aborted){cancel();return;}
  void (async()=>{try{const permission=await Location.requestForegroundPermissionsAsync();if(settled)return;if(permission.status!=="granted")throw new Error("denied");const {coords,timestamp}=await Location.getCurrentPositionAsync({});if(!Number.isFinite(coords.latitude)||!Number.isFinite(coords.longitude)||Math.abs(coords.latitude)>90||Math.abs(coords.longitude)>180)throw new Error("unavailable");finish(undefined,{latitude:coords.latitude,longitude:coords.longitude,accuracy:coords.accuracy??Infinity,observedAt:timestamp??0});}catch(error){finish(error instanceof Error?error:new Error("unavailable"));}})();
 });
}

export async function captureGatePosition(signal:AbortSignal,timeoutMs=15000){const {latitude,longitude}=await captureGateObservation(signal,timeoutMs);return {latitude,longitude};}
