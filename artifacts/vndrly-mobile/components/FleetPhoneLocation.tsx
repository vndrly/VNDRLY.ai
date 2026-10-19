import {startFleetBackgroundLocation, stopFleetBackgroundLocation, subscribeFleetBackgroundLocation} from "@/lib/fleet-background-location-native";
import React, { useEffect, useRef, useState } from "react";
import { AppState, Text, View } from "react-native";
import * as Location from "expo-location";
import * as Crypto from "expo-crypto";
import { router } from "expo-router";
import type { FleetOverview, FleetRun } from "@workspace/api-zod";
import TogglePillButton from "@/components/TogglePillButton";
import OptionSwitch from "@/components/work-hub/library/OptionSwitch";
import { apiFetch } from "@/lib/api";
import { captureAuthScope, isAuthScopeCurrent, subscribeToken, subscribeUser } from "@/lib/auth";
import { getDeviceId } from "@/lib/deviceId";
import { hasActiveConsentForThisDevice } from "@/lib/locationConsent";
import { enableFleetRunLocation } from "@/lib/fleet-location-setup";
import { nativeLocationCollectionAllowed, readNativeOperations } from "@/lib/native-operations";
import * as Storage from "@/lib/fleet-device-storage";
import { createFleetPhoneLocationCollector, type FleetVerifiedAccount } from "@/lib/fleet-phone-location";
import { useColors } from "@/hooks/useColors";
import { useFleetCopy } from "@/lib/fleet-copy";

