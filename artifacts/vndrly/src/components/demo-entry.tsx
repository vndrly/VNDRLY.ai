import {useState} from 'react';
import {Popover,PopoverTrigger,PopoverContent} from '@/components/ui/popover';
import {PngPillButton} from '@/components/png-pill-rollover';
import {DEMO_VIEWS,DEMO_ENTRY_PATHS,DEMO_STORAGE_KEY,type DemoPersona} from '@/lib/demo-guide';

export default function DemoEntry(){
 const [persona,setPersona]=useState<DemoPersona|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 async function enter(guided:boolean){
  if(!persona||busy)return;setBusy(true);setError('');
  try{
   const response=await fetch(`${import.meta.env.BASE_URL.replace(/\/$/,'')}/api/auth/demo-entry`,{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({persona})});
   if(!response.ok)throw Error('The demo is temporarily unavailable. Please try again.');
   sessionStorage.setItem(DEMO_STORAGE_KEY,JSON.stringify({persona,guided,step:0}));
   window.location.assign(`${import.meta.env.BASE_URL.replace(/\/$/,'')}${DEMO_ENTRY_PATHS[persona]}`);
  }catch(e){setError(e instanceof Error?e.message:'Unable to open demo.');setBusy(false);}
 }
 return <Popover><PopoverTrigger asChild><button type="button" data-testid="marketing-demo-cta" style={{height:30,minHeight:30,maxHeight:30,fontSize:13,fontWeight:700}} className="inline-flex h-[30px] items-center rounded-full border border-white/60 px-6 text-[13px] font-bold text-white hover:border-[var(--vndrly-amber)] hover:text-[var(--vndrly-amber)] focus-visible:ring-2 focus-visible:ring-[var(--vndrly-amber)]">Demo</button></PopoverTrigger>
  <PopoverContent align="start" collisionPadding={12} style={{maxHeight:'var(--radix-popover-content-available-height)'}} className="w-[min(360px,calc(100vw-24px))] overflow-y-auto border-white/30 bg-[#15191d] p-4 text-white">
   <h2 className="text-lg font-bold">Explore VNDRLY</h2><p className="mt-1 text-sm text-slate-300">Choose your view of a fictional, connected operation with 30 days of history.</p>
   <fieldset disabled={busy} className="mt-3 space-y-2"><legend className="sr-only">Demo role</legend>{(Object.keys(DEMO_VIEWS) as DemoPersona[]).map(key=><label key={key} className="flex cursor-pointer gap-3 rounded-lg border border-white/30 p-2"><input type="radio" name="demo-persona" value={key} checked={persona===key} onChange={()=>setPersona(key)}/><span><span className="block text-sm font-bold">{DEMO_VIEWS[key].label}</span><span className="text-xs text-slate-300">{DEMO_VIEWS[key].company}</span></span></label>)}</fieldset>
   <div className="mt-4 flex flex-col gap-2"><PngPillButton color="blue" disabled={!persona||busy} onClick={()=>void enter(false)}>Explore on my own</PngPillButton><PngPillButton color="blue" disabled={!persona||busy} onClick={()=>void enter(true)}>Guide me through</PngPillButton></div>
   <p className="mt-3 text-xs text-slate-300">No account or password needed. Read-only demo; no real payments or messages.</p>{busy&&<p role="status">Opening your demo…</p>}{error&&<p role="alert" className="mt-2 text-sm text-red-300">{error}</p>}
  </PopoverContent></Popover>;
}
