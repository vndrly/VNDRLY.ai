import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { workHubRequest } from "@/lib/work-hub-client";
import BrandPillButton from "@/components/brand-pill-button";
import { BrandedInput } from "./chrome";

export function ChatParticipants({ channelId, creatorId, members }: { channelId: string; creatorId: number; members: { userId: number; displayName: string; mode?: string }[] }) {
  const { user } = useAuth();
  const client = useQueryClient();
  const [search, setSearch] = useState("");
  const [add, setAdd] = useState<number[]>([]);
  const [remove, setRemove] = useState<number[]>([]);
  const access = useQuery<{ canManage: boolean }>({ queryKey: ["work-hub", "member-access", channelId, user?.userId, user?.activeMembershipId], queryFn: () => workHubRequest(`/channels/${channelId}/member-access`) });
  const people = useQuery<{ id: number; displayName: string; organizationName?: string }[]>({ queryKey: ["work-hub", "participant-search", search, user?.userId, user?.activeMembershipId], queryFn: () => workHubRequest(`/people?search=${encodeURIComponent(search)}`), enabled: access.data?.canManage === true && search.trim().length >= 2 });
  const save = useMutation({ mutationFn: () => workHubRequest(`/channels/${channelId}/chat-participants`, { method: "PATCH", body: JSON.stringify({ addUserIds: add, removeUserIds: remove }) }),
    onSuccess: async () => { setAdd([]); setRemove([]); await client.invalidateQueries({ queryKey: ["work-hub"] }); } });
  const toggle = (ids: number[], id: number) => ids.includes(id) ? ids.filter(x => x !== id) : [...ids, id];
  return <div className="space-y-3">
    <p className="text-xs text-muted-foreground">Only participants and company admins can view this chat. Company admins can view all company chats.</p>
    {members.map(member => <div key={member.userId} className="flex items-center justify-between gap-3 border-b py-3">
      <span>{member.displayName}<small className="block text-muted-foreground">{member.userId === creatorId ? "Creator" : "Participant"}</small></span>
      {access.data?.canManage && member.userId !== creatorId && <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={remove.includes(member.userId)} disabled={save.isPending} onChange={() => setRemove(toggle(remove, member.userId))} />Remove</label>}
    </div>)}
    {access.data?.canManage && <div className="space-y-3 pt-3">
      <h3>Add people</h3><BrandedInput aria-label="Find chat participants" placeholder="Find company people by name or email" value={search} onChange={event => setSearch(event.target.value)} />
      {people.data?.filter(person => !members.some(m => m.userId === person.id)).map(person => <label key={person.id} className="flex items-center gap-3 text-sm"><input type="checkbox" checked={add.includes(person.id)} disabled={save.isPending} onChange={() => setAdd(toggle(add, person.id))} />{person.displayName}{person.organizationName ? ` · ${person.organizationName}` : ""}</label>)}
      <p className="text-xs text-muted-foreground">{add.length} to add · {remove.length} to remove. Added participants can see this chat’s history.</p>
      <BrandPillButton tone="brand" disabled={(!add.length && !remove.length) || save.isPending} onClick={() => save.mutate()}>Save participants</BrandPillButton>
    </div>}
    {(access.isError || people.isError || save.isError) && <p role="alert">{save.error?.message ?? "Participant information could not load."}</p>}
    {save.isSuccess && <p role="status">Participants saved.</p>}
  </div>;
}
