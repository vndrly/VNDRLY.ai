import {beforeEach,describe,expect,it,vi} from 'vitest';

const fixtures=vi.hoisted(()=>({
  authority:vi.fn(async()=>({owner:{type:'vendor',id:7}})),
  required:vi.fn(async()=>({provisional:false,services:[],items:new Map(),requirements:[]})),
  catalog:{curriculum:[],additional:{courses:[]},catalog:{services:[{id:'VMS-SEISMIC',name:'Seismic acquisition',deliveryMode:'site',roleRuleIds:['survey'],conditionalRuleIds:['driving'],sourceUrls:['https://example.invalid/source'],scopeNotes:[],gapTopicIds:[]}],roleRules:{survey:{role:'Field survey crew',familyIds:['H01'],rationale:'Direct survey knowledge.'}},conditionalRules:{driving:{roles:['Assigned drivers','Loaders'],familyIds:['H19','H20','E03'],trigger:'Only actual driving, delivery or loading duties.',rationale:'Desk support is not driving.'}},gapTopics:{}}},
}));
vi.mock('@workspace/db',()=>({db:{}}));
vi.mock('../work-hub/library-core',()=>({libraryAuthority:fixtures.authority}));
vi.mock('./company-required-training',()=>({trainingCatalog:fixtures.catalog,companyRequiredTraining:fixtures.required}));
import {safetyTrainingCatalogView}from'./safety-training-catalog-view';

beforeEach(()=>vi.clearAllMocks());
describe('catalog conditional course connections',()=>{
  it('includes an H19 connection supplied only by a reviewed conditional rule and preserves its trigger',async()=>{
    const view=await safetyTrainingCatalogView({userId:1,role:'vendor',vendorId:7} as never,{familyId:'H19'});
    expect(view.total).toBe(1);
    expect(view.services[0].roleMappings).toEqual([expect.objectContaining({role:'Assigned drivers; Loaders',familyIds:['H19','H20','E03'],conditional:true,scopeMustBeConfirmed:true,trigger:'Only actual driving, delivery or loading duties.',rationale:'Desk support is not driving.'})]);
    expect(view.courses).toEqual([]);
    expect(fixtures.required).toHaveBeenCalledTimes(1);
    // Projection does not feed a conditional family into baseline allocation.
    expect(fixtures.required).toHaveBeenCalledWith({}, {type:'vendor',id:7});
  });
  it('retains direct rules and excludes unrelated family filters',async()=>{
    const direct=await safetyTrainingCatalogView({userId:1} as never,{familyId:'H01'});
    expect(direct.services[0].roleMappings).toEqual([fixtures.catalog.catalog.roleRules.survey]);
    expect((await safetyTrainingCatalogView({userId:1} as never,{familyId:'H15'})).total).toBe(0);
  });
});
