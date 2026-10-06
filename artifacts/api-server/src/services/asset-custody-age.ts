import type { AssetRecord } from "./assets";

/** Continuous time out of storage, rather than time with only the latest holder. */
export function custodyAge(asset: Pick<AssetRecord, "holderUserId" | "history">, now = new Date()): { checkedOutAt: Date | null; custodyDays: number | null } {
  const unknown = { checkedOutAt: null, custodyDays: null };
  if (asset.holderUserId === null) return unknown;
  const custodyEvents = asset.history.filter(event => ["checkout", "return", "transfer"].includes(event.type));
  if (custodyEvents.some(event => { const time = new Date(event.occurredAt).getTime(); return !Number.isFinite(time) || time > now.getTime(); })) return unknown;
  let holder = asset.holderUserId;
  const history = [...asset.history].sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime());
  for (const event of history) {
    if (event.type === "return") return unknown;
    if (event.type === "transfer") {
      if (event.toHolderUserId !== holder || event.fromHolderUserId == null) return unknown;
      holder = event.fromHolderUserId;
    }
    if (event.type === "checkout") {
      const checkedOutAt = new Date(event.occurredAt);
      const elapsed = now.getTime() - checkedOutAt.getTime();
      if (event.toHolderUserId !== holder || !Number.isFinite(elapsed) || elapsed < 0) return unknown;
      return { checkedOutAt, custodyDays: Math.floor(elapsed / 86_400_000) };
    }
  }
  return unknown;
}
