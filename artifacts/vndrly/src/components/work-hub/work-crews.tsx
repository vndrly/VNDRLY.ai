import { useRef, useState, type CSSProperties } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Users } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { VendorEditFlyout } from "@/components/vendor-edit-flyout";
import { useBrand } from "@/hooks/use-brand";
import { useAuth } from "@/hooks/use-auth";
import { commandEnvelope, ownerForUser, workHubRequest } from "@/lib/work-hub-client";
import { ProfileActionButton } from "@/components/gate-profile-chrome";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { WorkHubCardTitle } from "./chrome";
import { CrewAnnouncements } from "./crew-announcements";

export type WorkCrew = { id: string; name: string; purpose: string; noExpiry: boolean; expiresAt: string | null; expired: boolean; members: { userId: number; name: string }[] };
type Workspace = { canManage: boolean; workers: { userId: number; name: string; lastName?: string | null }[]; crews: WorkCrew[] };
export function useWorkCrews() {
  const { user } = useAuth();
  return useQuery<Workspace>({ queryKey: ["work-hub", "work-crews", user?.userId, user?.activeMembershipId, user?.vendorId, user?.partnerId], queryFn: () => workHubRequest("/work-crews"), enabled: Boolean(user), refetchInterval: 15000, retry: false });
}
export function WorkCrews() {
  const { user } = useAuth(), owner = ownerForUser(user), query = useWorkCrews(), qc = useQueryClient(), brand = useBrand();
  const [creating, setCreating] = useState(false), [announcing, setAnnouncing] = useState(false), [search, setSearch] = useState("");
  const empty = { name: "", purpose: "", userIds: [] as number[], noExpiry: false };
  const [draft, setDraft] = useState(empty), [selected, setSelected] = useState<WorkCrew | null>(null);
  const [job, setJob] = useState({ title: "", description: "", dueAt: "" }), [saved, setSaved] = useState("");
  const operations = useRef(new Map<string, ReturnType<typeof commandEnvelope>>());
  function envelope(kind: string, payload: unknown) { const key=JSON.stringify([owner,kind,payload]); if(!operations.current.has(key))operations.current.set(key,commandEnvelope(owner!,payload)); return operations.current.get(key)!; }
  const create = useMutation({ mutationFn: () => workHubRequest<{ resource: { name: string } }>("/work-crews", { method: "POST", body: JSON.stringify(envelope("create",draft)) }), onSuccess: result => { setSaved(`Work crew “${result.resource.name}” created.`); setCreating(false); setDraft(empty); operations.current.clear(); void qc.invalidateQueries({ queryKey: ["work-hub", "work-crews"] }); } });
  const assign = useMutation({ mutationFn: () => workHubRequest<{ resource: { memberCount: number } }>(`/work-crews/${selected!.id}/assign`, { method: "POST", body: JSON.stringify(envelope(selected!.id,{title:job.title,description:job.description,dueAt:job.dueAt?new Date(job.dueAt).toISOString():null})) }), onSuccess: result => { setSaved(`Job assigned to all ${result.resource.memberCount} crew members.`); setSelected(null); setJob({title:"",description:"",dueAt:""}); operations.current.clear(); void qc.invalidateQueries({queryKey:["work-hub"]}); } });
  const byName=new Intl.Collator(undefined,{sensitivity:"base"});
  const workers=[...(query.data?.workers??[])].sort((a,b)=>byName.compare(a.lastName?.trim()||a.name.trim().split(/\s+/).at(-1)||a.name,b.lastName?.trim()||b.name.trim().split(/\s+/).at(-1)||b.name)||byName.compare(a.name,b.name)),crews=(query.data?.crews??[]).filter(crew=>!crew.expired);
  return <section aria-label="Work crews" className="grid gap-4">
    {saved&&<p role="status">{saved}</p>}
    <section data-work-hub-card aria-label="Current work crews" className="p-4 space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-3"><h2 className="m-0"><WorkHubCardTitle icon={Users}>Current work crews</WorkHubCardTitle></h2><div className="flex flex-wrap gap-2"><ProfileActionButton disabled={query.data?.canManage===false} onClick={()=>{setCreating(true);setSaved("");}}>Create work crew</ProfileActionButton><ProfileActionButton disabled={!owner||query.data?.canManage===false} onClick={()=>setAnnouncing(true)}>Crew announcements</ProfileActionButton></div></header>
      <div className="grid gap-3 pl-7">
      {query.isError&&<p role="alert">Could not load work crews. Try again.</p>}
    {crews.map(crew=><article key={crew.id} className="flex min-w-0 items-center gap-3 rounded-2xl border border-white/15 p-3"><div className="min-w-0 flex-1"><h3 className="truncate font-semibold">{crew.name}</h3><p className="truncate text-sm text-muted-foreground" title={crew.members.map(member=>member.name).join(", ")}>{crew.members.map(member=>member.name).join(", ")}</p><p className="text-xs text-muted-foreground">{crew.expired?"Expired":crew.noExpiry?"Does not expire":`Expires ${new Date(crew.expiresAt!).toLocaleDateString()}`}</p></div><ProfileActionButton disabled={crew.expired} onClick={()=>{setSelected(crew);setSaved("");}}>Assign job</ProfileActionButton></article>)}
      {!query.isPending&&!query.isError&&!crews.length&&<p className="text-sm text-muted-foreground">No current work crews.</p>}
      </div>
    {selected&&<form aria-label="Assign job to crew" className="grid gap-3 border-t border-white/15 pt-4" onSubmit={event=>{event.preventDefault();assign.mutate();}}><h3 className="font-semibold">Assign job to {selected.name}</h3><p className="text-sm text-muted-foreground">{selected.members.map(member=>member.name).join(", ")}</p>
      <label className="grid gap-1 text-sm">Job title<Input required maxLength={200} value={job.title} onChange={event=>setJob({...job,title:event.target.value})}/></label><label className="grid gap-1 text-sm">Job details<Textarea value={job.description} onChange={event=>setJob({...job,description:event.target.value})}/></label><label className="grid gap-1 text-sm">Due date<Input type="datetime-local" value={job.dueAt} onChange={event=>setJob({...job,dueAt:event.target.value})}/></label>
      {assign.isError&&<p role="alert">{assign.error.message}</p>}<div className="flex gap-2"><ProfileActionButton type="submit" disabled={!job.title.trim()||assign.isPending}>Assign to whole crew</ProfileActionButton><ProfileActionButton disabled={assign.isPending} onClick={()=>setSelected(null)}>Cancel</ProfileActionButton></div>
    </form>}
    </section>
    <Dialog open={creating} onOpenChange={value=>{if(!create.isPending)setCreating(value);}}>
      <VendorEditFlyout title="Create work crew" logoSrc={brand.logoSquareUrl||brand.logoUrl||undefined} logoAlt={`${brand.name} logo`} onClose={()=>{if(!create.isPending)setCreating(false);}} dismissDisabled={create.isPending}>
        <div className="managed-crews-page" style={{"--brand-primary":brand.primary} as CSSProperties}>
      {query.isError&&<p role="alert">Could not load the company worker pool. Try again.</p>}
    {creating&&<form aria-label="Create work crew" className="grid gap-3" onSubmit={event=>{event.preventDefault();create.mutate();}}>
      <label className="grid gap-1 text-sm">Crew name<Input required maxLength={120} value={draft.name} onChange={event=>setDraft({...draft,name:event.target.value})}/></label>
      <label className="grid gap-1 text-sm">Purpose<Textarea maxLength={2000} value={draft.purpose} onChange={event=>setDraft({...draft,purpose:event.target.value})}/></label>
      <fieldset className="min-w-0 space-y-2"><legend className="text-sm font-semibold">Company workers</legend><Input aria-label="Find company workers" placeholder="Search workers" value={search} onChange={event=>setSearch(event.target.value)}/>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">{query.isPending&&<p role="status">Loading company workers…</p>}{workers.filter(worker=>worker.name.toLowerCase().includes(search.trim().toLowerCase())).map(worker=><label key={worker.userId} className="crew-worker-choice flex min-h-11 min-w-0 cursor-pointer items-center gap-3 rounded-xl border border-white/15 px-3 py-2 text-sm"><input type="checkbox" checked={draft.userIds.includes(worker.userId)} onChange={event=>setDraft({...draft,userIds:event.target.checked?[...draft.userIds,worker.userId]:draft.userIds.filter(id=>id!==worker.userId)})}/><span className="min-w-0 truncate" title={worker.name}>{worker.name}{worker.userId===user?.userId?" (you)":""}</span></label>)}</div><p className="text-xs text-muted-foreground">{draft.userIds.length} selected</p>
      </fieldset>
      <label className="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" checked={draft.noExpiry} onChange={event=>setDraft({...draft,noExpiry:event.target.checked})}/>Do not expire</label>
      <p className="text-sm text-muted-foreground">Crews expire after 30 days without a job assignment. Assigning a job restarts the clock.</p>
      {create.isError&&<p role="alert">{create.error.message}</p>}<div className="flex gap-2"><ProfileActionButton type="submit" disabled={!owner||!draft.name.trim()||!draft.userIds.length||create.isPending||!query.data}>Create work crew</ProfileActionButton><ProfileActionButton disabled={create.isPending} onClick={()=>setCreating(false)}>Cancel</ProfileActionButton></div>
    </form>}
        </div>
      </VendorEditFlyout>
    </Dialog>
    <Dialog open={announcing} onOpenChange={setAnnouncing}>
      <VendorEditFlyout title="Crew announcements" logoSrc={brand.logoSquareUrl||brand.logoUrl||undefined} logoAlt={`${brand.name} logo`} onClose={()=>setAnnouncing(false)}>
        <div className="managed-crews-page" style={{"--brand-primary":brand.primary} as CSSProperties}>{owner&&<CrewAnnouncements owner={owner} crews={crews}/>}</div>
      </VendorEditFlyout>
    </Dialog>
  </section>;
}
