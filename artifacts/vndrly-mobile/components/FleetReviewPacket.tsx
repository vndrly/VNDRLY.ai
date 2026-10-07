import React,{useEffect,useRef,useState} from "react";
import {Text,View} from "react-native";
import {FleetReviewPacketSchema,type FleetReviewPacket as Packet,type FleetRun} from "@workspace/api-zod";
import {apiFetch} from "@/lib/api";
import {captureAuthScope,isAuthScopeCurrent} from "@/lib/auth";
import {useFleetCopy} from "@/lib/fleet-copy";
import TogglePillButton from "@/components/TogglePillButton";
export default function FleetReviewPacket({run,disabled}:{run:FleetRun;disabled:boolean}){
 const copy=useFleetCopy(),[packet,setPacket]=useState<Packet|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState("");
 const alive=useRef(true),version=useRef(run.version),blocked=useRef(disabled);version.current=run.version;blocked.current=disabled;
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);useEffect(()=>{setPacket(null);setError("");},[run.version]);
 async function read(){if(disabled||busy)return;setBusy(true);setError("");setPacket(null);const scope=captureAuthScope(),expected=run.version;try{const value=FleetReviewPacketSchema.parse(await apiFetch(`/api/fleet/runs/${run.id}/review-packet`,{},scope));if(value.runId!==run.id||value.runVersion!==expected||version.current!==expected)throw new Error("This run changed. Refresh before reading its review packet.");if(alive.current&&isAuthScopeCurrent(scope)&&!blocked.current)setPacket(value);}catch(e){if(alive.current&&isAuthScopeCurrent(scope))setError(e instanceof Error?e.message:"Review packet unavailable.");}finally{if(alive.current)setBusy(false);}}
 return <View style={{gap:8}}><Text>{copy("Fleet review readiness")}</Text><Text>{copy("Saved record completeness is separate from physical proof and verified signature identity. Read the current packet before closeout or operational review.")}</Text>
 {!packet&&run.operationalProfile?.evidenceRequirements?.filter(rule=>rule.required).map(rule=><Text key={rule.id}>{copy("Required saved association")}: {rule.label} · {copy(rule.kind)} · {copy(rule.scope==="each_load"?"For each recorded load":"For the whole run")}</Text>)}
 <TogglePillButton disabled={disabled||busy} onPress={()=>void read()}>{copy("Read current Fleet review packet")}</TogglePillButton>
 {packet&&!disabled&&<><Text>{copy("Saved run version")}: {packet.runVersion}</Text><Text>{copy("Missing required evidence")}: {packet.missingRequiredCount}</Text><Text>{copy(packet.readyForOperationalReview?"Recorded requirements ready for operational review":"Recorded requirements are incomplete")}</Text><Text>{copy("Reported inspection exceptions")}: {packet.inspectionExceptions} · {copy("Undelivered recorded loads")}: {packet.undeliveredLoadCount}</Text>
 <Text>{copy("Recorded inspection")}: {copy(packet.inspectionComplete?"Complete":"Incomplete")} · {copy("Recorded manifests")}: {copy(packet.manifestComplete?"Complete":"Incomplete")} · {copy("Recorded closeout requirements")}: {copy(packet.closeoutRecordsComplete?"Complete":"Incomplete")}</Text>
 {packet.requirements.map(rule=><View key={`${rule.id}:${rule.loadId??"run"}`}><Text>{rule.label} · {copy(rule.kind)} · {copy(rule.required?"Required":"Optional")} · {copy(rule.evidenceIds.length?"Saved association present":rule.required||rule.missing?"Missing saved association":"No saved association (optional)")}</Text><Text>{copy(rule.scope==="each_load"?"For each recorded load":"For the whole run")}{rule.loadId?` · ${run.loads.find(load=>load.id===rule.loadId)?.manifestReference??rule.loadId}`:""}</Text>{rule.evidenceIds.map(id=><Text key={id}>{copy("Saved evidence ID")}: {id}</Text>)}</View>)}
 {packet.limitations.map((text,index)=><Text key={index}>{copy(text)}</Text>)}</>}{!!error&&<Text accessibilityRole="alert">{copy(error)}</Text>}</View>;
}
