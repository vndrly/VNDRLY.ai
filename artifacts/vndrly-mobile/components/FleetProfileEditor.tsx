import React,{useState} from "react";
import {Text,TextInput,View} from "react-native";
import * as Crypto from "expo-crypto";
import {FleetOperationalProfileSchema,type FleetOperationalProfile} from "@workspace/api-zod";
import {useFleetCopy} from "@/lib/fleet-copy";
import TogglePillButton from "@/components/TogglePillButton";
import FleetCheckbox from "@/components/FleetCheckbox";
import {useColors} from "@/hooks/useColors";

export default function FleetProfileEditor({profile,disabled,onChange}:{profile:FleetOperationalProfile|undefined;disabled:boolean;onChange:(value:FleetOperationalProfile|undefined)=>void}) {
 const copy=useFleetCopy();
 const colors=useColors(),text={color:colors.text},field={color:colors.text,borderWidth:1,borderColor:colors.border,padding:12,borderRadius:8};
 const lines=(items:FleetOperationalProfile["inspectionItems"]|undefined)=>items?.map(item=>`${item.required?"* ":""}${item.label}`).join("\n")??"";
 const [name,setName]=useState(profile?.name??""),[inspection,setInspection]=useState(lines(profile?.inspectionItems)),[manifest,setManifest]=useState(lines(profile?.manifestFields)),[error,setError]=useState("");
 const [evidence,setEvidence]=useState(profile?.evidenceRequirements??[]),[evidenceLabel,setEvidenceLabel]=useState("");
 const [kind,setKind]=useState<"photo"|"scale"|"receipt"|"signature">("photo"),[scope,setScope]=useState<"run"|"each_load">("run"),[required,setRequired]=useState(true);
 function apply(){
  const parse=(text:string,previous:FleetOperationalProfile["inspectionItems"]|undefined)=>text.split("\n").map(line=>line.trim()).filter(Boolean).map(line=>{const required=line.startsWith("*"),label=line.replace(/^\*\s*/,"");return {id:previous?.find(item=>item.label===label)?.id??Crypto.randomUUID(),label,required};});
  const value=FleetOperationalProfileSchema.safeParse({name,inspectionItems:parse(inspection,profile?.inspectionItems),manifestFields:parse(manifest,profile?.manifestFields),...(evidence.length||profile?.evidenceRequirements?{evidenceRequirements:evidence}:{})});
  if(!value.success){setError("Name the profile and use at most 50 unique items in each list.");return;}setError("");onChange(value.data);
 }
 return <View style={{gap:8}}><Text style={text}>{copy("Detail operational profile")}</Text><Text style={text}>{copy("One item per line; prefix required items with *. Changes affect newly created runs. Existing runs keep their saved requirements.")}</Text>
  <TextInput style={field} accessibilityLabel={copy("Profile name")} editable={!disabled} value={name} onChangeText={setName}/>
  <TextInput style={field} accessibilityLabel={copy("Inspection item labels")} editable={!disabled} multiline value={inspection} onChangeText={setInspection}/>
  <TextInput style={field} accessibilityLabel={copy("Manifest field labels")} editable={!disabled} multiline value={manifest} onChangeText={setManifest}/>
  <Text style={text}>{copy("Media requirements for new runs")}</Text><Text style={text}>{copy("Choose saved association requirements; photos and signature images do not verify physical work or identity.")}</Text>
  {evidence.map(rule=><View key={rule.id}><Text style={text}>{rule.label} · {copy(rule.kind)} · {copy(rule.scope==="each_load"?"For each recorded load":"For the whole run")} · {copy(rule.required?"Required":"Optional")}</Text><TogglePillButton disabled={disabled} onPress={()=>setEvidence(items=>items.filter(item=>item.id!==rule.id))}>{`${copy("Remove media requirement")}: ${rule.label}`}</TogglePillButton></View>)}
  <TextInput style={field} accessibilityLabel={copy("Media requirement label")} editable={!disabled} value={evidenceLabel} onChangeText={setEvidenceLabel}/>
  {(["photo","scale","receipt","signature"] as const).map(value=><TogglePillButton key={value} disabled={disabled} solid={kind===value} onPress={()=>setKind(value)}>{copy(value)}</TogglePillButton>)}
  {(["run","each_load"] as const).map(value=><TogglePillButton key={value} disabled={disabled} solid={scope===value} onPress={()=>setScope(value)}>{copy(value==="each_load"?"For each recorded load":"For the whole run")}</TogglePillButton>)}
  <FleetCheckbox disabled={disabled} checked={required} onChange={setRequired} label={copy("Required media association")} />
  <TogglePillButton disabled={disabled||evidence.length>=20||!evidenceLabel.trim()||evidenceLabel.trim().length>200} onPress={()=>{setEvidence(items=>[...items,{id:Crypto.randomUUID(),label:evidenceLabel.trim(),kind,scope,required}]);setEvidenceLabel("");}}>{copy("Add media requirement to draft")}</TogglePillButton>
  {!!error&&<Text accessibilityRole="alert" style={{color:colors.destructive}}>{copy(error)}</Text>}
  <TogglePillButton disabled={disabled} onPress={apply}>{copy("Apply profile to Details draft")}</TogglePillButton>
  <TogglePillButton disabled={disabled} onPress={()=>{onChange(undefined);setName("");setInspection("");setManifest("");setEvidence([]);}}>{copy("Remove profile from Details draft")}</TogglePillButton>
 </View>;
}
