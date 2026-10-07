import React,{useState} from "react";
import {Text,TextInput,View} from "react-native";
import DateTimePicker from "@react-native-community/datetimepicker";
import * as Crypto from "expo-crypto";
import {FleetDraftEditSchema,FleetRunSchema,type FleetRun,type FleetDefinitionSchema} from "@workspace/api-zod";
import type {z} from "zod/v4";
import {apiFetch} from "@/lib/api";
import {useFleetCopy} from "@/lib/fleet-copy";
import TogglePillButton from "@/components/TogglePillButton";

export default function FleetDraftEditor({run,fleet,disabled,onSaved}:{run:FleetRun;fleet:z.infer<typeof FleetDefinitionSchema>|undefined;disabled:boolean;onSaved:()=>void}) {
 const copy=useFleetCopy(),[title,setTitle]=useState(run.title),[stops,setStops]=useState(run.stops);
 const [scheduled,setScheduled]=useState(!!run.schedule),[start,setStart]=useState(new Date(run.schedule?.plannedStartAt??Date.now())),[end,setEnd]=useState(new Date(run.schedule?.plannedEndAt??Date.now()+3600000));
 const [timezone,setTimezone]=useState(run.schedule?.timezone??Intl.DateTimeFormat().resolvedOptions().timeZone);
 const [picker,setPicker]=useState<{field:"start"|"end";mode:"date"|"time"}|null>(null),[kind,setKind]=useState<"pickup"|"delivery"|"return">("pickup");
 const [pending,setPending]=useState<z.infer<typeof FleetDraftEditSchema>|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState("");
 const [baseVersion,setBaseVersion]=useState(run.version);
 const alive=React.useRef(true);React.useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 const changed=run.version>baseVersion,waiting=run.version<baseVersion;
 const locked=disabled||busy||!!pending||changed||waiting;
 let validZone:string|undefined;try{new Intl.DateTimeFormat("en",{timeZone:timezone});validZone=timezone;}catch{validZone=undefined;}
 async function save(){
  if(disabled||busy||!run.canEditDraft||(!pending&&(changed||waiting)))return;
  const parsed=FleetDraftEditSchema.safeParse(pending??{operationId:Crypto.randomUUID(),expectedVersion:baseVersion,title,schedule:scheduled?{plannedStartAt:start.toISOString(),plannedEndAt:end.toISOString(),timezone}:null,stops});
  if(!parsed.success){setError("Choose a title, ordered stops and a valid planned time window.");return;}
  const exact=parsed.data;setPending(exact);setBusy(true);setError("");
  try{
   if(pending){const current=FleetRunSchema.parse(await apiFetch(`/api/fleet/runs/${run.id}`));if(!alive.current)return;if(current.id!==run.id)throw new Error("Draft save outcome needs verification.");if(current.events.some(event=>event.operationId===exact.operationId)){setPending(null);setBaseVersion(current.version);onSaved();return;}}
   const saved=FleetRunSchema.parse(await apiFetch(`/api/fleet/runs/${run.id}/draft`,{method:"PATCH",body:JSON.stringify(exact)}));
   if(saved.id!==run.id||!saved.events.some(event=>event.operationId===exact.operationId))throw new Error("Draft save outcome needs verification.");
   if(alive.current){setPending(null);setBaseVersion(saved.version);onSaved();}
  }catch(e){if(alive.current)setError(e instanceof Error?e.message:"Draft save outcome needs verification.");}
  finally{if(alive.current)setBusy(false);}
 }
 if(!run.canEditDraft || !fleet)return null;
 return <View style={{gap:8}}><Text>{copy("Edit permitted Fleet draft")}</Text><Text>{copy("Planned hours are informational. Saving does not dispatch, start duty or verify physical work.")}</Text>
  <TextInput accessibilityLabel={copy("Draft title")} editable={!locked} value={title} onChangeText={setTitle}/>
  <TogglePillButton disabled={locked} solid={scheduled} onPress={()=>setScheduled(!scheduled)}>{copy("Planned schedule")}</TogglePillButton>
  {scheduled&&<><Text>{start.toLocaleString(undefined,{timeZone:validZone})} → {end.toLocaleString(undefined,{timeZone:validZone})}</Text><TextInput accessibilityLabel={copy("Schedule timezone")} editable={!locked} value={timezone} onChangeText={setTimezone}/>{(["start","end"] as const).map(field=><View key={field}>{(["date","time"] as const).map(mode=><TogglePillButton key={mode} disabled={locked} onPress={()=>setPicker({field,mode})}>{copy(field)} {copy(mode)}</TogglePillButton>)}</View>)}{picker&&<DateTimePicker value={picker.field==="start"?start:end} mode={picker.mode} timeZoneName={validZone} onChange={(_,value)=>{const field=picker.field;setPicker(null);if(value)(field==="start"?setStart:setEnd)(value);}}/>}</>}
  {stops.map((stop,index)=><Text key={stop.id}>{index+1}. {copy(stop.kind)} · {run.labels?.sites.find(site=>site.siteId===stop.siteId)?.name??`site ${stop.siteId}`}</Text>)}
  {(["pickup","delivery","return"] as const).map(value=><TogglePillButton key={value} disabled={locked} solid={kind===value} onPress={()=>setKind(value)}>{copy(value)}</TogglePillButton>)}
  {fleet.siteIds.map(siteId=><TogglePillButton key={siteId} disabled={locked} onPress={()=>setStops(current=>[...current,{id:Crypto.randomUUID(),siteId,kind,sequence:current.length}])}>{copy("Add site ")}{run.labels?.sites.find(site=>site.siteId===siteId)?.name??siteId}</TogglePillButton>)}
  <TogglePillButton disabled={locked} onPress={()=>setStops(current=>current.slice(0,-1))}>{copy("Remove last draft stop")}</TogglePillButton>
  {!!error&&<Text accessibilityRole="alert">{copy(error)}</Text>}
  {changed&&!pending&&<><Text>{copy("This draft changed. Reload its current fields before editing; local changes are not rebased.")}</Text><TogglePillButton disabled={disabled||busy} onPress={()=>{setBaseVersion(run.version);setTitle(run.title);setStops(run.stops);setScheduled(!!run.schedule);setStart(new Date(run.schedule?.plannedStartAt??Date.now()));setEnd(new Date(run.schedule?.plannedEndAt??Date.now()+3600000));setTimezone(run.schedule?.timezone??Intl.DateTimeFormat().resolvedOptions().timeZone);}}>{copy("Reload current draft")}</TogglePillButton></>}
  <TogglePillButton disabled={disabled||busy||(!pending&&(changed||waiting))} onPress={()=>void save()}>{copy(pending?"Verify and retry exact draft save":"Save Fleet draft changes")}</TogglePillButton>
 </View>;
}
