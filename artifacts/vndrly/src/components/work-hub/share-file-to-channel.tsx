import { useState } from "react";
import BrandPillButton from "@/components/brand-pill-button";
import { BrandedSelect } from "./chrome";
export type FileShareChannel = { id: string; name: string; contextKind?: string; ownerOrgType: string; ownerOrgId: number };
export function ShareFileToChannel({ channels, source, onShare }: {
  channels: FileShareChannel[];
  source: { id: string; orgType: string; orgId: number; data: { channelId: string | null } };
  onShare: (channelId: string) => Promise<unknown>;
}) {
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");
  const choices = channels.filter(c => c.contextKind && c.contextKind !== "chat" && c.id !== source.data.channelId && c.ownerOrgType === source.orgType && c.ownerOrgId === source.orgId);
  return <div className="w-full space-y-2">
    <BrandPillButton tone="brand" onClick={() => { setOpen(!open); setDone(""); }}>Share to channel</BrandPillButton>
    {open && <div className="space-y-2">
      <BrandedSelect aria-label="Share file to channel" value={target} disabled={pending} onChange={e => setTarget(e.target.value)}>
        <option value="">Choose a channel</option>
        {choices.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
      </BrandedSelect>
      {!choices.length && <p className="text-sm text-muted-foreground">No other channels available.</p>}
      <p className="text-xs text-muted-foreground">Channel members will see this file version. The original conversation stays private.</p>
      <BrandPillButton tone="brand" disabled={!target || pending} onClick={async () => {
        setPending(true); setError("");
        try { await onShare(target); setDone(`Shared to ${choices.find(c => c.id === target)?.name ?? "channel"}`); setOpen(false); }
        catch (e) { setError(e instanceof Error ? e.message : "Could not share file"); }
        finally { setPending(false); }
      }}>{pending ? "Sharing…" : "Share file"}</BrandPillButton>
    </div>}
    {error && <p role="alert">{error}</p>}
    {done && <p role="status" className="text-sm">{done}</p>}
  </div>;
}
