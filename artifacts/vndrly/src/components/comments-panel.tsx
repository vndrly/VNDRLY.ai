import { PngPillButton, PngPillButton as PillButton } from "@/components/png-pill-rollover";
import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { translateApiError } from "@/lib/api-error";
import { MessageSquare, Image as ImageIcon, Trash2, Pencil, X, Eye, RotateCcw } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import LiveConnectionPill from "@/components/live-connection-pill";
import { useLiveConnectionStatus } from "@/hooks/use-live-connection-status";
import { useRateLimitGate } from "@/hooks/use-rate-limit-gate";
import { cn } from "@/lib/utils";

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

function safeHttpsUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  if (url.startsWith("/api/storage/") || url.startsWith("/objects/")) return url;
  return null;
}

type Participant = { id: number; displayName: string | null; username: string | null; role: string | null };

type Comment = {
  id: number;
  content: string;
  attachments: string[] | null;
  mentions: number[] | null;
  editHistory: { at: string; prev: string }[] | null;
  updatedAt: string | null;
  deletedAt: string | null;
  deletedById: number | null;
  // Task #52 — server resolves the deleter's display name when present
  // so admins see "Removed by {{name}} · {{when}}". Null when the user
  // has been hard-deleted since the soft-delete happened.
  deletedByName: string | null;
  createdAt: string;
  createdById: number | null;
  createdByName: string | null;
  createdByRole: string | null;
  seenBy: { userId: number; seenAt: string }[];
  seenCount: number;
};

type Props = {
  source: "ticket" | "hotlist";
  parentId: number;
  testIdPrefix?: string;
};

