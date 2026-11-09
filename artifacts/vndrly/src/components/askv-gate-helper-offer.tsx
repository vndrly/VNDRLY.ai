import {useState,useSyncExternalStore} from 'react';
import {useLocation} from 'wouter';
import {useTranslation} from 'react-i18next';
import {ListTodo} from 'lucide-react';
import {useAuth} from '@/hooks/use-auth';
import {useNextSteps} from './next-steps';
import {canUseOfficeNavigation} from '@/lib/office-navigation';
import {registeredGateHelpers,subscribeGateHelpers,gateHelpersRevision,type GateHelperDefinition,type GateHelperContext} from '@/lib/gate-helper-registry';

const normalized=(text:string)=>text.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9 ]/g,' ').replace(/\s+/g,' ').trim();
export function gateHelperForInstruction(question:string,definitions:GateHelperDefinition[],office:boolean){
 const text=normalized(question);
 if(!/\b(?:how (?:do|can|should|to)|help me|show me|guide me|teach me|where (?:do|can|is|are)|como|ayudame|guiame|muestrame)\b/.test(text))return null;
 const matches=definitions.filter(d=>(office||d.access!=='office')&&(office||d.key!=='first-watch')).map(d=>({definition:d,score:Math.max(0,...d.keywords.map(word=>text.includes(normalized(word))?normalized(word).length:0))})).filter(item=>item.score>0);
 matches.sort((a,b)=>b.score-a.score||a.definition.key.localeCompare(b.definition.key));
 return matches[0]?.definition??null;
}
function pageContext():GateHelperContext{
 const params=new URLSearchParams(window.location.search);const result:GateHelperContext={};
 const site=Number(params.get('siteId'));if(Number.isSafeInteger(site)&&site>0)result.siteId=site;
 const vehicle=Number(params.get('vehicleId'));if(Number.isSafeInteger(vehicle)&&vehicle>0)result.vehicleId=vehicle;
 for(const key of ['stationId','shiftId','alertId','movementId']as const){const value=params.get(key);if(value&&/^[a-f0-9-]{36}$/i.test(value))result[key]=value;}
 const day=params.get('date')??params.get('day');if(day&&/^\d{4}-\d{2}-\d{2}$/.test(day))result.day=day;
 return result;
}
/** A how-to question offers the registered helper; only the user's click starts guidance. */
export function AskVGateHelperOffer({question,onStarted}:{question:string;onStarted?:()=>void}){
 const next=useNextSteps();const {user}=useAuth();const {i18n}=useTranslation();const [location]=useLocation();
 useSyncExternalStore(subscribeGateHelpers,gateHelpersRevision,gateHelpersRevision);
 const [result,setResult]=useState<{identity:string;ok:boolean}|null>(null);
 if(!next?.enabled||!user||!question.trim())return null;
 const definition=gateHelperForInstruction(question,registeredGateHelpers(),canUseOfficeNavigation(user));
 if(!definition)return null;
 const identity=JSON.stringify([next.scope,question,definition.key]);const current=result?.identity===identity?result:null;
 const busyWithOther=Boolean(next.selected&&next.selected.id!==definition.key);
 const es=i18n.language?.startsWith('es');
 return <section className="rounded-xl border-2 p-3 text-sm" style={{borderColor:'var(--brand-primary)',background:'#ffffff',color:'#111827'}} aria-label={es?'Ayuda guiada de Gate':'Gate guided helper offer'} data-testid="askv-gate-helper-offer">
  <strong className="flex items-center gap-2"><ListTodo className="h-4 w-4" aria-hidden="true"/>{definition.title}</strong>
  <p className="mt-1">{es?'Puedo guiarte con los controles reales, paso a paso. Tú revisas y guardas los cambios.':'I can guide you through the actual controls, one step at a time. You review and save each change.'}</p>
  <button className="vendor-mini-card-button mt-2" type="button" disabled={busyWithOther||current?.ok===true} onClick={()=>{const ok=next.startHelper(definition.key,pageContext());setResult({identity,ok});if(ok)onStarted?.();}} data-page={location}>{current?.ok?(es?'Ayuda iniciada':'Helper started'):(es?'Iniciar ayuda guiada':'Start guided helper')}</button>
  {busyWithOther&&<p role="status">{es?'Termina o cierra tu ayuda actual antes de iniciar otra.':'Finish or close your current helper before starting another.'}</p>}
  {current&&!current.ok&&!busyWithOther&&<p role="status">{es?'La ayuda no está disponible con tu acceso actual.':'This helper is unavailable with your current access.'}</p>}
 </section>;
}
