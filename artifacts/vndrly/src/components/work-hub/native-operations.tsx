import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/hooks/use-auth";
import { PngPillButton } from "@/components/png-pill-rollover";
import NativeSupportConsole from "./native-support-console";
import { nativeOperationErrorMessage, nativeOperationsRequest, nativeRequestLabel, nativeRequestEvidence, type NativeOperationRequest } from "@/lib/native-operations-client";

type Policy = { enabled: boolean; locationRequests: boolean; photoRequests: boolean; automaticArrival?:boolean; usageAlertUsd?:number; usageAlertTokens?:number; escalation?:{assignedContactUserId:number|null;backupContactUserId:number|null;intervalMinutes:number}; supportGrants?:Array<{userId:number;purpose:string;expiresAt:string;workerUserIds:number[];siteIds:number[]}>; dutyModes: string[]; approvedAiProviders?: string[]; grants: Array<{ requesterUserId: number; workerUserId: number; siteId?: number; ticketId?: number }>; [key: string]: unknown };
type Status = {
  policy: Policy; userId: number; vendorId?: number | null; company?: { type: string; id: number };
  consent: { locationSharing: boolean }; duty: { active: boolean; mode?: string; endsAt?: string | null };
  designatedDeviceId: string | null; bindingVersion: number; canManagePolicy: boolean;
  canWorkerOperate?:boolean; canRequest?:boolean;
  onCallWindows?:Array<{startsAt:string;endsAt:string;consent:true}>;
  devices: Array<{ id: string; friendlyName: string; deviceClass: string; revokedAt: string | null }>;
  workers: Array<{ userId: number; vendorId?: number; displayName: string }>;
  sites?: Array<{ id: number; name: string }>; tickets?: Array<{ id: number; ticketNumber?: string; siteLocationId?: number }>;
  grantCandidates?: Array<{userId:number;displayName:string;orgType:string;orgId:number;siteId?:number}>;
  contactCandidates?:Array<{userId:number;displayName:string}>;
  supportCandidates?:Array<{userId:number;displayName:string}>;
  requests: NativeOperationRequest[];
};
type Attempt = { workerUserId: number; vendorId: number; kind: "location" | "photo"; ticketId?: number; siteId?: number; purpose: string; allowLibrary?: boolean; idempotencyKey: string };

export default function NativeOperations() {
  const { user } = useAuth();
  if (!user) return null;
  if (user.role === "admin") return <NativeSupportConsole key={`${user.userId}:${user.activeMembershipId}`} identity={`${user.userId}:${user.activeMembershipId}`} />;
  return <Panel key={`${user.userId}:${user.activeMembershipId}:${user.vendorId}:${user.partnerId}`} identity={`${user.userId}:${user.activeMembershipId}:${user.vendorId}:${user.partnerId}`} />;
}

