import { useState } from "react";
import { Download } from "lucide-react";
import { workHubRequest } from "@/lib/work-hub-client";
type Transcript = { title: string; messages: Array<{ id: string; createdAt: string; authorName: string | null; body: string; parentMessageId?: string | null }> };
export function formatTranscript(data: Transcript) {
  return `${data.title}\r\n${data.messages.length} messages · Times in UTC\r\n\r\n` + data.messages.map(message =>
    `[${new Date(message.createdAt).toISOString()}] ${message.authorName || "Unknown sender"}${message.parentMessageId ? ` (reply to ${message.parentMessageId})` : ""}\r\n${message.body}`,
  ).join("\r\n\r\n");
}
export function ConversationTranscript({ channelId }: { channelId: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const download = async () => {
    setBusy(true); setError("");
    try {
      const data = await workHubRequest<Transcript>(`/channels/${channelId}/transcript`);
      const url = URL.createObjectURL(new Blob([formatTranscript(data)], { type: "text/plain;charset=utf-8" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = `${data.title.replace(/[<>:"/\\|?*\x00-\x1f]/g, "-").slice(0,100) || "conversation"}-transcript.txt`;
      document.body.appendChild(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch { setError("Transcript could not download. Try again."); }
    finally { setBusy(false); }
  };
  return <div className="relative">
    <button type="button" className="hub-conversation-tool" title="Download transcript (.txt)" aria-label="Download transcript (.txt)" disabled={busy} aria-busy={busy} onClick={download}><Download className="h-4 w-4" aria-hidden="true" /></button>
    {error && <p role="alert" className="absolute right-0 z-10 w-52 rounded-lg bg-[#242426] p-2 text-sm text-red-300">{error}</p>}
  </div>;
}
