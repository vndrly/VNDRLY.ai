import { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/hooks/use-auth';
import { changeOverRequest } from '@/lib/change-over-api';
import { BrandedSelect } from './work-hub/chrome';
import { visitsApi } from '@/lib/visits-api';
import { useNextSteps } from './next-steps';
import { useGuidedTarget } from './guided-target';
import { gateGuideMatches, gateGuideScope, gateMovementTarget } from '@/lib/gate-operational-helpers';
import type { GateHelperKey } from '@/lib/gate-helper-registry';

export type PhysicalGate = {id:string;siteId:number;name:string;latitude:number|null;longitude:number|null;version:number;active:boolean;topology?:{kind:'independent'|'series'|'parallel';area:string;parentGateId:string|null;parallelGateId:string|null;destinations?:{id:string;name:string;gateId:string|null}[];defaultDestinationId?:string|null}|null};
export function parallelGateGroup(gates:PhysicalGate[],gateId?:string) {
  const group=new Set<string>(gateId?[gateId]:[]);
  let changed=true;
  while(changed){changed=false;for(const gate of gates){const sibling=gate.topology?.parallelGateId;if(sibling&&(group.has(gate.id)||group.has(sibling))){if(!group.has(gate.id)||!group.has(sibling))changed=true;group.add(gate.id);group.add(sibling);}}}
  return group;
}
export function gateCheckInDestinationDefaults(gates:PhysicalGate[],gateId?:string) {
  const gate=gates.find(g=>g.id===gateId),named=gate?.topology?.destinations??[];
  const children=gateId?gates.filter(g=>g.active&&g.topology?.parentGateId===gateId):[];
  return {destinationId:named.length?(gate?.topology?.defaultDestinationId??(named.length===1?named[0].id:undefined)):undefined,destinationGateId:!named.length&&children.length===1?children[0].id:undefined};
}
type Movement={operationId:string;kind:string;gateId:string;gateName:string;area:string;destination:string;at:string;actorName?:string;actorId?:number;note?:string};
type AreaVisit={id:number;entryGateId?:string|null;firstName:string;lastName:string;company:string|null;vehiclePlate:string|null;checkInTime?:string;checkOutTime:string|null;movements:Movement[];presence:{currentGateId:string|null;expectedGateId:string|null;expectedSiteExit:boolean;label:string;lastConfirmedGateId?:string|null;lastConfirmedLocation?:string;intendedDestination?:string|null}};
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
  const gates=query.data?.gates??[],gate=gates.find(g=>g.id===gateId),hasAreas=gates.some(g=>g.topology?.area||g.topology?.destinations?.length);
  const enteredSecureArea = (visit: AreaVisit) => visit.movements.some(movement => movement.kind === 'enter' && Boolean(movement.area || gates.find(g => g.id === movement.gateId)?.topology?.area));
  const helper = useNextSteps();
  const selectedVisit = (query.data?.visits ?? []).find(v => helper?.selected?.context?.vehicleId != null && String(v.id) === String(helper.selected.context.vehicleId));
  const selectedContext = { siteId, stationId: gateId, vehicleId: selectedVisit?.id };
  const movementKey = helper?.selected?.id as GateHelperKey | undefined;
  const selectedInside = Boolean(gate?.topology?.area && gates.find(g => g.id === selectedVisit?.presence.currentGateId)?.topology?.area === gate.topology.area);
  const target = movementKey && selectedVisit && gateGuideMatches(helper?.selected, movementKey, selectedContext) ? gateMovementTarget(movementKey, { open: !selectedVisit.checkOutTime, online: navigator.onLine, canManage: query.data?.canManage !== false && !query.isError && busy === null, inner: Boolean(gate?.topology?.area), inside: selectedInside, expectedHere: selectedVisit.presence.expectedGateId === gateId, expectedInner: Boolean(selectedVisit.presence.expectedGateId) && !enteredSecureArea(selectedVisit), expectedSiteExit: selectedVisit.presence.expectedSiteExit, previouslyEntered: selectedVisit.movements.some(m => m.kind === 'enter' && m.gateId === gateId), showAll }) : null;
  const finderScope = gateGuideScope('traffic-finder', { siteId, stationId: gateId });
  useGuidedTarget(target && { ...target, scopeId: target.targetId === 'find-vehicle' ? finderScope : gateGuideScope('movement', selectedContext) }, Boolean(target), 45);
  if(!hasAreas||!gate)return null;
  const area=gate.topology?.area,root=!area;
  const entryGate=gates.find(g=>g.id===gate.topology?.parentGateId)??gate;
  const namedDestinations=entryGate.topology?.destinations??[];
  const routeGates=gates.filter(g=>g.active&&g.topology?.parentGateId===gateId);
  const isInArea=(v:AreaVisit)=>!!area&&gates.find(g=>g.id===v.presence.currentGateId)?.topology?.area===area;
  const rootGates=parallelGateGroup(gates,gateId);
  const visits=(query.data?.visits??[]).filter(v=>{
    if(root&&v.entryGateId&&!rootGates.has(v.entryGateId))return false;
    if(showAll)return !v.checkOutTime;
    if(view==='arrivals')return (root&&v.entryGateId===gateId)||v.presence.expectedGateId===gateId||v.movements.some(m=>m.gateId===gateId&&m.kind==='enter');
    if(view==='departures')return root?v.presence.expectedSiteExit||!!v.checkOutTime:v.movements.some(m=>m.gateId===gateId&&m.kind==='leave');
    if(view==='on_site')return !v.checkOutTime&&(root||isInArea(v));
    return root||gates.find(g=>g.id===v.presence.currentGateId)?.topology?.area===area||v.movements.some(m=>m.area===area);
  });
  async function act(visitId:number,kind:string) {
    if(lock.current||!siteId||!gateId||!navigator.onLine)return;
    const before = query.data?.visits.find(v => v.id === visitId);
    const destination=destinations[visitId]??(kind==='route'?'remain':'site_exit');
    const body={siteId,gateId,visitId,kind,...(kind==='leave'||kind==='route'?destination==='site_exit'||destination==='remain'?{destination}:namedDestinations.some(d=>d.id===destination)?{destinationId:destination}:{destinationGateId:destination}:{})};
    const fingerprint=JSON.stringify(body);
    if(operation.current?.fingerprint!==fingerprint)operation.current={fingerprint,id:crypto.randomUUID()};
    lock.current=true;setBusy(visitId);setMessage('');
    try {
      const result=kind==='site_exit'?(await visitsApi.gateCheckOut(visitId,undefined,undefined,undefined,gateId),{}):await changeOverRequest<{warning?:string}>('/movements',{...body,operationId:operation.current.id});
      operation.current=null;setMessage(result.warning??t('Movement recorded.','Movimiento registrado.'));
      await Promise.all(['gate-area-traffic','gatekeeper-visits','gate-history-report','gatekeeper-departures','gate-coverage-map'].map(key=>cache.invalidateQueries({queryKey:[key]})));
      if (before && helper?.recordCompletion) {
        const previouslyEntered = before.movements.some(m => m.kind === 'enter' && m.gateId === gateId);
        const key = kind === 'enter' ? previouslyEntered ? 'gate-return-to-inner' : 'gate-inner-arrival' : kind === 'site_exit' ? before.presence.expectedGateId && !enteredSecureArea(before) ? 'gate-early-turnaround' : 'gate-vehicle-check-out' : null;
        if (key) void helper.recordCompletion(key, { recordType: 'gate-visit', recordId: before.id, siteId });
        if (kind === 'leave' && destination === 'site_exit' && before.entryGateId && helper.selected?.id === 'gate-vehicle-check-out') {
          helper.updateHelperStep('gate-vehicle-check-out', { action: null, message: 'Your inner departure is saved. The outer-gate colleague must confirm final site checkout; the visit is still on site. Keep your current watch. You can stop this guide without changing saved work.' });
        }
      }
    } catch(e){setMessage(e instanceof Error?e.message:t('Could not save movement.','No se pudo guardar el movimiento.'));await query.refetch();}
    finally{lock.current=false;setBusy(null);}
  }
  return <section data-guidance-scope={finderScope} aria-label={t('Site and secure-area movements','Movimientos del sitio y áreas seguras')} className="space-y-3 min-w-0">
    <h3 className="text-sm font-semibold">{t('Site and secure-area movements','Movimientos del sitio y áreas seguras')}</h3>
    {area&&<button data-guidance-id="find-vehicle" className="text-sm text-[var(--brand-primary)]" aria-pressed={showAll} onClick={()=>setShowAll(!showAll)}>{showAll?t('Show this gate’s queue','Mostrar lista de este acceso'):t('Find someone already on site / unexpected arrival','Buscar persona en el sitio / llegada no prevista')}</button>}
    {message&&<p role="status" className="text-sm">{message}</p>}
    {!visits.length&&<p className="text-sm text-muted-foreground">{t('No internal movements in this queue.','No hay movimientos internos en esta lista.')}</p>}
    {visits.map(v=>{const pending=!v.checkOutTime&&(view==='arrivals'?v.presence.expectedGateId===gateId:view==='departures'&&root&&v.presence.expectedSiteExit);const hours=v.checkInTime?(Date.now()-Date.parse(v.checkInTime))/3600000:0;return <article data-guidance-scope={gateGuideScope('movement', { siteId, stationId: gateId, vehicleId: v.id })} key={v.id} className={`rounded-lg border border-white/20 bg-[#27272a] p-3 space-y-2 text-sm ${pending?"gate-movement-pending":view==='on_site'&&hours>=48?"gate-movement-overdue":view==='on_site'&&hours>=24?"gate-movement-aged":""}`}>
      <strong>{v.firstName} {v.lastName}</strong><p>{[v.company,v.vehiclePlate].filter(Boolean).join(' · ')}</p>
      {view==='on_site'&&v.checkInTime&&<p>{t('Time on site','Tiempo en el sitio')}: {Math.floor(Math.max(0,hours))}:{String(Math.floor(Math.max(0,hours)*60)%60).padStart(2,'0')}</p>}<p className={pending?"gate-pending-text":""}>{pending?t(view==='arrivals'?'Awaiting arrival confirmation':'Awaiting site checkout',view==='arrivals'?'Esperando confirmar llegada':'Esperando salida del sitio'):v.presence.label}</p>
      {!v.checkOutTime&&<div className="flex flex-wrap items-center gap-2">
        {area && !isInArea(v) && (v.presence.expectedGateId===gateId||showAll) && <button data-guidance-id="enter" className="gate-history-filter" disabled={busy!==null} onClick={()=>void act(v.id,'enter')}>{t('Confirm arrival','Confirmar llegada')}</button>}
        {area && isInArea(v) && <>
          {(namedDestinations.some(d=>!d.gateId||gates.find(g=>g.id===d.gateId)?.topology?.area!==area)||gates.filter(g=>g.active&&g.topology?.area&&g.topology.area!==area).length>0) && <label>{t('Next destination','Próximo destino')}<BrandedSelect aria-label={`${t('Destination for','Destino para')} ${v.firstName} ${v.lastName}`} value={destinations[v.id]??'site_exit'} onChange={e=>setDestinations({...destinations,[v.id]:e.target.value})} disabled={busy!==null}><option value="site_exit">{t('Leaving site','Salir del sitio')}</option><option value="remain">{t('Remaining on site','Permanecer en el sitio')}</option>{namedDestinations.length?namedDestinations.filter(d=>!d.gateId||gates.find(g=>g.id===d.gateId)?.topology?.area!==area).map(d=><option key={d.id} value={d.id}>{d.name}</option>):gates.filter(g=>g.active&&g.topology?.area&&g.topology.area!==area).map(g=><option key={g.id} value={g.id}>{g.name}</option>)}</BrandedSelect></label>}
          <button data-guidance-id="leave" className="gate-history-filter" disabled={busy!==null} onClick={()=>void act(v.id,'leave')}>{t('Check out','Registrar salida')}</button>
        </>}
        {root && view==='on_site' && !gates.find(g=>g.id===v.presence.currentGateId)?.topology?.area && (namedDestinations.length>0||routeGates.length>0) && <>
          <label>{t('Next destination','Próximo destino')}<BrandedSelect aria-label={`${t('Destination for','Destino para')} ${v.firstName} ${v.lastName}`} value={destinations[v.id]??'remain'} onChange={e=>setDestinations({...destinations,[v.id]:e.target.value})} disabled={busy!==null}>
            <option value="remain">{t('Remaining on site','Permanecer en el sitio')}</option>
            {namedDestinations.length?namedDestinations.map(d=><option key={d.id} value={d.id}>{d.name}</option>):routeGates.map(g=><option key={g.id} value={g.id}>{g.topology?.area} · {g.name}</option>)}
          </BrandedSelect></label>
          <button className="gate-history-filter" disabled={busy!==null} onClick={()=>void act(v.id,'route')}>{t('Set destination','Establecer destino')}</button>
        </>}
        {root && !gates.find(g=>g.id===v.presence.currentGateId)?.topology?.area && <button data-guidance-id="site-exit" className="gate-history-filter" disabled={busy!==null} onClick={()=>void act(v.id,'site_exit')}>{t('Check out','Registrar salida')}</button>}
      </div>}
      {helper?.enabled && !v.checkOutTime && query.data?.canManage !== false && <div className="flex flex-wrap gap-3 border-t border-white/10 pt-2">
        {([...(area && !isInArea(v) && v.presence.expectedGateId === gateId ? ['gate-inner-arrival'] : []), ...(area && !isInArea(v) && v.movements.some(m => m.kind === 'enter' && m.gateId === gateId) ? ['gate-return-to-inner'] : []), ...(isInArea(v) || root && !gates.find(g=>g.id===v.presence.currentGateId)?.topology?.area ? [root && v.presence.expectedGateId && !enteredSecureArea(v) ? 'gate-early-turnaround' : 'gate-vehicle-check-out'] : [])] as GateHelperKey[]).map(key => <button type="button" key={key} className="text-xs underline underline-offset-4" onClick={() => helper.startHelper(key, { siteId, stationId: gateId, stationName: gate.name, vehicleId: v.id })}>{key === 'gate-inner-arrival' ? t('Guide this arrival', 'Guiar esta llegada') : key === 'gate-return-to-inner' ? t('Guide this return', 'Guiar este regreso') : key === 'gate-early-turnaround' ? t('Guide this turnaround', 'Guiar este retorno') : t('Guide this checkout', 'Guiar esta salida')}</button>)}
      </div>}
      <details className="gate-panel-disclosure" open={history||undefined}><summary>{t('Movement history','Historial de movimientos')} ({v.movements.length})</summary><ul className="space-y-2 pt-2">{v.movements.map(m=><li key={m.operationId}><time>{new Date(m.at).toLocaleString()}</time> · {m.gateName} · {m.actorName??(m.actorId?`User ${m.actorId}`:t('Gatekeeper','Portero'))} · {m.kind==='enter'?t('Entered','Entrada'):m.kind==='leave'?t('Left area','Salida del área'):m.kind==='route'?t('Destination updated','Destino actualizado'):t('Left site','Salida del sitio')}{m.note&&<> · {m.note}</>}{m.destination!=='remain'&&<> → {m.destination==='site_exit'?t('Main Gate','Acceso principal'):m.destination}</>}</li>)}</ul></details>
    </article>})}
  </section>;
}

/** Gate-confirmed state; deliberately separate from live staff or vehicle GPS. */
export function GateMovementLocationSummary({siteId,gateId}:{siteId?:number;gateId?:string}) {
  const query=useGateAreaTraffic(siteId),{i18n}=useTranslation(),es=i18n?.language?.startsWith('es');
  const visits=(query.data?.visits??[]).filter(v=>!v.checkOutTime&&(v.presence.lastConfirmedGateId===gateId||v.presence.expectedGateId===gateId));
  if(!visits.length)return null;
  return <section aria-label={es?'Ubicación confirmada en acceso':'Gate-confirmed locations'} className="space-y-2 text-sm">
    <h3 className="font-semibold">{es?'Ubicación confirmada en acceso · no es GPS en vivo':'Gate-confirmed locations · not live GPS'}</h3>
    {visits.map(v=><div key={v.id} className="rounded border border-white/20 p-2"><strong>{v.firstName} {v.lastName}</strong><p>{es?'Última ubicación confirmada':'Last confirmed location'}: {v.presence.lastConfirmedLocation??v.presence.label}</p><p>{es?'Destino previsto':'Intended destination'}: {v.presence.intendedDestination??(es?'Sin destino pendiente':'No pending destination')}</p></div>)}
  </section>;
}
