import React from 'react';
import {Text, View} from 'react-native';
import {useTranslation} from 'react-i18next';
import type {CertificationProgram} from '@workspace/api-zod/certification-program-links';
import {useColors} from '@/hooks/useColors';

export default function CertificationProgramReference({program}: {program: CertificationProgram}) {
  const colors = useColors(), {i18n} = useTranslation();
  return <View testID="certification-program-reference" style={{minWidth:0,maxWidth:'100%',gap:16,borderWidth:2,borderColor:colors.primary,borderRadius:14,backgroundColor:'#242426',padding:16}}>
    <Text accessibilityRole="header" style={{color:'#ececec',fontSize:20,fontWeight:'700'}}>{program.title}</Text>
    <Text style={{color:'#ececec',fontSize:14,lineHeight:24}}>{program.description}</Text>
    <Text accessibilityRole="header" style={{color:'#ececec',fontWeight:'700'}}>{i18n.language.startsWith('es') ? 'Cursos incluidos' : 'Included courses'}</Text>
    {program.courses.map(course => <Text key={course.id} style={{color:'#ececec',fontSize:14,lineHeight:20,borderTopWidth:1,borderTopColor:'#ffffff1a',paddingTop:12}}>{course.title}</Text>)}
  </View>;
}
