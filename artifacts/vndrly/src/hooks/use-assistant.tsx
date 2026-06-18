import { useCallback, useEffect, useRef, useState } from "react";

export type SignupAssistantLang = "en" | "es";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export type AssistantFeedbackRating = "helpful" | "unhelpful";

export interface AssistantMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  /** DB row id for persisted session turns (enables feedback). */
  serverId?: number;
  feedbackRating?: AssistantFeedbackRating | null;
  // Tool calls only attached to assistant messages once the stream
  // finishes. Used by the panel to render a "Used tool: …" footer.
  toolCalls?: Array<{ name: string; input: unknown; output: string }>;
  pending?: boolean;
}

// ─────────────────────────────────────────────────────────────────
// Pre-auth → post-auth hand-off: stash the signup-mode chat in
// sessionStorage so that after the visitor finishes the signup form
// and signs in, the authenticated panel can offer to "Continue your
// earlier chat?" instead of throwing the conversation away.
//
// Lives in sessionStorage (not localStorage) so the chat doesn't
// outlive the browser session — once the user closes the tab the
// pending chat is gone.
// ─────────────────────────────────────────────────────────────────
const PENDING_SIGNUP_CHAT_KEY = "vndrly:pending-signup-chat:v1";

export interface PendingSignupChat {
  persona: "partner" | "vendor";
  // Plain text turns only — no pending bubbles, no tool traces. The
  // server's `seedHistory` validator drops anything else defensively
  // but we filter here too so the offer banner can show an accurate
  // turn count without re-parsing.
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  savedAt: number;
}

export function readPendingSignupChat(): PendingSignupChat | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(PENDING_SIGNUP_CHAT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PendingSignupChat>;
    if (
      !parsed ||
      (parsed.persona !== "partner" && parsed.persona !== "vendor") ||
      !Array.isArray(parsed.messages) ||
      parsed.messages.length === 0
    ) {
      return null;
    }
    const messages = parsed.messages
      .filter(
        (m): m is { role: "user" | "assistant"; content: string } =>
          !!m &&
          (m.role === "user" || m.role === "assistant") &&
          typeof m.content === "string" &&
          m.content.trim().length > 0,
      )
      .map((m) => ({ role: m.role, content: m.content }));
    if (messages.length === 0) return null;
    return {
      persona: parsed.persona,
      messages,
      savedAt: typeof parsed.savedAt === "number" ? parsed.savedAt : Date.now(),
    };
  } catch {
    return null;
  }
}

export function clearPendingSignupChat(): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(PENDING_SIGNUP_CHAT_KEY);
  } catch {
    // sessionStorage may throw in incognito / quota-exceeded — silent.
  }
}

function writePendingSignupChat(chat: PendingSignupChat): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(PENDING_SIGNUP_CHAT_KEY, JSON.stringify(chat));
  } catch {
    // Best-effort: a failed stash just means the user won't see the
    // "continue your earlier chat?" offer. Worth logging? No — the
    // panel still works either way.
  }
}

export interface ConversationSummary {
  id: number;
  title: string;
  updatedAt: string;
}

type StreamEvent =
  | { type: "token"; delta: string }
  | { type: "tool"; name: string; status: "start" | "end" }
  | { type: "done"; content: string; assistantMessageId?: number }
  | { type: "error"; message: string };

export interface AssistantOptions {
  /**
   * Current browser path (from wouter) so the server can inject page
   * context into the system prompt. Ignored in token/signup modes.
   */
  pageContext?: { path: string; entityId?: number | null };
  /**
   * When set, the hook talks to the unauthenticated field-employee
   * invite-token endpoint instead of the session-authenticated
   * conversations endpoints. In token mode there is no DB persistence:
   * we hold the conversation in memory and replay it on each turn.
   * Used by the `/onboarding/field/:token` page.
   */
  tokenMode?: { token: string };
  /**
   * When set, the hook talks to the unauthenticated signup-page
   * endpoint scoped to the given persona ("partner" or "vendor").
   * Same statelessness as tokenMode (no DB row, history replayed each
   * turn) but no token: the visitor is fully anonymous. Used on
   * `/signup/partner` and `/signup/vendor` so a brand-new visitor can
   * ask for help without first creating an account.
   *
   * `lang` is the browser-derived (or toggle-overridden) language hint
   * forwarded to the server so it can prime Claude in the visitor's
   * language from the very first reply. Read fresh from a ref on each
   * `send` so toggling EN/ES mid-conversation takes effect immediately
   * — without re-mounting the panel or recreating the callback.
   */
  signupMode?: { persona: "partner" | "vendor"; lang?: SignupAssistantLang };
}

