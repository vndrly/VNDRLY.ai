import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { MessageSquare } from "lucide-react";
import { Link } from "wouter";
import { commandEnvelope, createWorkHubOperationId, workHubRequest } from "@/lib/work-hub-client";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import BrandPillButton from "@/components/brand-pill-button";
import { useRepository } from "./repository-client";
type MessageAttempt = { body: string; operationId: string; channelId?: string };

export default function TrainingMessageButton({ person }: { person: { userId: number; name: string } }) {
  const repo = useRepository({ enabled: false }), cache = useQueryClient();
  const identity = `${repo.user?.userId}:${repo.user?.activeMembershipId}:${repo.owner?.type}:${repo.owner?.id}`;
  const current = useRef(identity); current.current = identity;
  const [open, setOpen] = useState(false), [body, setBody] = useState(""), [busy, setBusy] = useState(false), [error, setError] = useState(""), [sentChannel, setSentChannel] = useState("");
  const attempt = useRef<MessageAttempt | null>(null);
  useEffect(() => { setOpen(false); setBody(""); setError(""); setSentChannel(""); setBusy(false); attempt.current = null; }, [identity]);
  async function send() {
    if (busy || !repo.owner || !body.trim()) return;
    const context = identity, owner = repo.owner;
    const request: MessageAttempt = attempt.current ?? { body: body.trim(), operationId: createWorkHubOperationId() };
    attempt.current = request; setBusy(true); setError("");
    const headers: Record<string, string> = owner.type === "vendor" ? {
      "X-VNDRLY-Actor-User": String(repo.user?.userId), "X-VNDRLY-Vendor": String(owner.id), "X-VNDRLY-Membership": String(repo.user?.activeMembershipId),
    } : {};
    try {
      if (!request.channelId) {
        const result = await workHubRequest<{ channel?: { id: string } }>("/chats", { method: "POST", headers, body: JSON.stringify({ recipientUserId: person.userId }) });
        if (current.current !== context) return;
        if (!result.channel) throw Error("A direct chat could not be opened in this company.");
        request.channelId = result.channel.id;
      }
      if (current.current !== context) return;
      const result = await workHubRequest<{ operationId: string }>(`/channels/${request.channelId}/messages`, {
        method: "POST", headers, body: JSON.stringify(commandEnvelope(owner, { body: request.body, mentionUserIds: [] }, request.operationId)),
      });
      if (current.current !== context) return;
      if (result.operationId !== request.operationId) throw Error("Message delivery was not confirmed. Retry to verify the original send.");
      setSentChannel(request.channelId); setBody(""); attempt.current = null;
      void cache.invalidateQueries({ queryKey: ["work-hub"] });
    } catch (e) { if (current.current === context) setError(e instanceof Error ? e.message : "Message could not be sent."); }
    finally { if (current.current === context) setBusy(false); }
  }
  return <>
    <button type="button" className="training-admin-message" aria-label={`Message ${person.name} about training`} title="Admin message" onClick={event => { event.preventDefault(); event.stopPropagation(); if (sentChannel) setSentChannel(""); setOpen(true); }}><MessageSquare aria-hidden="true" size={15} /></button>
    <Sheet open={open} onOpenChange={value => { if (!busy) setOpen(value); }}>
      <SheetContent><SheetHeader><SheetTitle>Message {person.name}</SheetTitle><SheetDescription>Send a private training follow-up to your direct chat in Conversations.</SheetDescription></SheetHeader>
        {sentChannel ? <div className="mt-5 space-y-4"><p role="status">Message sent.</p><Link className="underline" href={`/work-hub/chat?channel=${sentChannel}`}>Open chat</Link><BrandPillButton tone="brand" onClick={() => setOpen(false)}>Close</BrandPillButton></div>
          : <form className="mt-5 space-y-4" onSubmit={event => { event.preventDefault(); void send(); }}>
            <label className="block font-semibold" htmlFor={`training-message-${person.userId}`}>Message</label>
            <textarea id={`training-message-${person.userId}`} className="min-h-36 w-full rounded-lg border bg-transparent p-3" maxLength={4000} value={body} disabled={busy || !!attempt.current} placeholder={`Hi ${person.name}, how is your training progressing?`} onChange={event => setBody(event.target.value)} />
            {error && <p role="alert">{error}</p>}
            <BrandPillButton tone="brand" type="submit" disabled={busy || !body.trim()}>{busy ? "Sending…" : error ? "Retry Submit" : "Submit"}</BrandPillButton>
          </form>}
      </SheetContent>
    </Sheet>
  </>;
}
