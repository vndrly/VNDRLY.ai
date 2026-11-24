import React from "react";
import { ScrollView, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { ModalPressable as Pressable } from "@/components/ModalDraft";
import { useColors } from "@/hooks/useColors";

export type GateMapEquipmentDetail = {
  id:string;
  name:string;
  lines:string[];
  linkLabel:string;
  href:string;
  latitude:number;
  longitude:number;
};

export default function GateMapEquipmentDetailNative({ detail, x, y, mapWidth, mapHeight, onAction }: { detail:GateMapEquipmentDetail; x:number; y:number; mapWidth:number; mapHeight:number; onAction:(action:"close"|"open")=>void }) {
  const primary=useColors().primary;
  const width=Math.min(344,Math.max(0,mapWidth-16));
  const left=Math.max(8,Math.min(mapWidth-width-8,x-width/2));
  const top=y>mapHeight*.55?Math.max(8,y-240):Math.min(Math.max(8,mapHeight-230),y+22);
  return <View style={{position:"absolute",top,left,width,maxHeight:Math.max(160,mapHeight-16),backgroundColor:"#242426",borderColor:primary,borderWidth:2,borderRadius:12,shadowColor:"#000",shadowOpacity:.4,shadowRadius:10,elevation:8}}>
    <ScrollView keyboardShouldPersistTaps="always" contentContainerStyle={{padding:12,gap:8}}>
      <View style={{flexDirection:"row",alignItems:"center",gap:8}}><Feather name="package" size={17} color={primary}/><Text accessibilityRole="header" style={{color:"#eee",fontSize:17,fontWeight:"700",flex:1}}>{detail.name}</Text><Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={()=>onAction("close")} style={{padding:8}}><Feather name="x" size={18} color="#eee"/></Pressable></View>
      {detail.lines.map((line,index)=><Text key={`${index}:${line}`} style={{color:"#ddd",fontSize:12}}>{line}</Text>)}
      <Pressable accessibilityRole="link" onPress={()=>onAction("open")} style={{paddingVertical:8}}><Text style={{color:primary,fontSize:12,textDecorationLine:"underline"}}>{detail.linkLabel}</Text></Pressable>
    </ScrollView>
  </View>;
}
