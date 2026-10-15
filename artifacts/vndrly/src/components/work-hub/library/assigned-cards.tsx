import React from "react";
import {Paragraph as Text,Frame as View,Pill as TogglePillButton,usePalette as useColors} from "./editor-controls";
import {useLocation} from "wouter";
import {z} from "zod/v4";
import {AssignmentMetadataSchema} from "@workspace/api-zod";
import {useTranslation} from "react-i18next";

import {useLibrary as useFormCampaigns} from "./use-library";

const schema=z.object({items:z.array(z.object({instanceId:z.uuid(),title:z.string(),kind:z.string(),assignment:AssignmentMetadataSchema,href:z.string()}))});
export default function AssignedCards({completed=false}:{completed?:boolean}) {
 const [,navigate]=useLocation();const router={push:(path:string)=>navigate(path)};
 const {t}=useTranslation(),colors=useColors(),api=useFormCampaigns("/api/work-hub/library/to-complete",v=>schema.parse(v));
 return <View style={{gap:12}}>{api.data?.items.filter(x=>completed?x.assignment.status==="completed":["assigned","in_progress"].includes(x.assignment.status)).map(x=><View key={x.instanceId} style={{borderWidth:2,borderColor:colors.primary,borderRadius:14,padding:16,gap:8,backgroundColor:colors.card}}><Text style={{color:colors.text}}>{t(`workHubLibrary.kind_${x.kind}`)}</Text><Text style={{color:colors.text,fontWeight:"700"}}>{x.title}</Text>{x.assignment.dueAt&&<Text style={{color:colors.text}}>{new Date(x.assignment.dueAt).toLocaleString()}</Text>}<TogglePillButton color="brand" onPress={()=>router.push(x.href as never)}>{t(completed?"workHubLibrary.viewResponse":"workHubLibrary.open")}</TogglePillButton></View>)}{api.error&&<Text style={{color:colors.text}}>{api.error}</Text>}</View>;
}
