import React, { useRef, useState } from "react";
import { Linking, ScrollView, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import * as Crypto from "expo-crypto";
import { ModalPressable as Pressable } from "@/components/ModalDraft";
import { changeOverRequest } from "@/lib/change-over-api";
import { useColors } from "@/hooks/useColors";

export type GateMapPinDetail = { id:string; label:string; notes:string; latitude:number; longitude:number; createdAt:string; historical:boolean; pending:boolean; error:string; es:boolean };
type ShareOptions = { people:{userId:number;name:string}[]; groups:{id:string;name:string;userIds:number[]}[] };

export default function GateMapPinDetailNative({ pin, x, y, mapWidth, mapHeight, onAction }: { pin:GateMapPinDetail; x:number; y:number; mapWidth:number; mapHeight:number; onAction:(action:"close"|"edit"|"move"|"remove")=>void }) {
  const primary = useColors().primary;
  const t=(en:string,es:string)=>pin.es?es:en;
  const [directions,setDirections]=useState(false);
  const [sharing,setSharing]=useState(false);
  const [audience,setAudience]=useState<"all"|"group"|"individuals"|null>(null);
  const [groupId,setGroupId]=useState("");
  const [userIds,setUserIds]=useState<number[]>([]);
  const [options,setOptions]=useState<ShareOptions|null>(null);
  const [optionsError,setOptionsError]=useState("");
  const [busy,setBusy]=useState(false);
  const [shareError,setShareError]=useState("");
  const [sent,setSent]=useState<number|null>(null);
  const [confirmRemove,setConfirmRemove]=useState(false);
  const [operationId,setOperationId]=useState(()=>Crypto.randomUUID());
  const loading=useRef(false);
  const button=(label:string,onPress:()=>void,disabled=false,icon?:React.ComponentProps<typeof Feather>["name"]) => <Pressable key={label} accessibilityRole="button" disabled={disabled} onPress={onPress} style={{minHeight:34,paddingHorizontal:8,paddingVertical:6,borderWidth:1,borderColor:primary,borderRadius:6,flexDirection:"row",alignItems:"center",gap:5,opacity:disabled?0.5:1}}>{icon&&<Feather name={icon} size={13} color={primary}/>}<Text style={{color:"#eee",fontSize:12}}>{label}</Text></Pressable>;
  const refreshOptions=async()=>{ if(loading.current)return;loading.current=true;setOptionsError("");try{setOptions(await changeOverRequest<ShareOptions>(`/map-pins/${pin.id}/share-options`));}catch{setOptionsError(t("Recipients could not be loaded.","No se pudieron cargar los destinatarios."));}finally{loading.current=false;} };
  const changeAudience=(next:"all"|"group"|"individuals")=>{setAudience(audience===next?null:next);setOperationId(Crypto.randomUUID());setSent(null);setShareError("");};
  const share=async()=>{if(!audience||!options||busy||sent!==null)return;setBusy(true);setShareError("");try{const result=await changeOverRequest<{notifiedCount:number}>(`/map-pins/${pin.id}/share`,{operationId,audience,...(audience==="group"?{groupId}:{}),userIds:audience==="individuals"?userIds:[]});setSent(result.notifiedCount);}catch(error){setShareError(error instanceof Error?error.message:t("Could not share pin","No se pudo compartir el pin"));}finally{setBusy(false);}};
  const openDirections=(provider:"apple"|"google")=>{const destination=encodeURIComponent(`${pin.latitude},${pin.longitude}`);void Linking.openURL(provider==="apple"?`https://maps.apple.com/?daddr=${destination}&dirflg=d`:`https://www.google.com/maps/dir/?api=1&destination=${destination}&travelmode=driving`);};
  const width=Math.min(344,Math.max(0,mapWidth-16));
  const left=Math.max(8,Math.min(mapWidth-width-8,x-width/2));
  const top=y>mapHeight*.55?Math.max(8,y-320):Math.min(Math.max(8,mapHeight-270),y+22);
  return <View style={{position:"absolute",left,top,width,maxHeight:Math.max(180,mapHeight-16),backgroundColor:"#242426",borderWidth:2,borderColor:primary,borderRadius:12,shadowColor:"#000",shadowOpacity:.4,shadowRadius:10,elevation:8}}>
    <ScrollView keyboardShouldPersistTaps="always" contentContainerStyle={{padding:12,gap:8}}>
      <View style={{flexDirection:"row",alignItems:"center",gap:8}}><Feather name="map-pin" size={17} color={primary}/><Text accessibilityRole="header" style={{color:"#eee",fontSize:17,fontWeight:"700",flex:1}}>{pin.label}</Text>{button("×",()=>onAction("close"))}</View>
      <Text style={{color:"#ddd",fontSize:12}}>{pin.latitude.toFixed(6)}, {pin.longitude.toFixed(6)}</Text>
      {!!pin.notes&&<Text style={{color:"#ddd",fontSize:12}}>{pin.notes}</Text>}
      <Text style={{color:"#aaa",fontSize:12}}>{new Date(pin.createdAt).toLocaleString(pin.es?"es":"en")}</Text>
      {!pin.historical&&<View style={{flexDirection:"row",flexWrap:"wrap",gap:6}}>{button(t("Edit Details","Editar detalles"),()=>onAction("edit"))}{button(t("Pick-Up & Move","Recoger y mover"),()=>onAction("move"))}</View>}
      {button(t("Get Directions","Cómo llegar"),()=>setDirections(value=>!value),false,"navigation")}
      {directions&&<View style={{flexDirection:"row",gap:6}}>{button("Apple Maps",()=>openDirections("apple"))}{button("Google Maps",()=>openDirections("google"))}</View>}
      {!pin.historical&&button(t("Share Pin","Compartir pin"),()=>{setSharing(value=>!value);if(!sharing&&!options)void refreshOptions();},false,"share-2")}
      {sharing&&<View style={{gap:6}}>{optionsError?<View>{!!optionsError&&<Text accessibilityRole="alert" style={{color:"#fca5a5"}}>{optionsError}</Text>}{button(t("Retry","Reintentar"),()=>void refreshOptions())}</View>:!options?<Text style={{color:"#aaa"}}>{t("Loading recipients…","Cargando destinatarios…")}</Text>:<>
        <View style={{flexDirection:"row",flexWrap:"wrap",gap:5}}>{(["all","group","individuals"] as const).map(value=>button(value==="all"?t("All","Todos"):value==="group"?t("Group","Grupo"):t("Individuals","Personas"),()=>changeAudience(value)))}</View>
        {audience==="all"&&<View><Text style={{color:"#ddd"}}>{options.people.length} {t("company members","miembros de la empresa")}</Text>{[...options.people].sort((a,b)=>a.name.localeCompare(b.name)).map(person=><Text key={person.userId} style={{color:"#ddd",padding:4}}>{person.name}</Text>)}</View>}
        {audience==="group"&&options.groups.map(group=><Pressable key={group.id} accessibilityRole="radio" accessibilityState={{checked:groupId===group.id}} onPress={()=>{setGroupId(group.id);setOperationId(Crypto.randomUUID());setSent(null);}} style={{padding:6}}><Text style={{color:groupId===group.id?primary:"#ddd"}}>{group.name}</Text></Pressable>)}
        {audience==="group"&&!options.groups.length&&<Text style={{color:"#aaa"}}>{t("No available groups","No hay grupos disponibles")}</Text>}
        {audience==="individuals"&&options.people.map(person=><Pressable key={person.userId} accessibilityRole="checkbox" accessibilityState={{checked:userIds.includes(person.userId)}} onPress={()=>{setUserIds(ids=>ids.includes(person.userId)?ids.filter(id=>id!==person.userId):[...ids,person.userId]);setOperationId(Crypto.randomUUID());setSent(null);}} style={{padding:6}}><Text style={{color:userIds.includes(person.userId)?primary:"#ddd"}}>{person.name}</Text></Pressable>)}
        {audience&&button(busy?t("Sharing…","Compartiendo…"):t("Share","Compartir"),()=>void share(),busy||sent!==null||!options.people.length||audience==="group"&&!groupId||audience==="individuals"&&!userIds.length)}
      </>}{!!shareError&&<Text accessibilityRole="alert" style={{color:"#fca5a5"}}>{shareError}</Text>}{sent!==null&&<Text style={{color:"#ddd"}}>{pin.es?`Se notificó a ${sent} personas.`:`Notified ${sent} people.`}</Text>}</View>}
      {!pin.historical&&(confirmRemove?<View style={{gap:6}}><Text accessibilityRole="alert" style={{color:"#fca5a5"}}>{t("Are you sure? This removes the pin for everyone in your company.","¿Está seguro? Se eliminará el pin para toda su empresa.")}</Text><View style={{flexDirection:"row",gap:6}}>{button(pin.pending?t("Removing…","Eliminando…"):t("Yes, remove","Sí, eliminar"),()=>onAction("remove"),pin.pending)}{button(t("Cancel","Cancelar"),()=>setConfirmRemove(false),pin.pending)}</View></View>:button(t("Remove Pin","Eliminar pin"),()=>setConfirmRemove(true),pin.pending,"trash-2"))}
      {!!pin.error&&<Text accessibilityRole="alert" style={{color:"#fca5a5"}}>{pin.error}</Text>}
    </ScrollView>
  </View>;
}
