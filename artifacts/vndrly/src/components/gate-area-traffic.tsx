import { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/hooks/use-auth';
import { changeOverRequest } from '@/lib/change-over-api';
import { BrandedSelect } from './work-hub/chrome';
import { visitsApi } from '@/lib/visits-api';

export type PhysicalGate = {id:string;siteId:number;name:string;latitude:number|null;longitude:number|null;version:number;active:boolean;topology?:{kind:'independent'|'series'|'parallel';area:string;parentGateId:string|null;parallelGateId:string|null}|null};
type Movement={operationId:string;kind:string;gateId:string;gateName:string;area:string;destination:string;at:string};
type AreaVisit={id:number;firstName:string;lastName:string;company:string|null;vehiclePlate:string|null;checkOutTime:string|null;movements:Movement[];presence:{currentGateId:string|null;expectedGateId:string|null;expectedSiteExit:boolean;label:string}};
export function useGateAreaTraffic(siteId?:number) {
  const {user}=useAuth();
  return useQuery({queryKey:['gate-area-traffic',user?.userId,user?.activeMembershipId,siteId],queryFn:()=>changeOverRequest<{gates:PhysicalGate[];visits:AreaVisit[];canManage:boolean}>(`/movements?siteId=${siteId}`),enabled:!!siteId,refetchInterval:15000,retry:false});
}
export function GateAreaTraffic({siteId,gateId,view='all',history=false}:{siteId?:number;gateId?:string;view?:'arrivals'|'on_site'|'departures'|'all';history?:boolean}) {
  const query=useGateAreaTraffic(siteId),cache=useQueryClient(),{i18n}=useTranslation(),es=i18n?.language?.startsWith('es');
  const t=(en:string,spanish:string)=>es?spanish:en;
  const [destinations,setDestinations]=useState<Record<number,string>>({}),[busy,setBusy]=useState<number|null>(null),[message,setMessage]=useState('');
  const [showAll,setShowAll]=useState(false);
  const lock=useRef(false),operation=useRef<{fingerprint:string;id:string}|null>(null);
  const gates=query.data?.gates??[],gate=gates.find(g=>g.id===gateId),hasAreas=gates.some(g=>g.topology?.area);
  if(!hasAreas||!gate)return null;
  const area=gate.topology?.area,root=!area;
  const visits=(query.data?.visits??[]).filter(v=>{
    if(showAll)return !v.checkOutTime;
    if(view==='arrivals')return !v.checkOutTime&&v.presence.expectedGateId!=null&&gates.find(g=>g.id===v.presence.expectedGateId)?.topology?.area===area;
    if(view==='departures')return root?v.presence.expectedSiteExit||!!v.checkOutTime:(history?v.movements.some(m=>m.area===area&&m.kind==='leave'):v.movements.filter(m=>m.area===area&&(m.kind==='enter'||m.kind==='leave')).at(-1)?.kind==='leave');
    if(view==='on_site')return !v.checkOutTime&&(root||gates.find(g=>g.id===v.presence.currentGateId)?.topology?.area===area);
    return true;
  });
  async function act(visitId:number,kind:string) {
    if(lock.current||!siteId||!gateId)return;
    const destination=destinations[visitId]??'site_exit';
    const body={siteId,gateId,visitId,kind,...(kind==='leave'||kind==='route'?destination==='site_exit'||destination==='remain'?{destination}:{destinationGateId:destination}:{})};
    const fingerprint=JSON.stringify(body);
    if(operation.current?.fingerprint!==fingerprint)operation.current={fingerprint,id:crypto.randomUUID()};
    lock.current=true;setBusy(visitId);setMessage('');
    try {
      const result=kind==='site_exit'?(await visitsApi.gateCheckOut(visitId,undefined,undefined,undefined,gateId),{}):await changeOverRequest<{warning?:string}>('/movements',{...body,operationId:operation.current.id});
      operation.current=null;setMessage(result.warning??t('Movement recorded.','Movimiento registrado.'));
      await Promise.all(['gate-area-traffic','gatekeeper-visits','gate-history-report','gatekeeper-departures','gate-coverage-map'].map(key=>cache.invalidateQueries({queryKey:[key]})));
    } catch(e){setMessage(e instanceof Error?e.message:t('Could not save movement.','No se pudo guardar el movimiento.'));}
    finally{lock.current=false;setBusy(null);}
  }
  return <section aria-label={t('Site and secure-area movements','Movimientos del sitio y áreas seguras')} className="space-y-3 min-w-0">
    <h3 className="text-sm font-semibold">{t('Site and secure-area movements','Movimientos del sitio y áreas seguras')}</h3>
    {area&&<button className="text-sm text-[var(--brand-primary)]" aria-pressed={showAll} onClick={()=>setShowAll(!showAll)}>{showAll?t('Show this gate’s queue','Mostrar lista de este acceso'):t('Find someone already on site / unexpected arrival','Buscar persona en el sitio / llegada no prevista')}</button>}
    {message&&<p role="status" className="text-sm">{message}</p>}
    {!visits.length&&<p className="text-sm text-muted-foreground">{t('No internal movements in this queue.','No hay movimientos internos en esta lista.')}</p>}
    {visits.map(v=><article key={v.id} className="rounded-lg border border-white/20 bg-[#27272a] p-3 space-y-2 text-sm">
      <strong>{v.firstName} {v.lastName}</strong><p>{[v.company,v.vehiclePlate].filter(Boolean).join(' · ')}</p>
      <p>{v.presence.label}</p>
      {!v.checkOutTime&&<div className="flex flex-wrap items-center gap-2">
        <label className="grid gap-1 min-w-0 flex-1">{t('Next destination','Próximo destino')}<BrandedSelect aria-label={`${t('Destination for','Destino para')} ${v.firstName} ${v.lastName}`} value={destinations[v.id]??'site_exit'} onChange={e=>setDestinations({...destinations,[v.id]:e.target.value})} disabled={busy!==null}>
          <option value="site_exit">{t('Leaving site — Main Gate','Salir del sitio — acceso principal')}</option><option value="remain">{t('Remaining on site','Permanecer en el sitio')}</option>
          {gates.filter(g=>g.active&&g.topology?.area&&g.topology.area!==area).map(g=><option key={g.id} value={g.id}>{g.topology?.area} · {g.name}</option>)}
        </BrandedSelect></label>
        <div className="flex flex-wrap gap-3 w-full">
          <button className="text-[var(--brand-primary)] disabled:text-gray-500" disabled={busy!==null} onClick={()=>void act(v.id,'route')}>{t('Set destination','Establecer destino')}</button>
          {area&&<><button className="text-[var(--brand-primary)] disabled:text-gray-500" disabled={busy!==null||gates.find(g=>g.id===v.presence.currentGateId)?.topology?.area===area} onClick={()=>void act(v.id,'enter')}>{t('Enter secure area','Entrar al área segura')}</button><button className="text-[var(--brand-primary)] disabled:text-gray-500" disabled={busy!==null||gates.find(g=>g.id===v.presence.currentGateId)?.topology?.area!==area} onClick={()=>void act(v.id,'leave')}>{t('Leave secure area','Salir del área segura')}</button></>}
          {root&&<button className="text-[var(--brand-primary)] disabled:text-gray-500" disabled={busy!==null} onClick={()=>void act(v.id,'site_exit')}>{t('Confirm site departure','Confirmar salida del sitio')}</button>}
        </div>
      </div>}
      <details className="gate-panel-disclosure" open={history||undefined}><summary>{t('Movement history','Historial de movimientos')} ({v.movements.length})</summary><ul className="space-y-2 pt-2">{v.movements.map(m=><li key={m.operationId}><time>{new Date(m.at).toLocaleString()}</time> · {m.gateName} · {m.kind==='enter'?t('Entered','Entrada'):m.kind==='leave'?t('Left area','Salida del área'):m.kind==='route'?t('Destination updated','Destino actualizado'):t('Left site','Salida del sitio')}{m.destination!=='remain'&&<> → {m.destination==='site_exit'?t('Main Gate','Acceso principal'):m.destination}</>}</li>)}</ul></details>
    </article>)}
  </section>;
}
