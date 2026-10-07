import { InventoryManagement } from "./asset-management";
import { InventoryCustody } from "./asset-custody";
import { InventoryRegistration } from "./asset-registration";
import { InventoryRecovery, InventoryIdentifierQueue } from "./asset-recovery";
import { InventoryTransfer } from "./asset-transfer";
import { useAuth } from "@/hooks/use-auth";
import { InventoryHoldRelease, type InventoryHold } from "./asset-hold-release";
import { useQuery } from "@tanstack/react-query";
import { implementationARequest } from "./client";
import { EmptyState, ImplementationSurface } from "./surface";
type Asset = {
  version: number;
  holds?: InventoryHold[];
  id: string;
  name: string;
  category: string;
  status: string;
  condition?: string | null;
  currentLocation?: string | null;
  hold?: string | null;
  holderUserId?: number | null;
  capabilities?: { canTransfer?: boolean; canCheckOut?: boolean; canReturn?: boolean; canVerifyIssued?: boolean };
  policy?: { photosRequiredOnCheckout: boolean; photosRequiredOnReturn: boolean; expectedReturnRequired: boolean };
};
type AssetCapabilities = {
  canCheckOutAsset: boolean;
  canVerifyIssuedAsset: boolean;
  canManageAsset: boolean;
};
export function Assets() {
  const { user } = useAuth();
  const identity = JSON.stringify([
    user?.userId,
    user?.role,
    user?.vendorRole,
    user?.activeMembershipId,
    user?.vendorId,
    user?.partnerId,
  ]);
  const query = useQuery<{ assets: Asset[]; capabilities: AssetCapabilities }>({
    queryKey: ["implementation-a", "assets", identity],
    queryFn: () => implementationARequest("/assets"),
  });
  const owner = user?.partnerId ? { type: "partner" as const, id: user.partnerId } : user?.vendorId ? { type: "vendor" as const, id: user.vendorId } : null;
  const refreshed=async()=>{const r=await query.refetch();if(r.isError)throw Error("Refresh failed")};
  return (
    <ImplementationSurface
      module="assets"
      title="Inventory"
      description="Asset identity, custody, condition, and evidence history."
    >
      {owner && <InventoryRegistration key={identity+"register"} owner={owner} identity={identity} canManage={!query.isError && query.data?.capabilities.canManageAsset===true} onSaved={refreshed} />}
      {user?.role === "admin" && (
        <InventoryIdentifierQueue key={identity} identity={identity} />
      )}
      {!query.isError && query.data?.assets?.length ? (
        <ul className="grid gap-3">
          {query.data.assets.map((asset) => (
            <li key={asset.id} className="rounded-lg border p-4">
              <strong>{asset.name}</strong>
              <p className="text-sm text-muted-foreground">
                {[asset.category, asset.status, asset.condition]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
              {asset.currentLocation ? (
                <p className="text-sm text-muted-foreground">
                  {asset.currentLocation}
                </p>
              ) : null}
              {asset.holderUserId ? (
                <p className="text-sm text-muted-foreground">
                  Held by user {asset.holderUserId}
                </p>
              ) : null}
              {asset.holds?.length ? (
                <InventoryHoldRelease
                  key={identity + asset.id}
                  actorIdentity={identity}
                  assetId={asset.id}
                  version={asset.version}
                  holds={asset.holds}
                  onSaved={() => query.refetch()}
                />
              ) : null}
              {user?.userId && <InventoryCustody key={identity+asset.id+"custody"} asset={{...asset,holderUserId:asset.holderUserId??null}} userId={user.userId} identity={identity} onSaved={refreshed} />}
              {owner && user?.userId && <InventoryManagement key={identity+asset.id+"management"} owner={owner} identity={identity} userId={user.userId} asset={asset} assets={query.data.assets} canManage={query.data.capabilities.canManageAsset} onSaved={refreshed} />}
              {owner && <InventoryRegistration key={identity+asset.id+"alias"} owner={owner} identity={identity} assetId={asset.id} version={asset.version} canManage={query.data.capabilities.canManageAsset} onSaved={refreshed} />}
              {user?.userId && (
                <InventoryTransfer key={identity + asset.id + "transfer"} assetId={asset.id} assetName={asset.name} userId={user.userId} identity={identity} canTransfer={asset.capabilities?.canTransfer === true} onSaved={async () => { const value = await query.refetch(); if (value.isError) throw new Error("Refresh failed"); }} />
              )}
              {user?.userId && (
                <InventoryRecovery
                  key={identity + asset.id + "recovery"}
                  assetId={asset.id}
                  identity={identity}
                  userId={user.userId}
                  canManage={query.data.capabilities.canManageAsset}
                  onSaved={() => query.refetch()}
                />
              )}
              {asset.hold ? (
                <p className="text-sm text-muted-foreground">
                  Hold: {asset.hold}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState>No inventory items yet.</EmptyState>
      )}
    </ImplementationSurface>
  );
}
