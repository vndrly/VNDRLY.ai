import React,{useState} from 'react';
import {Text,View,Pressable} from 'react-native';
import {router} from 'expo-router';
import {z} from 'zod/v4';
import {useColors} from '@/hooks/useColors';
import {useFormCampaigns} from '@/lib/use-form-campaigns';
import TrainingBody from './TrainingBody';
const schema=z.object({programs:z.array(z.object({id:z.string(),title:z.string(),equivalentCertification:z.string().nullable(),courseIds:z.array(z.string())})),courses:z.array(z.object({id:z.string(),title:z.string()}))});
const courseSchema=z.object({title:z.string(),lessons:z.array(z.object({id:z.string(),title:z.string(),body:z.string()}))});
function CatalogCourse({id}:{id:string}){
 const colors=useColors(),course=useFormCampaigns(`/api/work-hub/catalog/courses/${id}`,v=>courseSchema.parse(v));
 const [opened,setOpened]=useState<string|null>(null);
 return <View style={{gap:12}}>{course.loading&&<Text style={{color:colors.text}}>Loading course…</Text>}{!!course.error&&<Text accessibilityRole="alert" style={{color:colors.text}}>{String(course.error)}</Text>}{course.data?.lessons.map(l=><View key={l.id}><Pressable accessibilityRole="button" accessibilityState={{expanded:opened===l.id}} onPress={()=>setOpened(opened===l.id?null:l.id)} style={{paddingVertical:12}}><Text style={{color:colors.text,fontWeight:'700'}}>{opened===l.id?'▾':'▸'} {l.title}</Text></Pressable>{opened===l.id&&<TrainingBody text={l.body} color={colors.text}/>}</View>)}</View>;
}
export function CatalogCourseRow({id,title}:{id:string;title:string}){
 const colors=useColors(),[open,setOpen]=useState(false);
 return <View><Pressable accessibilityRole="button" accessibilityState={{expanded:open}} onPress={()=>setOpen(!open)} style={{paddingVertical:12}}><Text style={{color:colors.primary,fontWeight:'700'}}>{open?'▾':'▸'} {title}</Text></Pressable>{open&&<CatalogCourse id={id}/>}</View>;
}
export default function VndrlyUCatalog({kind,search='',mine=false}:{kind:'programs'|'courses';search?:string;mine?:boolean}){
 const colors=useColors(),catalog=useFormCampaigns('/api/work-hub/catalog',v=>schema.parse(v));
 const personal=useFormCampaigns('/api/work-hub/catalog/training/state',v=>z.object({programs:z.array(z.object({id:z.string(),complete:z.boolean().optional(),expiresAt:z.string().nullable().optional(),awardedAt:z.string().nullable().optional(),certNumber:z.string().optional()}))}).parse(v));
 const matches=(s:string)=>s.toLowerCase().includes(search.toLowerCase());
 const date=(value:string)=>new Date(value).toLocaleDateString(undefined,{year:'numeric',month:'short',day:'numeric',timeZone:'UTC'});
 return <View style={{gap:12}}>{!!(catalog.error||(mine&&personal.error))&&<Text accessibilityRole="alert" style={{color:colors.text}}>{String(catalog.error||personal.error)}</Text>}{kind==='programs'?catalog.data?.programs.filter(p=>(!mine||personal.data?.programs.some(r=>r.id===p.id))&&matches(p.title+' '+(p.equivalentCertification??''))).map(p=>{
 const record=personal.data?.programs.find(r=>r.id===p.id),expires=record?.expiresAt?Date.parse(record.expiresAt):NaN;
 const expired=Number.isFinite(expires)&&expires<Date.now(),soon=Number.isFinite(expires)&&!expired&&expires-Date.now()<=90*86400000;
 const accent=record?.complete?(expired?'#ef4444':soon?'#f59e0b':'#22c55e'):colors.primary;
 return <View key={p.id} style={{padding:16,borderWidth:1,borderColor:accent,borderRadius:14,gap:8,backgroundColor:colors.card}}>
 <View style={{flexDirection:'row',alignItems:'flex-start',gap:8}}><Pressable accessibilityRole="link" onPress={()=>router.push(('/work-hub/bundle/'+p.id) as never)} style={{flex:1}}><Text style={{color:colors.text,fontWeight:'700'}}>{record?.complete&&<Text style={{color:accent}}>✓ </Text>}{p.title}</Text></Pressable>{record?.complete&&(expired||soon)&&<Pressable accessibilityRole="button" onPress={()=>router.push(('/work-hub/bundle/'+p.id) as never)} style={{borderWidth:1,borderColor:accent,borderRadius:7,paddingHorizontal:10,paddingVertical:6}}><Text style={{color:colors.text}}>Renew</Text></Pressable>}</View>
 {p.equivalentCertification&&<Text style={{color:colors.text}}>Equivalent certification: {p.equivalentCertification}</Text>}<Text style={{color:colors.text}}>{p.courseIds.length} constituent courses</Text>
 {record?.complete&&<View style={{flexDirection:'row',flexWrap:'wrap',gap:8}}><Text style={{color:accent,fontWeight:'700'}}>{expired?'Expired':soon?'Expiring soon':Number.isFinite(expires)?'Current':'No expiration recorded'}</Text>{record.awardedAt&&<Text style={{color:colors.text}}>Awarded: {date(record.awardedAt)}</Text>}{record.expiresAt&&<Text style={{color:accent}}>Expires: {date(record.expiresAt)}</Text>}{record.certNumber&&<Text style={{color:colors.text}}>Certificate: {record.certNumber}</Text>}</View>}
 </View>;
 }):catalog.data?.courses.filter(c=>matches(c.title)).map(c=><CatalogCourseRow key={c.id} {...c}/>)}</View>;
}
