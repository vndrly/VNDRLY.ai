import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, List, ListChecks, Plus, Undo2, Redo2 } from "lucide-react";
import BrandPillButton from "@/components/brand-pill-button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { commandEnvelope, createWorkHubOperationId, workHubRequest, type WorkHubOwner } from "@/lib/work-hub-client";
import { withRequestDeadline } from "@/lib/request-deadline";
import { BrandedSelect } from "./chrome";
import { noteMessageBody } from "./note-message";

type Draft = { title: string; body: string };
type NoteFile = { id: string; canManage: boolean; data: { name: string; channelId: string; state: string; byteSize?: number } };
type LegacyNote = { id: string; title: string; body: string };
type Reservation = { documentId: string; fileId: string; uploadURL: string };
type SaveAttempt = { draft: Draft; reserveId: string; finalizeId: string; messageId: string; finalized?: boolean; resource?: Reservation };
export const noteFilename = (title: string) => `${title.trim().replace(/\.txt$/i, "").replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").slice(0, 180) || "Note"}.txt`;

export function NoteEditor({ channelId, owner, legacyNotes = [] }: { channelId: string; owner: WorkHubOwner; legacyNotes?: LegacyNote[] }) {
  const cache = useQueryClient();
  const [draft, setDraft] = useState<Draft>({ title: "", body: "" });
  const [baseline, setBaseline] = useState<Draft>(draft);
  const [document, setDocument] = useState<NoteFile | null>(null);
  const [selection, setSelection] = useState("");
  const [undo, setUndo] = useState<Draft[]>([]);
  const [redo, setRedo] = useState<Draft[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const textarea = useRef<HTMLTextAreaElement>(null);
  // Retry the same upload and message operations after an uncertain network result.
  const pending = useRef<SaveAttempt | null>(null);
  const [retry, setRetry] = useState(false);
  const files = useQuery({ queryKey: ["work-hub-file-library", "notes", owner.type, owner.id, channelId],
    queryFn: () => workHubRequest<NoteFile[]>(`/file-library?orgType=${owner.type}&orgId=${owner.id}`) });
  const rows = (files.data ?? []).filter(f => f.data.channelId === channelId && f.data.state === "active" && /\.txt$/i.test(f.data.name));
  const dirty = draft.title !== baseline.title || draft.body !== baseline.body;
  const locked = busy || retry;
  const editable = !document || document.canManage;
  function edit(next: Draft) { setUndo(h => [...h.slice(-99), draft]); setRedo([]); setDraft(next); setSaved(false); }
  function reset(next: Draft, file: NoteFile | null, key: string) {
    setDraft(next); setBaseline(next); setDocument(file); setSelection(key); setUndo([]); setRedo([]); setSaved(false); setError("");
  }
  async function open(key: string) {
    if (dirty && !window.confirm("Discard your unsaved note changes?")) return;
    if (!key) { reset({ title: "", body: "" }, null, ""); return; }
    const legacy = legacyNotes.find(n => `note:${n.id}` === key);
    if (legacy) { reset({ title: legacy.title, body: legacy.body }, null, key); return; }
    const file = rows.find(f => f.id === key);
    if (!file) return;
    setBusy(true); setError("");
    try {
      if ((file.data.byteSize ?? 0) > 1024 * 1024) throw new Error("This file is too large for the note editor (1 MB maximum).");
      const body = await withRequestDeadline(async signal => {
        const response = await fetch(`/api/work-hub/file-library/${file.id}/download`, { credentials: "include", signal });
        if (!response.ok) throw new Error("The note could not be opened.");
        const text = await response.text();
        if (text.length > 1024 * 1024) throw new Error("This file is too large for the note editor.");
        return text;
      }, { timeoutMs: 30_000, timeoutMessage: "Opening the note timed out. Try again." });
      reset({ title: file.data.name.replace(/\.txt$/i, ""), body }, file, key);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  function prefixLines(prefix: string) {
    const el = textarea.current;
    if (!el) return;
    const start = draft.body.lastIndexOf("\n", el.selectionStart - 1) + 1;
    const endOfLine = draft.body.indexOf("\n", el.selectionEnd);
    const end = endOfLine < 0 ? draft.body.length : endOfLine;
    edit({ ...draft, body: draft.body.slice(0, start) + draft.body.slice(start, end).split("\n").map(line => prefix + line).join("\n") + draft.body.slice(end) });
    el.focus();
  }
  async function save() {
    setBusy(true); setError("");
    try {
      const attempt: SaveAttempt = pending.current ?? { draft: { ...draft }, reserveId: createWorkHubOperationId(), finalizeId: createWorkHubOperationId(), messageId: createWorkHubOperationId(), finalized: false };
      const file = new File([attempt.draft.body], noteFilename(attempt.draft.title), { type: "text/plain" });
      if (file.size > 1024 * 1024) throw new Error("Notes must be no larger than 1 MB.");
      pending.current = attempt;
      if (!attempt.resource) {
        const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
        const checksumSha256 = [...new Uint8Array(digest)].map(n => n.toString(16).padStart(2, "0")).join("");
        const result = await workHubRequest<{ resource: Reservation }>("/file-library/reserve", { method: "POST", body: JSON.stringify(commandEnvelope(owner, {
          ...(document ? { documentId: document.id } : {}), scope: "channel", channelId,
          fileName: file.name, byteSize: file.size, contentType: file.type, checksumSha256,
        }, attempt.reserveId)) });
        attempt.resource = result.resource;
      }
      const resource = attempt.resource;
      if (!attempt.finalized) {
      const response = await withRequestDeadline(signal => fetch(resource.uploadURL, { method: "PUT", headers: { "Content-Type": file.type }, body: file, signal }), { timeoutMs: 120_000, timeoutMessage: "Saving was not confirmed. Retry to finish saving the same file." });
      if (!response.ok) throw new Error("The note upload failed. Retry saving.");
      await workHubRequest("/file-library/finalize", { method: "POST", body: JSON.stringify(commandEnvelope(owner, { id: resource.documentId, fileId: resource.fileId }, attempt.finalizeId)) });
      attempt.finalized = true;
      }
      await workHubRequest(`/channels/${channelId}/messages`, { method: "POST", body: JSON.stringify(commandEnvelope(owner, {
        body: noteMessageBody(file.name, resource.documentId), mentionUserIds: [],
      }, attempt.messageId)) });
      setDocument({ id: resource.documentId, canManage: true, data: { name: file.name, channelId, state: "active" } });
      setSelection(resource.documentId); setBaseline(attempt.draft); setSaved(true); setRetry(false); pending.current = null;
      await cache.invalidateQueries({ queryKey: ["work-hub-file-library"] });
      await cache.invalidateQueries({ queryKey: ["work-hub"] });
    } catch (e) { setError(`${pending.current?.finalized ? "File saved; the conversation link was not confirmed. Retry to finish. " : ""}${(e as Error).message}`); setRetry(!!pending.current); } finally { setBusy(false); }
  }
  function download() {
    const url = URL.createObjectURL(new Blob([draft.body], { type: "text/plain;charset=utf-8" }));
    const a = window.document.createElement("a"); a.href = url; a.download = noteFilename(draft.title); a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <section aria-label="Note editor" className="flex min-h-[24rem] flex-col gap-3">
    <div className="flex items-center gap-2">
      <BrandedSelect aria-label="Open saved note" className="min-w-0 flex-1" value={selection} disabled={locked} onChange={e => void open(e.target.value)}>
        <option value="">New note</option>
        {rows.map(f => <option key={f.id} value={f.id}>{f.data.name}</option>)}
        {document && !rows.some(f => f.id === document.id) && <option value={document.id}>{document.data.name}</option>}
        {legacyNotes.map(n => <option key={n.id} value={`note:${n.id}`}>{n.title} (existing note)</option>)}
      </BrandedSelect>
      <button className="hub-conversation-tool" title="New note" aria-label="New note" disabled={locked} onClick={() => void open("")}><Plus size={18} /></button>
    </div>
    <Input aria-label="Note title" placeholder="Note title" value={draft.title} disabled={locked || !editable} maxLength={180} onChange={e => edit({ ...draft, title: e.target.value })} />
    <div className="flex items-center gap-1" role="toolbar" aria-label="Note tools">
      <button className="hub-conversation-tool" title="Undo" aria-label="Undo" disabled={locked || !undo.length} onClick={() => { setRedo(h => [...h, draft]); setDraft(undo[undo.length - 1]); setUndo(h => h.slice(0, -1)); }}><Undo2 size={18} /></button>
      <button className="hub-conversation-tool" title="Redo" aria-label="Redo" disabled={locked || !redo.length} onClick={() => { setUndo(h => [...h, draft]); setDraft(redo[redo.length - 1]); setRedo(h => h.slice(0, -1)); }}><Redo2 size={18} /></button>
      <button className="hub-conversation-tool" title="Bullets" aria-label="Bullets" disabled={locked || !editable} onClick={() => prefixLines("• ")}><List size={18} /></button>
      <button className="hub-conversation-tool" title="Checklist" aria-label="Checklist" disabled={locked || !editable} onClick={() => prefixLines("[ ] ")}><ListChecks size={18} /></button>
      <button className="hub-conversation-tool ml-auto" title="Download note (.txt)" aria-label="Download note (.txt)" disabled={!draft.body} onClick={download}><Download size={18} /></button>
    </div>
    <Textarea ref={textarea} aria-label="Note body" placeholder="Write a note…" className="!min-h-[18rem] flex-1 !resize-y" value={draft.body} disabled={locked || !editable} onChange={e => edit({ ...draft, body: e.target.value })} />
    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
      <span>{draft.body.trim() ? draft.body.trim().split(/\s+/).length : 0} words · {dirty ? "Unsaved changes" : saved ? "Saved to conversation & Files" : document ? "Saved note" : "Plain text (.txt)"}</span>
      <BrandPillButton tone="brand" disabled={busy || !editable || !draft.title.trim() || !draft.body.trim() || (saved && !dirty)} onClick={() => void save()}>{busy ? "Saving…" : retry ? "Retry save" : "Save note"}</BrandPillButton>
    </div>
    {!editable && <p className="text-xs text-muted-foreground">Only the file owner or an administrator can edit this note.</p>}
    {(error || files.error) && <p role="alert" className="text-sm text-red-400">{error || "Saved notes could not load. Try again shortly."}</p>}
  </section>;
}