function Panel({ identity }: { identity: string }) {
  const { i18n } = useTranslation(), queryClient = useQueryClient();
  const lang = i18n.language.startsWith("es") ? "es" : "en";
  const c = (en: string, es: string) => lang === "es" ? es : en;
  const key = ["native-operations", identity], journalKey = `native-request:${identity}`;
  const alive = useRef(true), busyRef = useRef(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [message, setMessage] = useState("");
  const [worker, setWorker] = useState(""), [ticket, setTicket] = useState(""), [site, setSite] = useState("");
  const [kind, setKind] = useState<"location" | "photo">("location"), [purpose, setPurpose] = useState(""), [allowLibrary, setAllowLibrary] = useState(false);
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const [grantRequester, setGrantRequester] = useState(""), [grantWorker, setGrantWorker] = useState(""), [grantSite, setGrantSite] = useState("");
  const [corruptJournal,setCorruptJournal]=useState(false);
  const [supportUser,setSupportUser]=useState(""),[supportWorker,setSupportWorker]=useState(""),[supportSite,setSupportSite]=useState(""),[supportPurpose,setSupportPurpose]=useState("");
  const [onCallStart,setOnCallStart]=useState(""),[onCallEnd,setOnCallEnd]=useState("");
  const status = useQuery({ queryKey: key, queryFn: ({ signal }) => nativeOperationsRequest<Status>("/status", { signal }), refetchInterval: 30000, enabled: Boolean(identity), retry: false });
  useEffect(() => {
    alive.current = true;
    const stored = sessionStorage.getItem(journalKey);
    if (stored) {
      try {
        const value: Attempt = JSON.parse(stored);
        if (!value.idempotencyKey || !value.workerUserId || !value.vendorId || !["photo", "location"].includes(value.kind)) throw Error("journal");
        setAttempt(value);
      } catch { setCorruptJournal(true);setError(c("The saved request needs review. Do not create a replacement until its outcome is checked.", "Revise la solicitud guardada antes de crear otra.")); }
    }
    return () => { alive.current = false; };
  }, [journalKey]);
  async function mutate(path: string, method: string, body: unknown, saved?: (value: unknown) => void) {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setError(""); setMessage("");
    try {
      const result = await nativeOperationsRequest(path, { method, body: JSON.stringify(body) });
      if (!alive.current) return;
      saved?.(result);
      setMessage(c("Change recorded. Device work may still be pending.", "Cambio registrado. El trabajo del dispositivo puede seguir pendiente."));
      await queryClient.invalidateQueries({ queryKey: key });
    } catch (e) { if (alive.current) setError(nativeOperationErrorMessage(e, lang)); }
    finally { busyRef.current = false; if (alive.current) setBusy(false); }
  }
  async function sendRequest() {
    if(corruptJournal)return;
    const selected = status.data?.workers.find(row => row.userId === Number(worker));
    const vendorId = selected?.vendorId ?? status.data?.vendorId;
    if (!attempt && (!selected || !vendorId || !purpose.trim() || kind === "photo" && !ticket)) return;
    const next = attempt ?? { workerUserId: selected!.userId, vendorId: vendorId!, kind, purpose: purpose.trim(), idempotencyKey: crypto.randomUUID(), ...(ticket ? { ticketId: Number(ticket) } : {}), ...(site ? { siteId: Number(site) } : {}), ...(kind === "photo" ? { allowLibrary } : {}) };
    sessionStorage.setItem(journalKey, JSON.stringify(next)); setAttempt(next);
    await mutate("/requests", "POST", next, () => { sessionStorage.removeItem(journalKey); setAttempt(null); setPurpose(""); });
  }
  const data = status.data;
  if (status.isPending) return <p role="status">{c("Loading native work…", "Cargando trabajo nativo…")}</p>;
  if (!data) return <section className="rounded-lg border p-4"><p role="alert">{status.error instanceof Error ? nativeOperationErrorMessage(status.error, lang) : c("Native work unavailable", "Trabajo nativo no disponible")}</p><PngPillButton onClick={() => void status.refetch()}>{c("Retry", "Reintentar")}</PngPillButton></section>;
  const ownVendor = Boolean(data.vendorId) && data.canWorkerOperate !== false;
  const enabled = data.policy.enabled;
  const fieldsDisabled = busy || Boolean(attempt);
  const fieldClass = "min-h-11 rounded-md border bg-background px-3 py-2 text-foreground";
  function field(label: string, content: React.ReactNode) { return <label className="grid gap-1 text-sm font-medium"><span>{label}</span>{content}</label>; }
  return <section aria-label={c("Native work", "Trabajo nativo")} className="mx-auto max-w-5xl space-y-5 p-4">
    <header><h2 className="text-2xl font-bold">{c("Native work", "Trabajo nativo")}</h2><p>{c("Request work from the designated phone and follow the saved result.", "Solicite trabajo al teléfono designado y consulte el resultado guardado.")}</p></header>
    {error && <p role="alert" className="rounded border border-red-400 p-3">{error}</p>}
    {message && <p role="status">{message}</p>}
    {!enabled && <p role="status">{c("Your company has turned native operations off.", "Su empresa desactivó las operaciones nativas.")}</p>}
    {enabled && ownVendor && <section className="space-y-3 rounded-lg border p-4">
      <h3 className="text-lg font-semibold">{c("Your duty and work phone", "Su servicio y teléfono de trabajo")}</h3>
      <details><summary>{c("Agreed on-call time","Horario de guardia acordado")}</summary><p>{c("Choose only a separately agreed window when work alerts may require your response. This does not start duty or location sharing.","Elija solo un horario acordado por separado para responder a alertas. Esto no inicia el servicio ni comparte ubicación.")}</p><div className="grid gap-3 sm:grid-cols-2">{field(c("Starts","Inicio"),<input className={fieldClass} type="datetime-local" value={onCallStart} onChange={e=>setOnCallStart(e.target.value)}/>)}{field(c("Ends","Fin"),<input className={fieldClass} type="datetime-local" value={onCallEnd} onChange={e=>setOnCallEnd(e.target.value)}/>)}</div><PngPillButton disabled={busy||!onCallStart||!onCallEnd||Date.parse(onCallEnd)<=Date.parse(onCallStart)} onClick={()=>{if(window.confirm(c("Confirm this agreed on-call window?","¿Confirmar este horario de guardia acordado?")))void mutate("/on-call","PUT",{windows:[...(data.onCallWindows??[]),{startsAt:new Date(onCallStart).toISOString(),endsAt:new Date(onCallEnd).toISOString(),consent:true}]});}}>{c("Confirm on-call time","Confirmar horario")}</PngPillButton><ul>{data.onCallWindows?.map((row,index)=><li key={index} className="flex gap-3 py-2">{new Date(row.startsAt).toLocaleString()} – {new Date(row.endsAt).toLocaleString()}<PngPillButton disabled={busy} onClick={()=>void mutate("/on-call","PUT",{windows:data.onCallWindows!.filter((_,i)=>i!==index)})}>{c("Remove","Quitar")}</PngPillButton></li>)}</ul></details>
      <p>{data.duty.active ? c("On duty", "En servicio") : c("Off duty", "Fuera de servicio")}{data.duty.endsAt ? ` · ${new Date(data.duty.endsAt).toLocaleString()}` : ""}</p>
      <label className="flex items-center gap-3"><input type="checkbox" disabled={busy} checked={data.consent.locationSharing} onChange={e => void mutate("/consent", "PUT", { locationSharing: e.target.checked })} />{c("Allow location requests during active duty", "Permitir solicitudes de ubicación durante el servicio")}</label>
      <p className="text-sm">{c("Your preference carries into future shifts. Off-duty location remains unavailable.", "Su preferencia se aplica a futuros turnos. La ubicación fuera de servicio no está disponible.")}</p>
      {field(c("Designated work phone", "Teléfono de trabajo designado"), <select className={fieldClass} value={data.designatedDeviceId ?? ""} disabled={busy} onChange={e => e.target.value && void mutate("/device", "PUT", { deviceId: e.target.value })}><option value="">{c("Choose your work phone", "Elija su teléfono")}</option>{data.devices.filter(row => !row.revokedAt).map(row => <option key={row.id} value={row.id}>{row.friendlyName} · {row.deviceClass}</option>)}</select>)}
      <div className="flex flex-wrap gap-3">{!data.duty.active && data.policy.dutyModes.includes("manual") && <PngPillButton disabled={busy} onClick={() => { if (window.confirm(c("Start duty? Your saved sharing preference will apply.", "¿Iniciar servicio? Se aplicará su preferencia de ubicación."))) void mutate("/duty", "POST", { action: "start", mode: "manual" }); }}>{c("Start duty", "Iniciar servicio")}</PngPillButton>}{data.duty.active && <PngPillButton disabled={busy} onClick={() => void mutate("/duty", "POST", { action: "end", mode: data.duty.mode ?? "manual" })}>{c("End duty", "Finalizar servicio")}</PngPillButton>}</div>
    </section>}
    {enabled && (data.workers.length > 0 || attempt) && <section className="space-y-3 rounded-lg border p-4">
      <h3 className="text-lg font-semibold">{c("Request device work", "Solicitar trabajo del dispositivo")}</h3>
      {attempt ? <p role="status">{c("The previous request has an unresolved outcome. Retry the same request to check it safely.", "El resultado anterior no está resuelto. Reintente la misma solicitud para verificarlo.")}</p> : <div className="grid gap-3 sm:grid-cols-2">
        {field(c("Worker", "Trabajador"), <select className={fieldClass} value={worker} disabled={fieldsDisabled} onChange={e => setWorker(e.target.value)}><option value="">{c("Choose an authorized worker", "Elija un trabajador autorizado")}</option>{data.workers.map(row => <option key={`${row.vendorId}:${row.userId}`} value={row.userId}>{row.displayName}</option>)}</select>)}
        {field(c("Request", "Solicitud"), <select className={fieldClass} value={kind} disabled={fieldsDisabled} onChange={e => setKind(e.target.value as "location" | "photo")}>{data.policy.locationRequests && <option value="location">{c("Fresh location", "Ubicación reciente")}</option>}{data.policy.photoRequests && <option value="photo">{c("Ticket photo", "Foto del ticket")}</option>}</select>)}
        {field(c("Site", "Sitio"), <select className={fieldClass} value={site} onChange={e => setSite(e.target.value)}><option value="">{c("Use ticket / company scope", "Usar ámbito del ticket / empresa")}</option>{data.sites?.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select>)}
        {field(c("Exact ticket", "Ticket exacto"), <select className={fieldClass} value={ticket} onChange={e => setTicket(e.target.value)}><option value="">{c("Choose a ticket for photos", "Elija un ticket para fotos")}</option>{data.tickets?.map(row => <option key={row.id} value={row.id}>{row.ticketNumber ?? `#${row.id}`}</option>)}</select>)}
        {field(c("Work purpose", "Motivo de trabajo"), <input className={fieldClass} maxLength={500} value={purpose} onChange={e => setPurpose(e.target.value)} />)}
        {kind === "photo" && <label className="flex items-center gap-3"><input type="checkbox" checked={allowLibrary} onChange={e => setAllowLibrary(e.target.checked)} />{c("Allow an existing photo", "Permitir una foto existente")}</label>}
      </div>}
      <PngPillButton disabled={busy || corruptJournal || !attempt && (!worker || !purpose.trim() || kind === "photo" && !ticket)} onClick={() => void sendRequest()}>{attempt ? c("Check the same request", "Consultar la misma solicitud") : c("Send request", "Enviar solicitud")}</PngPillButton>
      <p className="text-sm">{c("Location is unavailable off duty or offline. Photo requests expire at shift end or after eight hours; the worker reviews and saves the photo.", "La ubicación no está disponible fuera de servicio o sin conexión. Las fotos vencen al finalizar el turno o tras ocho horas; el trabajador revisa y guarda la foto.")}</p>
    </section>}
    <section className="space-y-3 rounded-lg border p-4"><h3 className="text-lg font-semibold">{c("Request history", "Historial de solicitudes")}</h3><PngPillButton disabled={busy} onClick={() => void status.refetch()}>{c("Refresh results", "Actualizar resultados")}</PngPillButton>
      {data.requests.length ? <ul className="space-y-3">{data.requests.map((row, index) => <li key={row.id ?? index} className="rounded border p-3"><strong>{row.purpose}</strong><p role="status">{nativeRequestLabel(row.state, lang)}</p><p className="text-sm">{row.kind === "photo" ? c("Ticket photo", "Foto del ticket") : c("Location", "Ubicación")}{row.ticketId ? ` · #${row.ticketId}` : ""}</p>{row.expiresAt && <p className="text-sm">{c("Expires", "Vence")}: {new Date(row.expiresAt).toLocaleString()}</p>}{nativeRequestEvidence(row, lang).map((text, i) => <p key={i}>{text}</p>)}{row.ticketId && ["saved", "completed"].includes(row.state) && <a className="underline" href={`/tickets/${row.ticketId}`}>{c("Open saved ticket", "Abrir ticket guardado")}</a>}</li>)}</ul> : <p>{c("No requests yet.", "Aún no hay solicitudes.")}</p>}
    </section>
    {data.canManagePolicy && <section className="space-y-3 rounded-lg border p-4"><h3 className="text-lg font-semibold">{c("Company settings", "Ajustes de la empresa")}</h3>
      {(["enabled", "locationRequests", "photoRequests"] as const).map((flag, index) => <label key={flag} className="flex items-center gap-3"><input type="checkbox" disabled={busy} checked={Boolean(data.policy[flag])} onChange={e => void mutate("/policy", "PUT", { ...data.policy, [flag]: e.target.checked })} />{[c("Native operations enabled", "Operaciones nativas activadas"), c("Location requests enabled", "Solicitudes de ubicación activadas"), c("Photo requests enabled", "Solicitudes de fotos activadas")][index]}</label>)}
      <fieldset><legend>{c("Duty methods", "Métodos de servicio")}</legend>{["manual", "ticket", "scheduled"].map(mode => <label key={mode} className="mr-4 inline-flex items-center gap-2"><input type="checkbox" checked={data.policy.dutyModes.includes(mode)} disabled={busy} onChange={e => void mutate("/policy", "PUT", { ...data.policy, dutyModes: e.target.checked ? [...data.policy.dutyModes, mode] : data.policy.dutyModes.filter(value => value !== mode) })} />{mode === "manual" ? c("Manual", "Manual") : mode === "ticket" ? c("Ticket-driven", "Por ticket") : c("Scheduled", "Programado")}</label>)}</fieldset>
      <label className="flex items-center gap-3"><input type="checkbox" disabled={busy} checked={Boolean(data.policy.automaticArrival)} onChange={e=>void mutate("/policy","PUT",{...data.policy,automaticArrival:e.target.checked})}/>{c("Allow automatic arrival for workers who choose it","Permitir llegada automática a trabajadores que la elijan")}</label>
      {data.policy.escalation && <fieldset className="grid gap-3 sm:grid-cols-3"><legend>{c("Unacknowledged work alerts","Alertas de trabajo sin confirmar")}</legend>
        {(["assignedContactUserId","backupContactUserId"] as const).map((name,index)=>field(index?c("Backup duty contact","Contacto de respaldo"):c("Assigned duty contact","Contacto de servicio"),<select key={name} className={fieldClass} disabled={busy} value={data.policy.escalation![name]??""} onChange={e=>void mutate("/policy","PUT",{...data.policy,escalation:{...data.policy.escalation,[name]:e.target.value?Number(e.target.value):null}})}><option value="">{c("No contact selected","Sin contacto seleccionado")}</option>{data.grantCandidates?.filter(row=>row.orgType==="vendor").map(row=><option key={`${row.userId}:${row.siteId}`} value={row.userId}>{row.displayName}</option>)}</select>))}
        {field(c("Minutes before backup","Minutos antes del respaldo"),<input className={fieldClass} key={data.policy.escalation.intervalMinutes} type="number" min={1} max={1440} disabled={busy} defaultValue={data.policy.escalation.intervalMinutes} onBlur={e=>{const value=Number(e.target.value);if(value>=1&&value<=1440&&value!==data.policy.escalation!.intervalMinutes)void mutate("/policy","PUT",{...data.policy,escalation:{...data.policy.escalation,intervalMinutes:value}});}}/>)}
      </fieldset>}
      <fieldset className="grid gap-3 sm:grid-cols-2"><legend>{c("Usage alerts; work continues","Alertas de uso; el trabajo continúa")}</legend>
        {field(c("Monthly estimated cost alert ($)","Alerta mensual de costo estimado ($)"),<input className={fieldClass} key={data.policy.usageAlertUsd} type="number" min={0.01} step={0.01} disabled={busy} defaultValue={data.policy.usageAlertUsd??25} onBlur={e=>{const value=Number(e.target.value);if(value>0&&value!==data.policy.usageAlertUsd)void mutate("/policy","PUT",{...data.policy,usageAlertUsd:value});}}/>)}
        {field(c("Monthly token alert","Alerta mensual de tokens"),<input className={fieldClass} key={data.policy.usageAlertTokens} type="number" min={1} disabled={busy} defaultValue={data.policy.usageAlertTokens??1000000} onBlur={e=>{const value=Number(e.target.value);if(Number.isSafeInteger(value)&&value>0&&value!==data.policy.usageAlertTokens)void mutate("/policy","PUT",{...data.policy,usageAlertTokens:value});}}/>)}
      </fieldset>
      <details><summary>{c("Support access to work content","Acceso de soporte al contenido de trabajo")}</summary>
        <p>{c("Support normally sees technical status only. Grant one support person access to one worker and site for one hour, with a recorded purpose.","Soporte normalmente solo ve el estado técnico. Autorice a una persona de soporte para un trabajador y sitio durante una hora, con un motivo registrado.")}</p>
        <div className="grid gap-3 sm:grid-cols-2">
          {field(c("Support person","Persona de soporte"),<select className={fieldClass} value={supportUser} onChange={e=>setSupportUser(e.target.value)}><option value="">{c("Choose support","Elija soporte")}</option>{data.supportCandidates?.map(row=><option key={row.userId} value={row.userId}>{row.displayName}</option>)}</select>)}
          {field(c("Worker","Trabajador"),<select className={fieldClass} value={supportWorker} onChange={e=>setSupportWorker(e.target.value)}><option value="">{c("Choose worker","Elija trabajador")}</option>{data.workers.map(row=><option key={row.userId} value={row.userId}>{row.displayName}</option>)}</select>)}
          {field(c("Site","Sitio"),<select className={fieldClass} value={supportSite} onChange={e=>setSupportSite(e.target.value)}><option value="">{c("Choose site","Elija sitio")}</option>{data.sites?.map(row=><option key={row.id} value={row.id}>{row.name}</option>)}</select>)}
          {field(c("Purpose","Motivo"),<input className={fieldClass} maxLength={300} value={supportPurpose} onChange={e=>setSupportPurpose(e.target.value)}/>)}
        </div>
        <PngPillButton disabled={busy||!supportUser||!supportWorker||!supportSite||!supportPurpose.trim()} onClick={()=>{if(window.confirm(c("Allow this scoped work-content access for one hour?","¿Permitir este acceso limitado al contenido durante una hora?")))void mutate("/policy","PUT",{...data.policy,supportGrants:[...(data.policy.supportGrants??[]),{userId:Number(supportUser),workerUserIds:[Number(supportWorker)],siteIds:[Number(supportSite)],purpose:supportPurpose.trim(),expiresAt:new Date(Date.now()+3600000).toISOString()}]});}}>{c("Grant one hour","Autorizar una hora")}</PngPillButton>
        <ul>{data.policy.supportGrants?.map((grant,index)=><li key={index} className="flex flex-wrap gap-3 py-2">{data.supportCandidates?.find(row=>row.userId===grant.userId)?.displayName??c("Support person","Persona de soporte")} · {grant.purpose} · {new Date(grant.expiresAt).toLocaleString()}<PngPillButton disabled={busy} onClick={()=>void mutate("/policy","PUT",{...data.policy,supportGrants:data.policy.supportGrants!.filter((_,i)=>i!==index)})}>{c("Revoke","Revocar")}</PngPillButton></li>)}</ul>
      </details>
      {data.policy.approvedAiProviders && <fieldset><legend>{c("Approved V providers", "Proveedores de V aprobados")}</legend>{["anthropic", "openai"].map(provider => <label key={provider} className="mr-4 inline-flex items-center gap-2"><input type="checkbox" disabled={busy} checked={data.policy.approvedAiProviders!.includes(provider)} onChange={e => void mutate("/policy", "PUT", { ...data.policy, approvedAiProviders: e.target.checked ? [...data.policy.approvedAiProviders!, provider] : data.policy.approvedAiProviders!.filter(value => value !== provider) })} />{provider === "anthropic" ? "AskV / Anthropic" : "OpenAI"}</label>)}</fieldset>}
      <details><summary>{c("Explicit supervisor grants", "Permisos explícitos de supervisores")}</summary><p className="text-sm">{c("Grant only a verified supervisor account for an exact worker and site. Current membership and ticket access are rechecked for every request.", "Autorice solo una cuenta de supervisor verificada para un trabajador y sitio exactos. Se verifican permisos en cada solicitud.")}</p><div className="grid gap-3 sm:grid-cols-3">{field(c("Supervisor", "Supervisor"), <select className={fieldClass} value={grantRequester} onChange={e => setGrantRequester(e.target.value)}><option value="">{c("Choose authorized supervisor", "Elija supervisor autorizado")}</option>{data.grantCandidates?.filter(row => !grantSite || !row.siteId || row.siteId === Number(grantSite)).map(row => <option key={`${row.userId}:${row.siteId}`} value={row.userId}>{row.displayName}</option>)}</select>)}{field(c("Worker", "Trabajador"), <select className={fieldClass} value={grantWorker} onChange={e => setGrantWorker(e.target.value)}><option value="">{c("Choose worker", "Elija trabajador")}</option>{data.workers.map(row => <option key={row.userId} value={row.userId}>{row.displayName}</option>)}</select>)}{field(c("Site", "Sitio"), <select className={fieldClass} value={grantSite} onChange={e => setGrantSite(e.target.value)}><option value="">{c("Choose site", "Elija sitio")}</option>{data.sites?.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select>)}</div><PngPillButton disabled={busy || !grantRequester || !grantWorker || !grantSite} onClick={() => void mutate("/policy", "PUT", { ...data.policy, grants: [...data.policy.grants, { requesterUserId: Number(grantRequester), workerUserId: Number(grantWorker), siteId: Number(grantSite) }] })}>{c("Grant site access", "Autorizar acceso al sitio")}</PngPillButton><ul>{data.policy.grants.map((grant, index) => <li key={index} className="flex flex-wrap items-center gap-3 py-2">{`${grant.requesterUserId} → ${grant.workerUserId} · ${grant.siteId ?? grant.ticketId ?? "company"}`}<PngPillButton disabled={busy} onClick={() => void mutate("/policy", "PUT", { ...data.policy, grants: data.policy.grants.filter((_, i) => i !== index) })}>{c("Revoke grant", "Revocar permiso")}</PngPillButton></li>)}</ul></details>
    </section>}
  </section>;
}
