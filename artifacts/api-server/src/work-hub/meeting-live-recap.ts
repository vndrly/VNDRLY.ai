import { createHash } from "node:crypto";
import { z } from "zod/v4";

export type RecapSource = { id: string; text: string; speaker: string; time: number };
const itemSchema = z.object({ id: z.string(), text: z.string().max(2000), status: z.enum(["open", "deferred", "confirmed", "resolved", "completed"]), owner: z.string().nullable(), due: z.string().nullable(), sourceId: z.string(), evidence: z.string().min(1), explicitChange: z.boolean() });
export const recapProposalSchema = z.object({ summary: z.string().max(8000), actionItems: z.array(itemSchema).max(80), decisions: z.array(itemSchema).max(80) });
export type RecapItem = z.infer<typeof itemSchema> & { history?: Array<{ text: string; status: string; sourceId: string }> };
export type LiveRecap = { version: number; summary: string; actionItems: RecapItem[]; decisions: RecapItem[]; processed: string[]; updatedAt: string };
export function sourceKey(source: RecapSource) { return createHash("sha256").update(source.id + source.text).digest("hex"); }
export function mergeLiveRecap(previous: LiveRecap | null, proposal: z.infer<typeof recapProposalSchema>, sources: RecapSource[]): LiveRecap {
  const byId = new Map(sources.map(s => [s.id, s]));
  function merge(old: RecapItem[], updates: RecapItem[], kind: string) {
    const result = old.map(item => ({ ...item }));
    for (const update of updates) {
      const source = byId.get(update.sourceId);
      // Only exact evidence from NEW public participant contributions may change state.
      if (!source || !source.text.includes(update.evidence)) continue;
      const index = result.findIndex(item => item.id === update.id);
      if (index >= 0) {
        const current = result[index];
        if (current.status === "confirmed" && (!update.explicitChange || !/\b(change|revise|replace|reverse|rescind|overturn|amend|cancel|instead)\b/i.test(update.evidence))) continue;
        if (current.text === update.text && current.status === update.status && current.owner === update.owner && current.due === update.due) continue;
        result[index] = { ...update, id: current.id, history: [...(current.history ?? []), { text: current.text, status: current.status, sourceId: current.sourceId }] };
      } else {
        if (result.some(item => item.text.toLowerCase() === update.text.toLowerCase())) continue;
        result.push({ ...update, id: `${kind}-${createHash("sha256").update(source.id + update.text).digest("hex").slice(0,16)}` });
      }
    }
    // Omissions never delete open/deferred questions or confirmed decisions.
    return result;
  }
  return { version: (previous?.version ?? 0) + 1, summary: proposal.summary,
    actionItems: merge(previous?.actionItems ?? [], proposal.actionItems, "action"),
    decisions: merge(previous?.decisions ?? [], proposal.decisions, "decision"),
    processed: [...new Set([...(previous?.processed ?? []), ...sources.map(sourceKey)])], updatedAt: new Date().toISOString() };
}
