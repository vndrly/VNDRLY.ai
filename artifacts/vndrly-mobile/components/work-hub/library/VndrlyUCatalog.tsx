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
export default function VndrlyUCatalog({kind,search=''}:{kind:'programs'|'courses';search?:string}){
 const colors=useColors(),catalog=useFormCampaigns('/api/work-hub/catalog',v=>schema.parse(v));
 const matches=(s:string)=>s.toLowerCase().includes(search.toLowerCase());
 return <View style={{gap:12}}>{catalog.loading&&<Text style={{color:colors.text}}>Loading catalog…</Text>}{!!catalog.error&&<Text accessibilityRole="alert" style={{color:colors.text}}>{String(catalog.error)}</Text>}{kind==='programs'?catalog.data?.programs.filter(p=>matches(p.title+' '+(p.equivalentCertification??''))).map(p=><View key={p.id} style={{padding:16,borderWidth:1,borderColor:colors.primary,borderRadius:14,gap:8}}><Pressable accessibilityRole="link" onPress={()=>router.push(('/work-hub/bundle/'+p.id) as any)}><Text style={{color:colors.primary,fontWeight:'700'}}>{p.title}</Text></Pressable>{p.equivalentCertification&&<Text style={{color:colors.text}}>Equivalent certification: {p.equivalentCertification}</Text>}<Text style={{color:colors.text}}>{p.courseIds.length} constituent courses</Text></View>):catalog.data?.courses.filter(c=>matches(c.title)).map(c=><CatalogCourseRow key={c.id} {...c}/>)}</View>;
}
