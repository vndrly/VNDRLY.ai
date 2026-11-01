import {expect,it} from 'vitest';
import {automaticAudienceMembers} from './automatic-library-audiences';
it('resolves the four audiences from current company membership and active staff roles',()=>{
 const people=[{userId:1,role:'admin',vendorPeopleId:11},{userId:2,role:'member',vendorPeopleId:12},{userId:3,role:'member',vendorPeopleId:13},{userId:4,role:'member',vendorPeopleId:14}];
 const staff=[{id:11,userId:1,vendorRole:'office',roles:[]},{id:12,userId:2,vendorRole:'office',roles:[]},{id:13,userId:3,vendorRole:'gate_supervisor',roles:['gatekeeper']}];
 expect(automaticAudienceMembers('audience:admin',people,staff)).toEqual([1]);
 expect(automaticAudienceMembers('audience:all-hands',people,staff)).toEqual([1,2,3]);
 expect(automaticAudienceMembers('audience:office-staff',people,staff)).toEqual([1,2]);
 expect(automaticAudienceMembers('audience:gatekeepers',people,staff)).toEqual([3]);
 expect(()=>automaticAudienceMembers('audience:unknown',people,staff)).toThrow();
});
