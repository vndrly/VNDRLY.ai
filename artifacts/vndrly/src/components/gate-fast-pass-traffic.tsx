import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FastPassIdentitySchema, type FastPassTripInput, type FastPassTripState } from "@workspace/api-zod";
import { useAuth } from "@/hooks/use-auth";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { GateTrafficRecord } from "./gate-traffic-record";

type Identity = FastPassTripInput["identity"];
type GateTrip = {
  id: string;
  fastPass: FastPassTripState;
  presenceState: "en_route" | "on_site" | "off_site";
  latitude: number | null;
  longitude: number | null;
};
const labels: Partial<Record<keyof Identity, string>> = {
  firstName: "First name", lastName: "Last name", company: "Company", vehiclePlate: "Tag", plateState: "Issuing state",
};

async function gateFastPassRequest<T>(path: string, signal?: AbortSignal, details?: unknown): Promise<T> {
  const base = import.meta.env.BASE_URL.replace(/\/$/, "");
  const response = await fetch(base + "/api/implementation-a/fast-pass/gate" + path, {
    credentials: "include", signal,
    ...(details === undefined ? {} : {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(details),
    }),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message = response.status === 409 ? "This arrival changed. Refresh and review the current details."
      : "Fast Pass couldn't be updated at this gate.";
    throw new Error(message);
  }
  return payload as T;
}

export function useGateFastPassTraffic(siteId?: number) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["gate-fast-pass", user?.userId, user?.activeMembershipId, user?.vendorId, user?.partnerId, siteId],
    queryFn: ({ signal }) => gateFastPassRequest<{ trips: GateTrip[] }>("?siteId=" + siteId, signal),
    enabled: !!user?.userId && !!siteId,
    refetchInterval: 15_000,
    retry: false,
  });
}

export function GateFastPassTraffic({ siteId, gateId, view, writable }: {
  siteId: number; gateId: string; view: "arrivals" | "departures"; writable: boolean;
}) {
  const query = useGateFastPassTraffic(siteId);
  const cache = useQueryClient();
  const [draft, setDraft] = useState<{ tripId: string; identity: Identity } | null>(null);
  const mutation = useMutation({
    mutationFn: ({ tripId, identity }: { tripId: string; identity?: Identity }) =>
      gateFastPassRequest<FastPassTripState>("/" + tripId, undefined, { siteId, gateId, ...(identity && { identity }) }),
    onSuccess: () => setDraft(null),
    onSettled: () => cache.invalidateQueries({ queryKey: ["gate-fast-pass"] }),
  });
  const rows = (query.data?.trips ?? []).filter(row => view === "arrivals"
    ? row.presenceState === "en_route"
    : row.presenceState === "on_site" && !!row.fastPass.checkoutRequestedAt);
  if (!rows.length && !draft) return null;
  return <div className="space-y-2" aria-label="Fast Pass">
    {mutation.isError && !draft && <p role="alert" className="text-sm text-destructive">{mutation.error.message}</p>}
    {rows.map(({ id, fastPass }) => {
      const { identity, clearance, destinationName } = fastPass;
      const arrival = view === "arrivals";
      const status = arrival ? clearance ? "Cleared · " + clearance.gateName
        : fastPass.arrivalEtaMinutes == null ? "En route" : fastPass.arrivalEtaMinutes + " min away"
        : "Checkout requested";
      return <GateTrafficRecord key={id}
        testId={"gate-fast-pass-" + id}
        onOpen={() => { if (arrival && writable) { mutation.reset(); setDraft({ tripId: id, identity }); } }}
        name={identity.firstName + " " + identity.lastName}
        description={[identity.company, identity.vehiclePlate + " · " + identity.plateState, destinationName].join(" · ")}
        status={status} className={clearance && arrival ? "gate-traffic-approved" : "gate-traffic-pending"}
        footer={identity.notes && <span>{identity.notes}</span>}
        action={arrival && <>
          {clearance?.gateId !== gateId && <button type="button" className="gate-history-filter"
            disabled={!writable || mutation.isPending} onClick={() => mutation.mutate({ tripId: id })}>Pre-clear</button>}
          <button type="button" className="gate-history-filter" disabled={!writable || mutation.isPending}
            onClick={() => { mutation.reset(); setDraft({ tripId: id, identity }); }}>Edit</button>
        </>} />;
    })}
    <Dialog open={draft !== null} onOpenChange={open => { if (!open && !mutation.isPending) { setDraft(null); mutation.reset(); } }}>
      <DialogContent>
        <DialogTitle>Edit Fast Pass arrival</DialogTitle>
        <DialogDescription>Correct the details the driver sent to the gate.</DialogDescription>
        {draft && <form className="grid gap-3" onSubmit={event => {
          event.preventDefault();
          const result = FastPassIdentitySchema.safeParse(draft.identity);
          if (result.success && !mutation.isPending) mutation.mutate({ tripId: draft.tripId, identity: result.data });
        }}>
          {(Object.keys(labels) as (keyof Identity)[]).map(key => <label key={key} className="grid gap-1 text-sm">
            {labels[key]}
            <input className="rounded-md border bg-background px-3 py-2" required disabled={mutation.isPending}
              value={draft.identity[key] ?? ""} onChange={event => {
                const value = event.target.value;
                setDraft(current => current && { ...current, identity: { ...current.identity, [key]: value } });
              }} />
          </label>)}
          {mutation.isError && <p role="alert" className="text-sm text-destructive">{mutation.error.message}</p>}
          <button type="submit" className="gate-history-filter justify-self-end"
            disabled={mutation.isPending || !writable || !FastPassIdentitySchema.safeParse(draft.identity).success}>Save</button>
        </form>}
      </DialogContent>
    </Dialog>
  </div>;
}
