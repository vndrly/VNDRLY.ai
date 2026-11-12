import React,{useEffect,useState} from "react";
import { View, Text } from "react-native";
import { useTranslation } from "react-i18next";
import {captureAuthScope,isAuthScopeCurrent} from "@/lib/auth";
import { useColors } from "@/hooks/useColors";
import { apiFetch } from "@/lib/api";
import AuthedImage from "./AuthedImage";
import type { TicketGateProof as Proof } from "@workspace/gate-booth";
export default function TicketGateProof({ticketId,accountKey,refreshKey}:{ticketId:number;accountKey:string;refreshKey?:number|null}){
 const {t}=useTranslation(),c=useColors();
 const [q,setQuery]=useState<{data:Proof|null;isLoading:boolean;isError:boolean}>({data:null,isLoading:true,isError:false});
 useEffect(()=>{let cancelled=false;const scope=captureAuthScope();setQuery({data:null,isLoading:true,isError:false});
  void apiFetch<Proof>('/api/tickets/'+ticketId+'/gate-proof',{},scope).then(data=>{
   if(!data||!Array.isArray(data.visits))throw Error('Invalid crossing proof response');
   if(!cancelled&&isAuthScopeCurrent(scope))setQuery({data,isLoading:false,isError:false});
  }).catch(()=>{if(!cancelled&&isAuthScopeCurrent(scope))setQuery({data:null,isLoading:false,isError:true});});
  return()=>{cancelled=true;};
 },[ticketId,accountKey,refreshKey]);
  return (
    <View
      style={{ gap: 10, padding: 12, borderWidth: 1, borderColor: c.primary }}
    >
      <Text style={{ color: c.foreground, fontWeight: "700" }}>
        {t("gateProof.title")}
      </Text>
      <Text style={{ color: c.foreground }}>
        {q.isError
          ? t("gateProof.unavailable")
          : q.isLoading
            ? t("common.loading")
            : !q.data?.visits.length
              ? t("gateProof.missing")
              : ""}
      </Text>
      {q.data?.visits.map((v) => (
        <View key={v.id} style={{ gap: 8 }}>
          <Text style={{ color: c.foreground }}>
            {v.siteName} / {v.gateName ?? t("gateProof.notRecorded")}
          </Text>
          <Text style={{ color: c.foreground }}>
            {t("gateProof.entry")}:{" "}
            {v.admissionStatus === "pending"
              ? t("gateProof.notRecorded")
              : new Date(v.checkInTime).toLocaleString()}{" "}
            · {t("gateProof.exit")}:{" "}
            {v.checkOutTime
              ? new Date(v.checkOutTime).toLocaleString()
              : t("gateProof.notRecorded")}
          </Text>
          {!v.capture?.images.some(image=>image.phase==="entry")&&<Text style={{color:c.foreground}}>{t("gateProof.missingEntryPhoto")}</Text>}
          {!v.capture?.images.some(image=>image.phase==="exit")&&<Text style={{color:c.foreground}}>{t("gateProof.missingExitPhoto")}</Text>}
          {v.capture?.images.map((image) => (
            <View key={image.objectPath}><Text style={{color:c.foreground}}>{t(image.phase==="entry"?"gateProof.entry":image.phase==="exit"?"gateProof.exit":"gateProof.unclassified")}</Text>
            <AuthedImage
              key={image.objectPath}
              uri={"/api/storage" + image.originalPath}
              accessibilityLabel={t("gateProof.photo")+" - "+t("gateProof.original")}
              style={{ height: 180, width: "100%" }}
              resizeMode="contain"
            /></View>
          ))}
        </View>
      ))}
    </View>
  );
}
