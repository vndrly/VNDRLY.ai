import { useEffect, useState } from "react";
import { workHubItemDestination } from "@workspace/api-client-react/work-hub-destinations";

export function WorkHubExactItem({ subjectType, itemId }: { subjectType: string; itemId: string }) {
  const [state, setState] = useState<{ key: string; item?: Record<string, unknown>; error?: string } | null>(null);
  const key = `${subjectType}:${itemId}`;
  useEffect(() => {
    const controller = new AbortController();
    const destination = workHubItemDestination(subjectType, itemId);
    if (!destination) { setState({ key, error: "This item is unavailable." }); return; }
    void fetch(`/api${destination.readPath}`, { credentials: "include", cache: "no-store", signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error("This item is unavailable or your access has changed.");
        const item = await response.json();
        if (!controller.signal.aborted) setState({ key, item });
      }).catch(() => { if (!controller.signal.aborted) setState({ key, error: "This item is unavailable or your access has changed." }); });
    return () => controller.abort();
  }, [key, subjectType, itemId]);
  if (state?.key !== key) return <p role="status">Loading record…</p>;
  if (state.error) return <p role="alert">{state.error}</p>;
  const item = state.item ?? {};
  return <article className="rounded-lg border p-4 space-y-3">
    <h2 className="font-semibold">{String(item.title ?? item.name ?? "Record")}</h2>
    {typeof item.body === "string" && <p className="whitespace-pre-wrap">{item.body}</p>}
    {typeof item.status === "string" && <p>{item.status}</p>}
    {subjectType === "asset" && <dl>{["category", "legalOwner", "condition", "holderUserId", "version"].map(field => item[field] != null ? <div key={field}><dt>{field}</dt><dd>{String(item[field])}</dd></div> : null)}</dl>}
  </article>;
}
