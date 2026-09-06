import { useCallback, useEffect, useRef, useState } from "react";

import { getApiBase } from "@/lib/api";
import { getToken, setToken, setUser } from "@/lib/auth";
import type { AskVClientIntent, AskVClientResult } from "@/lib/askv-client-tools";
import {
  readAssistantErrorMessage,
  readAssistantStreamResponse,
} from "@/lib/assistant-sse";
import * as Location from "expo-location";
import {
  readAskVCurrentLocationForMessage,
} from "@/lib/assistant-location-context";

export type AssistantFeedbackRating = "helpful" | "unhelpful";

export interface AssistantMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  pending?: boolean;
  serverId?: number;
  feedbackRating?: AssistantFeedbackRating | null;
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

export interface UseAssistantOptions {
  /** Called when a streamed assistant reply finishes (for TTS). */
  onAssistantReply?: (text: string) => void;
  onClientIntent?: (intent: AskVClientIntent) => Promise<AskVClientResult>;
  onMutation?: () => void;
}

export function useAssistant(opts: UseAssistantOptions = {}) {
  const onAssistantReplyRef = useRef(opts.onAssistantReply);
  onAssistantReplyRef.current = opts.onAssistantReply;
  const onClientIntentRef = useRef(opts.onClientIntent);
  onClientIntentRef.current = opts.onClientIntent;
  const onMutationRef = useRef(opts.onMutation); onMutationRef.current = opts.onMutation;
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

  const restoreConversation = useCallback((id: number, restored: AssistantMessage[]) => {
    restoreVersionRef.current += 1;
    hasRestoredRef.current = true;
    conversationIdRef.current = id;
    setConversationId(id);
    setMessages(restored);
  }, []);

  const upsertMessage = useCallback((message: AssistantMessage) => {
    hasRestoredRef.current = true;
    setMessages(previous => {
      const index = previous.findIndex(item => item.id === message.id);
      if (index < 0) return [...previous, message];
      return previous.map((item, i) => i === index ? { ...item, ...message } : item);
    });
  }, []);

  const getConversationId = useCallback(() => conversationIdRef.current, []);

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
        messages: Array<{
          id: number;
          role: "user" | "assistant";
          content: string;
          feedbackRating?: AssistantFeedbackRating | null;
        }>;
      };
      if (myVersion !== restoreVersionRef.current || streamingRef.current) return;

      const restored: AssistantMessage[] = detail.messages
        .filter((m) => m.role === "user" || m.content.trim().length > 0)
        .map((m) => ({
          id: `db-${m.id}`,
          serverId: m.id,
          role: m.role,
          content: m.content,
          feedbackRating: m.feedbackRating ?? null,
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
      const sendVersion = restoreVersionRef.current;
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
          readAskVCurrentLocationForMessage(
            trimmed,
            Location,
            Location.Accuracy.Balanced,
          ).then((currentLocation) =>
            assistantFetch("/api/assistant/chat", {
              method: "POST",
              headers: { accept: "text/event-stream" },
              body: JSON.stringify({
                message: trimmed,
                ...(convId !== null ? { conversationId: convId } : {}),
                pageContext: {
                  path: "/mobile/askv",
                  ...(currentLocation ? { currentLocation } : {}),
                },
              }),
              signal: ac.signal,
            }),
          );

        let res = await postChat(conversationIdRef.current);
        if (ac.signal.aborted || sendVersion !== restoreVersionRef.current) return;
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
        let completedText = "";
        const clientIntents: Promise<AskVClientResult>[] = [];

        const streamResult = await readAssistantStreamResponse(res, ac.signal, (evt) => {
          if (ac.signal.aborted || sendVersion !== restoreVersionRef.current) return;
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
          } else if (evt.type === "client_intent") {
            const execute = onClientIntentRef.current;
            clientIntents.push(execute ? execute(evt.intent) : Promise.resolve({ ok: false, message: "This device cannot open that workflow." }));
          } else if (evt.type === "mutation") {
            onMutationRef.current?.();
          } else if (evt.type === "done") {
            sawDone = true;
            accumulatedContent = evt.content || accumulatedContent;
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId
                  ? {
                      ...m,
                      id: evt.assistantMessageId ? `db-${evt.assistantMessageId}` : m.id,
                      serverId: evt.assistantMessageId,
                      content: evt.content || m.content,
                      pending: false,
                    }
                  : m,
              ),
            );
            setActiveTool(null);
            completedText = (evt.content || accumulatedContent).trim();
          } else if (evt.type === "error") {
            sawError = true;
            setError(evt.message);
            setMessages((prev) =>
              prev.map((m) => (m.id === assistantId ? { ...m, pending: false } : m)),
            );
            setActiveTool(null);
          }
        });

        const clientResults = await Promise.all(clientIntents);
        if (ac.signal.aborted || sendVersion !== restoreVersionRef.current) return;
        if (clientResults.length) {
          completedText = clientResults.map(result => result.message).join(" ");
          setMessages(previous => previous.map(message => message.id === assistantId || message === previous[previous.length - 1]
            ? { ...message, content: completedText, pending: false } : message));
        }
        if (completedText && sawDone && !sawError) onAssistantReplyRef.current?.(completedText);

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
        if (abortRef.current !== ac) return;
        setStreaming(false);
        streamingRef.current = false;
        setActiveTool(null);
        abortRef.current = null;
      }
    },
    [],
  );

  useEffect(() => () => abortRef.current?.abort(), []);

  const submitFeedback = useCallback(
    async (messageId: number, rating: AssistantFeedbackRating): Promise<boolean> => {
      try {
        const res = await assistantFetch(`/api/assistant/messages/${messageId}/feedback`, {
          method: "POST",
          body: JSON.stringify({ rating }),
        });
        if (!res.ok) return false;
        setMessages((prev) =>
          prev.map((m) =>
            m.serverId === messageId ? { ...m, feedbackRating: rating } : m,
          ),
        );
        return true;
      } catch {
        return false;
      }
    },
    [],
  );

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
    submitFeedback,
    getConversationId,
    restoreConversation,
    upsertMessage,
  };
}
