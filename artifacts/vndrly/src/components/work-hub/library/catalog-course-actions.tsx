import React from 'react';
import {Link} from 'wouter';
import {z} from 'zod/v4';
import {Dialog,DialogContent,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import {ProfileActionButton} from '@/components/gate-profile-chrome';
import {catalogTitle} from '@/lib/catalog-title';
import {useLibrary} from './use-library';
import {workHubRequest} from '@/lib/work-hub-client';

const optionsSchema=z.object({people:z.array(z.object({userId:z.number(),name:z.string().nullable()})),groups:z.array(z.object({id:z.string(),name:z.string()})),positions:z.array(z.object({id:z.string(),label:z.string(),userIds:z.array(z.number())})).default([])});
function CourseAssignment({id,onSaved}:{id:string;onSaved:()=>Promise<void>}) {
 const api=useLibrary('/api/work-hub/library/options',value=>optionsSchema.parse(value));
 const [users,setUsers]=React.useState<number[]>([]),[groups,setGroups]=React.useState<string[]>([]),[roles,setRoles]=React.useState<string[]>([]),[search,setSearch]=React.useState(''),[busy,setBusy]=React.useState(false),[notice,setNotice]=React.useState('');
 const scope=React.useRef(api.contextKey);scope.current=api.contextKey;
 React.useEffect(()=>{setUsers([]);setGroups([]);setRoles([]);setNotice('');setBusy(false);},[api.contextKey,id]);
 const choose=<T,>(values:T[],value:T)=>values.includes(value)?values.filter(v=>v!==value):[...values,value];
 const assign=async()=>{const current=scope.current;setBusy(true);setNotice('');try{
  await workHubRequest('/catalog/training/assign',{method:'POST',body:JSON.stringify({targetId:id,audience:{mode:'selected',userIds:[...new Set([...users,...(api.data?.positions??[]).filter(r=>roles.includes(r.id)).flatMap(r=>r.userIds)])],groupIds:groups}})});
  if(current===scope.current)await onSaved();
 }catch(error){if(current===scope.current)setNotice(error instanceof Error?error.message:'Assignment could not be confirmed');}finally{if(current===scope.current)setBusy(false);}};
 if(api.loading)return <p role="status">Loading assignment options…</p>;
 if(api.error)return <p role="alert">{String(api.error)}</p>;
 const matches=(text:string)=>text.toLowerCase().includes(search.toLowerCase());
 return <section className="space-y-3"><input aria-label="Search assignment recipients" placeholder="Search individuals, roles or groups" value={search} onChange={e=>setSearch(e.target.value)} className="w-full rounded border p-2"/>
  <div className="max-h-80 overflow-y-auto space-y-3"><fieldset><legend>Individuals</legend>{api.data?.people.filter(p=>matches(p.name??String(p.userId))).map(p=><label key={p.userId} className="flex gap-2 py-1"><input type="checkbox" disabled={busy} checked={users.includes(p.userId)} onChange={()=>setUsers(choose(users,p.userId))}/>{p.name??String(p.userId)}</label>)}</fieldset>
  <fieldset><legend>Roles</legend>{api.data?.positions.filter(p=>matches(p.label)).map(p=><label key={p.id} className="flex gap-2 py-1"><input type="checkbox" disabled={busy} checked={roles.includes(p.id)} onChange={()=>setRoles(choose(roles,p.id))}/>{p.label}</label>)}</fieldset>
  <fieldset><legend>Groups</legend>{api.data?.groups.filter(p=>matches(p.name)).map(p=><label key={p.id} className="flex gap-2 py-1"><input type="checkbox" disabled={busy} checked={groups.includes(p.id)} onChange={()=>setGroups(choose(groups,p.id))}/>{p.name}</label>)}</fieldset></div>
  <ProfileActionButton disabled={busy||(!users.length&&!roles.length&&!groups.length)} onClick={()=>void assign()}>{busy?'Assigning…':'Assign training'}</ProfileActionButton>{notice&&<p role="alert">{notice}</p>}
 </section>;
}

export default function CatalogCourseActions({id,title}:{id:string;title:string}) {
 return <div className="flex items-center justify-between gap-4 text-sm leading-6" data-course-actions>
  <Link href={`/work-hub/course/${encodeURIComponent(id)}`} className="text-[var(--brand-primary)] underline">View Course</Link>
  <CatalogAssign id={id} title={title}/>
 </div>;
}
export function CatalogAssign({id,title}:{id:string;title:string}) {
  const [assign,setAssign]=React.useState(false);
  return <>
      <button type="button" onClick={()=>setAssign(true)} className="ml-auto p-0 text-[var(--brand-primary)] underline">Assign</button>
    {assign&&<Dialog open onOpenChange={setAssign}><DialogContent className="library-page" dismissLabel="Cancel">
      <DialogTitle>Assign {id.includes('-')?'course':'certification'}</DialogTitle>
      <DialogDescription>{catalogTitle(title)}</DialogDescription>
      <CourseAssignment id={id} onSaved={async()=>setAssign(false)}/>
      <ProfileActionButton onClick={()=>setAssign(false)}>Cancel</ProfileActionButton>
    </DialogContent></Dialog>}
  </>;
}
