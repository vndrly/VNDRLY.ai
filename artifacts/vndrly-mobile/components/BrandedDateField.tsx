import { ModalPressable as Pressable } from "@/components/ModalDraft";
import React, {useState} from 'react';
import {Platform, Text, View} from "react-native";
import DateTimePicker from '@react-native-community/datetimepicker';
import {Feather} from '@expo/vector-icons';
import {useColors} from '@/hooks/useColors';
import {useTranslation} from 'react-i18next';

export default function BrandedDateField({label,value,onChange}: {label:string;value:string;onChange:(value:string)=>void}) {
  const {primary} = useColors();
  const {t} = useTranslation();
  const [open,setOpen] = useState(false);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00`) : new Date();
  const style = {minWidth:0,maxWidth:'100%' as const,minHeight:44,borderWidth:1,borderColor:primary,borderRadius:9999,
    paddingVertical:10,paddingHorizontal:12,backgroundColor:'#303034'};
  return <View style={{gap:6,minWidth:0,maxWidth:'100%'}}>
    <Text style={{color:'#fff',fontSize:12}}>{label}</Text>
    {Platform.OS === 'web' ? React.createElement('input',{type:'date',value,'aria-label':label,
      onChange:(event:React.ChangeEvent<HTMLInputElement>)=>onChange(event.target.value),
      style:{boxSizing:'border-box',width:'100%',minWidth:0,maxWidth:'100%',minHeight:44,border:`1px solid ${primary}`,
        borderRadius:9999,padding:'10px 12px',background:'#303034',color:'#ececec',colorScheme:'dark',fontSize:16}}) : <>
      <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={()=>setOpen(!open)} style={{...style,flexDirection:'row',alignItems:'center',gap:8}}>
        <Text style={{flex:1,minWidth:0,color:'#ececec'}}>{value || 'MM/DD/YYYY'}</Text><Feather name="calendar" size={16} color={primary}/>
      </Pressable>
      {open && <DateTimePicker mode="date" value={date} themeVariant="dark" onChange={(_,selected)=>{
        setOpen(false);if(selected)onChange(`${selected.getFullYear()}-${String(selected.getMonth()+1).padStart(2,'0')}-${String(selected.getDate()).padStart(2,'0')}`);
      }}/>}
      {!!value && <Pressable accessibilityRole="button" accessibilityLabel={`${t('common.clear',{defaultValue:'Clear'})} ${label}`} onPress={()=>onChange('')} style={{alignSelf:'flex-end',minHeight:44,justifyContent:'center'}}>
        <Text style={{color:primary}}>{t('common.clear',{defaultValue:'Clear'})}</Text>
      </Pressable>}
    </>}
  </View>;
}
