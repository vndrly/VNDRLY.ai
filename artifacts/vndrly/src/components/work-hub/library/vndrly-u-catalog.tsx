import React from 'react';
import {Link} from 'wouter';
import {z} from 'zod/v4';
import {useLibrary} from './use-library';
const schema=z.object({programs:z.array(z.object({id:z.string(),title:z.string(),equivalentCertification:z.string().nullable(),courseIds:z.array(z.string())})),courses:z.array(z.object({id:z.string(),title:z.string()}))});
const courseSchema=z.object({title:z.string(),lessons:z.array(z.object({id:z.string(),title:z.string(),body:z.string()}))});
export function CatalogCourse({id}:{id:string}){
 const course=useLibrary(`/api/work-hub/catalog/courses/${id}`,v=>courseSchema.parse(v));
 return <section aria-label="Course material" className="space-y-3">{course.loading&&<p>Loading course…</p>}{course.error&&<p role="alert">{String(course.error)}</p>}{course.data?.lessons.map(l=><details key={l.id} className="rounded border border-white/20 p-3"><summary className="cursor-pointer font-semibold">{l.title}</summary><div className="mt-3 whitespace-pre-wrap break-words text-base leading-6">{l.body}</div></details>)}</section>;
}
export function CatalogCourseRow({id,title}:{id:string;title:string}){
 const [open,setOpen]=React.useState(false);
 return <div className="border-t border-white/15 py-3"><button type="button" aria-expanded={open} onClick={()=>setOpen(!open)} className="text-left font-semibold text-[var(--brand-primary)]">{open?'▾':'▸'} {title}</button>{open&&<CatalogCourse id={id}/>}</div>;
}
export default function VndrlyUCatalog({kind,search=''}:{kind:'programs'|'courses';search?:string}){
 const catalog=useLibrary('/api/work-hub/catalog',v=>schema.parse(v));
 const matches=(value:string)=>value.toLowerCase().includes(search.toLowerCase());
 return <section aria-label="VNDRLY/U catalog" className="space-y-3">{catalog.loading&&<p>Loading catalog…</p>}{catalog.error&&<p role="alert">{String(catalog.error)}</p>}{kind==='programs'?catalog.data?.programs.filter(p=>matches(p.title+' '+(p.equivalentCertification??''))).map(p=><article key={p.id} className="rounded-xl border border-[var(--brand-primary)] p-4"><Link href={`/work-hub/bundle/${p.id}`} className="font-bold text-[var(--brand-primary)]">{p.title}</Link>{p.equivalentCertification&&<p>Equivalent certification: {p.equivalentCertification}</p>}<p>{p.courseIds.length} constituent courses</p></article>):catalog.data?.courses.filter(c=>matches(c.title)).map(c=><CatalogCourseRow key={c.id} {...c}/>)}</section>;
}
