import {expect,it,vi} from 'vitest';
import {AssetServiceError} from './assets';
import {assetHolderDisplayName} from './asset-holder-name';
it('never reads a foreign or revoked holder name',async()=>{
 const read=vi.fn().mockResolvedValue('Foreign Person');
 const deny=vi.fn().mockRejectedValue(new AssetServiceError('asset.transfer_recipient_not_found',404));
 expect(await assetHolderDisplayName({type:'vendor',id:7},12,deny,read)).toBe('User 12');expect(read).not.toHaveBeenCalled();
});
it('returns only an authorized display name and preserves unknown holders',async()=>{
 const check=vi.fn().mockResolvedValue(undefined),read=vi.fn().mockResolvedValue(' Joe Smith ');
 expect(await assetHolderDisplayName({type:'vendor',id:7},12,check,read)).toBe('Joe Smith');
 expect(check).toHaveBeenCalledWith({type:'vendor',id:7},12);
 read.mockResolvedValue('');expect(await assetHolderDisplayName({type:'vendor',id:7},12,check,read)).toBe('User 12');
 read.mockClear();expect(await assetHolderDisplayName({type:'partner',id:8},null,check,read)).toBeNull();expect(read).not.toHaveBeenCalled();
});
it('does not hide a database failure as an unknown person',async()=>{
 await expect(assetHolderDisplayName({type:'vendor',id:7},12,async()=>{throw Error('database unavailable')},async()=>null)).rejects.toThrow('database unavailable');
});

