import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { BrandedCheckbox } from '@/components/branded-checkbox';
import { useTranslation } from 'react-i18next';

type Topic={familyId:string;title:string;purpose:string;practicalBoundary:string};
type Credit={families:{familyId:string}[];reviewNote:string};
const base=import.meta.env.BASE_URL.replace(/\/$/,'');
export function ExternalTrainingCredit({employeeId,certificateId,credit,onSaved}:{employeeId:number;certificateId:number;credit?:Credit|null;onSaved:()=>unknown}) {
  const {i18n}=useTranslation();const es=i18n.language.startsWith('es');
  const [open,setOpen]=useState(false),[selected,setSelected]=useState<string[]>(credit?.families.map(f=>f.familyId)??[]);
  const [note,setNote]=useState(credit?.reviewNote??''),[error,setError]=useState(''),[saving,setSaving]=useState(false);
  const topics=useQuery({queryKey:['certificate-training-topics',employeeId],enabled:open,queryFn:async()=>{
    const r=await fetch(`${base}/api/field-employees/${employeeId}/certification-training-topics`,{credentials:'include'});
    if(!r.ok)throw Error(es?'No se pudieron cargar los temas':'Could not load training topics');return r.json() as Promise<Topic[]>;
  }});
  async function save(){setSaving(true);setError('');try{
    const r=await fetch(`${base}/api/field-employees/${employeeId}/certifications/${certificateId}/training-credit`,{method:'PUT',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({familyIds:selected,reviewNote:note})});
    const data=await r.json();if(!r.ok)throw Error(data.error??'Could not save training credit');
    await onSaved();setOpen(false);
  }catch(e){setError((e as Error).message);}finally{setSaving(false);}}
  return <details className="w-full text-xs" open={open} onToggle={e=>setOpen(e.currentTarget.open)}>
    <summary className="cursor-pointer py-2" style={{color:'var(--brand-primary)'}}>{es?'Crédito de formación externa':'Outside training credit'}</summary>
    <p>{es?'Seleccione solo los temas cuya cobertura completa verificó en el certificado y su programa. Esto no concede autorización práctica ni una credencial de otro emisor.':'Select only topics whose full coverage you verified against this certificate and its syllabus. This does not grant practical authorization or another issuer’s credential.'}</p>
    {topics.isPending?<p>{es?'Cargando temas…':'Loading topics…'}</p>:topics.isError?<p role="alert">{topics.error.message}</p>:<div className="max-h-60 overflow-y-auto my-2 space-y-2">
      {topics.data?.map(topic=><label key={topic.familyId} className="flex items-start gap-2">
        <BrandedCheckbox checked={selected.includes(topic.familyId)} onCheckedChange={checked=>setSelected(old=>checked?[...old,topic.familyId]:old.filter(id=>id!==topic.familyId))} />
        <span><strong>{topic.familyId} | {topic.title}</strong><span className="block text-muted-foreground">{topic.purpose}</span><span className="block text-muted-foreground">{topic.practicalBoundary}</span></span>
      </label>)}
    </div>}
    <label className="block">{es?'Evidencia revisada (programa, versión y fuente de verificación)':'Evidence reviewed (syllabus, version, and verification source)'}
      <textarea className="w-full rounded border bg-transparent p-2" value={note} onChange={e=>setNote(e.target.value)} maxLength={2000}/>
    </label>
    {error&&<p role="alert">{error}</p>}
    <button type="button" className="py-2 font-semibold" style={{color:'var(--brand-primary)'}} disabled={saving||note.trim().length<10||!topics.data} onClick={()=>void save()}>{saving?(es?'Guardando…':'Saving…'):(es?'Guardar revisión':'Save review')}</button>
  </details>;
}
