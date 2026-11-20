import React, { useEffect, useState } from 'react';
import { Platform, Text, View } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { GateRow, gateStyle, useGateCopy } from '../gate/GateChrome';
import ProfileMiniCardButton from '../ProfileMiniCardButton';
import StatusShield from '../StatusShield';
import { useColors } from '@/hooks/useColors';

const names = ['Rivet', 'V', 'Beacon', 'Scout', 'Relay', 'Tally', 'Field Worker'];
export default function ProfileAvatar({ userId }: { userId?: number }) {
  const c = useGateCopy(), colors = useColors();
  const [selected,setSelected] = useState(''), [open,setOpen] = useState(false), [error,setError] = useState('');
  const key = `vndrly:next-steps-avatar:${userId}`;
  const nativeKey = `vndrly.next-steps-avatar.${userId}`;
  useEffect(()=>{
    let current=true;
    const read=Promise.resolve().then(()=>Platform.OS==='web'?localStorage.getItem(key):SecureStore.getItemAsync(nativeKey));
    void read.then(value=>{if(current)setSelected(value&&names.includes(value)?value:'');}).catch(()=>{if(current)setError(c('Could not load avatar.','No se pudo cargar el avatar.'));});
    return ()=>{current=false;};
  },[key]);
  async function choose(name:string) {
    try {
      if(Platform.OS==='web')localStorage.setItem(key,name);else await SecureStore.setItemAsync(nativeKey,name);
      setSelected(name);setOpen(false);setError('');
    } catch {setError(c('Could not save avatar.','No se pudo guardar el avatar.'));}
  }
  return <>
    <GateRow label="VNDRLY Avatar" expanded={open} icon={open?'chevron-down':'chevron-right'} onPress={()=>setOpen(!open)}
      trailing={<View style={{flexDirection:'row',alignItems:'center',gap:12}}><Text style={gateStyle.muted}>{selected}</Text><StatusShield status={selected?'green':'grey'} label={c(selected?'Avatar selected':'Avatar not selected',selected?'Avatar seleccionado':'Avatar sin seleccionar')}/></View>}/>
    {open&&<View style={{gap:12,padding:16}}>{!!error&&<Text accessibilityRole="alert" style={gateStyle.text}>{error}</Text>}<View style={{flexDirection:'row',flexWrap:'wrap',gap:12}}>{names.map(name=><ProfileMiniCardButton key={name} borderColor={colors.primary} onPress={()=>void choose(name)}>{name}</ProfileMiniCardButton>)}</View></View>}
  </>;
}
