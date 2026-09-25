import React from "react";
import { View } from "react-native";
import { EmptyState, ImplementationASurface, RecordCard } from "./Surface";

type Asset = { id: string; name: string; category: string; status: string; condition?: string | null; currentLocation?: string | null; hold?: string | null; holderUserId?: number | null; currentHolderDisplayName?: string | null };
export function Assets({ assets = [] }: { assets?: Asset[] }) {
  return <ImplementationASurface description="Asset identity, custody, condition, and evidence history. Camera, scanner, and Ask V checkout are available when supported.">
    {assets.length ? <View style={{ gap: 10 }}>{assets.map((asset) => <RecordCard key={asset.id} title={asset.name} detail={[asset.category, asset.status, asset.condition].filter(Boolean).join(" · ")} extra={[asset.currentHolderDisplayName ? `Held by ${asset.currentHolderDisplayName}` : asset.holderUserId ? `Held by user ${asset.holderUserId}` : null, asset.currentLocation, asset.hold ? `Hold: ${asset.hold}` : null].filter(Boolean).join(" · ")} />)}</View> : <EmptyState>No inventory items yet.</EmptyState>}
  </ImplementationASurface>;
}
