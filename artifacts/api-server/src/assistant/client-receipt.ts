import { z } from "zod/v4";
export const clientReceiptsSchema = z.object({ receipts: z.array(z.object({ ok: z.boolean(), message: z.string().max(1000) }).strict()).min(1).max(16) }).strict();
/** The browser may report display outcomes only, never approve a business operation. */
export function attachClientReceipts(calls: unknown, receipts: Array<{ ok: boolean; message: string }>, organizationKey: string) {
  if (!Array.isArray(calls)) return null;
  const clientCalls = calls.filter(call => {
    try { return call.organizationKey === organizationKey && JSON.parse(call.output).execution === "client"; } catch { return false; }
  });
  if (clientCalls.length !== receipts.length) return null;
  let index = 0;
  return calls.map(call => clientCalls.includes(call) ? { ...call, clientReceipt: { ...receipts[index++], source: "authenticated_client", authority: "display_only", receivedAt: new Date().toISOString() } } : call);
}
