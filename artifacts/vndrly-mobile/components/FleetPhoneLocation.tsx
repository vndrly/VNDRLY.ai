import {startFleetBackgroundLocation, stopFleetBackgroundLocation, subscribeFleetBackgroundLocation, type FleetBackgroundStatus} from "@/lib/fleet-background-location-native";
import React, { useEffect, useRef, useState } from "react";
import { AppState, Text, View } from "react-native";
import * as Location from "expo-location";
import * as Crypto from "expo-crypto";
import { router } from "expo-router";
import type { FleetOverview, FleetRun } from "@workspace/api-zod";
import TogglePillButton from "@/components/TogglePillButton";
import { apiFetch } from "@/lib/api";
import { captureAuthScope, isAuthScopeCurrent, subscribeToken, subscribeUser } from "@/lib/auth";
import { getDeviceId } from "@/lib/deviceId";
import { hasActiveConsentForThisDevice } from "@/lib/locationConsent";
import { createFleetPhoneLocationCollector, type FleetPhoneLocationState, type FleetVerifiedAccount } from "@/lib/fleet-phone-location";
import { useColors } from "@/hooks/useColors";
import { useFleetCopy } from "@/lib/fleet-copy";

export default function FleetPhoneLocation({run,account,disabled}:{run:FleetRun;account:FleetVerifiedAccount;disabled:boolean}) {
  const colors=useColors(),copy=useFleetCopy();
  const [status,setStatus]=useState<FleetPhoneLocationState>({state:"stopped",message:"Phone sharing is stopped.",lastAccepted:null});
  const [background,setBackground]=useState<FleetBackgroundStatus>({state:"stopped",message:"Background phone sharing is stopped.",lastAcceptedAt:null});
  const controller=useRef<ReturnType<typeof createFleetPhoneLocationCollector>|null>(null);
  const timer=useRef<ReturnType<typeof setInterval>|null>(null);
  const alive=useRef(true);
  function stop(message="Phone sharing is stopped.",discard=false){if(timer.current)clearInterval(timer.current);timer.current=null;controller.current?.stop(message,discard);}
  useEffect(()=>{
    alive.current=true;
    const backgroundSubscription=subscribeFleetBackgroundLocation(value=>{if(alive.current)setBackground(value);});
    const stopAuth=()=>{stop("The account or device context changed. Phone sharing stopped.",true);controller.current=null;};
    const user=subscribeUser(stopAuth),token=subscribeToken(stopAuth);
    const app=AppState.addEventListener("change",state=>{if(state!=="active")stop("Phone sharing is foreground only and stopped while the app is inactive.");});
    return()=>{alive.current=false;stop();backgroundSubscription();user();token();app.remove();};
  },[]);
  useEffect(()=>{if(disabled || run.status!=="in_progress" || run.phase==="paused"){stop("This run is paused or no longer active. Phone sharing stopped.");void stopFleetBackgroundLocation(true).catch(()=>undefined);}},[disabled,run.status,run.phase]);
  function start(){
    if(disabled || run.status!=="in_progress" || run.phase==="paused" || AppState.currentState!=="active")return;
    stop();
    if(controller.current){controller.current.start();void controller.current.poll();timer.current=setInterval(()=>void controller.current?.poll(),60_000);return;}
    const scope=captureAuthScope();
    controller.current=createFleetPhoneLocationCollector(account,{
      readCurrent:async()=>{
        const overview=await apiFetch<FleetOverview>("/api/fleet/overview");
        if(!overview.accountScope || !overview.capabilities.canDrive)throw Object.assign(new Error("Current Fleet duty verification is required."),{status:403});
        if(!isAuthScopeCurrent(scope))throw Object.assign(new Error("Account changed."),{status:403});
        const current=await apiFetch<FleetRun>(`/api/fleet/runs/${run.id}`);
        return {account:overview.accountScope,run:current};
      },
      consent:hasActiveConsentForThisDevice,
      permission:async()=>(await Location.getForegroundPermissionsAsync()).status==="granted",
      deviceId:getDeviceId,
      sample:async()=>{const position=await Location.getCurrentPositionAsync({accuracy:Location.Accuracy.Balanced});return {latitude:position.coords.latitude,longitude:position.coords.longitude,accuracy:position.coords.accuracy,timestamp:position.timestamp};},
      post:input=>apiFetch(`/api/fleet/runs/${run.id}/location`,{method:"POST",body:JSON.stringify(input)}),
      operationId:Crypto.randomUUID,
      contextCurrent:()=>alive.current && isAuthScopeCurrent(scope) && AppState.currentState==="active",
      changed:value=>{if(alive.current)setStatus(value);},
    },run);
    controller.current.start();void controller.current.poll();
    timer.current=setInterval(()=>void controller.current?.poll(),60_000);
  }
  return <View style={{gap:8}}>
    <Text style={{color:colors.text}}>{copy("Driver phone location")}</Text>
    <Text style={{color:colors.text}}>{copy("Sharing uses this phone while this screen is open and the app is active. It requires current duty and device consent; it does not provide truck telemetry or prove arrival, loading or delivery.")}</Text>
    <Text style={{color:colors.text}}>{copy(status.message)}</Text>
    {status.lastAccepted && <Text style={{color:colors.text}}>{copy("Last accepted phone observation")}: {status.lastAccepted.recordedAt} · {copy(status.lastAccepted.freshness)} · {copy("Accuracy")}: {status.lastAccepted.accuracyMeters ?? copy("unavailable")}</Text>}
    <TogglePillButton disabled={disabled || run.status!=="in_progress" || run.phase==="paused" || status.state==="checking" || status.state==="sharing"} onPress={start}>{copy("Start foreground phone sharing")}</TogglePillButton>
    <TogglePillButton onPress={()=>{stop();void stopFleetBackgroundLocation(true).catch(()=>undefined);}}>{copy("Stop phone sharing")}</TogglePillButton>
    <Text style={{color:colors.text}}>{copy(background.message)}</Text>
    {background.lastAcceptedAt && <Text style={{color:colors.text}}>{copy("Last accepted background phone report")}: {background.lastAcceptedAt}</Text>}
    <TogglePillButton disabled={disabled || run.status!=="in_progress" || run.phase==="paused" || background.state==="configured" || background.state==="accepted"} onPress={()=>{stop();void (async()=>{try {await Location.requestBackgroundPermissionsAsync();await startFleetBackgroundLocation(account,run);}catch(error){if(alive.current)setBackground({state:"unavailable",message:error instanceof Error?error.message:"Background phone sharing is unavailable.",lastAcceptedAt:null});}})();}}>{copy("Start duty-bound background phone sharing")}</TogglePillButton>
    <Text style={{color:colors.text}}>{copy("Background sharing uses this phone only during the verified active run. Always location permission and device consent are required. OS suspension can delay reports; no truck telemetry or physical proof is provided.")}</Text>
    <TogglePillButton disabled={disabled} onPress={()=>{stop();void stopFleetBackgroundLocation(true).catch(()=>undefined);router.push({pathname:"/location-consent",params:{returnTo:`/fleet-run/${run.id}`}} as never);}}>{copy("Review device location consent")}</TogglePillButton>
  </View>;
}
