import React,{useState} from "react";
import {Platform,Image,Text,TextInput,View} from "react-native";
import * as ImagePicker from "expo-image-picker";
import type {FleetRun,FleetWorkSession,FleetWorkEvidencePageSchema} from "@workspace/api-zod";
import type {z} from "zod/v4";
import {getApiBase} from "@/lib/api";
import {getToken,captureAuthScope,isAuthScopeCurrent} from "@/lib/auth";
import {useColors} from "@/hooks/useColors";
import TogglePillButton from "./TogglePillButton";
export default function FleetRetainedEvidence({session,run,onChanged,simple=false}:{session:FleetWorkSession;run:FleetRun;onChanged:()=>void;simple?:boolean}){
 const colors=useColors(),[notes,setNotes]=useState(""),[busy,setBusy]=useState(false),[message,setMessage]=useState(""),[kind,setKind]=useState<"photo"|"scale"|"receipt"|"signature">("photo"),[page,setPage]=useState<z.infer<typeof FleetWorkEvidencePageSchema>|null>(null),[preview,setPreview]=useState<{id:string;token:string}|null>(null);
 async function capture(source:"camera"|"library"){
  if(busy||run.driverUserId!==session.scope.userId)return;setBusy(true);
  try{const permission=source==="camera"?await ImagePicker.requestCameraPermissionsAsync():await ImagePicker.requestMediaLibraryPermissionsAsync();if(permission.status!=="granted")throw Error("Photo permission is required");const result=source==="camera"?await ImagePicker.launchCameraAsync({quality:0.8,allowsEditing:false}):await ImagePicker.launchImageLibraryAsync({mediaTypes:["images"],quality:0.8,allowsEditing:false});if(result.canceled||!result.assets?.[0])return;const asset=result.assets[0],sourceFile=Platform.OS==="web"?await fetch(asset.uri).then(response=>response.blob()):asset.uri;
   await session.captureEvidence(run,sourceFile,asset.mimeType??"image/jpeg",kind,notes||(simple?"Run photo":""));setNotes("");setMessage(simple?"Photo saved on this phone; waiting to sync.":"Saved on this device — photo pending sync. Original bytes remain retained until canonical association is verified.");onChanged();
  }catch(error){setMessage(error instanceof Error?error.message:"Photo was not durably saved");}finally{setBusy(false);}
 }
 async function read(cursor:string|null=null){if(busy)return;setBusy(true);try{const result=await session.evidencePage(run.id,cursor);setPage(prior=>cursor&&prior?{...result,evidence:[...prior.evidence,...result.evidence]}:result);}catch(error){setMessage(error instanceof Error?error.message:"Saved evidence is unavailable");}finally{setBusy(false);}}
 async function open(id:string){const scope=captureAuthScope(),token=await getToken();if(token&&isAuthScopeCurrent(scope))setPreview({id,token});}
 if(simple)return <View style={{gap:10}}><Text style={{color:colors.text}}>Photos (optional)</Text><TextInput accessibilityLabel="Photo notes (optional)" placeholder="Photo notes (optional)" editable={!busy} value={notes} onChangeText={setNotes} style={{color:colors.text,borderWidth:1,borderColor:colors.border,padding:12,borderRadius:8}}/><TogglePillButton disabled={busy} onPress={()=>void capture("camera")}>Take photo</TogglePillButton><TogglePillButton disabled={busy} onPress={()=>void capture("library")}>Choose photo</TogglePillButton>{!!message&&<Text accessibilityLiveRegion="polite" style={{color:colors.text}}>{message}</Text>}</View>;
 return <View style={{gap:10,borderWidth:2,borderColor:colors.primary,backgroundColor:colors.card,borderRadius:12,padding:16}}><Text style={{color:colors.text,fontWeight:"700"}}>Fleet evidence</Text><Text style={{color:colors.text}}>Capture while safely stopped. Photos do not verify physical delivery, inspection decisions or signature identity.</Text>
  {run.driverUserId===session.scope.userId&&<>{(["photo","scale","receipt","signature"] as const).map(value=><TogglePillButton compactOnTablet key={value} disabled={busy} solid={kind===value} onPress={()=>setKind(value)}>{value}</TogglePillButton>)}<TextInput accessibilityLabel="Evidence notes" maxLength={2000} editable={!busy} value={notes} onChangeText={setNotes} style={{color:colors.text,borderWidth:2,borderColor:colors.primary,padding:12,borderRadius:10}}/>
   <TogglePillButton compactOnTablet disabled={busy} onPress={()=>void capture("camera")}>Capture Fleet image</TogglePillButton><TogglePillButton compactOnTablet disabled={busy} onPress={()=>void capture("library")}>Choose Fleet image</TogglePillButton></>}
  <TogglePillButton compactOnTablet disabled={busy} onPress={()=>void read()}>Read saved Fleet evidence</TogglePillButton>
  {page?.evidence.map(value=><View key={value.record.evidenceId} style={{gap:8}}><Text style={{color:colors.text}}>{value.record.kind} · {value.record.size} bytes · {value.record.recordedAt}</Text><Text style={{color:colors.text}}>{value.record.notes}</Text>{value.record.contentType.startsWith("image/")&&<TogglePillButton disabled={busy} onPress={()=>void open(value.record.evidenceId)}>View authorized saved image</TogglePillButton>}{preview?.id===value.record.evidenceId&&<Image accessibilityLabel="Authorized Fleet evidence image" style={{width:"100%",height:240}} resizeMode="contain" source={{uri:`${getApiBase().replace(/\/$/,"")}/api/fleet/runs/${run.id}/evidence/${value.record.evidenceId}/file`,headers:{Authorization:`Bearer ${preview.token}`},cache:"reload"}} onError={()=>{setPreview(null);setMessage("Saved image could not be read under current permissions");}}/>}</View>)}
  {page?.nextCursor&&<TogglePillButton compactOnTablet disabled={busy} onPress={()=>void read(page.nextCursor)}>Load more saved evidence</TogglePillButton>}
  {!!message&&<Text accessibilityRole="alert" style={{color:colors.text}}>{message}</Text>}
 </View>;
}
