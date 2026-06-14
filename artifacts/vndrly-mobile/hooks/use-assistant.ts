import { useCallback, useEffect, useRef, useState } from "react";

import { getApiBase } from "@/lib/api";
import { getToken } from "@/lib/auth";
import { consumeAssistantSse } from "@/lib/assistant-sse";

export interface AssistantMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  pending?: boolean;
}

export interface ConversationSummary {
  id: number;
  title: string;
  updatedAt: string;
}

async function assistantFetch(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const token = await getToken();
  const headers = new Headers(init.headers as HeadersInit | undefined);
  if (!headers.has("content-type") && init.body) {
    headers.set("content-type", "application/json");
  }
  if (token) headers.set("authorization", `Bearer ${token}`);
  return fetch(`${getApiBase()}${path}`, { ...init, headers });
}

export function useAssistant() {
  const [conversationId, setConversationId] = useState<number | null>(null);
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [activeTool, setActiveTool] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const hasRestoredRef = useRef(false);
  const restoreVersionRef = useRef(0);
  const messagesRef = useRef(messages);
  messagesRef.current = messages;

  const ensureConversation = useCallback(async (): Promise<number> => {
    if (conversationId !== null) return conversationId;
    const res = await assistantFetch("/api/assistant/conversations", {
      method: "POST",
      body: JSON.stringify({}),
    });
    if (!res.ok) throw new Error("Failed to start conversation");
    const data = (await res.json()) as { id: number };
    setConversationId(data.id);
    return data.id;
  }, [conversationId]);

  const startNew = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    restoreVersionRef.current += 1;
    hasRestoredRef.current = true;
    setConversationId(null);
    setMessages([]);
    setStreaming(false);
    setActiveTool(null);
    setError(null);
  }, []);

  const loadLatest = useCallback(async () => {
    if (hasRestoredRef.current) return;
    hasRestoredRef.current = true;
    const myVersion = restoreVersionRef.current;
    try {
      const listRes = await assistantFetch("/api/assistant/conversations");
      if (!listRes.ok || myVersion !== restoreVersionRef.current) return;
      const list = (await listRes.json()) as { conversations?: ConversationSummary[] };
      const latest = list.conversations?.[0];
      if (!latest) return;
      const detailRes = await assistantFetch(`/api/assistant/conversations/${latest.id}`);
      if (!detailRes.ok || myVersion !== restoreVersionRef.current) return;
      const detail = (await detailRes.json()) as {
        id: number;
        messages: Array<{ id: number; role: "user" | "assistant"; content: string }>;
      };
      if (myVersion !== restoreVersionRef.current) return;
      const restored: AssistantMessage[] = detail.messages
        .filter((m) => m.role === "user" || m.content.trim().length > 0)
        .map((m) => ({
          id: `db-${m.id}`,
          role: m.role,
          content: m.content,
        }));
      setConversationId(detail.id);
      setMessages(restored);
    } catch {
      // best-effort
    }
  }, []);

  const clear = useCallback(async () => {
    const id = conversationId;
    startNew();
    if (id !== null) {
      try {
        await assistantFetch(`/api/assistant/conversations/${id}`, { method: "DELETE" });
      } catch {
        // best-effort
      }
    }
  }, [conversationId, startNew]);

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || streaming) return;

      restoreVersionRef.current += 1;
      hasRestoredRef.current = true;
      setError(null);

      const userId = `user-${Date.now()}`;
      const assistantId = `asst-${Date.now()}`;
      setMessages((prev) => [
        ...prev,
        { id: userId, role: "user", content: trimmed },
        { id: assistantId, role: "assistant", content: "", pending: true },
      ]);
      setStreaming(true);

      const ac = new AbortController();
      abortRef.current = ac;

      try {
        const convId = await ensureConversation();
        const priorHistory = messagesRef.current
          .filter((m) => !m.pending && m.content.trim().length > 0)
          .map((m) => ({ role: m.role, content: m.content }));

        const res = await assistantFetch(`/api/assistant/conversations/${convId}/messages`, {
          method: "POST",
          headers: { accept: "text/event-stream" },
          body: JSON.stringify({
            message: trimmed,
            pageContext: { path: "/mobile/askv" },
          }),
          signal: ac.signal,
        });
        if (!res.ok || !res.body) {
          throw new Error(`HTTP ${res.status}`);
        }

        await consumeAssistantSse(res.body, ac.signal, (evt) => {
          if (evt.type === "token") {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId
                  ? { ...m, content: m.content + evt.delta, pending: true }
                  : m,
              ),
            );
          } else if (evt.type === "tool") {
            setActiveTool(evt.status === "start" ? evt.name : null);
          } else if (evt.type === "done") {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId
                  ? { ...m, content: evt.content || m.content, pending: false }
                  : m,
              ),
            );
            setActiveTool(null);
          } else if (evt.type === "error") {
            setError(evt.message);
            setMessages((prev) =>
              prev.map((m) => (m.id === assistantId ? { ...m, pending: false } : m)),
            );
            setActiveTool(null);
          }
        });
      } catch (err) {
        if ((err as Error).name === "AbortError") return;
        setError("askv.errorGeneric");
        setMessages((prev) =>
          prev.map((m) => (m.id === assistantId ? { ...m, pending: false } : m)),
        );
      } finally {
        setStreaming(false);
        setActiveTool(null);
        abortRef.current = null;
      }
    },
    [ensureConversation, streaming],
  );

  useEffect(() => () => abortRef.current?.abort(), []);

  return {
    conversationId,
    messages,
    streaming,
    activeTool,
    error,
    send,
    clear,
    startNew,
    loadLatest,
  };
}
