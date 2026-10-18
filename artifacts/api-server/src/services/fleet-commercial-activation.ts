type ActivationEnvironment={FLEET_COMMERCIAL_WORK_V2?:string;FLEET_COMMERCIAL_WORK_V2_VENDOR_IDS?:string};
/** Private acceptance companies use the same authority checks as the general release. */
export function fleetCommercialCompanyIds(env:ActivationEnvironment=process.env):number[]{
 return [...new Set((env.FLEET_COMMERCIAL_WORK_V2_VENDOR_IDS??"").split(",").map(value=>value.trim()).filter(value=>/^[1-9]\d*$/.test(value)).map(Number).filter(Number.isSafeInteger))];
}
export function isFleetCommercialWorkEnabled(companyId:number|undefined,env:ActivationEnvironment=process.env):boolean{
 return Number.isSafeInteger(companyId)&&Number(companyId)>0&&(env.FLEET_COMMERCIAL_WORK_V2==="1"||fleetCommercialCompanyIds(env).includes(companyId!));
}