/**
 * Manages a single live conversation with the assistant. Owns the SSE
 * lifecycle so the panel component can stay focused on rendering.
 */
export function useAssistant(opts: AssistantOptions = {}) {
  const tokenMode = opts.tokenMode ?? null;
  const signupMode = opts.signupMode ?? null;
  const pageContextRef = useRef(opts.pageContext);
  pageContextRef.current = opts.pageContext;
  // Both tokenMode and signupMode are stateless/anonymous — they
  // share the same "no DB conversation row, history replayed each
  // turn" behaviour, just hitting different endpoints. Collapsing
  // them into one flag here keeps the rest of the hook readable.
  const stateless = tokenMode !== null || signupMode !== null;

  // Track the latest signup language hint in a ref so toggling EN/ES
  // in the panel header is picked up by the next `send` without
  // having to recreate the (memoised) `send` callback. The deps
  // array on `send` intentionally stays narrow to avoid re-rendering
  // the textarea every time the toggle flips.
  const signupLangRef = useRef<SignupAssistantLang | null>(
    signupMode?.lang ?? null,
  );
  useEffect(() => {
    signupLangRef.current = signupMode?.lang ?? null;
  }, [signupMode?.lang]);
  const [conversationId, setConversationId] = useState<number | null>(null);
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [activeTool, setActiveTool] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Ensure we only run one stream at a time per conversation. If the
  // user sends a second message before the first one finishes we abort
  // the in-flight reader so its `done` event doesn't clobber state.
  const abortRef = useRef<AbortController | null>(null);

  const ensureConversation = useCallback(async (): Promise<number> => {
    if (stateless) {
      // Stateless modes (token / signup) never need a conversation
      // row. Returning -1 marks "no conversation id needed".
      return -1;
    }
    if (conversationId !== null) return conversationId;
    const res = await fetch(`${BASE}/api/assistant/conversations`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    if (!res.ok) throw new Error("Failed to start conversation");
    const data = (await res.json()) as { id: number };
    setConversationId(data.id);
    return data.id;
  }, [conversationId, tokenMode]);

  // Reset the panel for a fresh conversation. Does NOT delete the
  // server-side history — that's what the trash button is for. Bumps
  // the restore version so any in-flight loadLatest() bails out
  // instead of resurrecting the previous conversation behind the
  // user's back, and pins hasRestoredRef=true so a re-render of the
  // panel won't auto-restore over the user's "New chat" decision.
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

  // One-shot guard so loadLatest() never resurrects a conversation
  // after the user clicks "New chat" or sends their first message in a
  // fresh session. The caller (panel) is expected to call
  // resetRestoreGuard() when the panel closes so the next open can
  // restore again. We use a ref so a flip doesn't trigger re-renders.
  const hasRestoredRef = useRef(false);

  // Bumped on startNew/clear so any in-flight loadLatest() request
  // recognises that its result is stale and bails out before writing
  // to state. This avoids the race where a slow GET arrives after the
  // user has already started a new chat or sent a message.
  const restoreVersionRef = useRef(0);

  // Load the user's most recent server-side conversation and hydrate
  // the panel with its messages. Used on first panel open so a return
  // visit picks up where the user left off rather than always starting
  // from a blank slate. Guarded against (a) repeat calls within the
  // same session, (b) clobbering an in-progress send, and (c) stale
  // responses arriving after startNew/clear.
  const loadLatest = useCallback(async () => {
    // Stateless modes (token / signup) are unauthenticated — there's
    // no server-side history to load. The panel still calls this on
    // open; we just bail out as a no-op.
    if (stateless) return;
    if (hasRestoredRef.current) return;
    hasRestoredRef.current = true;
    const myVersion = restoreVersionRef.current;
    try {
      const listRes = await fetch(`${BASE}/api/assistant/conversations`, {
        credentials: "include",
      });
      if (!listRes.ok || myVersion !== restoreVersionRef.current) return;
      const list = (await listRes.json()) as { conversations?: ConversationSummary[] };
      const latest = list.conversations?.[0];
      if (!latest) return;
      const detailRes = await fetch(`${BASE}/api/assistant/conversations/${latest.id}`, {
        credentials: "include",
      });
      if (!detailRes.ok || myVersion !== restoreVersionRef.current) return;
      const detail = (await detailRes.json()) as {
        id: number;
        messages: Array<{
          id: number;
          role: "user" | "assistant";
          content: string;
          feedbackRating?: AssistantFeedbackRating | null;
        }>;
      };
      // Final stale-check after the second await. If anything mutated
      // local state in the meantime (startNew, clear, or a send) we
      // refuse to write — the user's intent wins.
      if (myVersion !== restoreVersionRef.current) return;
      // Drop empty assistant rows (stream errors mid-flight) so we
      // don't render blank "Thinking…" bubbles from prior sessions.
      const restored: AssistantMessage[] = detail.messages
        .filter((m) => m.role === "user" || m.content.trim().length > 0)
        .map((m) => ({
          id: `db-${m.id}`,
          serverId: m.id,
          role: m.role,
          content: m.content,
          feedbackRating: m.feedbackRating ?? null,
        }));
      setConversationId(detail.id);
      setMessages(restored);
    } catch {
      // Best-effort restore — silent failures keep the panel usable.
    }
  }, []);

  // Called by the panel when it closes so the next open re-attempts a
  // fresh restore. Without this, a user who closes the panel after
  // clicking "New chat" would never re-load their prior history.
  const resetRestoreGuard = useCallback(() => {
    hasRestoredRef.current = false;
    restoreVersionRef.current += 1;
  }, []);

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || streaming) return;

      // Lock out any in-flight loadLatest() before we mutate state so
      // a slow restore can't overwrite the user's optimistic message
      // and pending assistant bubble (or worse, swap conversationId
      // out from under the active stream target).
      restoreVersionRef.current += 1;
      hasRestoredRef.current = true;

      setError(null);
      // Optimistically append the user message + a pending assistant
      // bubble so the UI immediately reflects the send.
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
        // Snapshot the prior history (BEFORE the optimistic user/assistant
        // pair we just appended) so the server has the full context.
        // For token mode this is the only history the server sees, since
        // we don't persist anything.
        const priorHistory = messages
          .filter((m) => !m.pending && m.content.trim().length > 0)
          .map((m) => ({ role: m.role, content: m.content }));
        // Route to whichever endpoint matches the active mode. Both
        // stateless modes ship the prior history in the body since
        // there's no server-side row to read it from. The session
        // endpoint only needs `message` because the server can read
        // the conversation row for context.
        const url = tokenMode
          ? `${BASE}/api/assistant/field-onboarding/${encodeURIComponent(tokenMode.token)}/chat`
          : signupMode
            ? `${BASE}/api/assistant/signup/${encodeURIComponent(signupMode.persona)}/chat`
            : `${BASE}/api/assistant/conversations/${convId}/messages`;
        // Signup mode also forwards the current language hint
        // (browser-derived or toggle-overridden). Read from a ref so
        // a mid-conversation EN/ES flip takes effect on the very next
        // turn. tokenMode never sends `lang` because it has its own
        // server-side source (vendor_people.preferred_language).
        const body = signupMode
          ? {
              message: trimmed,
              history: priorHistory,
              lang: signupLangRef.current ?? undefined,
            }
          : stateless
            ? { message: trimmed, history: priorHistory }
            : {
                message: trimmed,
                ...(pageContextRef.current ? { pageContext: pageContextRef.current } : {}),
              };
        const res = await fetch(url, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
          body: JSON.stringify(body),
          signal: ac.signal,
        });
        if (!res.ok || !res.body) {
          throw new Error(`HTTP ${res.status}`);
        }
        await consumeSse(res.body, ac.signal, (evt) => {
          if (evt.type === "token") {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId ? { ...m, content: m.content + evt.delta, pending: true } : m,
              ),
            );
          } else if (evt.type === "tool") {
            setActiveTool(evt.status === "start" ? evt.name : null);
          } else if (evt.type === "done") {
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
          } else if (evt.type === "error") {
            setError(evt.message);
            // Clear the "Thinking…" placeholder so the bubble doesn't
            // sit stuck in a pending state forever after a stream error.
            setMessages((prev) =>
              prev.map((m) => (m.id === assistantId ? { ...m, pending: false } : m)),
            );
            setActiveTool(null);
          }
        });
      } catch (err) {
        if ((err as Error).name === "AbortError") return;
        setError("The assistant is having trouble right now. Please try again.");
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

  // Discard the current conversation server-side and reset. startNew()
  // already bumps the restore version so a slow loadLatest() can't
  // resurrect the deleted conversation.
  const clear = useCallback(async () => {
    const id = conversationId;
    startNew();
    if (id !== null) {
      try {
        await fetch(`${BASE}/api/assistant/conversations/${id}`, {
          method: "DELETE",
          credentials: "include",
        });
      } catch {
        // Best-effort: orphaned rows are user-scoped and harmless.
      }
    }
  }, [conversationId, startNew]);

  // Stop in-flight streaming if the panel unmounts.
  useEffect(() => () => abortRef.current?.abort(), []);

  // ── Pre-auth → post-auth hand-off ────────────────────────────
  // Whenever the panel runs in signupMode, mirror the visible chat
  // turns into sessionStorage so the authenticated panel can offer
  // the visitor a "Continue your earlier chat?" prompt after they
  // create their account. We only persist *settled* turns (no pending
  // bubbles, no empty content) to avoid handing the server a half-
  // streamed assistant message later.
  useEffect(() => {
    if (!signupMode) return;
    const settled = messages
      .filter((m) => !m.pending && m.content.trim().length > 0)
      .map((m) => ({ role: m.role, content: m.content }));
    if (settled.length === 0) {
      // Nothing worth restoring yet — and we explicitly do NOT clear
      // here, because clearing on first render would wipe a chat the
      // visitor saved on a prior page mount before they navigated to
      // the actual signup form.
      return;
    }
    writePendingSignupChat({
      persona: signupMode.persona,
      messages: settled,
      savedAt: Date.now(),
    });
  }, [messages, signupMode]);

  // Adopt a pre-auth signup chat into a brand-new authenticated
  // conversation row. POSTs the seed history alongside the
  // conversation create so the server stores the history server-side
  // (which is what makes the model see it on the next turn). On
  // success we hydrate local state to match what the server now has,
  // and clear the sessionStorage entry so the offer doesn't keep
  // resurfacing on subsequent panel opens. Only valid in fully
  // session-authenticated mode — token/signup modes have no DB row.
  const adoptSignupHistory = useCallback(
    async (seed: PendingSignupChat): Promise<boolean> => {
      if (stateless) return false;
      // Lock out loadLatest / startNew races: any in-flight restore
      // would otherwise overwrite the just-adopted history.
      restoreVersionRef.current += 1;
      hasRestoredRef.current = true;
      try {
        const res = await fetch(`${BASE}/api/assistant/conversations`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ seedHistory: seed.messages }),
        });
        if (!res.ok) return false;
        const data = (await res.json()) as { id: number };
        // Reflect the adopted history in the panel immediately so the
        // user sees their old chat right away. The IDs are local-only
        // — the next open will reload from the DB rows the server
        // just wrote — so we prefix them to avoid colliding with the
        // db-{id} format loadLatest() uses.
        const restored: AssistantMessage[] = seed.messages.map((m, idx) => ({
          id: `seed-${idx}`,
          role: m.role,
          content: m.content,
        }));
        setConversationId(data.id);
        setMessages(restored);
        setError(null);
        clearPendingSignupChat();
        return true;
      } catch {
        return false;
      }
    },
    [stateless],
  );

  const submitFeedback = useCallback(
    async (messageId: number, rating: AssistantFeedbackRating): Promise<boolean> => {
      if (stateless) return false;
      try {
        const res = await fetch(`${BASE}/api/assistant/messages/${messageId}/feedback`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
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
    [stateless],
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
    resetRestoreGuard,
    adoptSignupHistory,
    submitFeedback,
  };
}

// ─────────────────────────────────────────────────────────────────
// Minimal SSE consumer. The standard EventSource API doesn't support
// POST bodies, so we parse the stream manually from a fetch response.
// Format follows the W3C spec: lines like `event: <name>` / `data: <json>`
// terminated by a blank line.
// ─────────────────────────────────────────────────────────────────
async function consumeSse(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal,
  onEvent: (evt: StreamEvent) => void,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";

  while (!signal.aborted) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // Process complete events (delimited by blank lines).
    let idx: number;
    while ((idx = buffer.indexOf("\n\n")) !== -1) {
      const raw = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      const lines = raw.split("\n");
      let eventName = "message";
      const dataLines: string[] = [];
      for (const line of lines) {
        if (line.startsWith("event:")) eventName = line.slice(6).trim();
        else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
      }
      if (dataLines.length === 0) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(dataLines.join("\n"));
      } catch {
        continue;
      }
      if (eventName === "token") onEvent({ type: "token", delta: (parsed as { delta: string }).delta });
      else if (eventName === "tool") onEvent({ type: "tool", ...(parsed as { name: string; status: "start" | "end" }) });
      else if (eventName === "done") onEvent({ type: "done", content: (parsed as { content: string }).content });
      else if (eventName === "error") onEvent({ type: "error", message: (parsed as { message: string }).message });
    }
  }
}
