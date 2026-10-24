import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { createWorkHubOperationId, workHubRequest } from "@/lib/work-hub-client";
import BrandPillButton from "@/components/brand-pill-button";
import { BrandedInput } from "./chrome";

type Person = { id: number; displayName: string; organizationName?: string };
export function NewChat({ onCreated }: { onCreated: (id: string) => void }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Person[]>([]);
  const [name, setName] = useState("");
  const [operationId, setOperationId] = useState(createWorkHubOperationId);
  const people = useQuery<Person[]>({
    queryKey: ["work-hub", "new-chat-people", user?.userId, user?.activeMembershipId, search],
    queryFn: () => workHubRequest(`/people?search=${encodeURIComponent(search)}`),
  });
  const create = useMutation({
    mutationFn: () => workHubRequest<{ channel: { id: string } }>("/channels/start-chat", {
      method: "POST", body: JSON.stringify({ participantUserIds: selected.map(p => p.id), name: name.trim() || undefined, operationId }),
    }),
    onSuccess: result => {
      setSelected([]); setName(""); setSearch(""); setOperationId(createWorkHubOperationId());
      qc.invalidateQueries({ queryKey: ["work-hub"] }); onCreated(result.channel.id);
    },
  });
  const changed = () => { setOperationId(createWorkHubOperationId()); create.reset(); };
  return <div className="grid gap-3">
    <BrandedInput aria-label="Find chat participants" placeholder="Search people by name or email" value={search} onChange={e => setSearch(e.target.value)} disabled={create.isPending} />
    {selected.length > 0 && <div className="flex flex-wrap gap-x-3 gap-y-1" aria-label="Selected chat participants">
      {selected.map(p => <span key={p.id} className="inline-flex items-center gap-1 text-sm">
        {p.displayName}<button type="button" aria-label={`Remove ${p.displayName}`} disabled={create.isPending}
          onClick={() => { setSelected(selected.filter(person => person.id !== p.id)); changed(); }} className="px-1 text-muted-foreground hover:text-foreground">×</button>
      </span>)}
    </div>}
    <div className="max-h-40 overflow-y-auto space-y-1" aria-label="Choose chat participants">
      {people.data?.filter(p => p.id !== user?.userId && !selected.some(s => s.id === p.id)).map(p =>
        <label key={p.id} className="flex items-center gap-2 text-sm cursor-pointer">
          <input type="checkbox" checked={false} disabled={create.isPending || selected.length >= 100}
            onChange={() => { setSelected([...selected, p]); changed(); }} />
          <span>{p.displayName}{p.organizationName ? ` · ${p.organizationName}` : ""}</span>
        </label>)}
      {people.isPending && <p className="text-sm text-muted-foreground">Loading people…</p>}
      {people.data?.length === 0 && <p className="text-sm text-muted-foreground">No people found.</p>}
    </div>
    <BrandedInput aria-label="Chat name (optional)" placeholder="Chat name (optional)" maxLength={120} value={name} disabled={create.isPending}
      onChange={e => { setName(e.target.value); changed(); }} />
    <BrandPillButton tone="brand" className="w-fit max-w-full justify-self-start" disabled={!selected.length || create.isPending} onClick={() => create.mutate()}>
      {create.isPending ? "Starting…" : "Start Chat"}
    </BrandPillButton>
    {(people.error || create.error) && <p role="alert" className="text-sm text-red-500">{(people.error || create.error)?.message}</p>}
  </div>;
}
