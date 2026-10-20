import React,{useState} from "react";
import {Text,View} from "react-native";
import type {FleetActionInput,FleetRun} from "@workspace/api-zod";
import {useColors} from "@/hooks/useColors";
import {useFleetCopy} from "@/lib/fleet-copy";
import FleetRunAction from "./FleetRunAction";
import TogglePillButton from "./TogglePillButton";

type DriverRun=React.ComponentProps<typeof FleetRunAction>["run"] & Pick<FleetRun,"status"|"phase"|"allowedActions"|"inspections"|"records"|"visitedStopIds"|"activeReplacement"|"driverUserId"|"vehicleAssetId"|"trailerAssetId">;
export function nextDriverRunAction(run:DriverRun,pending:Partial<FleetActionInput>[]=[]):FleetActionInput["action"]|undefined{
 const allowed=run.allowedActions,has=(name:FleetActionInput["action"])=>allowed.includes(name);
 if(has("acknowledge"))return "acknowledge";
 if(has("start"))return "start";
 if(run.status==="acknowledged"||run.phase==="paused"&&!has("resume")){
  const inspection=run.inspections.at(-1);
  const currentInspection=run.inspections.length>(run.activeReplacement?.inspectionCount??0)&&inspection?.driverUserId===run.driverUserId&&inspection?.vehicleAssetId===run.vehicleAssetId&&inspection?.trailerAssetId===run.trailerAssetId;
  const reported=pending.filter(input=>input.action==="inspect").at(-1)?.inspectionOutcome??(currentInspection?inspection?.outcome:undefined);
  if(reported!=="passed"&&has("inspect"))return "inspect";
  if(has("record_meter"))return "record_meter";
 }
 if(has("resume"))return "resume";
 if(has("arrive_stop"))return "arrive_stop";
 const stop=run.stops.find(item=>item.id===run.currentStopId);
 if(stop?.kind==="pickup"&&!run.loads.some(load=>(load as {pickupStopId?:string}).pickupStopId===stop.id)&&has("record_load"))return "record_load";
 if(stop?.kind==="delivery"&&run.loads.some(load=>!load.deliveredAt&&!load.delivered&&!load.transferOut)&&has("record_delivery"))return "record_delivery";
 if(has("depart_stop"))return "depart_stop";
 if(has("submit_closeout"))return "submit_closeout";
 if(run.status==="in_progress"&&run.visitedStopIds.length>=run.stops.length&&has("record_meter"))return "record_meter";
}
export default function FleetDriverRun({run,pendingActions=[],disabled,onSubmit,photo}:{run:DriverRun;pendingActions?:Partial<FleetActionInput>[];disabled:boolean;onSubmit:(action:FleetActionInput["action"],fields:Partial<FleetActionInput>)=>void;photo?:React.ReactNode}){
 const colors=useColors(),copy=useFleetCopy(),[photosOpen,setPhotosOpen]=useState(false);
 const next=nextDriverRunAction(run,pendingActions);
 return <View style={{gap:14}} accessibilityLabel={copy("Your next step")}>
  {next==="submit_closeout"&&<Text style={{color:colors.text}}>{copy("Return the truck and attached rigging, report any condition issue, then close the run. A reported issue affects the Fleet score but does not block ticket flow.")}</Text>}
  {next?<FleetRunAction key={`${run.version}:${next}`} run={run} action={next} guided disabled={disabled} onSubmit={fields=>onSubmit(next,fields)}/>:<Text style={{color:colors.text}}>{copy(["submitted_for_review","completed"].includes(run.status)?"Run closed. The office handles review and billing.":"No driver action is available. Contact dispatch if you need help.")}</Text>}
  {photo&&<><TogglePillButton compactOnTablet onPress={()=>setPhotosOpen(value=>!value)}>{copy(photosOpen?"Hide photos":"Add photo (optional)")}</TogglePillButton>{photosOpen&&photo}</>}
 </View>;
}
