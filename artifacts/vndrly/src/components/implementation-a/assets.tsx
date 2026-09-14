import { useQuery } from "@tanstack/react-query";
import { implementationARequest } from "./client";
import { EmptyState, ImplementationSurface } from "./surface";
type Asset = { id: string; name: string; category: string; status: string; currentHolderUserId?: number | null };
export function Assets() { const query = useQuery<{ assets: Asset[] }>({ queryKey: ["implementation-a", "assets"], queryFn: () => implementationARequest("/assets") }); return <ImplementationSurface module="assets" title="Inventory" description="Asset identity, custody, condition, and evidence history.">{query.data?.assets?.length ? <ul className="grid gap-3">{query.data.assets.map(asset => <li key={asset.id} className="rounded-lg border p-4"><strong>{asset.name}</strong><p className="text-sm text-muted-foreground">{asset.category} · {asset.status}</p></li>)}</ul> : <EmptyState>No inventory items yet. Ask V can create a provisional item during checkout.</EmptyState>}</ImplementationSurface>; }
