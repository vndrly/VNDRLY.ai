import { useCallback, useEffect, useRef, useState } from "react";
import {
  NUDGE_FLASH_MS,
  WORKFLOW_NUDGE_TYPE,
  ticketIdFromNotificationLink,
  ticketIdFromPushData,
  unreadNudgedTicketIds,
} from "@workspace/ticket-nudge-ui";

import { apiFetch } from "@/lib/api";

type NotificationRow = {
  type: string;
  link: string | null;
  isRead: boolean;
};

type Options = {
  enabled?: boolean;
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

  const handlePushData = useCallback(
    (data: Record<string, unknown> | null | undefined) => {
      if (!data || data.type !== WORKFLOW_NUDGE_TYPE) return;
      const id = ticketIdFromPushData(data);
      if (id) flashNudgeTicket(id);
    },
    [flashNudgeTicket],
  );

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    void (async () => {
      try {
        const rows = await apiFetch<NotificationRow[]>(
          `/api/notifications?type=${WORKFLOW_NUDGE_TYPE}&limit=50`,
        );
        if (cancelled) return;
        for (const id of unreadNudgedTicketIds(rows)) {
          flashNudgeTicket(id);
        }
      } catch {
        /* offline */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled, flashNudgeTicket]);

  useEffect(
    () => () => {
      for (const timer of timersRef.current.values()) clearTimeout(timer);
      timersRef.current.clear();
    },
    [],
  );

  return { nudgeFlashingTicketIds, flashNudgeTicket, handlePushData };
}
