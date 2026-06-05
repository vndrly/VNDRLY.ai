import { useCallback, useEffect, useRef, useState } from "react";
import {
  NUDGE_FLASH_MS,
  WORKFLOW_NUDGE_TYPE,
  ticketIdFromNotificationLink,
  unreadNudgedTicketIds,
} from "@workspace/ticket-nudge-ui";
import { notificationsApi } from "@/lib/notifications-api";

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

type Options = {
  enabled?: boolean;
  /** When set, only flash nudges for this ticket (detail page). */
  ticketId?: number;
  onNudge?: (ticketId: number) => void;
};

export function useTicketNudgeFlash(options: Options = {}) {
  const { enabled = true, ticketId, onNudge } = options;
  const onNudgeRef = useRef(onNudge);
  onNudgeRef.current = onNudge;
  const ticketIdRef = useRef(ticketId);
  ticketIdRef.current = ticketId;

  const [nudgeFlashingTicketIds, setNudgeFlashingTicketIds] = useState<
    Set<number>
  >(new Set());
  const timersRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(
    new Map(),
  );

  const flashNudgeTicket = useCallback((id: number) => {
    const scoped = ticketIdRef.current;
    if (scoped != null && id !== scoped) return;

    setNudgeFlashingTicketIds((prev) => {
      if (prev.has(id)) return prev;
      const next = new Set(prev);
      next.add(id);
      return next;
    });
    onNudgeRef.current?.(id);

    const existing = timersRef.current.get(id);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      timersRef.current.delete(id);
      setNudgeFlashingTicketIds((prev) => {
        if (!prev.has(id)) return prev;
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }, NUDGE_FLASH_MS);
    timersRef.current.set(id, timer);
  }, []);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    void (async () => {
      try {
        const rows = await notificationsApi.list();
        if (cancelled) return;
        for (const id of unreadNudgedTicketIds(rows)) {
          flashNudgeTicket(id);
        }
      } catch {
        /* offline — SSE / push will catch up */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled, flashNudgeTicket]);

  useEffect(() => {
    if (!enabled) return;
    if (typeof window === "undefined" || typeof EventSource === "undefined") {
      return;
    }

    let es: EventSource | null = null;
    try {
      es = new EventSource(`${API_BASE}/api/notifications/events`, {
        withCredentials: true,
      });
      const onCreated = (msg: MessageEvent) => {
        try {
          const parsed = JSON.parse(msg.data) as {
            type?: string;
            notifType?: string;
            link?: string | null;
          };
          if (parsed.type !== "notification.created") return;
          if (parsed.notifType !== WORKFLOW_NUDGE_TYPE) return;
          const id = ticketIdFromNotificationLink(parsed.link);
          if (id) flashNudgeTicket(id);
        } catch {
          /* malformed */
        }
      };
      es.addEventListener("notification.created", onCreated as EventListener);
    } catch {
      es = null;
    }

    return () => {
      es?.close();
    };
  }, [enabled, flashNudgeTicket]);

  useEffect(
    () => () => {
      for (const timer of timersRef.current.values()) clearTimeout(timer);
      timersRef.current.clear();
    },
    [],
  );

  return { nudgeFlashingTicketIds, flashNudgeTicket };
}
