import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { apiFetch } from "@/lib/api";
import {
  captureAuthScope,
  isAuthScopeCurrent,
  subscribeToken,
  subscribeUser,
} from "@/lib/auth";
import {
  NOTIFICATION_CATEGORY_IDS,
  type NotificationRow,
  type NotificationsListResponse,
  type NotificationsResponse,
} from "@/lib/notifications-ui";
import { syncAppIconBadge } from "@/lib/notificationBadge";
import { useRateLimitGate } from "@/hooks/use-rate-limit-gate";

function subscribeAuth(listener: () => void) {
  const user = subscribeUser(listener);
  const token = subscribeToken(listener);
  return () => {
    user();
    token();
  };
}
const authGeneration = () => captureAuthScope().generation;
type Inbox = {
  generation: number;
  category: string;
  mode: "unknown" | "gate" | "office";
  categories: readonly string[];
  items: NotificationRow[];
  nextCursor: NotificationsResponse["nextCursor"];
  error: unknown;
  pending: "first" | "refresh" | "more" | null;
};
function emptyInbox(generation: number): Inbox {
  return {
    generation,
    category: "all",
    mode: "unknown",
    categories: ["all"],
    items: [],
    nextCursor: null,
    error: null,
    pending: "first",
  };
}

/** Gate pages are server-filtered; office arrays keep their existing local filters. */
export function useNotificationInbox(initialCategory: string) {
  const generation = useSyncExternalStore(subscribeAuth, authGeneration);
  const [selection, setSelection] = useState({
    generation,
    category: initialCategory,
    routeCategory: initialCategory,
  });
  const activeCategory =
    selection.generation !== generation
      ? "all"
      : selection.routeCategory !== initialCategory
        ? initialCategory
        : selection.category;
  const [state, setState] = useState<Inbox>(() => emptyInbox(generation));
  const stateRef = useRef(state);
  stateRef.current = state;
  const requestId = useRef(0);
  const inFlight = useRef<AbortController | null>(null);
  const scopeMatches = state.generation === generation;
  const pageMatches =
    scopeMatches &&
    (state.mode === "office" || state.category === activeCategory);
  const current = scopeMatches ? state : emptyInbox(generation);
  const { rateLimited, retryAfterSeconds } = useRateLimitGate(
    pageMatches ? state.error : null,
    "notifications.rate_limited",
  );

  const request = useCallback(
    async (kind: "first" | "refresh" | "more" = "first") => {
      if (rateLimited) return;
      const previous =
        stateRef.current.generation === generation
          ? stateRef.current
          : emptyInbox(generation);
      if (
        kind === "more" &&
        (inFlight.current ||
          previous.mode !== "gate" ||
          previous.category !== activeCategory ||
          !previous.nextCursor)
      )
        return;
      inFlight.current?.abort();
      const controller = new AbortController();
      inFlight.current = controller;
      const id = ++requestId.current;
      const scope = captureAuthScope();
      const valid = () =>
        id === requestId.current &&
        isAuthScopeCurrent(scope) &&
        !controller.signal.aborted;
      const query = new URLSearchParams({
        limit: "25",
        category: activeCategory,
      });
      if (kind === "more" && previous.nextCursor) {
        // Keep timestamp text intact: PostgreSQL cursors include microseconds.
        query.set("beforeCreatedAt", previous.nextCursor.createdAt);
        query.set("beforeId", String(previous.nextCursor.id));
      }
      setState({
        ...previous,
        category: activeCategory,
        items:
          previous.category === activeCategory || previous.mode === "office"
            ? previous.items
            : [],
        error: null,
        pending: kind,
      });
      try {
        // Discovery retains the office endpoint's 100-row default. Gate default is already 25.
        const data = await apiFetch<NotificationsListResponse>(
          previous.mode === "gate"
            ? `/api/notifications?${query}`
            : "/api/notifications",
          { signal: controller.signal },
        );
        if (!valid()) return;
        const office = Array.isArray(data);
        const categories: readonly string[] = office
          ? NOTIFICATION_CATEGORY_IDS
          : ["all", ...data.categories];
        const rows = office ? data : data.items;
        const unique = new Map<number, NotificationRow>();
        for (const row of [
          ...(kind === "more" ? stateRef.current.items : []),
          ...rows,
        ]) {
          if (!unique.has(row.id)) unique.set(row.id, row);
        }
        const resultCategory =
          previous.mode === "unknown" ? "all" : activeCategory;
        const next: Inbox = {
          generation,
          category: resultCategory,
          mode: office ? "office" : "gate",
          categories,
          items: [...unique.values()],
          nextCursor: office ? null : data.nextCursor,
          error: null,
          pending: null,
        };
        stateRef.current = next;
        setState(next);
        if (!categories.includes(activeCategory))
          setSelection({
            generation,
            category: "all",
            routeCategory: initialCategory,
          });
        void syncAppIconBadge();
      } catch (error) {
        if (valid()) setState((value) => ({ ...value, error, pending: null }));
      } finally {
        if (id === requestId.current) inFlight.current = null;
      }
    },
    [activeCategory, generation, initialCategory, rateLimited],
  );

  useEffect(() => {
    const value = stateRef.current;
    if (
      value.generation !== generation ||
      value.mode !== "office" ||
      value.error
    )
      void request();
    return () => {
      ++requestId.current;
      inFlight.current?.abort();
      inFlight.current = null;
    };
  }, [request, generation]);

  // A category deep link is selected only after the discovery response authorizes that filter.
  useEffect(() => {
    if (
      current.mode === "gate" &&
      current.category !== activeCategory &&
      !inFlight.current
    )
      void request();
  }, [current.mode, current.category, activeCategory, request]);

  useEffect(() => {
    if (rateLimited) return;
    let stopped = false;
    let polling = false;
    let cursor = 0;
    const scope = captureAuthScope();
    const poll = async () => {
      if (polling) return;
      polling = true;
      try {
        const result = await apiFetch<{ currentSeq: number; changed: boolean }>(
          `/api/notifications/events?transport=poll&after=${cursor}`,
        );
        if (stopped || !isAuthScopeCurrent(scope)) return;
        cursor = result.currentSeq;
        if (result.changed && !inFlight.current) await request("refresh");
      } catch {
        /* Next poll / pull-to-refresh retries a transient live-sync failure. */
      } finally {
        polling = false;
      }
    };
    void poll();
    const timer = setInterval(() => void poll(), 5000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [request, generation, rateLimited]);

  const selectCategory = (category: string) => {
    if (category === activeCategory || !current.categories.includes(category))
      return;
    ++requestId.current;
    inFlight.current?.abort();
    inFlight.current = null;
    setSelection({ generation, category, routeCategory: initialCategory });
  };
  const setItems = (update: (rows: NotificationRow[]) => NotificationRow[]) => {
    if (authGeneration() !== generation) return;
    setState((value) =>
      value.generation === generation
        ? { ...value, items: update(value.items) }
        : value,
    );
  };
  return {
    generation,
    activeCategory,
    selectCategory,
    categories: current.categories,
    isGate: current.mode === "gate",
    items: pageMatches ? current.items : [],
    setItems,
    loading: !pageMatches || current.pending === "first",
    refreshing: current.pending === "refresh",
    loadingMore: current.pending === "more",
    loadError: pageMatches ? current.error : null,
    rateLimited,
    retryAfterSeconds,
    refresh: () => request("refresh"),
    loadMore: () => request("more"),
    retry: () =>
      request(current.items.length && current.nextCursor ? "more" : "first"),
  };
}
