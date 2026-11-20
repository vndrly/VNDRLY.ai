import {useState} from 'react';
import {Link} from 'wouter';
import {type CatalogProfile} from '@workspace/api-zod/catalog-profile';
import {expirationShield} from '@workspace/api-zod/profile-status';
import StatusShield from './status-shield';
import ImagePill from './image-pill';
import {catalogTitle} from '@/lib/catalog-title';
import {Dialog} from './ui/dialog';
import EmployeeDialogContent from './employee-dialog-content';
import {ProfileActionButton,profileRequest} from './gate-profile-chrome';
import {BrandedInput} from './work-hub/chrome';
type Program=CatalogProfile['programs'][number];
const expirationTextColors={green:'#00db8b',yellow:'#fbbf24',red:'#ef4444',grey:'#a1a1aa'} as const;
export default function ProfileCatalogTraining({programs=[],extra=[],onChanged}:{programs?:Program[];extra?:CatalogProfile['courses'];onChanged?:()=>void}){
 const [editing,setEditing]=useState<Program|null>(null);
 const [form,setForm]=useState({certNumber:'',awardedAt:'',expiresAt:''});
 const [busy,setBusy]=useState(false),[error,setError]=useState('');
 const [removed,setRemoved]=useState<string[]>([]);
 function edit(p:Program){setError('');setForm({certNumber:p.certNumber??'',awardedAt:p.awardedAt?.slice(0,10)??'',expiresAt:p.expiresAt?.slice(0,10)??''});setEditing(p);}
 async function save(){if(!editing)return;setBusy(true);setError('');try{await profileRequest('/work-hub/catalog/programs/'+editing.id+'/credential',{method:'PATCH',body:JSON.stringify({...form,awardedAt:form.awardedAt||null,expiresAt:form.expiresAt||null})});setEditing(null);onChanged?.();}catch(e){setError(e instanceof Error?e.message:'Could not save');}finally{setBusy(false);}}
 async function remove(p:Program){if(!window.confirm('Remove '+catalogTitle(p.title)+' from your profile?'))return;setBusy(true);setError('');try{await profileRequest('/work-hub/catalog/programs/'+p.id+'/credential',{method:'DELETE'});setRemoved(ids=>[...ids,p.id]);onChanged?.();}catch(e){setError(e instanceof Error?e.message:'Could not remove');}finally{setBusy(false);}}
 const courses=(rows:CatalogProfile['courses'])=>rows.map(course=><details key={course.id} className="border-t border-white/15 py-2">
  <summary className="cursor-pointer"><span className="inline-flex w-[95%] items-center justify-between gap-3"><span>{catalogTitle(course.title)}</span><span className="inline-flex items-center gap-2"><ImagePill color={course.percent===100?'green':course.percent?'amber':'grey'}>{course.percent}%</ImagePill><StatusShield status={course.percent===100?'green':course.percent?'yellow':'grey'} label={course.percent===100?'Completed':course.percent?'In progress':'Not started'}/></span></span></summary>
  <div className="space-y-2 py-2 pl-4"><Link href={`/work-hub/course/${course.id}`} className="text-[var(--brand-primary)] underline">View Course</Link>{course.score!==null&&<p>Coursework: {course.score}%</p>}{course.benchmarks.map(b=><div key={b.id} className="flex justify-between gap-3 text-sm"><span>{catalogTitle(b.title)}</span><span>{b.complete?'Completed':'Pending'}{b.reviewedAt?' · '+new Date(b.reviewedAt).toLocaleDateString():''}</span></div>)}</div>
 </details>);
 return <section aria-label="My VNDRLY/U training" className="space-y-2">
  {programs.filter(p=>!p.profileHidden&&!removed.includes(p.id)).map(p=>{
   const status=p.complete?expirationShield(p.expiresAt,true):p.percent?'yellow':'grey';
   const indicators=<span className="inline-flex shrink-0 items-center gap-2"><ImagePill color={status==='yellow'?'amber':status}>{p.percent}%</ImagePill><StatusShield status={status} label={status==='yellow'&&p.complete?'Expires within 60 days':status==='red'?'Expired':p.complete?'Completed':p.percent?'In progress':'Not started'}/></span>;
   const metadata=<>{p.certNumber&&<p>Certificate number: {p.certNumber}</p>}{p.score!==null&&<p>Final assessment: {p.score}%</p>}{p.awardedAt&&<p>Completed: {p.awardedAt.slice(0,10)}</p>}{p.expiresAt&&<p style={{color:expirationTextColors[expirationShield(p.expiresAt)]}}>Expires: {p.expiresAt.slice(0,10)}</p>}</>;
   if(p.complete)return <article key={p.id} data-card-layout style={{borderRadius:14}} className="my-3 rounded-xl border-2 border-[var(--brand-primary)] bg-[#242426] p-4 text-sm space-y-2">
    <div className="flex items-center justify-between gap-3"><strong>{catalogTitle(p.title)}</strong>{indicators}</div>
    <p>VNDRLY/U</p>{metadata}
    <div className="flex flex-wrap gap-2"><ProfileActionButton disabled={busy} onClick={()=>edit(p)}>Edit</ProfileActionButton><ProfileActionButton disabled={busy} onClick={()=>void remove(p)}>Remove</ProfileActionButton></div>
    <details className="border-t border-white/15 pt-2"><summary className="cursor-pointer">Certification details</summary><div className="pt-2"><Link href={'/work-hub/bundle/'+p.id} className="text-[var(--brand-primary)] underline">View Certification</Link>{courses(p.courses)}</div></details>
   </article>;
   return <details key={p.id} className="border-b border-white/20 py-3"><summary className="cursor-pointer"><span className="inline-flex w-[95%] items-center justify-between gap-3"><span>{catalogTitle(p.title)}</span>{indicators}</span></summary><div className="py-2 pl-4"><Link href={'/work-hub/bundle/'+p.id} className="text-[var(--brand-primary)] underline">View Certification</Link>{metadata}{courses(p.courses)}</div></details>;
  })}
  {courses(extra)}
  {error&&!editing&&<p role="alert">{error}</p>}
  <Dialog open={!!editing} onOpenChange={open=>{if(!open&&!busy)setEditing(null);}}><EmployeeDialogContent title="Edit certification" appearance="dark">
   <p>{editing&&catalogTitle(editing.title)}</p>
   <label className="grid gap-1 text-sm">Certificate number<BrandedInput value={form.certNumber} onChange={e=>setForm({...form,certNumber:e.target.value})}/></label>
   <label className="grid gap-1 text-sm">Completion date<BrandedInput type="date" value={form.awardedAt} onChange={e=>setForm({...form,awardedAt:e.target.value})}/></label>
   <label className="grid gap-1 text-sm">Expiration date<BrandedInput type="date" value={form.expiresAt} onChange={e=>setForm({...form,expiresAt:e.target.value})}/></label>
   {error&&<p role="alert">{error}</p>}
   <div className="flex justify-end gap-2"><ProfileActionButton disabled={busy} onClick={()=>setEditing(null)}>Cancel</ProfileActionButton><ProfileActionButton disabled={busy} onClick={()=>void save()}>Save</ProfileActionButton></div>
  </EmployeeDialogContent></Dialog>
 </section>;
}
