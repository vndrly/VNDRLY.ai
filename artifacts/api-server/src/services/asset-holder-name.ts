import {AssetServiceError,type AssetOwner} from './assets';
/** Resolve only after proving current membership/sponsorship in the asset's owner company. */
export async function assetHolderDisplayName(owner:AssetOwner,userId:number|null,assertInScope:(owner:AssetOwner,userId:number)=>Promise<void>,readName:(userId:number)=>Promise<string|null>){
 if(userId===null)return null;
 const fallback=`User ${userId}`;
 try{await assertInScope(owner,userId);}catch(error){if(error instanceof AssetServiceError&&error.code==='asset.transfer_recipient_not_found')return fallback;throw error;}
 const name=await readName(userId);return name?.trim()||fallback;
}

