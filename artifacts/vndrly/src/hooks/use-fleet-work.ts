import {useEffect,useRef,useState} from "react";
import {openFleetWorkSession,type FleetWorkAccount,type FleetWorkSession,type FleetWorkCommand,type FleetWorkState,type FleetRun} from "@workspace/api-zod";
import {openWebFleetWorkStorage,openWebFleetWorkJournal} from "@/lib/fleet-work-journal-web";
export function useFleetWork(account:FleetWorkAccount|undefined,runs:readonly FleetRun[]){
 const identity=JSON.stringify(account??null),identityRef=useRef(identity);identityRef.current=identity;
 const [session,setSession]=useState<FleetWorkSession|null>(null),[status,setStatus]=useState({pending:0,needsReconciliation:0,pendingEvidence:0,locked:false}),[commands,setCommands]=useState<FleetWorkCommand[]>([]),[entries,setEntries]=useState<FleetWorkState["entries"]>([]),[error,setError]=useState("");
 const active=useRef<FleetWorkSession|null>(null);
 const refresh=async(sync=true)=>{const client=active.current;if(!client)return;try{if(sync)await client.synchronize();const state=await client.journal.readState();if(identityRef.current!==identity)return;setStatus(await client.journal.readStatus(client.scope));setEntries(state.entries);setCommands(state.entries.filter(row=>row.delivery.state!=="applied").map(row=>row.command));}catch(e){if(identityRef.current===identity)setError(e instanceof Error?e.message:"Retained Fleet work is unavailable");}};
 useEffect(()=>{let alive=true;active.current=null;setSession(null);setCommands([]);setEntries([]);setError("");if(!account)return;const current=()=>alive&&identityRef.current===identity;
  void(async()=>{try{const index=await openWebFleetWorkStorage(`fleet-account:${identity}`,current),client=await openFleetWorkSession({account,index,isCurrent:current,uuid:()=>crypto.randomUUID(),openJournal:scope=>openWebFleetWorkJournal(scope,current),http:async(path,body)=>{if(!current())throw Error("Original Fleet account changed");const response=await fetch(path,{credentials:"include",cache:"no-store",...(body?{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)}:{})});if(!response.ok)throw Object.assign(Error("Fleet work request could not be verified"),{status:response.status});return response.json();}});if(current()){active.current=client;setSession(client);if(client){for(const run of runs)await client.cacheRun(run);await refresh();}}}catch(e){if(current())setError(e instanceof Error?e.message:"Retained Fleet work is unavailable");}})();
  const online=()=>void refresh();window.addEventListener("online",online);return()=>{alive=false;window.removeEventListener("online",online);};
 },[identity]);
 const runSignature=JSON.stringify(runs);
 useEffect(()=>{if(!session)return;void Promise.all(runs.map(run=>session.cacheRun(run))).catch(()=>undefined);},[session,runSignature]);
 return {session,status,commands,entries,error,refresh};
}
