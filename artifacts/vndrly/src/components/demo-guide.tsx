import {useEffect,useState} from 'react';
import {useLocation} from 'wouter';
import {useAuth} from '@/hooks/use-auth';
import {PngPillButton} from '@/components/png-pill-rollover';
import {DEMO_VIEWS,DEMO_STEPS,DEMO_STORAGE_KEY,demoPersona,type DemoPersona} from '@/lib/demo-guide';

function savedGuide(){try{return JSON.parse(sessionStorage.getItem(DEMO_STORAGE_KEY)||'null');}catch{return null;}}
export default function DemoGuide(){
 const {user}=useAuth();const [,navigate]=useLocation();
 const [saved]=useState(savedGuide),[expanded,setExpanded]=useState(Boolean(saved?.guided)),[step,setStep]=useState(Number.isInteger(saved?.step)?saved.step:0);
 const [tickets,setTickets]=useState<{id:number;status:string}[]>([]);
 const [error,setError]=useState('');
 const persona:DemoPersona|undefined=demoPersona(saved?.persona);
 const active=Boolean(persona&&user?.userId===DEMO_VIEWS[persona].userId);
 useEffect(()=>{if(!active)return;let cancelled=false;void fetch(`${import.meta.env.BASE_URL.replace(/\/$/,'')}/api/tickets`,{credentials:'include',cache:'no-store'}).then(async r=>r.ok?r.json():null).then(data=>{const rows=Array.isArray(data)?data:data?.tickets??data?.items??[];if(!cancelled)setTickets(rows);}).catch(()=>{});return()=>{cancelled=true;};},[active]);
 if(!persona||!active)return null;
 const steps=DEMO_STEPS[persona],index=Math.max(0,Math.min(step,steps.length-1)),current=steps[index];
 function change(next:number){setStep(next);sessionStorage.setItem(DEMO_STORAGE_KEY,JSON.stringify({persona,guided:true,step:next}));}
 function open(){const match=current.status?tickets.find(t=>t.status===current.status):null;navigate(match?`/tickets/${match.id}`:current.path);}
 async function exit(){try{const response=await fetch(`${import.meta.env.BASE_URL.replace(/\/$/,'')}/api/auth/logout`,{method:'POST',credentials:'include'});if(!response.ok)throw Error();sessionStorage.removeItem(DEMO_STORAGE_KEY);window.location.assign(import.meta.env.BASE_URL);}catch{setError('Unable to exit. Please try again.');}}
 return <aside aria-label="VNDRLY demo helper" className="fixed bottom-3 left-3 z-[60] max-h-[75vh] w-[min(350px,calc(100vw-24px))] overflow-y-auto rounded-xl border-2 border-[var(--brand-primary)] bg-background p-4 text-foreground shadow-xl">
  <div className="flex items-center justify-between gap-2"><strong className="text-sm">Demo · {DEMO_VIEWS[persona].label}</strong><button className="text-sm underline" onClick={()=>setExpanded(!expanded)} aria-expanded={expanded}>{expanded?'Collapse':'Guide'}</button></div>
  <p className="mt-1 text-xs text-muted-foreground">Fictional history · Read-only · No real payments</p>
  {expanded&&<><p className="mt-4 text-xs font-semibold text-muted-foreground">Step {index+1} of {steps.length}</p><h2 className="mt-1 text-base font-bold">{current.title}</h2><p className="mt-2 text-sm leading-6">{current.text}</p><div className="mt-3"><PngPillButton color="blue" onClick={open}>Show me in the app</PngPillButton></div><div className="mt-3 flex flex-wrap gap-2"><PngPillButton disabled={index===0} onClick={()=>change(index-1)}>Back</PngPillButton><PngPillButton color="blue" onClick={()=>index===steps.length-1?setExpanded(false):change(index+1)}>{index===steps.length-1?'Explore freely':'Next / Skip'}</PngPillButton></div><button className="mt-3 text-xs underline" onClick={()=>change(0)}>Restart walkthrough</button></>}
  <div className="mt-3 flex justify-between text-xs"><button className="underline" onClick={()=>setExpanded(false)}>Explore on my own</button><button className="underline" onClick={()=>void exit()}>Exit demo / change role</button></div>
  {error&&<p role="alert" className="mt-2 text-xs text-red-600">{error}</p>}
 </aside>;
}
