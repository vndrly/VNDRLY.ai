import {useColors} from '@/hooks/useColors';
import ImagePill from '../ImagePill';
import React,{useState} from 'react';
import {View,Text,Pressable} from 'react-native';
import {router} from 'expo-router';
import {catalogDisplayTitle,type CatalogProfile} from '@workspace/api-zod/catalog-profile';
import {expirationShield} from '@workspace/api-zod/profile-status';
import {useGateQuery} from '@/hooks/use-gate-query';
import {GateRow,gateStyle} from '../gate/GateChrome';
import StatusShield from '../StatusShield';
export default function ProfileCatalogTraining(){
 const colors=useColors();
 const api=useGateQuery<CatalogProfile>('/api/work-hub/catalog/training/state');
 const [open,setOpen]=useState<string[]>([]);
 const toggle=(id:string)=>setOpen(values=>values.includes(id)?values.filter(v=>v!==id):[...values,id]);
 const courses=(rows:CatalogProfile['courses'])=>rows.map(c=><View key={c.id} style={{paddingLeft:12}}>
  <GateRow label={catalogDisplayTitle(c.title)} expanded={open.includes(c.id)} onPress={()=>toggle(c.id)} trailing={<View style={{flexDirection:'row',alignItems:'center',gap:8}}><ImagePill color={c.percent===100?"green":c.percent?"amber":"grey"} accessibilityLabel="Course completion">{c.percent}%</ImagePill><StatusShield status={c.percent===100?'green':c.percent?'yellow':'grey'} label={c.percent===100?'Completed':c.percent?'In progress':'Not started'}/></View>}/>
  {open.includes(c.id)&&<View style={{gap:8,padding:12}}><Pressable onPress={()=>router.push(`/work-hub/course/${c.id}` as never)}><Text style={gateStyle.text}>View Course</Text></Pressable>{c.score!==null&&<Text style={gateStyle.text}>Coursework: {c.score}%</Text>}{c.benchmarks.map(b=><View key={b.id} style={{gap:4}}><Text style={gateStyle.text}>{catalogDisplayTitle(b.title)}</Text><Text style={gateStyle.muted}>{b.complete?'Completed':'Pending'}{b.reviewedAt?' · '+new Date(b.reviewedAt).toLocaleDateString():''}</Text></View>)}</View>}
 </View>);
 const programs=(rows:CatalogProfile["programs"])=>rows.map(p=>{
  const status=p.complete?expirationShield(p.expiresAt,true):p.percent?'yellow':'grey';
  return <View key={p.id} style={p.complete?{marginVertical:6,padding:16,borderWidth:2,borderColor:colors.primary,borderRadius:14,backgroundColor:"#242426"}:undefined}><GateRow label={catalogDisplayTitle(p.title)} expanded={open.includes(p.id)} onPress={()=>toggle(p.id)} trailing={<View style={{flexDirection:'row',alignItems:'center',gap:8}}><ImagePill color={status==='yellow'?'amber':status} accessibilityLabel="Certification completion">{p.percent}%</ImagePill><StatusShield status={status} label={p.complete?(status==='yellow'?'Expires within 60 days':status==='red'?'Expired':'Completed'):p.percent?'In progress':'Not started'}/></View>}/>
  {open.includes(p.id)&&<View style={{padding:8,gap:8}}><Pressable onPress={()=>router.push(`/work-hub/bundle/${p.id}` as never)}><Text style={gateStyle.text}>View Certification</Text></Pressable>{p.score!==null&&<Text style={gateStyle.text}>Final assessment: {p.score}%</Text>}{p.awardedAt&&<Text style={gateStyle.muted}>Completed: {new Date(p.awardedAt).toLocaleDateString()}</Text>}{p.expiresAt&&<Text style={[gateStyle.muted,{color:expirationTextColors[expirationShield(p.expiresAt)]}]}>Expires: {p.expiresAt}</Text>}{courses(p.courses)}</View>}</View>;
 });
 const assigned=api.data?.programs.filter(p=>!p.complete)??[],completed=api.data?.programs.filter(p=>p.complete)??[],extra=api.data?.courses.filter(c=>c.sources.includes(c.id))??[];
 const badge=(values:number[])=>{const percent=values.length?Math.round(values.reduce((a,b)=>a+b,0)/values.length):0,status=percent===100?"green":percent?"yellow":"grey";return <View style={{flexDirection:"row",alignItems:"center",gap:8}}><ImagePill color={status==='yellow'?'amber':status} accessibilityLabel="Training completion">{percent}%</ImagePill><StatusShield status={status} label={status==='green'?'Completed':status==='yellow'?'In progress':'Not started'}/></View>;};
 return <View>{api.error&&<Text accessibilityRole="alert" style={gateStyle.text}>{api.error.message}</Text>}
 <GateRow label="Assigned certifications" expanded={open.includes("assigned")} onPress={()=>toggle("assigned")} trailing={badge(assigned.flatMap(p=>p.courses.map(c=>c.percent)))}/>{open.includes("assigned")&&programs(assigned)}
 <GateRow label="Extra training" expanded={open.includes("extra")} onPress={()=>toggle("extra")} trailing={badge(extra.map(c=>c.percent))}/>{open.includes("extra")&&courses(extra)}
 <GateRow label="VNDRLY/U certifications" expanded={open.includes("completed")} onPress={()=>toggle("completed")}/>{open.includes("completed")&&programs(completed)}
 </View>;
}

const expirationTextColors = {green: "#00db8b", yellow: "#fbbf24", red: "#ef4444", grey: "#a1a1aa"} as const;
