import React,{useState} from "react";
import {Text,TextInput,View} from "react-native";
import {useTranslation} from "react-i18next";
import {FleetRequirementVersionSchema,FleetInsuranceWorkScopeSchema,fleetComplianceSourceChoiceLabel,type FleetRequirementVersion} from "@workspace/api-zod";
import {useColors} from "@/hooks/useColors";
import FleetChoiceField from "./FleetChoiceField";
type Coverage=FleetRequirementVersion["coverage"];
export default function FleetCoverageRequirementFields({value,disabled,onChange}:{value?:Coverage;disabled?:boolean;onChange:(value:Coverage)=>void}){
 const colors=useColors(),{i18n}=useTranslation(),lang=(i18n.resolvedLanguage??i18n.language??"en").startsWith("es")?"es":"en",say=(en:string,es:string)=>lang==="es"?es:en;
 const [type,setType]=useState<string>(value?.coverageType??""),[limit,setLimit]=useState(value?.requiredLimitUSD??""),[filing,setFiling]=useState(value?(value.filingRequired?"yes":"no"):"");
 function publish(nextType:string,nextLimit:string,nextFiling:string){const parsed=nextType&&nextLimit.trim()&&nextFiling?FleetRequirementVersionSchema.shape.coverage.safeParse({coverageType:nextType,requiredLimitUSD:nextLimit.trim(),filingRequired:nextFiling==="yes"}):null;onChange(parsed?.success?parsed.data:undefined);}
 const ready=type&&limit.trim()&&filing&&FleetRequirementVersionSchema.shape.coverage.safeParse({coverageType:type,requiredLimitUSD:limit.trim(),filingRequired:filing==="yes"}).success;
 return <View style={{backgroundColor:colors.card,borderColor:colors.primary,borderWidth:2,borderRadius:10,padding:12,gap:10}}>
  <Text style={{color:colors.text,fontWeight:"700"}}>{say("Reviewed coverage requirement","Requisito de cobertura revisado")}</Text>
  <FleetChoiceField label={say("Coverage required","Cobertura requerida")} value={type} disabled={disabled} options={FleetInsuranceWorkScopeSchema.shape.coverageType.options.map(id=>({id,label:fleetComplianceSourceChoiceLabel(id,lang)}))} onChange={next=>{setType(next);publish(next,limit,filing);}}/>
  <Text style={{color:colors.text}}>{say("Exact minimum limit (USD)","Límite mínimo exacto (USD)")}</Text><TextInput accessibilityLabel={say("Exact minimum limit (USD)","Límite mínimo exacto (USD)")} style={{color:colors.text,backgroundColor:colors.card,borderColor:colors.primary,borderWidth:2,borderRadius:8,padding:10}} value={limit} editable={!disabled} keyboardType="decimal-pad" onChangeText={next=>{setLimit(next);publish(type,next,filing);}}/>
  <FleetChoiceField label={say("Government filing required for this requirement","Presentación oficial requerida para este requisito")} value={filing} disabled={disabled} options={[{id:"yes",label:say("Yes","Sí")},{id:"no",label:"No"}]} onChange={next=>{setFiling(next);publish(type,limit,next);}}/>
  {!ready&&<Text style={{color:colors.text}}>{say("Coverage terms unresolved; this requirement cannot establish work coverage.","Términos de cobertura sin resolver; este requisito no demuestra cobertura del trabajo.")}</Text>}
 </View>;
}
