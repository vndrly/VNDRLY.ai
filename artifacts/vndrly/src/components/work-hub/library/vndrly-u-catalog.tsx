import React from 'react';
import {Link} from 'wouter';
import {z} from 'zod/v4';
import {useLibrary} from './use-library';
import { ProfileActionButton } from '@/components/gate-profile-chrome';
import { BookOpen, GraduationCap, ChevronDown, ChevronRight } from 'lucide-react';
import { WORK_HUB_CARD_CLASS, WorkHubCardTitle } from '../chrome';
import './catalog-lessons.css';
import CourseContent from './course-content';
import {catalogTitle} from '@/lib/catalog-title';
import CatalogCourseActions from './catalog-course-actions';
import CatalogTrainingButton from './catalog-training-button';
import courseDescriptions from '@/lib/catalog-course-descriptions.json';
const schema=z.object({programs:z.array(z.object({id:z.string(),title:z.string(),equivalentCertification:z.string().nullable(),courseIds:z.array(z.string())})),courses:z.array(z.object({id:z.string(),title:z.string()}))});
const courseSchema=z.object({title:z.string(),lessons:z.array(z.object({id:z.string(),title:z.string(),body:z.string()}))});
export function CatalogCourse({id}:{id:string}){
 const course=useLibrary(`/api/work-hub/catalog/courses/${id}`,v=>courseSchema.parse(v));
 return <section aria-label="Course material"><CourseCertifications id={id}/>{course.loading&&<p>Loading course…</p>}{course.error&&<p role="alert">{String(course.error)}</p>}{course.data?.lessons.map(l=><details key={l.id} className="catalog-lesson"><summary><ChevronRight aria-hidden="true" /><span>{catalogTitle(l.title)}</span></summary><div className="catalog-lesson-body break-words text-base leading-6"><CourseContent body={l.body} title={l.title}/></div></details>)}</section>;
}
export function CatalogCoursePage({id}:{id:string}) {
 const course=useLibrary(`/api/work-hub/catalog/courses/${encodeURIComponent(id)}`,v=>courseSchema.parse(v));
 return <article data-library-card style={{borderRadius:14}} className={`${WORK_HUB_CARD_CLASS} space-y-4 p-4`}>
   {course.loading&&<p>Loading course…</p>}
   {course.error&&<p role="alert">{String(course.error)}</p>}
   {course.data&&<><h1><WorkHubCardTitle icon={BookOpen}>{catalogTitle(course.data.title)}</WorkHubCardTitle></h1>
     <p className="text-sm text-muted-foreground">{(courseDescriptions as Record<string,string>)[id]}</p>
     <CatalogTrainingButton id={id}/>
     <CatalogCourse id={id}/>
   </>}
 </article>;
}
function CourseCertifications({id}:{id:string}) {
 const catalog=useLibrary('/api/work-hub/catalog',v=>schema.parse(v));
 const programs=[...new Map((catalog.data?.programs??[]).filter(program=>program.courseIds.includes(id)).map(program=>[program.id,program])).values()];
 return <details className="border-b border-white/20 pb-3">
   <summary className="cursor-pointer py-2 font-semibold">Applies to certifications{catalog.data?` (${programs.length})`:''}</summary>
   {catalog.loading&&<p>Loading certifications…</p>}
   {catalog.error&&<p role="alert">{String(catalog.error)}</p>}
   {!catalog.loading&&!catalog.error&&(programs.length?<ul className="mt-2 space-y-2">{programs.map(program=><li key={program.id}><Link href={`/work-hub/bundle/${program.id}`} className="text-[var(--brand-primary)] underline">{program.title}</Link></li>)}</ul>:<p>No certification associations listed.</p>)}
 </details>;
}
export function CatalogCourseRow({id,title}:{id:string;title:string}){
 const [open,setOpen]=React.useState(false);
 const Chevron = open ? ChevronDown : ChevronRight;
 const description=(courseDescriptions as Record<string,string>)[id] ?? `Course material for ${catalogTitle(title)}.`;
 return <article data-work-hub-card data-library-card style={{borderRadius:14}} className={`${WORK_HUB_CARD_CLASS} min-w-0 p-4`}><button type="button" aria-expanded={open} onClick={()=>setOpen(!open)} className="flex w-full items-start justify-between gap-3 p-0 text-left leading-6"><WorkHubCardTitle icon={BookOpen}>{catalogTitle(title)}</WorkHubCardTitle><Chevron aria-hidden className="h-5 w-5 shrink-0 text-[var(--brand-primary)]" /></button><p data-course-description className="m-0 truncate text-sm leading-6 text-muted-foreground" title={description}>{description}</p><CatalogCourseActions id={id} title={title}/>{open&&<div className="mt-3 border-t border-white/15 pt-3"><CatalogCourse id={id}/></div>}</article>;
}
export default function VndrlyUCatalog({kind,search=''}:{kind:'programs'|'courses';search?:string}){
 const catalog=useLibrary('/api/work-hub/catalog',v=>schema.parse(v));
 const [courseView,setCourseView]=React.useState<'grouped'|'all'>('grouped');
 const matches=(value:string)=>value.toLowerCase().includes(search.trim().toLowerCase());
 // Shared courses keep their canonical ID; grouping creates no course records.
 const courses=[...new Map((catalog.data?.courses??[]).map(course=>[course.id,course])).values()];
 const byId=new Map(courses.map(course=>[course.id,course]));
 const programs=catalog.data?.programs??[];
 const grouped=programs.map(program=>({program,courses:[...new Set(program.courseIds)].flatMap(id=>{
   const course=byId.get(id);
   return course&&(matches(program.title+' '+(program.equivalentCertification??''))||matches(course.title))?[course]:[];
 })})).filter(group=>group.courses.length);
 const assignedIds=new Set(programs.flatMap(program=>program.courseIds));
 const standalone=courses.filter(course=>!assignedIds.has(course.id)&&matches(course.title));
 const visibleCourses=courses.filter(course=>matches(course.title));
 const visiblePrograms=programs.filter(program=>matches(program.title+' '+(program.equivalentCertification??'')));
 const noResults=kind==='programs'?!visiblePrograms.length:courseView==='all'?!visibleCourses.length:!grouped.length&&!standalone.length;
 return <section aria-label="VNDRLY/U catalog" data-library-card style={{borderRadius:14}} className={WORK_HUB_CARD_CLASS+' min-w-0 p-4'}>
   <header className="mb-3 flex flex-wrap items-center justify-between gap-3 border-b-2 border-gray-500 pb-3">
     <h2><WorkHubCardTitle icon={kind==='programs'?GraduationCap:BookOpen}>{kind==='programs'?'VNDRLY/U Certifications':'VNDRLY/U Courses'}</WorkHubCardTitle></h2>
     {kind==='courses'&&<div className="flex flex-wrap gap-2" role="group" aria-label="Course view">
       <ProfileActionButton className={courseView==='grouped'?'library-action-selected':''} aria-pressed={courseView==='grouped'} onClick={()=>setCourseView('grouped')}>By certification</ProfileActionButton>
       <ProfileActionButton className={courseView==='all'?'library-action-selected':''} aria-pressed={courseView==='all'} onClick={()=>setCourseView('all')}>All courses</ProfileActionButton>
     </div>}
   </header>
   <div role="region" aria-label={kind==='programs'?'Certification list':'Course list'} tabIndex={0} className="space-y-3 overflow-y-scroll overflow-x-hidden pr-2 focus-visible:outline-2 focus-visible:outline-[var(--brand-primary)]" style={{maxHeight:'60dvh',scrollbarGutter:'stable'}}>
     {catalog.loading&&<p>Loading catalog…</p>}
     {catalog.error&&<p role="alert">{String(catalog.error)}</p>}
     {!catalog.loading&&!catalog.error&&noResults&&<p>No matches found.</p>}
     {kind==='programs'?visiblePrograms.map(program=><article key={program.id} data-work-hub-card data-library-card style={{borderRadius:14}} className={WORK_HUB_CARD_CLASS+' min-w-0 p-4'}>
       <h3><Link href={'/work-hub/bundle/'+program.id} className="block text-inherit"><WorkHubCardTitle icon={GraduationCap}>{program.title}</WorkHubCardTitle></Link></h3>
       <div className="mt-2 space-y-1 text-sm text-muted-foreground">{program.equivalentCertification&&<p>Equivalent certification: {program.equivalentCertification}</p>}<p>{program.courseIds.length} constituent courses</p></div>
     </article>):courseView==='all'?visibleCourses.map(course=><CatalogCourseRow key={course.id} {...course}/>):<>
       {grouped.map(({program,courses:members})=><details key={program.id} open={search.trim()?true:undefined} className="rounded-xl border border-[var(--brand-primary)] p-3">
         <summary className="cursor-pointer py-2 font-semibold">{program.title} <span className="text-sm font-normal text-muted-foreground">({members.length})</span></summary>
         <div className="mt-3 space-y-3">{members.map(course=><CatalogCourseRow key={course.id} {...course}/>)}</div>
       </details>)}
       {standalone.length>0&&<details open={search.trim()?true:undefined} className="rounded-xl border border-[var(--brand-primary)] p-3"><summary className="cursor-pointer py-2 font-semibold">Standalone courses ({standalone.length})</summary><div className="mt-3 space-y-3">{standalone.map(course=><CatalogCourseRow key={course.id} {...course}/>)}</div></details>}
     </>}
   </div>
 </section>;
}
