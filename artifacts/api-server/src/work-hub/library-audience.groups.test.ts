import {beforeEach,expect,it,vi} from 'vitest';
const state=vi.hoisted(()=>({sources:[] as string[],groups:[] as unknown[],people:[] as unknown[],members:[] as unknown[]}));
vi.mock('@workspace/db',()=>{
 const table=(name:string)=>({name,id:`${name}.id`,nameColumn:`${name}.name`,ownerOrgType:'ownerType',ownerOrgId:'ownerId',status:'status'});
 const db={select:()=>{
  let source='';
  const result=()=>source==='groups'?state.groups:source==='memberships'?state.people:source==='groupMembers'?state.members:[];
  const query:any={from:(t:any)=>{source=t.name;state.sources.push(source);return query;},innerJoin:()=>query,where:()=>query,limit:()=>query,for:()=>Promise.resolve(result()),then:(ok:any,bad:any)=>Promise.resolve(result()).then(ok,bad)};
  return query;
 }};
 return {db,usersTable:table('users'),userOrgMembershipsTable:table('memberships'),workHubCrewsTable:table('groups'),workHubCrewMembersTable:table('groupMembers'),workHubFilesTable:table('files')};
});
vi.mock('./library-core',()=>({libraryAuthority:vi.fn(async()=>({owner:{type:'vendor',id:1115}})),LibraryError:class extends Error{constructor(message:string,public status:number){super(message);}}}));
import {db} from '@workspace/db';
import {libraryOptions,expandLibraryAudience} from './library-audience';
const groupId='11111111-1111-4111-8111-111111111111';
const actor:any={userId:1142};
beforeEach(()=>{state.sources=[];state.groups=[];state.people=[];state.members=[];});
it('returns no groups when no defined Groups exist, without reading channels or work-crew presets',async()=>{
 expect((await libraryOptions(actor)).groups.map(group=>group.name)).toEqual(['Admin','All Hands','Office Staff','Gatekeepers']);
 expect(state.sources).toEqual(['groups','memberships','files']);
});
it('expands defined Group members only within eligible company staff',async()=>{
 state.groups=[{id:groupId,name:'Gatekeepers'}];
 state.people=[{userId:1145},{userId:1146}];
 state.members=[{userId:1145},{userId:9999}];
 const result=await expandLibraryAudience(db as any,actor,{mode:'selected',userIds:[],groupIds:[groupId]});
 expect(result.people).toEqual([{userId:1145}]);
 expect(result.excluded).toEqual([9999]);
 expect(state.sources).toEqual(['memberships','groups','groupMembers']);
});
