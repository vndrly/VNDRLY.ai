import { useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { workHubRequest } from "@/lib/work-hub-client";
import { BrandedInput } from "./chrome";

export function ConversationTitle({ channel, canRename }: { channel: { id: string; name: string; version?: number }; canRename: boolean }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(channel.name);
  const cancelled = useRef(false);
  const submitting = useRef(false);
  const qc = useQueryClient();
  const save = useMutation({
    mutationFn: () => workHubRequest(`/channels/${channel.id}`, { method: "PATCH", body: JSON.stringify({ name: value.trim(), expectedName: channel.name }) }),
    onSuccess: () => { setEditing(false); qc.invalidateQueries({ queryKey: ["work-hub"] }); },
    onSettled: () => { submitting.current = false; },
  });
  const finish = () => {
    if (cancelled.current || submitting.current) return;
    if (!value.trim() || value.trim() === channel.name) { setEditing(false); return; }
    submitting.current = true; save.mutate();
  };
  return <div className="min-w-0 flex-1">
    {editing ? <div className="flex items-center gap-2">
      <BrandedInput autoFocus aria-label="Conversation title" value={value} maxLength={120} disabled={save.isPending}
        onChange={e => setValue(e.target.value)} onBlur={finish} onKeyDown={e => {
          if (e.key === "Enter") { e.preventDefault(); finish(); }
          if (e.key === "Escape") { cancelled.current = true; setEditing(false); }
        }} />
      <button type="button" className="text-sm" disabled={save.isPending} onMouseDown={e => e.preventDefault()} onClick={finish}>Save</button>
    </div> : <h2 className="text-xl font-semibold break-words">{canRename ? <button type="button" className="text-left" title="Rename conversation" onClick={() => { cancelled.current = false; setValue(channel.name); save.reset(); setEditing(true); }}>{channel.name}</button> : channel.name}</h2>}
    {save.error && <p role="alert" className="text-sm text-red-400">{save.error.message}</p>}
  </div>;
}
