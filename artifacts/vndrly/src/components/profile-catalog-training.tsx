import {Link} from 'wouter';
import {type CatalogProfile} from '@workspace/api-zod/catalog-profile';
import {expirationShield} from '@workspace/api-zod/profile-status';
import StatusShield from './status-shield';
import ImagePill from './image-pill';
import {catalogTitle} from '@/lib/catalog-title';

export default function ProfileCatalogTraining({programs=[],extra=[]}:{programs?:CatalogProfile['programs'];extra?:CatalogProfile['courses']}){
 const courses=(rows:CatalogProfile['courses'])=>rows.map(course=><details key={course.id} className="border-t border-white/15 py-2">
  <summary className="cursor-pointer"><span className="inline-flex w-[95%] items-center justify-between gap-3"><span>{catalogTitle(course.title)}</span><span className="inline-flex items-center gap-2"><ImagePill color={course.percent===100?'green':course.percent?'amber':'grey'}>{course.percent}%</ImagePill><StatusShield status={course.percent===100?'green':course.percent?'yellow':'grey'} label={course.percent===100?'Completed':course.percent?'In progress':'Not started'}/></span></span></summary>
  <div className="space-y-2 py-2 pl-4"><Link href={`/work-hub/course/${course.id}`} className="text-[var(--brand-primary)] underline">View Course</Link>{course.score!==null&&<p>Coursework: {course.score}%</p>}{course.benchmarks.map(b=><div key={b.id} className="flex justify-between gap-3 text-sm"><span>{catalogTitle(b.title)}</span><span>{b.complete?'Completed':'Pending'}{b.reviewedAt?' · '+new Date(b.reviewedAt).toLocaleDateString():''}</span></div>)}</div>
 </details>);
 return <section aria-label="My VNDRLY/U training" className="space-y-2">
  {programs.map(p=>{const status=p.complete?expirationShield(p.expiresAt,true):p.percent?'yellow':'grey';return <details key={p.id} data-card-layout={p.complete || undefined} style={p.complete?{borderRadius:14}:undefined} className={p.complete?"my-3 rounded-xl border-2 border-[var(--brand-primary)] bg-[#242426] p-4":"border-b border-white/20 py-3"}>
   <summary className="cursor-pointer"><span className="inline-flex w-[95%] items-center justify-between gap-3"><span>{catalogTitle(p.title)}</span><span className="inline-flex shrink-0 items-center gap-2"><ImagePill color={status==='yellow'?'amber':status}>{p.percent}%</ImagePill><StatusShield status={status} label={status==='yellow'&&p.complete?'Expires within 60 days':status==='red'?'Expired':p.complete?'Completed':p.percent?'In progress':'Not started'}/></span></span></summary>
   <div className="py-2 pl-4"><Link href={`/work-hub/bundle/${p.id}`} className="text-[var(--brand-primary)] underline">View Certification</Link>{p.score!==null&&<p>Final assessment: {p.score}%</p>}{p.awardedAt&&<p>Completed: {new Date(p.awardedAt).toLocaleDateString()}</p>}{p.expiresAt&&<p style={{color: expirationTextColors[expirationShield(p.expiresAt)]}}>Expires: {p.expiresAt}</p>}{courses(p.courses)}</div>
  </details>})}
  {courses(extra)}
 </section>;
}


const expirationTextColors = {green: "#00db8b", yellow: "#fbbf24", red: "#ef4444", grey: "#a1a1aa"} as const;
