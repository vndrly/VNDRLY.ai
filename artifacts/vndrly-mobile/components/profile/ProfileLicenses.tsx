import {catalogDisplayTitle} from '@workspace/api-zod/catalog-profile';
import React,{useState} from 'react';
import {Text,View,Switch} from 'react-native';
import {PROFILE_LICENSE_TYPES,ProfileLicenseBody,type ProfileLicenseInput,type ProfileLicenseRecord} from '@workspace/api-zod/profile-licenses';
import {expirationShield} from '@workspace/api-zod/profile-status';
import {useGateQuery} from '@/hooks/use-gate-query';
import {GateRow,gateStyle,useGateCopy} from '../gate/GateChrome';
import StatusShield from '../StatusShield';
import {useColors} from '@/hooks/useColors';
import {apiFetch} from '@/lib/api';
import {uploadCredentialDocument,openCredentialDocument} from '@/lib/credential-documents';
import {BrandedOnboardingField} from '../OnboardingControls';
import BrandedDateField from '../BrandedDateField';
import ProfileMiniCardButton from '../ProfileMiniCardButton';

const empty:ProfileLicenseInput={type:'driver',issuer:'',jurisdiction:'',number:'',scope:'',restrictions:'',issuedDate:'',expirationDate:'',noExpiration:false,documentUrl:'',evaluationDate:'',evaluator:'',trainingReference:'',holderName:'',licenseClass:'',endorsements:'',frontPhotoUrl:'',backPhotoUrl:''};
const expirationTextColors={green:'#00db8b',yellow:'#fbbf24',red:'#ef4444',grey:'#a1a1aa'};
export default function ProfileLicenses({employeeId}:{employeeId:number}){
 const [open,setOpen]=useState(false),[editor,setEditor]=useState(false),[id,setId]=useState<number|null>(null),[form,setForm]=useState<ProfileLicenseInput>({...empty}),[busy,setBusy]=useState(false),[error,setError]=useState(''),[typesOpen,setTypesOpen]=useState(false);
 const c=useGateCopy(),colors=useColors(),path=`/api/field-employees/${employeeId}/licenses`,query=useGateQuery<ProfileLicenseRecord[]>(path,open);
 const employer=form.type==='equipment-authorization';
 const card={gap:8,padding:16,borderWidth:2,borderColor:colors.primary,borderRadius:14,backgroundColor:'#242426'};
 async function run(work:()=>Promise<void>){setBusy(true);setError('');try{await work();}catch(e){setError(e instanceof Error?e.message:'Could not save record.');}finally{setBusy(false);}}
 function edit(row?:ProfileLicenseRecord){setId(row?.id??null);setForm(row?Object.fromEntries(Object.keys(empty).map(key=>[key,row[key as keyof ProfileLicenseInput]??empty[key as keyof ProfileLicenseInput]])) as ProfileLicenseInput:{...empty});setEditor(true);setError('');}
 const field=(key:Exclude<keyof ProfileLicenseInput,'noExpiration'>,label:string,date=false)=>date?<BrandedDateField key={key} label={label} value={form[key]??''} onChange={value=>setForm(f=>({...f,[key]:value}))}/>:<BrandedOnboardingField key={key} label={label} value={form[key]??''} editable={!busy} onChangeText={value=>setForm(f=>({...f,[key]:value}))}/>;
 const button=(label:string,onPress:()=>void)=><ProfileMiniCardButton borderColor={colors.primary} disabled={busy} onPress={onPress}>{label}</ProfileMiniCardButton>;
 const document=(key:'frontPhotoUrl'|'backPhotoUrl'|'documentUrl',label:string)=><View key={key} style={{gap:4}}><Text style={gateStyle.text}>{label}</Text><View style={{flexDirection:'row',flexWrap:'wrap',gap:8}}>{button(c('Take photo','Tomar foto'),()=>void run(async()=>{const url=await uploadCredentialDocument('camera');if(url)setForm(f=>({...f,[key]:url}));}))}{button(key==='documentUrl'?c('Choose photo / PDF','Elegir foto / PDF'):c('Choose photo','Elegir foto'),()=>void run(async()=>{const url=await uploadCredentialDocument(key==='documentUrl'?'files':'photos');if(url)setForm(f=>({...f,[key]:url}));}))}{form[key]&&button(c('View attached document','Ver documento adjunto'),()=>void run(()=>openCredentialDocument(form[key]!)))}</View></View>;
 return <>
 <GateRow label={c('Licenses & regulatory credentials','Licencias y credenciales regulatorias')} expanded={open} onPress={()=>setOpen(!open)}/>
 {open&&<View style={{gap:12,paddingVertical:12}}>
 {query.isLoading&&<Text style={gateStyle.text}>{c('Loading…','Cargando…')}</Text>}
 {query.error&&<Text accessibilityRole="alert" style={gateStyle.text}>{query.error.message}</Text>}
 {query.data?.map(row=>{const type=PROFILE_LICENSE_TYPES.find(t=>t.id===row.type),status=expirationShield(row.expirationDate,row.noExpiration);return <View key={row.id} style={card}>
 <View style={{flexDirection:'row',justifyContent:'space-between',gap:8}}><Text style={[gateStyle.text,{flex:1}]}>{type?c(type.name,type.es):row.type}</Text><StatusShield status={status} label={row.expirationDate?'Expires '+row.expirationDate:'No expiration recorded'}/></View>
 <Text style={gateStyle.muted}>{catalogDisplayTitle(row.issuer)}{row.jurisdiction?' · '+row.jurisdiction:''}</Text>
 {row.number&&<Text style={gateStyle.text}>{c('License / credential number','Número de licencia / credencial')}: {row.number}</Text>}
 {row.issuedDate&&<Text style={gateStyle.muted}>{c('Issued','Emitida')}: {row.issuedDate}</Text>}
 <Text style={[gateStyle.text,{color:expirationTextColors[status]}]}>{status==='red'?c('Expired','Vencida'):c('Expires','Vence')}: {row.expirationDate||(row.noExpiration?c('No expiration','Sin vencimiento'):c('Not recorded','Sin registrar'))}</Text>
 {([['holderName','Name on license'],['licenseClass','License class'],['endorsements','Endorsements'],['scope','Scope'],['restrictions','Restrictions'],['evaluationDate','Evaluation date'],['evaluator','Evaluator'],['trainingReference','Supporting evidence']] as const).map(([key,label])=>row[key]?<Text key={key} style={gateStyle.text}>{label}: {catalogDisplayTitle(row[key]!)}</Text>:null)}
 <View style={{flexDirection:'row',flexWrap:'wrap',gap:8}}>{(['frontPhotoUrl','backPhotoUrl','documentUrl'] as const).map((key,index)=>row[key]?<React.Fragment key={key}>{button(index===0?'View license front':index===1?'View license back':'View supporting document',()=>void run(()=>openCredentialDocument(row[key]!)))}</React.Fragment>:null)}{button(c('Edit','Editar'),()=>edit(row))}</View>
 </View>;})}
 {button(c('Add record','Agregar registro'),()=>edit())}
 {editor&&<View style={card}>
 <Text style={gateStyle.text}>{id?c('Edit license / authorization','Editar licencia / autorización'):c('Add license / authorization','Agregar licencia / autorización')}</Text>
 <GateRow label={PROFILE_LICENSE_TYPES.find(t=>t.id===form.type)?.name??form.type} expanded={typesOpen} onPress={()=>setTypesOpen(!typesOpen)}/>
 {typesOpen&&PROFILE_LICENSE_TYPES.map(type=><GateRow key={type.id} label={c(type.name,type.es)} onPress={()=>{setForm(f=>({...f,type:type.id}));setTypesOpen(false);}}/>)}
 {field('number',employer?'Authorization number':'License / credential number')}
 {field('issuer',employer?'Authorizing employer':'Issuing authority')}{field('jurisdiction',form.type==='driver'?'Issuing state / territory':'Issuing jurisdiction')}
 {form.type==='driver'&&<>{field('holderName','Name on license')}{field('licenseClass','License class (A, B, C or other)')}{field('endorsements','Endorsements')}</>}
 {field('scope',form.type==='driver'?'Additional scope':'Equipment classes / scope')}{field('restrictions','Restrictions')}{field('issuedDate','Issue date',true)}
 {!form.noExpiration&&field('expirationDate','Expiration date',true)}
 <View style={{flexDirection:'row',gap:8,alignItems:'center'}}><Switch disabled={busy} value={form.noExpiration} onValueChange={value=>setForm(f=>({...f,noExpiration:value,expirationDate:value?'':f.expirationDate}))}/><Text style={gateStyle.text}>No expiration stated by issuer</Text></View>
 {employer?<>{field('evaluationDate','Evaluation date',true)}{field('evaluator','Evaluator / authorizing person')}{field('trainingReference','Training / evaluation reference')}</>:<>{document('frontPhotoUrl','License front photo')}{document('backPhotoUrl','License back photo')}</>}
 {document('documentUrl','Supporting document')}
 <View style={{flexDirection:'row',gap:8}}>{button(c('Cancel','Cancelar'),()=>setEditor(false))}{button(c('Save record','Guardar registro'),()=>void run(async()=>{const parsed=ProfileLicenseBody.parse(form);await apiFetch(id?`${path}/${id}`:path,{method:id?'PUT':'POST',body:JSON.stringify(parsed)});await query.refetch();setEditor(false);} ))}</View>
 </View>}
 {error&&<Text accessibilityRole="alert" style={gateStyle.text}>{error}</Text>}
 </View>}
 </>;
}
