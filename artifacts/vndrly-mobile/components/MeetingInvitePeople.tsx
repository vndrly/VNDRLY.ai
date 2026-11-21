import React, {useEffect,useRef,useState} from 'react';
import {View,Text,Pressable,TextInput} from 'react-native';
import {apiFetch} from '@/lib/api';
import {captureAuthScope,isAuthScopeCurrent} from '@/lib/auth';
import {useColors} from '@/hooks/useColors';
type Person={userId:number;displayName:string|null};
export default function MeetingInvitePeople({occurrenceId,onSaved}:{occurrenceId:string;onSaved:()=>Promise<unknown>}){
 const colors=useColors(),[open,setOpen]=useState(false),[people,setPeople]=useState<Person[]>([]),[search,setSearch]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const mounted=useRef(true);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
 async function load(){const scope=captureAuthScope();setOpen(true);setBusy(true);setError('');try{const result=await apiFetch<{people:Person[]}>(`/api/work-hub/meetings/${encodeURIComponent(occurrenceId)}/invite-candidates`,undefined,scope);if(mounted.current&&isAuthScopeCurrent(scope))setPeople(result.people);}catch(e){if(mounted.current&&isAuthScopeCurrent(scope))setError(String(e));}finally{if(mounted.current&&isAuthScopeCurrent(scope))setBusy(false);}}
 async function invite(userId:number){if(busy)return;const scope=captureAuthScope();setBusy(true);setError('');try{await apiFetch(`/api/work-hub/meetings/${encodeURIComponent(occurrenceId)}/invitations`,{method:'POST',body:JSON.stringify({userId})},scope);if(mounted.current&&isAuthScopeCurrent(scope)){setPeople(list=>list.filter(p=>p.userId!==userId));await onSaved();}}catch(e){if(mounted.current&&isAuthScopeCurrent(scope))setError(String(e));}finally{if(mounted.current&&isAuthScopeCurrent(scope))setBusy(false);}}
 return <View style={{gap:8}}><Pressable accessibilityRole="button" disabled={busy} onPress={()=>open?setOpen(false):void load()} style={{padding:10,borderWidth:1,borderColor:colors.primary,borderRadius:8}}><Text style={{color:colors.text}}>{open?'Close invitations':'Invite to meeting'}</Text></Pressable>{open&&<><TextInput accessibilityLabel="Find people to invite" placeholder="Find people" value={search} onChangeText={setSearch} style={{color:colors.text,padding:10,borderWidth:1,borderColor:colors.primary,borderRadius:8}}/>{people.filter(p=>(p.displayName??'').toLowerCase().includes(search.toLowerCase())).map(p=><Pressable key={p.userId} accessibilityRole="button" disabled={busy} onPress={()=>void invite(p.userId)} style={{padding:10}}><Text style={{color:colors.text}}>Invite {p.displayName??'Member'}</Text></Pressable>)}{!busy&&!people.length&&<Text style={{color:colors.text}}>No more people to invite</Text>}</>}{!!error&&<Text accessibilityRole="alert" style={{color:colors.destructive}}>{error}</Text>}</View>;
}
