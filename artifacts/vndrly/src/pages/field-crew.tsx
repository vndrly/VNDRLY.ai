import { useCallback, useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useTranslation } from "react-i18next";
import { ArrowLeft, UserPlus, UserMinus } from "lucide-react";
import { cn } from "@/lib/utils";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface NotificationRow {
  id: number;
  type: "crew_added" | "crew_removed" | string;
  category: string;
  title: string;
  body: string | null;
  link: string | null;
  isRead: boolean;
  createdAt: string;
}

const PAGE_SIZE = 25;
const TYPES_QUERY = "crew_added,crew_removed";

function ticketIdFromLink(link: string | null): number | null {
  if (!link) return null;
  const m = link.match(/^\/tickets\/(\d+)/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export default function FieldCrew() {
  const { t } = useTranslation();
  const [, navigate] = useLocation();
  const [items, setItems] = useState<NotificationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [errored, setErrored] = useState(false);

  function timeAgo(iso: string): string {
    const tt = new Date(iso).getTime();
    const s = Math.floor((Date.now() - tt) / 1000);
    if (s < 60) return t("notifications.ago.second", { n: s });
    const m = Math.floor(s / 60);
    if (m < 60) return t("notifications.ago.minute", { n: m });
    const h = Math.floor(m / 60);
    if (h < 24) return t("notifications.ago.hour", { n: h });
    const d = Math.floor(h / 24);
    return t("notifications.ago.day", { n: d });
  }

  const loadFirstPage = useCallback(async () => {
    try {
      setErrored(false);
      const r = await fetch(`${BASE}/api/notifications?type=${TYPES_QUERY}&limit=${PAGE_SIZE}`, {
        credentials: "include",
      });
      if (!r.ok) throw new Error(String(r.status));
      const rows = ((await r.json()) as NotificationRow[]) ?? [];
      setItems(rows);
      setHasMore(rows.length === PAGE_SIZE);
    } catch {
      setErrored(true);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore || items.length === 0) return;
    setLoadingMore(true);
    try {
      const cursor = items[items.length - 1].createdAt;
      const r = await fetch(
        `${BASE}/api/notifications?type=${TYPES_QUERY}&limit=${PAGE_SIZE}&before=${encodeURIComponent(cursor)}`,
        { credentials: "include" },
      );
      if (!r.ok) throw new Error(String(r.status));
      const rows = ((await r.json()) as NotificationRow[]) ?? [];
      setItems((prev) => {
        const seen = new Set(prev.map((x) => x.id));
        return [...prev, ...rows.filter((x) => !seen.has(x.id))];
      });
      setHasMore(rows.length === PAGE_SIZE);
    } catch {
      setHasMore(false);
    } finally {
      setLoadingMore(false);
    }
  }, [items, loadingMore, hasMore]);

  useEffect(() => {
    void loadFirstPage();
  }, [loadFirstPage]);

  const markRead = async (id: number) => {
    try {
      await fetch(`${BASE}/api/notifications/${id}/read`, { method: "POST", credentials: "include" });
      setItems((xs) => xs.map((x) => (x.id === id ? { ...x, isRead: true } : x)));
    } catch {}
  };

  const onCardPress = (item: NotificationRow) => {
    if (!item.isRead) void markRead(item.id);
    const ticketId = ticketIdFromLink(item.link);
    if (ticketId !== null) {
      navigate(`/tickets/${ticketId}`);
      return;
    }
    if (item.link === "/tickets") {
      navigate("/field");
    }
  };

  return (
    <div className="px-4 pt-4 pb-6 max-w-2xl mx-auto w-full" data-testid="field-crew">
      <div className="flex items-center gap-2 mb-4">
        <button
          type="button"
          onClick={() => navigate("/field/profile")}
          className="p-2 -ml-2 rounded-md hover:bg-muted"
          aria-label={t("common.back")}
          data-testid="crew-changes-back"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="text-xl font-bold">{t("crewChanges.title")}</h1>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-[color:var(--brand-primary)]" />
        </div>
      ) : items.length === 0 ? (
        <p className="text-center text-sm text-muted-foreground py-12">
          {errored ? t("crewChanges.loadFailed") : t("crewChanges.empty")}
        </p>
      ) : (
        <ul className="space-y-2.5">
          {items.map((item) => {
            const Icon = item.type === "crew_added" ? UserPlus : item.type === "crew_removed" ? UserMinus : null;
            const labelKey =
              item.type === "crew_added"
                ? "notifications.types.crew_added"
                : item.type === "crew_removed"
                  ? "notifications.types.crew_removed"
                  : null;
            const labelText = labelKey ? t(labelKey) : item.category.toUpperCase();
            return (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => onCardPress(item)}
                  className={cn(
                    "w-full text-left rounded-xl border-2 bg-card p-3 transition-colors",
                    item.isRead ? "border-border" : "border-[color:var(--brand-primary)]",
                  )}
                  data-testid={`crew-change-${item.id}`}
                >
                  <div className="flex items-center gap-2 mb-1.5">
                    <span
                      className={cn(
                        "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider",
                        item.isRead ? "bg-muted text-muted-foreground" : "bg-[color:var(--brand-primary)] text-white",
                      )}
                      data-testid={`crew-change-${item.id}-type-${item.type}`}
                    >
                      {Icon ? <Icon className="w-3 h-3" /> : null}
                      {labelText}
                    </span>
                    <span className="ml-auto text-[11px] text-muted-foreground">{timeAgo(item.createdAt)}</span>
                  </div>
                  <p
                    className={cn(
                      "text-sm font-bold",
                      item.isRead ? "text-muted-foreground" : "text-[color:var(--brand-primary)]",
                    )}
                  >
                    {item.title}
                  </p>
                  {item.body ? <p className="text-sm text-foreground mt-0.5">{item.body}</p> : null}
                </button>
              </li>
            );
          })}
          {hasMore ? (
            <li className="pt-2">
              <button
                type="button"
                onClick={() => void loadMore()}
                disabled={loadingMore}
                className="w-full py-2 text-sm text-muted-foreground hover:text-foreground"
                data-testid="crew-changes-load-more"
              >
                {loadingMore ? t("common.loading") : t("crewChanges.loadMore")}
              </button>
            </li>
          ) : null}
        </ul>
      )}
    </div>
  );
}
