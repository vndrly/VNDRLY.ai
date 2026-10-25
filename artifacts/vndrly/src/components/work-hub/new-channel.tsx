import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import {
  commandEnvelope,
  createWorkHubOperationId,
  ownerForUser,
  workHubRequest,
} from "@/lib/work-hub-client";
import BrandPillButton from "@/components/brand-pill-button";
import { BrandedInput, BrandedSelect } from "./chrome";

export function NewChannel({ onCreated }: { onCreated: (id: string) => void }) {
  const { user } = useAuth();
  const owner = ownerForUser(user);
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
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
          commandEnvelope(owner, { name: name.trim(), visibility }, operationId),
        ),
      });
    },
    onSuccess: (result) => {
      setName("");
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
      <BrandPillButton
        tone="brand"
        className="w-fit max-w-full justify-self-start"
        disabled={!name.trim() || !owner || create.isPending}
        onClick={() => create.mutate()}
      >
        {create.isPending ? "Creating…" : "Create Channel"}
      </BrandPillButton>
      {create.error && (
        <p role="alert" className="text-sm text-red-500">
          {create.error.message}
        </p>
      )}
    </div>
  );
}
