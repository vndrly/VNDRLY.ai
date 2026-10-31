import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

export type SubmittedProof = {
  revision: number; submittedAt: string; submittedById: number; ticketId: number;
  jobId: number | null; afe: string | null; digest: string;
  ticket: Record<string, any>; job: Record<string, any> | null;
  lineItems: Record<string, any>[]; notes: Record<string, any>[];
  checkIns: Record<string, any>[]; gps: Record<string, any>[]; gate: Record<string, any> | null;
};
export type ProofHistory = { jobId: number | null; revision: number; approvedRevision: number | null; submissions: SubmittedProof[] };
export function useSubmittedProof(ticketId: number, enabled = true) {
  return useQuery<ProofHistory>({ queryKey: ["ticket-proof-submissions", ticketId], enabled: enabled && ticketId > 0,
    queryFn: async () => {
      const response = await fetch(`/api/tickets/${ticketId}/proof-submissions`, { credentials: "include" });
      if (!response.ok) throw new Error("Unable to load submitted proof. Reload before reviewing.");
      return response.json();
    }, staleTime: 0,
  });
}
export function TicketSubmittedProof({ history, onRevisionChange }: { history?: ProofHistory; onRevisionChange?: (revision: number) => void }) {
  const [selected, setSelected] = useState<number | null>(null);
  if (!history) return null;
  const packet = history.submissions.find(p => p.revision === (selected ?? history.revision));
  if (!packet) return history.jobId ? <p className="text-sm">Job #{history.jobId} · Proof sheet will be saved when this ticket is submitted.</p> : null;
  return <section className="rounded-lg border p-4 space-y-3" data-testid="submitted-proof-sheet">
    <h3 className="font-semibold">Submitted proof sheet · Ticket #{packet.ticketId}</h3>
    <p>Job {packet.jobId ? `#${packet.jobId}` : "—"} · AFE {packet.afe || "Not assigned"}</p>
    <label className="block text-sm">Submission revision <select className="border rounded p-1" value={packet.revision} onChange={e => { setSelected(Number(e.target.value)); onRevisionChange?.(Number(e.target.value)); }}>
      {history.submissions.map(p => <option key={p.revision} value={p.revision}>{p.revision}{p.revision === history.approvedRevision ? " · Approved" : ""}</option>)}
    </select></label>
    <p className="text-sm">Submitted {new Date(packet.submittedAt).toLocaleString()} · Saved evidence for this revision. Only the latest revision ({history.revision}) can be reviewed.</p>
    {packet.job?.scope_snapshot?.scope && <p>{packet.job.scope_snapshot.scope}</p>}
    {packet.ticket.notes && <p className="whitespace-pre-wrap">{packet.ticket.notes}</p>}
    <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr><th className="text-left">Service / charge</th><th>Quantity</th><th>Unit price</th></tr></thead>
      <tbody>{packet.lineItems.map((line, index) => <tr key={line.id ?? index}><td>{line.description}</td><td className="text-center">{line.precise_quantity ?? line.quantity}</td><td className="text-center">{line.precise_unit_price ?? line.unit_price}</td></tr>)}</tbody></table></div>
    {packet.notes.map((note, index) => {
      const photo = typeof note.content === "string" && note.content.startsWith("[photo] ") ? note.content.slice(8).trim() : null;
      const attachments = [...(Array.isArray(note.attachments) ? note.attachments : []), ...(photo ? [photo] : [])]
        .filter((url: unknown): url is string => typeof url === "string" && (/^https?:\/\//i.test(url) || /^\/(?!\/)/.test(url)));
      return <div key={note.id ?? index} className="text-sm whitespace-pre-wrap">{photo ? "Field photo" : note.content}
        {attachments.map((url: string, i: number) => <p key={i}><a className="underline" href={url} target="_blank" rel="noreferrer">Attachment {i + 1}</a></p>)}
      </div>;
    })}
    <p className="text-sm">{packet.checkIns.length} crew sessions · {packet.gps.length} recorded location points{packet.gate ? " · Gate coverage included" : ""}</p>
    <details><summary className="cursor-pointer">View saved work and coverage records</summary>
      <div className="space-y-2 text-sm max-h-96 overflow-auto">
        {packet.checkIns.map((session, index) => <p key={session.id ?? index}>Crew #{session.employee_id} · {session.check_in_at ? new Date(session.check_in_at).toLocaleString() : "—"} to {session.check_out_at ? new Date(session.check_out_at).toLocaleString() : "—"}</p>)}
        {packet.gate?.period?.days?.map((day: any) => <p key={day.day}>{day.day} · {(Number(day.staffedMilliseconds) / 3600000).toFixed(2)} hours covered · USD {(Number(day.chargeCents) / 100).toFixed(2)}{day.hasCoverageGap ? " · Coverage gap acknowledged" : ""}</p>)}
        {packet.gps.map((point, index) => <p key={point.id ?? index}>{point.recorded_at ? new Date(point.recorded_at).toLocaleString() : "Location"} · {point.latitude}, {point.longitude}</p>)}
      </div>
    </details>
    <p className="text-xs break-all text-muted-foreground">Proof reference: {packet.digest}</p>
  </section>;
}
