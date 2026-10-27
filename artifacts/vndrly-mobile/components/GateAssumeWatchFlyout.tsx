import React from "react";
import { Modal, Pressable, ScrollView, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import type { ChangeOverState } from "@workspace/gate-booth";
import { useColors } from "@/hooks/useColors";
import TogglePillButton from "@/components/TogglePillButton";

export default function GateAssumeWatchFlyout({open,current,busy,blocked,pending,error,onClose,onAssume}:{open:boolean;current?:ChangeOverState;busy:boolean;blocked:boolean;pending:boolean;error:string;onClose:()=>void;onAssume:()=>void}) {
  const colors=useColors(),{i18n}=useTranslation(),es=(i18n?.language??"en").startsWith("es"),c=(en:string,spanish:string)=>es?spanish:en;
  const prep=current?.preparation,watch=current?.shift??current?.releasedWatch;
  return <Modal visible={open} transparent animationType="fade" onRequestClose={onClose}>
    <View style={{flex:1,justifyContent:"center",alignItems:"center",padding:20}}>
      <Pressable accessibilityRole="button" accessibilityLabel={c("Dismiss watch summary","Cerrar resumen de guardia")} onPress={onClose} style={{position:"absolute",top:0,right:0,bottom:0,left:0,backgroundColor:"rgba(0,0,0,0.65)"}}/>
      <View accessibilityViewIsModal style={{width:"100%",maxWidth:460,maxHeight:"80%",padding:18,gap:12,borderWidth:1,borderColor:colors.primary,borderRadius:12,backgroundColor:colors.card}}>
        <View style={{flexDirection:"row",alignItems:"center",justifyContent:"space-between"}}><Text accessibilityRole="header" style={{color:colors.foreground,fontWeight:"700",fontSize:18}}>{c("Assume Watch","Asumir vigilancia")}</Text><Pressable accessibilityRole="button" accessibilityLabel={c("Close watch summary","Cerrar resumen de guardia")} onPress={onClose} style={{padding:8}}><Text style={{color:colors.mutedForeground,fontSize:22}}>×</Text></Pressable></View>
        <ScrollView contentContainerStyle={{gap:10}}>
          <Text style={{color:colors.foreground,fontWeight:"700"}}>{current?.site.name} · {current?.station.name}</Text>
          {watch&&<Text style={{color:colors.mutedForeground}}>{watch.operator_name} · {new Date(watch.started_at).toLocaleString()}</Text>}
          {prep?<><Text style={{color:colors.foreground,fontWeight:"700"}}>{c("Saved handover","Relevo guardado")}</Text>{prep.summary.facts.map(f=><Text key={f.id} style={{color:colors.foreground}}>{f.text}</Text>)}{!!prep.notes&&<Text style={{color:colors.foreground}}>{prep.notes}</Text>}{prep.snapshot.openItems.filter(item=>item.status==="open").map(item=><Text key={item.id} style={{color:colors.foreground}}>{item.text}</Text>)}</>:<Text style={{color:colors.foreground,fontWeight:"700"}}>{c("No handover prepared","No hay relevo preparado")}</Text>}
          {prep&&current?.stale&&<><Text style={{color:colors.mutedForeground}}>{c("Gate activity has changed since this handover was saved.","La actividad cambió desde que se guardó este relevo.")}</Text>{current.snapshot?.facts.map(f=><Text key={f.id} style={{color:colors.foreground}}>{f.text}</Text>)}</>}
          {!!error&&<Text accessibilityRole="alert" style={{color:colors.destructive}}>{error}</Text>}
        </ScrollView>
        <TogglePillButton color="brand" disabled={busy||blocked} onPress={onAssume}>{pending?c("Check assumption","Comprobar guardia"):c("ASSUME","ASUMIR")}</TogglePillButton>
      </View>
    </View>
  </Modal>;
}
