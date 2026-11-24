export type AssistantClientReceipt = { ok: boolean; message: string };

/** Keep a native action's observed result in the conversation before its next turn. */
export async function postAssistantClientReceipts(
  messageId: number,
  receipts: AssistantClientReceipt[],
  post: (path: string, init: RequestInit) => Promise<Response>,
  timeoutMs = 2_000,
): Promise<boolean> {
  if (!Number.isSafeInteger(messageId) || messageId <= 0 || !receipts.length) return false;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await post(`/api/assistant/messages/${messageId}/client-receipts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ receipts }),
      signal: controller.signal,
    });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}
