type Config={kind:string;durationHours?:number;choices?:{id:string;label:string}[];maxSelections?:number;resultsTiming?:string};
type State={status:string;deadline?:string|null};
export function campaignDeadline(config:Config,publishedAt:Date):Date{return new Date(publishedAt.getTime()+(config.durationHours??(config.kind==="poll"?24:720))*3600000);}
export function campaignCanSubmit(config:Config,state:State,now:Date):boolean{
 if(!["published","closed"].includes(state.status)||!state.deadline)return false;
 return config.kind!=="poll"||state.status==="published"&&now.getTime()<Date.parse(state.deadline);
}
export function validateCampaignResponse(config:Config,values:Record<string,unknown>):Record<string,unknown>{
 if(config.kind==="acknowledgement"){if(values.acknowledged!==true)throw Error("Explicit acknowledgement is required");return {acknowledged:true};}
 if(config.kind==="poll"){
  const selected=values.choices;if(!Array.isArray(selected)||selected.length<1||selected.length>(config.maxSelections??1)||new Set(selected).size!==selected.length||selected.some(id=>typeof id!=="string"||!config.choices?.some(c=>c.id===id)))throw Error("Choose only the allowed poll choices");
  return {choices:selected};
 }
 if(!values.values||typeof values.values!=="object"||Array.isArray(values.values))throw Error("Form values required");return values.values as Record<string,unknown>;
}
export function campaignResultsVisible(config:Pick<Config,"resultsTiming">,state:State,now:Date):boolean{return config.resultsTiming==="live"||state.status==="closed"||!!state.deadline&&now.getTime()>=Date.parse(state.deadline);}
