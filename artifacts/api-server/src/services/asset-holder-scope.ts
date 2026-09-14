import type { AssetOwner } from "./assets";

export interface AssetHolderMembership {
  orgType: string;
  vendorId: number | null;
  partnerId: number | null;
}

export interface AssetHolderSponsorship {
  sponsorVendorId: number;
  status: string;
}

export function isAssetHolderInScope(
  owner: AssetOwner,
  memberships: readonly AssetHolderMembership[],
  sponsorships: readonly AssetHolderSponsorship[],
): boolean {
  const directMember = memberships.some((membership) =>
    owner.type === "vendor"
      ? membership.orgType === "vendor" && membership.vendorId === owner.id
      : membership.orgType === "partner" && membership.partnerId === owner.id,
  );
  if (directMember) return true;
  return (
    owner.type === "vendor" &&
    sponsorships.some(
      (sponsorship) =>
        sponsorship.sponsorVendorId === owner.id &&
        sponsorship.status === "active",
    )
  );
}
