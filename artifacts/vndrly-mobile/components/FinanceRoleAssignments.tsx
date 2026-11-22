import React,{useState} from 'react';
import {View,Text,Pressable,Modal,ScrollView} from 'react-native';
import {useAuth} from '@/hooks/use-auth';
import {useColors} from '@/hooks/useColors';
import {useFormCampaigns} from '@/lib/use-form-campaigns';
import {mobileOwner} from '@/lib/work-hub-mobile';
import {BrandedOnboardingSelect} from '@/components/OnboardingControls';
import ProfileMiniCardButton from '@/components/ProfileMiniCardButton';
type Finance={permissions:{administer:boolean};members:{userId:number;displayName:string;role:string}[];grants:{data:{userId:number;roles:string[]}}[]};
export default function FinanceRoleAssignments(){
 const {user}=useAuth(),owner=mobileOwner(user);
 return owner?<FinanceRoles owner={owner}/>:null;
}
function FinanceRoles({owner}:{owner:{type:string;id:number}}){
 const colors=useColors(),api=useFormCampaigns(`/api/work-hub/finance?orgType=${owner.type}&orgId=${owner.id}`,v=>v as Finance);
 const [selected,setSelected]=useState<number|null>(null),[roles,setRoles]=useState<string[]>([]),[open,setOpen]=useState(false),[notice,setNotice]=useState('');
 if(!api.data?.permissions.administer)return null;
 const text={color:colors.text};
 return <View style={{backgroundColor:colors.card,borderWidth:1,borderColor:colors.primary,borderRadius:14,padding:12,gap:6,marginBottom:16}}>
 <View style={{flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:8}}><Text accessibilityRole="header" style={{...text,fontWeight:'700',flex:1}}>Finance role assignments</Text><ProfileMiniCardButton inHeader borderColor={colors.primary} disabled={!selected||api.busy} onPress={()=>{setNotice('');void api.send('/api/work-hub/finance/grant',{userId:selected,roles}).then(()=>{setNotice('Finance assignments saved.');void api.reload();}).catch(e=>setNotice(String(e)));}}>Save finance roles</ProfileMiniCardButton></View>
 <BrandedOnboardingSelect label="Company member" value={api.data.members.find(m=>m.userId===selected)?.displayName??'Select member'} expanded={open} onPress={()=>setOpen(true)} />
 <Text style={{color:colors.mutedForeground,fontSize:12}}>Assign explicit payroll permissions independently of company administration. Saving replaces this person's finance assignments.</Text>
 <View style={{flexDirection:'row',flexWrap:'wrap',gap:8}}>{['billing_manager','payroll_viewer','payroll_preparer','payroll_approver'].map(role=><Pressable key={role} accessibilityRole="checkbox" accessibilityState={{checked:roles.includes(role)}} onPress={()=>setRoles(roles.includes(role)?roles.filter(r=>r!==role):[...roles,role])} style={{width:'47%',paddingVertical:5}}><Text style={text}>{roles.includes(role)?'☑':'☐'} {role.replaceAll('_',' ')}</Text></Pressable>)}</View>
 {!!(notice||api.error)&&<Text style={text}>{notice||api.error}</Text>}
 <Modal visible={open} presentationStyle="pageSheet" onRequestClose={()=>setOpen(false)}><ScrollView contentContainerStyle={{backgroundColor:colors.background,flexGrow:1,padding:20,gap:12}}><Pressable accessibilityRole="button" onPress={()=>setOpen(false)}><Text style={text}>Close</Text></Pressable>{api.data.members.map(m=><Pressable key={m.userId} accessibilityRole="button" onPress={()=>{setSelected(m.userId);setRoles(api.data?.grants.find(g=>g.data.userId===m.userId)?.data.roles??[]);setOpen(false);}}><Text style={text}>{m.displayName} ({m.role})</Text></Pressable>)}</ScrollView></Modal>
 </View>;
}
