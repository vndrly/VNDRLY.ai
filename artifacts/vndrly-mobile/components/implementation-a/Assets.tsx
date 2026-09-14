import React from "react";
import { View } from "react-native";
import { EmptyState, ImplementationASurface, RecordCard } from "./Surface";

type Asset = { id: string; name: string; category: string; status: string; currentHolderDisplayName?: string | null };
export function Assets({ assets = [] }: { assets?: Asset[] }) {
  return <ImplementationASurface description="Asset identity, custody, condition, and evidence history. Camera, scanner, and Ask V checkout are available when supported.">
    {assets.length ? <View style={{ gap: 10 }}>{assets.map((asset) => <RecordCard key={asset.id} title={asset.name} detail={`${asset.category} · ${asset.status}`} extra={asset.currentHolderDisplayName ? `Held by ${asset.currentHolderDisplayName}` : undefined} />)}</View> : <EmptyState>No inventory items yet. Ask V can create a provisional item during checkout.</EmptyState>}
  </ImplementationASurface>;
}