function timeAgo(iso: string): string {
  const t = new Date(iso).getTime();
  const s = Math.floor((Date.now() - t) / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  return `${d}d`;
}

const EDIT_WINDOW_MS = 5 * 60 * 1000;

export function CommentsPanel({ source, parentId, testIdPrefix = "comments" }: Props) {
  const { user } = useAuth();
  const { toast } = useToast();
  const { t } = useTranslation();
  const qc = useQueryClient();
  const basePath = source === "ticket"
    ? `${API_BASE}/api/tickets/${parentId}/comments`
    : `${API_BASE}/api/hotlist/jobs/${parentId}/comments`;
  const participantsPath = source === "ticket"
    ? `${API_BASE}/api/tickets/${parentId}/comments-participants`
    : `${API_BASE}/api/hotlist/jobs/${parentId}/comments-participants`;
  const queryKey = ["comments", source, parentId];

  // Task #699 — gate comment polling on `comments.rate_limited`. The
  // queries below pass `enabled: !commentsRateLimited` so neither
  // refetchOnWindowFocus nor SSE-driven invalidations re-fire while
  // the limiter window is open. We mirror the gate state into local
  // state so the queries can read the latest flag on the same render
  // (the same shape the tickets page uses for Task #675).
  const [commentsRateLimitedState, setCommentsRateLimitedState] = useState(false);
  const { data: comments = [], isLoading, error: commentsError } = useQuery<Comment[]>({
    queryKey,
    queryFn: async () => {
      const r = await fetch(basePath, { credentials: "include" });
      if (!r.ok) {
        let data: unknown = null;
        try {
          data = await r.json();
        } catch {
          // Non-JSON body: gate just won't trip; toast still useful.
        }
        const err = new Error("Failed to load comments") as Error & {
          status: number;
          data: unknown;
          headers: Headers;
        };
        err.status = r.status;
        err.data = data;
        err.headers = r.headers;
        throw err;
      }
      return r.json();
    },
    enabled: !commentsRateLimitedState,
    refetchOnWindowFocus: true,
    retry: (failureCount: number, err: unknown) => {
      // Don't burn through the limiter's window with the default
      // 3-retry storm; every other error keeps the standard retry.
      const status = (err as { status?: number } | null)?.status;
      if (status === 429) return false;
      return failureCount < 3;
    },
  });
  const commentsGate = useRateLimitGate(commentsError, "comments.rate_limited");
  const commentsRateLimited = commentsGate.rateLimited;
  useEffect(() => {
    setCommentsRateLimitedState(commentsRateLimited);
  }, [commentsRateLimited]);

  // Opening a hotlist thread marks comments seen server-side; refresh
  // hotlist list rows so unread badges on the dashboard clear.
  const hotlistListSyncedRef = useRef(false);
  useEffect(() => {
    hotlistListSyncedRef.current = false;
  }, [source, parentId]);
  useEffect(() => {
    if (source !== "hotlist" || isLoading || hotlistListSyncedRef.current) return;
    hotlistListSyncedRef.current = true;
    qc.invalidateQueries({ queryKey: ["hotlist", "list"] });
  }, [source, parentId, isLoading, qc]);

  // Task #666 / Task #672 / Task #676 — surface the live status of the
  // underlying comment feed so a dispatcher reading a thread always knows
  // whether what's on screen is being pushed in real time. Both ticket
  // and hotlist comments now have a dedicated SSE channel; we render the
  // standard Live / Reconnecting… / Reconnected — refreshed pill driven
  // by whichever channel matches this panel's `source`.
  //
  //   • For ticket comments we ride along on the shared
  //     `/api/tickets/events` stream that the rest of ticket-detail
  //     already subscribes to (Task #622). The bus carries
  //     `ticket.unblocked` events and a one-shot `ticket.hello`; the
  //     pill only cares about open/error and the hello's `gap` flag.
  //
  //   • For hotlist comments we subscribe to the per-job
  //     `/api/hotlist/jobs/:id/comments/events` stream added in Task #676.
  //     It carries `hotlist.comment.created/updated/deleted` events and
  //     a one-shot `hotlist.comment.hello`. Since the events themselves
  //     just signal "something changed on this job", we re-invalidate the
  //     comments query for every visible event — same effect as the
  //     hello-with-gap fallback, and avoids a parallel patch path.
  //
  // On a hello-with-gap (browser auto-reconnected with a stale
  // Last-Event-ID, server replayed past us) we re-fetch the comment
  // thread so any notes posted while we were offline catch up at once
  // instead of waiting on the next focus refetch.
  // Stash the gate state in a ref so the SSE callbacks (set up once
  // with stable deps) can read the latest value without rebuilding
  // their listeners every time the cooldown flips.
  const commentsRateLimitedRef = useRef(commentsRateLimitedState);
  commentsRateLimitedRef.current = commentsRateLimitedState;
  const refetchComments = useCallback(() => {
    // Inline the key build here so the callback's deps stay primitive
    // (source + parentId) and don't churn on every render the way a
    // captured `queryKey` array reference would.
    // Task #699 — skip while the comments limiter has us parked. The
    // query is also `enabled: false` so invalidate would be a no-op
    // anyway, but skipping keeps the cache "stable" rather than
    // "stale-but-disabled" and avoids a thundering refetch the
    // instant the cooldown clears.
    if (commentsRateLimitedRef.current) return;
    qc.invalidateQueries({ queryKey: ["comments", source, parentId] });
  }, [qc, source, parentId]);
  const liveUrl = source === "ticket"
    ? `${API_BASE}/api/tickets/events`
    : `${API_BASE}/api/hotlist/jobs/${parentId}/comments/events`;
  const liveHelloName = source === "ticket"
    ? "ticket.hello"
    : "hotlist.comment.hello";
  const liveStatus = useLiveConnectionStatus({
    url: liveUrl,
    helloEventName: liveHelloName,
    onHelloWithGap: refetchComments,
  });
  // For the hotlist channel each event ("created"/"updated"/"deleted")
  // is itself a refresh hint — the payload only identifies the job +
  // commentId, so we just re-fetch the thread so the panel renders the
  // canonical server state (deleted-by, edit history, read receipts).
  // The ticket channel doesn't carry comment-specific events, so this
  // listener is hotlist-only.
  useEffect(() => {
    if (source !== "hotlist") return;
    let es: EventSource | null = null;
    const onChange = () => {
      // Task #699 — skip during the comments rate-limit cooldown so
      // a noisy push channel can't cause us to invalidate (and the
      // user to keep seeing churn) faster than the limiter allows.
      if (commentsRateLimitedRef.current) return;
      qc.invalidateQueries({ queryKey: ["comments", source, parentId] });
    };
    try {
      es = new EventSource(liveUrl, { withCredentials: true });
      es.addEventListener("hotlist.comment.created", onChange);
      es.addEventListener("hotlist.comment.updated", onChange);
      es.addEventListener("hotlist.comment.deleted", onChange);
    } catch {
      es = null;
    }
    return () => {
      if (es) {
        es.removeEventListener("hotlist.comment.created", onChange);
        es.removeEventListener("hotlist.comment.updated", onChange);
        es.removeEventListener("hotlist.comment.deleted", onChange);
        es.close();
      }
    };
  }, [source, parentId, liveUrl, qc]);
  // Task #710 — the mention picker's participants endpoint is gated by
  // its own `participants.rate_limited` limiter on the server. Park the
  // query for the indicated Retry-After window so opening the @-picker
  // can't keep re-firing into a 429. While parked the picker just sees
  // the cached list (or an empty list on first load); the gate auto-
  // clears so the next mention attempt refreshes the roster.
  const [participantsRateLimitedState, setParticipantsRateLimitedState] =
    useState(false);
  const { data: participants = [], error: participantsError } = useQuery<
    Participant[]
  >({
    queryKey: ["comments-participants", source, parentId],
    queryFn: async () => {
      const r = await fetch(participantsPath, { credentials: "include" });
      if (!r.ok) {
        // Surface 429s to the gate by throwing a structured error; for
        // any other non-OK we keep the prior "render an empty roster"
        // affordance so the picker degrades gracefully.
        if (r.status === 429) {
          let data: unknown = null;
          try {
            data = await r.json();
          } catch {
            // Non-JSON body: gate just won't trip; fall through to empty list.
          }
          const err = new Error("rate-limited") as Error & {
            status: number;
            data: unknown;
            headers: Headers;
          };
          err.status = r.status;
          err.data = data;
          err.headers = r.headers;
          throw err;
        }
        return [];
      }
      return r.json();
    },
    enabled: !participantsRateLimitedState,
    retry: (failureCount: number, err: unknown) => {
      const status = (err as { status?: number } | null)?.status;
      if (status === 429) return false;
      return failureCount < 3;
    },
  });
  const participantsGate = useRateLimitGate(
    participantsError,
    "participants.rate_limited",
  );
  useEffect(() => {
    setParticipantsRateLimitedState(participantsGate.rateLimited);
  }, [participantsGate.rateLimited]);

  const [content, setContent] = useState("");
  const [attachments, setAttachments] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const [editingId, setEditingId] = useState<number | null>(null);
  const [editContent, setEditContent] = useState("");
  const [seenByOpen, setSeenByOpen] = useState<number | null>(null);

  const handleUpload = async (file: File) => {
    setUploading(true);
    try {
      const r = await fetch(`${API_BASE}/api/storage/uploads/request-url`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: file.name, size: file.size, contentType: file.type }),
        credentials: "include",
      });
      if (!r.ok) throw new Error("Failed");
      const { uploadURL, objectPath } = await r.json();
      const up = await fetch(uploadURL, { method: "PUT", headers: { "Content-Type": file.type }, body: file });
      if (!up.ok) throw new Error("Upload failed");
      await fetch(`${API_BASE}/api/storage/uploads/finalize`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ objectURL: uploadURL, visibility: "public" }),
      });
      setAttachments((a) => [...a, `${API_BASE}/api/storage${objectPath}`]);
    } catch {
      toast({ title: t("comments.couldntUploadPhoto"), variant: "destructive" });
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const post = useMutation({
    mutationFn: async () => {
      const r = await fetch(basePath, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ content: content.trim(), attachments }),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "Failed");
    },
    onSuccess: () => {
      setContent("");
      setAttachments([]);
      qc.invalidateQueries({ queryKey });
    },
    onError: (e: any) => toast({ title: translateApiError(e, t, t("comments.couldntPostComment")), variant: "destructive" }),
  });

  const editMut = useMutation({
    mutationFn: async ({ id, text }: { id: number; text: string }) => {
      const r = await fetch(`${basePath}/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ content: text.trim() }),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "Failed");
    },
    onSuccess: () => { setEditingId(null); setEditContent(""); qc.invalidateQueries({ queryKey }); },
    onError: (e: any) => toast({ title: translateApiError(e, t, t("comments.couldntEdit")), variant: "destructive" }),
  });

  const delMut = useMutation({
    mutationFn: async (id: number) => {
      const r = await fetch(`${basePath}/${id}`, { method: "DELETE", credentials: "include" });
      if (!r.ok) throw new Error("Failed");
    },
    onSuccess: () => qc.invalidateQueries({ queryKey }),
  });

  // Task #52 — admin-only restore. POSTs to the matching .../restore
  // endpoint added in artifacts/api-server/src/routes/comments.ts and
  // refetches so the row re-renders without the "[removed]" pill.
  const restoreMut = useMutation({
    mutationFn: async (id: number) => {
      const r = await fetch(`${basePath}/${id}/restore`, {
        method: "POST",
        credentials: "include",
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "Failed");
    },
    onSuccess: () => {
      toast({ title: t("comments.restored") });
      qc.invalidateQueries({ queryKey });
    },
    onError: (e: any) =>
      toast({
        title: translateApiError(e, t, t("comments.couldntRestore")),
        variant: "destructive",
      }),
  });

  // Task #52 — admins can flip individual deleted rows to show the
  // original content + attachments before deciding whether to restore.
  // Tracked here in a Set rather than per-row state so toggling one
  // doesn't reset the others on every re-fetch.
  const [revealedOriginalIds, setRevealedOriginalIds] = useState<Set<number>>(
    () => new Set(),
  );
  const toggleOriginal = (id: number) => {
    setRevealedOriginalIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const legacyPhotoPath = (c: string): string | null => {
    if (!c.startsWith("[photo] ")) return null;
    const path = c.slice("[photo] ".length).trim();
    if (!path) return null;
    if (/^https?:\/\//i.test(path)) return path;
    if (path.startsWith("/objects/")) return `${API_BASE}/api/storage${path}`;
    if (path.startsWith("objects/")) return `${API_BASE}/api/storage/${path}`;
    return `${API_BASE}/api/storage/objects/${path.replace(/^\//, "")}`;
  };

  const renderContent = (c: string) => {
    const legacy = legacyPhotoPath(c);
    if (legacy) {
      const safeHref = safeHttpsUrl(legacy);
      return safeHref ? (
        <a href={safeHref} target="_blank" rel="noreferrer">
          <img src={safeHref} alt="photo" className="h-32 w-32 object-cover rounded border" />
        </a>
      ) : (
        <img src={legacy} alt="photo" className="h-32 w-32 object-cover rounded border" />
      );
    }
    return c.split(/(@(?:"[^"]+"|[A-Za-z0-9_.\-]+))/g).map((part, i) => {
      if (part.startsWith("@")) {
        return <span key={i} className="text-amber-600 font-semibold">{part}</span>;
      }
      return <span key={i}>{part}</span>;
    });
  };

  return (
    <div className="space-y-3" data-testid={`${testIdPrefix}-panel`}>
      <div className="flex items-center gap-2">
        <MessageSquare className="w-5 h-5" style={{ color: "var(--brand-primary, #f59e0b)" }} />
        <h3 className="font-semibold">{t("comments.log")}</h3>
        <span className="text-xs text-muted-foreground">
          {t("comments.noteCount", { count: comments.length })}
        </span>
        {/* Task #666 / Task #676 — Live pill sits LEFT-aligned, AFTER
            the note count per the user's explicit order:
            Log → # notes → Live. Pill width is fixed so the header
            layout doesn't shift between states. */}
        {/* Task #699 — when the comments limiter parks us, swap the
            pill into "reconnecting" so the user sees the same
            familiar pause indicator they get from a dropped SSE
            connection. The auto-clear in `useRateLimitGate` returns
            control to `liveStatus` once the cooldown expires. */}
        <LiveConnectionPill
          status={commentsRateLimited ? "reconnecting" : liveStatus}
          testId={`${testIdPrefix}-live-connection-pill`}
        />
      </div>

      {/* Composer */}
      <div className="rounded-lg border bg-card p-3 space-y-2">
        <Textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder={t("comments.addNote")}
          className="min-h-[70px] resize-none"
          data-testid={`${testIdPrefix}-composer`}
        />
        {attachments.length > 0 && (
          <div className="flex gap-2 flex-wrap">
            {attachments.map((u) => (
              <div key={u} className="relative">
                <img src={u} className="h-16 w-16 object-cover rounded border" alt="attachment" />
                <button
                  className="absolute -top-1 -right-1 bg-white border rounded-full p-0.5 shadow"
                  onClick={() => setAttachments((a) => a.filter((x) => x !== u))}
                  type="button"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="flex items-center gap-2">
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleUpload(f);
            }}
          />
          <PngPillButton
            type="button"
            color="blue"
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            data-testid={`${testIdPrefix}-attach`}
          >
            <ImageIcon className="w-3.5 h-3.5" strokeWidth={3} />
            {uploading ? t("comments.uploading") : t("comments.attachPhoto")}
          </PngPillButton>
          <div className="ml-auto">
            <PngPillButton color="blue"
              onClick={() => post.mutate()}
              disabled={post.isPending || (!content.trim() && attachments.length === 0)}
              data-testid={`${testIdPrefix}-submit`}
            >
              {t("comments.post")}
            </PngPillButton>
          </div>
        </div>
      </div>

      {/* Thread */}
      {isLoading ? (
        <p className="text-sm text-muted-foreground">{t("comments.loading")}</p>
      ) : comments.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("comments.empty")}</p>
      ) : (
        <div className="space-y-3">
          {comments.map((c) => {
            const isAuthor = c.createdById === user?.userId;
            const isAdmin = user?.role === "admin";
            const canEdit = isAuthor && !c.deletedAt;
            const canDelete = (isAuthor || isAdmin) && !c.deletedAt;
            const withinEditWindow = Date.now() - new Date(c.createdAt).getTime() < EDIT_WINDOW_MS;
            // Task #52 — for admins the server returns the original
            // content/attachments on a deleted row, but we still render
            // it as removed by default; only flip to the original when
            // the admin explicitly clicks "View original". For everyone
            // else `c.content` is already the "[removed]" placeholder.
            const originalRevealed = isAdmin && c.deletedAt && revealedOriginalIds.has(c.id);
            const showAttachments =
              c.attachments && c.attachments.length > 0 && (!c.deletedAt || originalRevealed);
            return (
              <div
                key={c.id}
                id={`comment-${c.id}`}
                className={`rounded-lg border p-3 ${c.deletedAt ? "bg-muted/40 italic" : "bg-card"}`}
                data-testid={`${testIdPrefix}-item-${c.id}`}
              >
                <div className="flex items-start gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 text-xs flex-wrap">
                      <span className="font-semibold">{c.createdByName || t("comments.unknown")}</span>
                      {c.createdByRole && (
                        <span className="px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                          {c.createdByRole.replace(/_/g, " ")}
                        </span>
                      )}
                      <span className="text-muted-foreground">· {t("comments.ago", { time: timeAgo(c.createdAt) })}</span>
                      {c.editHistory && c.editHistory.length > 0 && !c.deletedAt && (
                        <span className="text-muted-foreground italic">{t("comments.edited")}</span>
                      )}
                      {/* Task #52 — surface deletion metadata on every
                          deleted row so admins can see who removed the
                          note even when they haven't expanded the
                          original. Non-admins also get this caption for
                          context (the content stays redacted). */}
                      {c.deletedAt && (
                        <span
                          className="text-red-600 not-italic"
                          data-testid={`${testIdPrefix}-removed-by-${c.id}`}
                        >
                          · {t("comments.removedBy", {
                            name: c.deletedByName || t("comments.unknown"),
                            time: timeAgo(c.deletedAt),
                          })}
                        </span>
                      )}
                    </div>
                    {editingId === c.id ? (
                      <div className="mt-2 space-y-1">
                        <Textarea
                          value={editContent}
                          onChange={(e) => setEditContent(e.target.value)}
                          className="min-h-[60px] resize-none"
                        />
                        <div className="flex gap-2">
                          <PillButton
                            color="blue"
                            onClick={() => editMut.mutate({ id: c.id, text: editContent })}
                          >
                            {t("comments.save")}
                          </PillButton>
                          <PillButton color="red" onClick={() => setEditingId(null)}>
                            {t("comments.cancel")}
                          </PillButton>
                          {!withinEditWindow && (
                            <span className="text-xs text-muted-foreground self-center">
                              {t("comments.pastEditWindow")}
                            </span>
                          )}
                        </div>
                      </div>
                    ) : (
                      <div
                        className="mt-1 text-sm whitespace-pre-wrap break-words"
                        data-testid={`${testIdPrefix}-content-${c.id}`}
                      >
                        {originalRevealed ? renderContent(c.content) : renderContent(c.deletedAt ? "[removed]" : c.content)}
                      </div>
                    )}
                    {showAttachments && (
                      <div className="mt-2 flex flex-wrap gap-2">
                        {c.attachments!.map((u) => {
                          const safeHref = safeHttpsUrl(u);
                          if (!safeHref) return null;
                          return (
                            <a key={u} href={safeHref} target="_blank" rel="noreferrer">
                              <img
                                src={safeHref}
                                className="h-24 w-24 object-cover rounded border"
                                alt="attachment"
                              />
                            </a>
                          );
                        })}
                      </div>
                    )}
                    <div className="mt-2 flex items-center gap-2 text-[11px] text-muted-foreground flex-wrap">
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 hover:underline"
                        onClick={() => setSeenByOpen(seenByOpen === c.id ? null : c.id)}
                        data-testid={`${testIdPrefix}-seen-${c.id}`}
                      >
                        <Eye className="w-3 h-3" />
                        {t("comments.seenBy", { count: c.seenCount })}
                      </button>
                      {canEdit && (
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 hover:underline"
                          onClick={() => { setEditingId(c.id); setEditContent(c.content); }}
                        >
                          <Pencil className="w-3 h-3" /> {t("comments.edit")}
                        </button>
                      )}
                      {canDelete && (
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 hover:underline text-red-600"
                          onClick={() => {
                            if (confirm(t("comments.removeConfirm"))) delMut.mutate(c.id);
                          }}
                        >
                          <Trash2 className="w-3 h-3" /> {t("comments.remove")}
                        </button>
                      )}
                      {/* Task #52 — admin moderation controls for
                          deleted rows. "View original" flips the row to
                          show the censored content + attachments;
                          "Restore" un-deletes the row for everyone. */}
                      {isAdmin && c.deletedAt && (
                        <>
                          <button
                            type="button"
                            className="inline-flex items-center gap-1 hover:underline"
                            onClick={() => toggleOriginal(c.id)}
                            data-testid={`${testIdPrefix}-view-original-${c.id}`}
                          >
                            <Eye className="w-3 h-3" />
                            {originalRevealed
                              ? t("comments.hideOriginal")
                              : t("comments.viewOriginal")}
                          </button>
                          <button
                            type="button"
                            className="inline-flex items-center gap-1 hover:underline text-emerald-700"
                            onClick={() => {
                              if (confirm(t("comments.restoreConfirm"))) restoreMut.mutate(c.id);
                            }}
                            disabled={restoreMut.isPending}
                            data-testid={`${testIdPrefix}-restore-${c.id}`}
                          >
                            <RotateCcw className="w-3 h-3" /> {t("comments.restore")}
                          </button>
                        </>
                      )}
                    </div>
                    {seenByOpen === c.id && c.seenBy.length > 0 && (
                      <div className="mt-2 text-[11px] text-muted-foreground border-l-2 border-amber-300 pl-2">
                        {c.seenBy.map((s) => {
                          const p = participants.find((pp) => pp.id === s.userId);
                          return (
                            <div key={s.userId}>
                              {p?.displayName || p?.username || t("comments.userPlaceholder", { id: s.userId })} · {t("comments.ago", { time: timeAgo(s.seenAt) })}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default CommentsPanel;
