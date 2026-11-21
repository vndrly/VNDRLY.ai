import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import {
  commandEnvelope,
  createWorkHubOperationId,
  ownerForUser,
  workHubRequest,
} from "@/lib/work-hub-client";
import { ProfileActionButton } from "@/components/gate-profile-chrome";
import { BrandedInput, BrandedSelect } from "./chrome";

export function NewChannel({ onCreated, onCancel }: { onCreated: (id: string) => void; onCancel?: () => void }) {
  const { user } = useAuth();
  const owner = ownerForUser(user);
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [search, setSearch] = useState("");
  const [participantUserIds, setParticipantUserIds] = useState<number[]>([]);
  const people = useQuery<{ id: number; displayName: string }[]>({
    queryKey: ["work-hub", "new-channel-people", user?.userId, user?.activeMembershipId, search],
    queryFn: () => workHubRequest(`/people?search=${encodeURIComponent(search)}`),
  });
  const [visibility, setVisibility] = useState<"organization" | "private">(
    "organization",
  );
  const [operationId, setOperationId] = useState(createWorkHubOperationId);
  const create = useMutation({
    mutationFn: async () => {
      if (!owner) throw Error("Current company required");
      return workHubRequest<{ resource: { id: string } }>("/channels", {
        method: "POST",
        body: JSON.stringify(
          commandEnvelope(owner, { name: name.trim(), visibility, participantUserIds }, operationId),
        ),
      });
    },
    onSuccess: (result) => {
      setName("");
      setParticipantUserIds([]);
      setSearch("");
      setVisibility("organization");
      setOperationId(createWorkHubOperationId());
      void queryClient.invalidateQueries({ queryKey: ["work-hub"] });
      onCreated(result.resource.id);
    },
  });
  const changed = () => {
    setOperationId(createWorkHubOperationId());
    create.reset();
  };
  return (
    <div className="grid gap-3">
      <BrandedInput
        aria-label="New channel name"
        placeholder="Channel name"
        maxLength={120}
        value={name}
        disabled={create.isPending}
        onChange={(event) => {
          setName(event.target.value);
          changed();
        }}
      />
      <BrandedSelect
        aria-label="New channel visibility"
        value={visibility}
        disabled={create.isPending}
        onChange={(event) => {
          setVisibility(event.target.value as "organization" | "private");
          changed();
        }}
      >
        <option value="organization">Everyone in the company</option>
        <option value="private">Private channel</option>
      </BrandedSelect>
      <BrandedInput aria-label="Find channel participants" placeholder="Search people by name or email" value={search} onChange={event => setSearch(event.target.value)} />
      <div className="grid h-48 content-start gap-x-4 gap-y-1 overflow-y-auto rounded-xl border-2 border-[var(--brand-primary)] bg-[#242426] p-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, max(250px, 40%)), 1fr))" }} aria-label="Choose channel participants">
        {people.data?.filter(person => person.id !== user?.userId).map(person => (
          <label key={person.id} className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={participantUserIds.includes(person.id)} disabled={create.isPending} onChange={() => {
              setParticipantUserIds(current => current.includes(person.id) ? current.filter(id => id !== person.id) : [...current, person.id]);
              changed();
            }} />
            <span>{person.displayName}</span>
          </label>
        ))}
        {people.isPending && <p>Loading people…</p>}
        {people.error && <p role="alert">{people.error.message}</p>}
      </div>
      <div className="flex items-center justify-between gap-3">
      <ProfileActionButton
        color="brand"
        className="w-fit max-w-full justify-self-start"
        disabled={!name.trim() || !owner || create.isPending}
        onClick={() => create.mutate()}
      >
        {create.isPending ? "Creating…" : "Create Channel"}
      </ProfileActionButton>
      {onCancel && <ProfileActionButton onClick={onCancel}>Cancel</ProfileActionButton>}
      </div>
      {create.error && (
        <p role="alert" className="text-sm text-red-500">
          {create.error.message}
        </p>
      )}
    </div>
  );
}
