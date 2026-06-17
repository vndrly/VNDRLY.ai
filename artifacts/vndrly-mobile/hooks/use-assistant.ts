import { useCallback, useEffect, useRef, useState } from "react";

import { getApiBase } from "@/lib/api";
import { getToken, setToken, setUser } from "@/lib/auth";
import {
  readAssistantErrorMessage,
  readAssistantStreamResponse,
} from "@/lib/assistant-sse";

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

const SESSION_DEAD_CODES = new Set([
  "auth.unauthenticated",
  "auth.not_authenticated",
  "auth.session_invalid",
  "auth.session_expired",
  "auth.session_invalidated",
  "auth.token_invalid",
]);

async function clearAuthIfSessionDead(res: Response, data: { code?: string } | null): Promise<void> {
  if (res.status !== 401 || !data?.code || !SESSION_DEAD_CODES.has(data.code)) return;
  try {
    await setToken(null);
    await setUser(null);
  } catch {
    // best effort
  }
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
  const streamingRef = useRef(false);
  const conversationIdRef = useRef<number | null>(null);

  useEffect(() => {
    conversationIdRef.current = conversationId;
  }, [conversationId]);

  const startNew = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    restoreVersionRef.current += 1;
    hasRestoredRef.current = true;
    conversationIdRef.current = null;
    setConversationId(null);
    setMessages([]);
    setStreaming(false);
    streamingRef.current = false;
    setActiveTool(null);
    setError(null);
  }, []);

  const loadLatest = useCallback(async () => {
    if (hasRestoredRef.current || streamingRef.current) return;
    const myVersion = restoreVersionRef.current;
    try {
      const listRes = await assistantFetch("/api/assistant/conversations");
      if (!listRes.ok || myVersion !== restoreVersionRef.current || streamingRef.current) {
        return;
      }
      const list = (await listRes.json()) as { conversations?: ConversationSummary[] };
      const latest = list.conversations?.[0];
      if (!latest) {
        hasRestoredRef.current = true;
        return;
      }
      const detailRes = await assistantFetch(`/api/assistant/conversations/${latest.id}`);
      if (!detailRes.ok || myVersion !== restoreVersionRef.current || streamingRef.current) {
        return;
      }
      const detail = (await detailRes.json()) as {
        id: number;
        messages: Array<{ id: number; role: "user" | "assistant"; content: string }>;
      };
      if (myVersion !== restoreVersionRef.current || streamingRef.current) return;

      const restored: AssistantMessage[] = detail.messages
        .filter((m) => m.role === "user" || m.content.trim().length > 0)
        .map((m) => ({
          id: `db-${m.id}`,
          role: m.role,
          content: m.content,
        }));
      conversationIdRef.current = detail.id;
      setConversationId(detail.id);
      setMessages(restored);
      hasRestoredRef.current = true;
    } catch {
      hasRestoredRef.current = true;
    }
  }, []);

  const clear = useCallback(async () => {
    const id = conversationIdRef.current;
    startNew();
    if (id !== null) {
      try {
        await assistantFetch(`/api/assistant/conversations/${id}`, { method: "DELETE" });
      } catch {
        // best-effort
      }
    }
  }, [startNew]);

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || streamingRef.current) return;

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
      streamingRef.current = true;

      const ac = new AbortController();
      abortRef.current = ac;

      try {
        const postChat = (convId: number | null) =>
          assistantFetch("/api/assistant/chat", {
            method: "POST",
            headers: { accept: "text/event-stream" },
            body: JSON.stringify({
              message: trimmed,
              ...(convId !== null ? { conversationId: convId } : {}),
              pageContext: { path: "/mobile/askv" },
            }),
            signal: ac.signal,
          });

        let res = await postChat(conversationIdRef.current);
        if (res.status === 404 && conversationIdRef.current !== null) {
          conversationIdRef.current = null;
          setConversationId(null);
          res = await postChat(null);
        }

        const newConvHeader = res.headers.get("X-Conversation-Id");
        if (newConvHeader) {
          const parsedId = Number(newConvHeader);
          if (Number.isFinite(parsedId)) {
            conversationIdRef.current = parsedId;
            setConversationId(parsedId);
          }
        }

        if (!res.ok) {
          let errData: { code?: string; message?: string; error?: string } | null = null;
          try {
            errData = (await res.clone().json()) as typeof errData;
          } catch {
            // ignore
          }
          await clearAuthIfSessionDead(res, errData);
          throw new Error(await readAssistantErrorMessage(res));
        }

        let sawDone = false;
        let sawError = false;
        let accumulatedContent = "";

        const streamResult = await readAssistantStreamResponse(res, ac.signal, (evt) => {
          if (evt.type === "token") {
            accumulatedContent += evt.delta;
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
            sawDone = true;
            accumulatedContent = evt.content || accumulatedContent;
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId
                  ? { ...m, content: evt.content || m.content, pending: false }
                  : m,
              ),
            );
            setActiveTool(null);
          } else if (evt.type === "error") {
            sawError = true;
            setError(evt.message);
            setMessages((prev) =>
              prev.map((m) => (m.id === assistantId ? { ...m, pending: false } : m)),
            );
            setActiveTool(null);
          }
        });

        if (!sawDone && !sawError && !streamResult.receivedDone && !streamResult.receivedError) {
          setMessages((prev) =>
            prev.map((m) => {
              if (m.id !== assistantId) return m;
              if (accumulatedContent.trim().length > 0) {
                return { ...m, pending: false };
              }
              return m;
            }),
          );
          if (accumulatedContent.trim().length === 0) {
            setError("askv.errorGeneric");
          }
        }
      } catch (err) {
        if ((err as Error).name === "AbortError") return;
        const message = err instanceof Error ? err.message : "";
        setError(message && !message.startsWith("HTTP ") ? message : "askv.errorGeneric");
        setMessages((prev) =>
          prev.map((m) => (m.id === assistantId ? { ...m, pending: false } : m)),
        );
      } finally {
        setStreaming(false);
        streamingRef.current = false;
        setActiveTool(null);
        abortRef.current = null;
      }
    },
    [],
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
