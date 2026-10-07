import React,{useEffect,useRef,useState} from 'react';
import {Text,TextInput,View} from 'react-native';
import {useTranslation} from 'react-i18next';
import {AssetIdentifierClaimContinuationSchema,AssetIdentifierClaimInputSchema,AssetIdentifierClaimResolutionSchema,AssetLossReportInputSchema,type AssetIdentifierClaim,type AssetIdentifierNotice} from '@workspace/api-zod';
import TogglePillButton from '@/components/TogglePillButton';
import {useColors} from '@/hooks/useColors';
import {apiFetch} from '@/lib/api';
import {captureAuthScope,getUser,isAuthScopeCurrent,subscribeToken,subscribeUser,type AuthScope} from '@/lib/auth';
import {nativeUuid} from '@/lib/native-uuid';
type Owner={type:'vendor'|'partner';id:number};
type Detail={id:string;version:number;holderUserId:number|null;lastCustody?:{holderDisplayName:string|null;holderUserId:number|null;recordedAt:string}|null;gpsTag?:{status:string;location:null}};
type Attempt={assetId:string;path:string;kind:'loss'|'claim'|'resolve'|'respond'|'withdraw';body:Record<string,unknown>;version:number;claimId?:string};
type Claims={claims:AssetIdentifierClaim[];truncated:boolean;incoming?:AssetIdentifierNotice[];incomingTruncated?:boolean};
const sameAlias=(a:unknown,b:unknown)=>{const x=a as Record<string,unknown>|undefined,y=b as typeof x;return !!x&&!!y&&x.kind===y.kind&&x.value===y.value&&x.jurisdiction===y.jurisdiction;};
export function InventoryRecovery(props:{assetId:string;owner:Owner;canManage:boolean;onRefresh:()=>void|Promise<void>;includePlatformQueue?:boolean}){
 return <Recovery key={`${props.owner.type}:${props.owner.id}:${props.assetId}`} {...props}/>;
}
function Recovery({assetId,owner,canManage,onRefresh,includePlatformQueue}:Parameters<typeof InventoryRecovery>[0]){
 const {t}=useTranslation(),colors=useColors(),copy=(key:string)=>t(`inventoryRecovery.${key}`);
 const [open,setOpen]=useState(false),[detail,setDetail]=useState<Detail|null>(null),[claims,setClaims]=useState<Claims|null>(null),[queue,setQueue]=useState<{claims:AssetIdentifierClaim[];truncated:boolean}|null>(null),[userId,setUserId]=useState<number|null>(null),[platform,setPlatform]=useState(false),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[kind,setKind]=useState<'loss'|'claim'|'resolve'|'respond'|'withdraw'|null>(null),[condition,setCondition]=useState<'missing'|'stolen'>('missing'),[reason,setReason]=useState(''),[alias,setAlias]=useState(''),[aliasKind,setAliasKind]=useState('serial'),[jurisdiction,setJurisdiction]=useState(''),[decision,setDecision]=useState('request_evidence'),[selectedClaim,setSelectedClaim]=useState<AssetIdentifierClaim|null>(null),[review,setReview]=useState<Attempt|null>(null),[unknown,setUnknown]=useState(false),[conflict,setConflict]=useState(false);
 const request=useRef<AbortController|null>(null),alive=useRef(false),attempt=useRef<Attempt|null>(null),currentScope=useRef<AuthScope|null>(null);
 useEffect(()=>{alive.current=true;const clear=()=>{request.current?.abort();request.current=null;currentScope.current=null;attempt.current=null;setDetail(null);setClaims(null);setQueue(null);setUserId(null);setPlatform(false);setKind(null);setReview(null);setUnknown(false);setConflict(false);setBusy(false);setMessage('');setReason('');setAlias('');};const a=subscribeUser(clear),b=subscribeToken(clear);return()=>{alive.current=false;request.current?.abort();a();b();};},[]);
 async function run(work:(scope:AuthScope,signal:AbortSignal,check:()=>void)=>Promise<void>){
  if(request.current)return;const controller=new AbortController(),scope=captureAuthScope();request.current=controller;currentScope.current=scope;
  const current=()=>alive.current&&request.current===controller&&!controller.signal.aborted&&isAuthScopeCurrent(scope),check=()=>{if(!current())throw Object.assign(Error('Authorization changed'),{name:'AbortError'});};
  setBusy(true);setMessage('');try{check();await work(scope,controller.signal,check);}catch(e){if(current())setMessage(e instanceof Error?e.message:copy('unavailable'));}finally{if(current())setBusy(false);if(request.current===controller)request.current=null;}
 }
 async function load(scope:AuthScope,signal:AbortSignal,check:()=>void){
  const user=await getUser();check();if(!user||user.role!=='admin'&&(owner.type==='vendor'?user.vendorId:user.partnerId)!==owner.id)throw Error(copy('unavailable'));
  const row=await apiFetch<Detail>(`/api/implementation-a/assets/${encodeURIComponent(assetId)}`,{signal},scope);check();if(row.id!==assetId||!Number.isSafeInteger(row.version)||row.version<1)throw Error(copy('unavailable'));
  setDetail(row);setUserId(user.id);setPlatform(user.role==='admin');
  if(canManage){const result=await apiFetch<Claims>(`/api/implementation-a/assets/${encodeURIComponent(assetId)}/identifier-claims`,{signal},scope);check();if(!Array.isArray(result.claims)||result.claims.some(c=>c.assetId!==assetId))throw Error(copy('unavailable'));setClaims(result);}
  if(includePlatformQueue&&user.role==='admin'){const result=await apiFetch<{claims:AssetIdentifierClaim[];truncated:boolean}>('/api/implementation-a/asset-identifier-claims',{signal},scope);check();if(!Array.isArray(result.claims))throw Error(copy('unavailable'));setQueue(result);}
 }
 const openPanel=()=>{if(busy)return;setOpen(true);setDetail(null);setClaims(null);setQueue(null);setUserId(null);setPlatform(false);void run(load);};
 function begin(next:'loss'|'claim'|'resolve'|'respond'|'withdraw',value?:'missing'|'stolen',claim?:AssetIdentifierClaim){attempt.current=null;setReview(null);setKind(next);setReason('');setAlias('');setJurisdiction('');setSelectedClaim(claim??null);setUnknown(false);setConflict(false);if(value)setCondition(value);}
 function prepare(){
  if(!detail||!currentScope.current||!isAuthScopeCurrent(currentScope.current))return;
  const operationId=nativeUuid(),identifier={kind:aliasKind,value:alias.trim(),...(aliasKind==='plate'&&jurisdiction.trim()?{jurisdiction:jurisdiction.trim()}:{})};
  let body:Record<string,unknown>,path:string,target=assetId,version=detail.version,claimId:string|undefined;
  try{
   if(kind==='loss'){body=AssetLossReportInputSchema.parse({operationId,expectedVersion:version,condition,reason,confirmed:true});path=`/api/implementation-a/assets/${assetId}/loss-report`;}
   else if(kind==='claim'){claimId=nativeUuid();body=AssetIdentifierClaimInputSchema.parse({operationId,claimId,expectedVersion:version,alias:identifier,reason,confirmed:true});path=`/api/implementation-a/assets/${assetId}/identifier-claims`;}
   else if((kind==='respond'||kind==='withdraw')&&canManage&&!platform&&selectedClaim&&selectedClaim.assetId===assetId){version=selectedClaim.version;claimId=selectedClaim.id;body=AssetIdentifierClaimContinuationSchema.parse({operationId,expectedVersion:version,reason,confirmed:true});path=`/api/implementation-a/assets/${assetId}/identifier-claims/${claimId}/${kind}`;}
   else if(kind==='resolve'&&platform&&selectedClaim){target=selectedClaim.assetId;version=selectedClaim.version;claimId=selectedClaim.id;body=AssetIdentifierClaimResolutionSchema.parse({operationId,expectedVersion:version,decision,reason,confirmed:true,...(decision==='correct_requester_alias'?{correctedAlias:identifier}:{})});path=`/api/implementation-a/assets/${target}/identifier-claims/${claimId}/resolve`;}
   else return;
   const next={assetId:target,path,kind:kind!,body,version,claimId};attempt.current=next;setReview(next);setMessage('');
  }catch{setMessage(copy('required'));}
 }
 const save=()=>void run(async(scope,signal,check)=>{
  const sent=attempt.current;if(!sent||review!==sent)return;
  let verified=false;
  try{
   const result=await apiFetch<Record<string,unknown>>(sent.path,{method:'POST',body:JSON.stringify(sent.body),signal},scope);check();
   let exact=result.assetId===sent.assetId&&result.operationId===sent.body.operationId;
   if(sent.kind==='loss')exact=exact&&result.version===sent.version+1&&result.status==='applied'&&result.condition===sent.body.condition&&result.physicalLossVerified===false&&Number.isFinite(Date.parse(String(result.reportedAt)));
   else{const status=sent.kind==='claim'||sent.kind==='respond'?'pending_review':sent.kind==='withdraw'?'withdrawn':({request_evidence:'awaiting_evidence',reject:'rejected',retain_existing:'resolved_existing_retained',correct_requester_alias:'resolved_requester_corrected'} as Record<string,string>)[String(sent.body.decision)];exact=exact&&result.id===sent.claimId&&result.version===(sent.kind==='claim'?1:sent.version+1)&&result.status===status&&result.ownershipTransferred===false&&result.otherOwnerDisclosed===false&&(sent.kind!=='claim'||sameAlias(result.alias,sent.body.alias))&&(sent.body.correctedAlias===undefined||sameAlias(result.correctedAlias,sent.body.correctedAlias));}
   if(sent.kind==='respond'||sent.kind==='withdraw')exact=exact&&result.responseReason===sent.body.reason&&result.physicalEvidenceVerified===false&&Number.isFinite(Date.parse(String(result[sent.kind==='respond'?'respondedAt':'withdrawnAt'])));
   if(!exact)throw Error(copy('unknown'));verified=true;attempt.current=null;setReview(null);setKind(null);setUnknown(false);setConflict(false);setClaims(null);setDetail(null);setMessage(copy('saved'));
   // A saved command remains saved even if its subsequent fresh projection fails.
   try{await load(scope,signal,check);}catch{check();setDetail(null);setClaims(null);setQueue(null);setMessage(copy('savedRefresh'));}
   await Promise.resolve(onRefresh()).catch(()=>undefined);check();
  }catch(e){check();if(verified){setDetail(null);setClaims(null);setQueue(null);setMessage(copy('savedRefresh'));return;}const status=(e as {status?:number}).status;const code=e instanceof Error?e.message:'';const changed=[401,403,409].includes(status??0)||/asset\.(version_conflict|current_session_required|current_membership_required|asset_manager_required|mediator_required|claim_terminal|loss_report_unavailable|claim_unavailable|identifier_in_use|identifier_collision_required|invalid_identifier|operation_reused)/.test(code);setConflict(changed);setUnknown(!changed);setMessage(copy(changed?'conflict':'unknown'));}
 });
 const action=(label:string,onPress:()=>void,disabled=busy)=> <TogglePillButton color="blue" accessibilityLabel={label} disabled={disabled} onPress={onPress}>{label}</TogglePillButton>;
 const input=(label:string,value:string,onChangeText:(v:string)=>void,maxLength=2000)=><TextInput accessibilityLabel={label} editable={!busy&&!review} value={value} onChangeText={onChangeText} maxLength={maxLength} style={{color:colors.text,borderWidth:1,borderColor:colors.border,padding:10,minHeight:44}}/>;
 const muted={color:colors.mutedForeground};
 function showClaim(c:AssetIdentifierClaim|AssetIdentifierNotice,allowReview=false,allowRequester=false){return <View key={c.id} style={{gap:6}}><Text style={muted}>{c.alias.value} · {copy(`statuses.${c.status}`)}</Text>{'correctedAlias' in c&&c.correctedAlias?<Text style={muted}>{copy('corrected')}: {c.correctedAlias.value}</Text>:null}{allowRequester&&'reviewReason' in c&&c.reviewReason?<Text style={muted}>{copy('reviewRequest')}: {c.reviewReason}</Text>:null}{allowRequester&&'responseReason' in c&&c.responseReason?<Text style={muted}>{copy('responseRecord')}: {c.responseReason}</Text>:null}{allowRequester&&canManage&&!platform&&c.assetId===assetId&&'requesterActions' in c&&c.requesterActions?.includes('respond')?action(copy('respond'),()=>begin('respond',undefined,c as AssetIdentifierClaim),busy||!!review):null}{allowRequester&&canManage&&!platform&&c.assetId===assetId&&'requesterActions' in c&&c.requesterActions?.includes('withdraw')?action(copy('withdraw'),()=>begin('withdraw',undefined,c as AssetIdentifierClaim),busy||!!review):null}{allowReview&&['pending_review','awaiting_evidence'].includes(c.status)?action(copy('reviewClaim'),()=>begin('resolve',undefined,c as AssetIdentifierClaim),busy||!!review):null}</View>;}
 return <View style={{gap:8}}>{action(copy('detail'),openPanel)}{open&&<View style={{gap:8}}>{detail?<>
  <Text style={muted}>{copy('tag')}</Text>{detail.lastCustody?<><Text style={muted}>{detail.lastCustody.holderDisplayName??detail.lastCustody.holderUserId}</Text><Text style={muted}>{copy('last')}: {detail.lastCustody.recordedAt}</Text></>:null}<Text style={muted}>{copy('recorded')}</Text>
  {canManage||detail.holderUserId===userId?<View style={{flexDirection:'row',flexWrap:'wrap',gap:8}}>{action(copy('missing'),()=>begin('loss','missing'),busy||!!review)}{action(copy('stolen'),()=>begin('loss','stolen'),busy||!!review)}</View>:null}
  {canManage?action(copy('claim'),()=>begin('claim'),busy||!!review):null}
  {claims?<><Text style={muted}>{copy('own')}</Text>{claims.claims.map(c=>showClaim(c,false,true))}<Text style={muted}>{copy('incoming')}</Text>{claims.incoming?.map(c=>showClaim(c))}{claims.truncated||claims.incomingTruncated?<Text style={muted}>{copy('partial')}</Text>:null}</>:null}
  {queue?<><Text style={muted}>{copy('queue')}</Text>{queue.claims.map(c=>showClaim(c,true))}{queue.truncated?<Text style={muted}>{copy('partial')}</Text>:null}</>:null}
 </>:null}
 {kind&&!review?<View style={{gap:8}}><Text style={muted}>{copy(kind==='loss'?'lossHint':kind==='respond'||kind==='withdraw'?'continuationHint':'claimHint')}</Text>{input(copy('reason'),reason,setReason)}
  {kind==='resolve'?<View style={{gap:6}}>{['request_evidence','reject','retain_existing','correct_requester_alias'].map(d=><TogglePillButton key={d} color="blue" solid={decision===d} disabled={busy} onPress={()=>setDecision(d)}>{copy(`decisions.${d}`)}</TogglePillButton>)}</View>:null}
  {kind==='claim'||kind==='resolve'&&decision==='correct_requester_alias'?<><View style={{flexDirection:'row',flexWrap:'wrap',gap:6}}>{['serial','vin','plate','asset_tag','model','other'].map(k=><TogglePillButton key={k} color="blue" solid={aliasKind===k} disabled={busy} onPress={()=>setAliasKind(k)}>{copy(`identifiers.${k}`)}</TogglePillButton>)}</View>{input(copy('alias'),alias,setAlias,200)}{aliasKind==='plate'?input(copy('jurisdiction'),jurisdiction,setJurisdiction,32):null}</>:null}
  {action(copy('review'),prepare,busy||!reason.trim())}</View>:null}
 {review?<View style={{gap:8}}><Text style={muted}>{copy(review.kind==='loss'?'lossHint':review.kind==='respond'||review.kind==='withdraw'?'continuationHint':'claimHint')}</Text><Text style={muted}>{copy('recordVersion')}: {review.version}</Text>{['resolve','respond','withdraw'].includes(review.kind)?<Text style={muted}>{copy('claimReference')}: {review.claimId}</Text>:null}<Text style={muted}>{String(review.body.reason)}</Text>{review.kind==='loss'?<Text style={muted}>{copy(String(review.body.condition))}</Text>:null}{[review.body.alias,review.body.correctedAlias].filter(Boolean).map((value,index)=>{const identifier=value as {kind:string;value:string;jurisdiction?:string};return <Text key={index} style={muted}>{copy(`identifiers.${identifier.kind}`)}: {identifier.value}{identifier.jurisdiction?` · ${identifier.jurisdiction}`:''}</Text>;})}{review.kind==='respond'||review.kind==='withdraw'?<Text style={muted}>{copy(review.kind)}</Text>:null}{review.kind==='resolve'?<Text style={muted}>{copy(`decisions.${String(review.body.decision)}`)}</Text>:null}{conflict?action(copy('refresh'),()=>{void run(async(scope,signal,check)=>{await load(scope,signal,check);attempt.current=null;setReview(null);setKind(null);setConflict(false);setUnknown(false);});}):action(copy(unknown?'retry':'confirm'),save)}</View>:null}
 </View>}{message?<Text style={muted}>{message}</Text>:null}</View>;
}
