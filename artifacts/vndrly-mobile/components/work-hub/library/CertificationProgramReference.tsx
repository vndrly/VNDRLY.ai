import {z} from 'zod/v4';
import {router} from 'expo-router';
import {useFormCampaigns} from '@/lib/use-form-campaigns';
const catalogSchema = z.object({items:z.array(z.object({itemId:z.uuid(),kind:z.string(),familyId:z.string().nullable().optional()}))});
import React from 'react';
import {Text, View} from 'react-native';
import {useTranslation} from 'react-i18next';
import type {CertificationProgram} from '@workspace/api-zod/certification-program-links';
import {useColors} from '@/hooks/useColors';

export default function CertificationProgramReference({program}: {program: CertificationProgram}) {
  const colors = useColors(), {i18n} = useTranslation();
  const catalog = useFormCampaigns('/api/work-hub/library', value => catalogSchema.parse(value));
  const courseIds = new Map(catalog.data?.items.filter(item=>item.kind==='training' && item.familyId).map(item=>[item.familyId,item.itemId]) ?? []);
  return <View testID="certification-program-reference" style={{minWidth:0,maxWidth:'100%',gap:16,borderWidth:2,borderColor:colors.primary,borderRadius:14,backgroundColor:'#242426',padding:16}}>
    <Text accessibilityRole="header" style={{color:'#ececec',fontSize:20,fontWeight:'700'}}>{program.title}</Text>
    <Text style={{color:'#ececec',fontSize:14,lineHeight:24}}>{program.description}</Text>
    <Text accessibilityRole="header" style={{color:'#ececec',fontWeight:'700'}}>{i18n.language.startsWith('es') ? 'Cursos incluidos' : 'Included courses'}</Text>
    {program.courses.map(course => <Text key={course.id} accessibilityRole={courseIds.has(course.id) ? 'link' : undefined} onPress={courseIds.has(course.id) ? ()=>router.push(('/work-hub/course/'+courseIds.get(course.id)) as any) : undefined} style={{color:'#ececec',fontSize:14,lineHeight:20,borderTopWidth:1,borderTopColor:'#ffffff1a',paddingTop:12}}>{course.title}</Text>)}
  </View>;
}
