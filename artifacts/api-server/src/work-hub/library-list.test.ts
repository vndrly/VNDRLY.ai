import {beforeEach,it,expect,vi} from 'vitest';
const state=vi.hoisted(()=>({rows:[] as any[],role:'admin'}));
vi.mock('@workspace/db',()=>({db:{select:()=>({from:()=>({where:()=>({orderBy:()=>({limit:async()=>state.rows})})})})},workHubFormTemplatesTable:{ownerOrgType:'type',ownerOrgId:'owner',campaignConfig:'campaign',createdAt:'created',id:'id',name:'name',currentVersion:'version',libraryMetadata:'metadata'},workHubFilesTable:{}}));
vi.mock('./library-core',()=>({libraryAuthority:async()=>({owner:{type:'vendor',id:1},member:{role:state.role}}),libraryRecord:vi.fn(),libraryCommand:vi.fn(),checkLibraryVersion:vi.fn(),LibraryError:class extends Error{}}));
vi.mock('../lib/company-required-training',()=>({selectedTrainingServices:vi.fn(),trainingCatalog:{},additionalTrainingApplies:vi.fn()}));
vi.mock('../lib/objectStore',()=>({getObjectStore:vi.fn()}));
vi.mock('./stored-training-projections',()=>({storedTrainingProjection:async()=>state.rows}));
import {listLibrary} from './library-service';
const series='11111111-1111-4111-8111-111111111111';
const row=(id:string,state='published',version=1)=>({id,name:id,currentVersion:version,libraryMetadata:{kind:'training',seriesId:series,contentVersion:version,version:0,state}});
beforeEach(()=>{state.role='admin';state.rows=[];});
it('filters certificate summaries after company scoping without including courses or legacy forms',async()=>{
 const bundle=row('certificate');bundle.libraryMetadata.kind='bundle';
 state.rows=[row('course'),bundle,{id:'legacy',name:'legacy',currentVersion:1,libraryMetadata:null}];
 expect((await listLibrary({} as any,false,false,false,true)).items.map(i=>i.itemId)).toEqual(['certificate']);
});
it('lists summary-only training without loading lesson content and suppresses older revisions',async()=>{
 state.rows=[row('current','published',2),row('old')];
 const result=await listLibrary({} as any);
 expect(result.items.map(i=>i.itemId)).toEqual(['current']);
 expect(result.items[0].contentVersion).toBe(2);
 expect(JSON.stringify(result)).not.toContain('questions');
});
it('keeps member visibility and archived-series behavior with compact metadata',async()=>{
 state.role='member';state.rows=[row('draft','draft',3),row('current','published',2)];
 expect((await listLibrary({} as any)).items.map(i=>i.itemId)).toEqual(['current']);
 state.role='admin';state.rows=[row('archived','archived',3),row('old','published',2)];
 expect((await listLibrary({} as any)).items).toEqual([]);
 expect((await listLibrary({} as any,true)).items.map(i=>i.itemId)).toEqual(['archived']);
});
