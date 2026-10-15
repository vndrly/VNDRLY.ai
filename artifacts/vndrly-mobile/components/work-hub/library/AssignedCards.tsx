import React from "react";
import {Text,View} from "react-native";
import {router} from "expo-router";
import {z} from "zod/v4";
import {AssignmentMetadataSchema} from "@workspace/api-zod";
import {useTranslation} from "react-i18next";
import {useColors} from "@/hooks/useColors";
import {useFormCampaigns} from "@/lib/use-form-campaigns";
import TogglePillButton from "../../TogglePillButton";
const schema=z.object({items:z.array(z.object({instanceId:z.uuid(),title:z.string(),kind:z.string(),assignment:AssignmentMetadataSchema,href:z.string()}))});
export default function AssignedCards({completed=false}:{completed?:boolean}) {
 const {t}=useTranslation(),colors=useColors(),api=useFormCampaigns("/api/work-hub/library/to-complete",v=>schema.parse(v));
 return <View style={{gap:12}}>{api.data?.items.filter(x=>completed?x.assignment.status==="completed":["assigned","in_progress"].includes(x.assignment.status)).map(x=><View key={x.instanceId} style={{borderWidth:2,borderColor:colors.primary,borderRadius:14,padding:16,gap:8,backgroundColor:colors.card}}><Text style={{color:colors.text}}>{t(`workHubLibrary.kind_${x.kind}`)}</Text><Text style={{color:colors.text,fontWeight:"700"}}>{x.title}</Text>{x.assignment.dueAt&&<Text style={{color:colors.text}}>{new Date(x.assignment.dueAt).toLocaleString()}</Text>}<TogglePillButton color="brand" onPress={()=>router.push(x.href as never)}>{t(completed?"workHubLibrary.viewResponse":"workHubLibrary.open")}</TogglePillButton></View>)}{api.error&&<Text style={{color:colors.mutedForeground}}>{api.error}</Text>}</View>;
}
