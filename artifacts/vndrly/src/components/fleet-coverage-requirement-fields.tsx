import { useState } from "react";
import { useTranslation } from "react-i18next";
import { FleetRequirementVersionSchema, FleetInsuranceWorkScopeSchema, fleetComplianceSourceChoiceLabel, type FleetRequirementVersion } from "@workspace/api-zod";
type Coverage=FleetRequirementVersion["coverage"];
/** Key by requirement identity/revision in the parent to discard another draft. */
export function FleetCoverageRequirementFields({value,disabled,onChange}:{value?:Coverage;disabled?:boolean;onChange:(value:Coverage)=>void}){
 const {i18n}=useTranslation(),lang=(i18n.resolvedLanguage??i18n.language??"en").startsWith("es")?"es":"en",say=(en:string,es:string)=>lang==="es"?es:en;
 const [type,setType]=useState<string>(value?.coverageType??""),[limit,setLimit]=useState(value?.requiredLimitUSD??""),[filing,setFiling]=useState(value?(value.filingRequired?"yes":"no"):"");
 function publish(nextType:string,nextLimit:string,nextFiling:string){
   const parsed=nextType&&nextLimit.trim()&&nextFiling?FleetRequirementVersionSchema.shape.coverage.safeParse({coverageType:nextType,requiredLimitUSD:nextLimit.trim(),filingRequired:nextFiling==="yes"}):null;
   onChange(parsed?.success?parsed.data:undefined);
 }
 const ready=type&&limit.trim()&&filing&&FleetRequirementVersionSchema.shape.coverage.safeParse({coverageType:type,requiredLimitUSD:limit.trim(),filingRequired:filing==="yes"}).success;
 return <fieldset disabled={disabled} className="fleet-detail-group space-y-3">
   <legend>{say("Reviewed coverage requirement","Requisito de cobertura revisado")}</legend>
   <label>{say("Coverage required","Cobertura requerida")}<select value={type} onChange={event=>{setType(event.target.value);publish(event.target.value,limit,filing);}}><option value="">{say("Unknown — needs review","Desconocido — requiere revisión")}</option>{FleetInsuranceWorkScopeSchema.shape.coverageType.options.map(id=><option key={id} value={id}>{fleetComplianceSourceChoiceLabel(id,lang)}</option>)}</select></label>
   <label>{say("Exact minimum limit (USD)","Límite mínimo exacto (USD)")}<input value={limit} inputMode="decimal" onChange={event=>{setLimit(event.target.value);publish(type,event.target.value,filing);}}/></label>
   <label>{say("Government filing required for this requirement","Presentación oficial requerida para este requisito")}<select value={filing} onChange={event=>{setFiling(event.target.value);publish(type,limit,event.target.value);}}><option value="">{say("Unknown — needs review","Desconocido — requiere revisión")}</option><option value="yes">{say("Yes","Sí")}</option><option value="no">{say("No","No")}</option></select></label>
   {!ready&&<p>{say("Coverage terms unresolved; this requirement cannot establish work coverage.","Términos de cobertura sin resolver; este requisito no demuestra cobertura del trabajo.")}</p>}
 </fieldset>;
}