/** Company-controlled sharing starts with verified active work, never by overriding OS permission. */
export default function FleetPhoneLocation({run,account,disabled}:{run:FleetRun;account:FleetVerifiedAccount;disabled:boolean}) {
  const colors=useColors(),copy=useFleetCopy();
  const [message,setMessage]=useState("Checking run location");
  const [allowPause,setAllowPause]=useState(false),[paused,setPaused]=useState(false),[needsSetup,setNeedsSetup]=useState(false);
  const [changing,setChanging]=useState(false);
  const sync=useRef<()=>Promise<void>>(async()=>{});
  const stop=useRef<()=>void>(()=>{});
  const pauseKey=`vndrly.fleet-location-pause.${account.userId}.${account.companyId}.${account.membershipId}.${account.sessionVersion}.${run.id}`;
  const binding=useRef(pauseKey);binding.current=pauseKey;
  const eligible=run.status==="in_progress"&&run.phase!=="paused";
  useEffect(()=>{
    let alive=true,authValid=true,syncing=false,foreground=false,backgroundReady=false;
    const scope=captureAuthScope();
    let collector:ReturnType<typeof createFleetPhoneLocationCollector>|null=null;
    const current=()=>alive&&authValid&&isAuthScopeCurrent(scope);
    const stopForeground=()=>{foreground=false;collector?.stop();};
    const stopAll=()=>{stopForeground();backgroundReady=false;void stopFleetBackgroundLocation(false).catch(()=>undefined);};
    stop.current=stopAll;
    const subscription=subscribeFleetBackgroundLocation(value=>{
      if(!current())return;
      backgroundReady=value.state==="configured"||value.state==="accepted";
      if(backgroundReady)setMessage("Location sharing active");
    });
    function startForeground(){
      if(foreground||!current()||AppState.currentState!=="active")return;
      collector??=createFleetPhoneLocationCollector(account,{
        readCurrent:async()=>{
          const overview=await apiFetch<FleetOverview>("/api/fleet/overview");
          if(!overview.accountScope||!overview.capabilities.canDrive||!current())throw Object.assign(new Error("Current Fleet duty verification is required."),{status:403});
          return {account:overview.accountScope,run:await apiFetch<FleetRun>(`/api/fleet/runs/${run.id}`)};
        },
        consent:async()=>await hasActiveConsentForThisDevice()&&await nativeLocationCollectionAllowed(),
        permission:async()=>(await Location.getForegroundPermissionsAsync()).status==="granted",
        deviceId:getDeviceId,
        sample:async()=>{const p=await Location.getCurrentPositionAsync({accuracy:Location.Accuracy.Balanced});return {...p.coords,timestamp:p.timestamp};},
        post:async input=>apiFetch(`/api/fleet/runs/${run.id}/location`,{method:"POST",headers:{"x-vndrly-device-id":await getDeviceId()},body:JSON.stringify(input)}),
        operationId:Crypto.randomUUID,
        contextCurrent:()=>current()&&AppState.currentState==="active",
        changed:value=>{if(current())setMessage(value.state==="sharing"?"Location sharing active":value.state==="checking"?"Checking run location":"Location sharing unavailable");},
      },run);
      foreground=true;collector.start();void collector.poll();
    }
    async function synchronize(){
      if(syncing||!current()||AppState.currentState!=="active")return;
      syncing=true;
      try{
        if(!eligible){stopAll();if(current())setMessage("Run location sharing stopped");return;}
        // Busy forms do not interrupt an already running background collector.
        if(disabled)return;
        const native=await readNativeOperations(scope);
        if(!current())return;
        const allowed=native.policy.allowDriverLocationPause===true;
        setAllowPause(allowed);
        const savedPause=allowed&&await Storage.getItemAsync(pauseKey)==="true";
        if(!current())return;
        if(!allowed)await Storage.deleteItemAsync(pauseKey);
        if(!current())return;
        setPaused(savedPause);
        if(savedPause){stopAll();setNeedsSetup(false);setMessage("Location sharing paused");return;}
        const consent=await hasActiveConsentForThisDevice()&&await nativeLocationCollectionAllowed();
        const permission=await Location.getForegroundPermissionsAsync();
        if(!current())return;
        if(!consent||permission.status!=="granted"){
          stopAll();setNeedsSetup(true);setMessage("Location permission needed");return;
        }
        const background=await Location.getBackgroundPermissionsAsync();
        if(!current())return;
        setNeedsSetup(background.status!=="granted");
        if(background.status==="granted"){
          if(!backgroundReady){
            try{await startFleetBackgroundLocation(account,run);if(!current()){return;}backgroundReady=true;setMessage("Location sharing active");}
            catch{if(current())startForeground();}
          }
          if(backgroundReady){stopForeground();if(current())setMessage("Location sharing active");}
        }else{if(backgroundReady){backgroundReady=false;await stopFleetBackgroundLocation(false);if(!current())return;}startForeground();}
        if(foreground)void collector?.poll();
      }catch{if(current()){stopAll();setAllowPause(false);setMessage("Location sharing unavailable");}}
      finally{syncing=false;}
    }
    sync.current=synchronize;
    const authChanged=()=>{authValid=false;stopAll();if(alive){setAllowPause(false);setMessage("Location sharing unavailable");}};
    const user=subscribeUser(authChanged),token=subscribeToken(authChanged);
    const app=AppState.addEventListener("change",state=>{if(state==="active")void synchronize();else stopForeground();});
    const interval=setInterval(()=>void synchronize(),60_000);
    void synchronize();
    return()=>{alive=false;clearInterval(interval);subscription();user();token();app.remove();stopForeground();};
    // A run revision may change action availability; the equipment/account binding is what owns collection.
  },[account.userId,account.companyId,account.membershipId,account.sessionVersion,run.id,run.vehicleAssetId,run.trailerAssetId,eligible,disabled,pauseKey]);
  async function changeSharing(enabled:boolean){
    if(changing||disabled)return;
    setChanging(true);
    const scope=captureAuthScope();
    try{
      const native=await readNativeOperations(scope);
      if(binding.current!==pauseKey)return;
      if(!isAuthScopeCurrent(scope)||native.policy.allowDriverLocationPause!==true){await sync.current();return;}
      await Storage.setItemAsync(pauseKey,enabled?"false":"true",{keychainAccessible:Storage.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY});
      if(!isAuthScopeCurrent(scope)||binding.current!==pauseKey)return;
      if(!enabled)stop.current();
      await sync.current();
    }catch{setMessage("Location sharing unavailable");}
    finally{setChanging(false);}
  }
  async function setupLocation(){
    const scope=captureAuthScope();
    try{
      const accepted=await hasActiveConsentForThisDevice();
      if(!isAuthScopeCurrent(scope))return;
      if(!accepted){router.push({pathname:"/location-consent",params:{returnTo:`/fleet-run/${run.id}`}} as never);return;}
      await enableFleetRunLocation();
      if(!isAuthScopeCurrent(scope))return;
      if((await Location.getForegroundPermissionsAsync()).status!=="granted")await Location.requestForegroundPermissionsAsync();
      if(!isAuthScopeCurrent(scope))return;
      if((await Location.getBackgroundPermissionsAsync()).status!=="granted")await Location.requestBackgroundPermissionsAsync();
      if(isAuthScopeCurrent(scope))await sync.current();
    }catch{if(isAuthScopeCurrent(scope))setMessage("Location sharing unavailable");}
  }
  if(!eligible)return null;
  return <View style={{gap:8}}>
    <Text accessibilityLiveRegion="polite" style={{color:colors.text}}>{copy(message)}</Text>
    {eligible&&allowPause&&<OptionSwitch label={copy("Share location during this run")} value={!paused} disabled={disabled||changing} onChange={value=>{void changeSharing(value);}}/>}
    {eligible&&needsSetup&&<TogglePillButton disabled={disabled} onPress={()=>{void setupLocation();}}>{copy("Enable run location")}</TogglePillButton>}
  </View>;
}
