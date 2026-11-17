import React from 'react';
import {Linking,Text,View} from 'react-native';

/** Text-only authored content: no HTML, and table records stack on narrow screens. */
export default function TrainingBody({text,color}:{text:string;color:string}) {
 const clean=(value:string)=>value.replace(/\*\*([^*]+)\*\*/g,'$1').replace(/`([^`]+)`/g,'$1');
 return <View style={{gap:12,minWidth:0}}>{text.split(/\n\s*\n/).filter(Boolean).map((block,index)=>{
  const lines=block.split('\n');
  if(lines.every(l=>l.startsWith('|'))){
   const rows=lines.filter(l=>!/^[-|:\s]+$/.test(l)).map(l=>l.replace(/^\||\|$/g,'').split('|').map(s=>clean(s.trim())));
   const [head,...body]=rows;
   return <View key={index} style={{gap:12}}>{body.map((row,i)=><View key={i} style={{gap:4}}>{row.map((cell,j)=><Text key={j} style={{color,fontSize:16,lineHeight:24}}>{head[j]}: {cell||'__________'}</Text>)}</View>)}</View>;
  }
  return <View key={index} style={{gap:4}}>{lines.map((line,i)=>{
   const heading=/^#{1,6}\s/.test(line),value=clean(line.replace(/^#{1,6}\s+/,''));
   return <Text key={i} selectable style={{color,fontSize:16,lineHeight:24,fontWeight:heading?'700':'400',flexShrink:1}}>{value.split(/(https?:\/\/[^\s]+)/g).map((part,n)=>/^https?:\/\//.test(part)?<Text key={n} accessibilityRole="link" style={{textDecorationLine:'underline'}} onPress={()=>void Linking.openURL(part).catch(()=>{})}>{part}</Text>:part)}</Text>;
  })}</View>;
 })}</View>;
}
