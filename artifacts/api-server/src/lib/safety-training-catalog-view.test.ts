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
import {safetyTrainingCatalog}from'../data/safety-training-catalog';

beforeEach(()=>vi.clearAllMocks());
describe('catalog conditional course connections',()=>{
  it('finds real catalog entries by common field terms',async()=>{
    const original={...fixtures.catalog};
    Object.assign(fixtures.catalog,safetyTrainingCatalog);
    try {
      for(const [search,id] of [['visitor check in','VMS-5D2D3CEB7A'],['H₂S','h2s_monitoring_safety_trailer'],['sour gas','h2s_monitoring_safety_trailer'],['3D seismic','VMS-A1652B8D16']]){
        const view=await safetyTrainingCatalogView({userId:1} as never,{search,allServices:true});
        expect([...view.services,...view.extensions].map(service=>service.id)).toContain(id);
      }
    } finally {
      for(const key of Object.keys(fixtures.catalog)) if(!Object.hasOwn(original,key)) Reflect.deleteProperty(fixtures.catalog,key);
      Object.assign(fixtures.catalog,original);
    }
  });
  it('finds the mapped master service by reviewed service name or description',async()=>{
    const catalog=fixtures.catalog as typeof fixtures.catalog&{legacy?:{entries:unknown[]}};
    catalog.legacy={entries:[{name:'Gatekeeping',code:'gatekeeping',canonicalDefinition:'Staffed entrance control',masterServiceIds:['VMS-SEISMIC']}]};
    try {
      for(const search of ['gate','Gatekeeping','entrance control']){
        const view=await safetyTrainingCatalogView({userId:1} as never,{search,familyId:'H01'});
        expect(view.services.map(service=>service.id)).toEqual(['VMS-SEISMIC']);
        expect(view.services[0].roleMappings).toEqual([fixtures.catalog.catalog.roleRules.survey]);
      }
    } finally { delete catalog.legacy; }
  });
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
  it('shows exact remaining evidence and only the current company course link',async()=>{
    const catalog=fixtures.catalog as typeof fixtures.catalog&{residuals?:{groups:unknown[]}};
    catalog.residuals={groups:[{groupId:'G13',title:'Seismic source preparation',courseId:'G62',role:'Actual shot-firing personnel only',serviceIds:['VMS-SEISMIC'],vendorEvidenceRequired:['Approved source method and assigned role.'],practicalAssessmentRequired:['Observed source-specific capability by a qualified assessor.'],scopeConfirmation:'Confirm whether explosives are actually used.',sourceUrls:[]}]};
    fixtures.required.mockResolvedValueOnce({provisional:true,services:[],items:new Map([['G62',{record:{id:'company-owned-course'}}]]),requirements:[]} as never);
    const view=await safetyTrainingCatalogView({userId:1} as never,{});
    expect(view.services[0].residualRequirements).toEqual([expect.objectContaining({courseId:'G62',trainingItemId:'company-owned-course',vendorEvidenceRequired:['Approved source method and assigned role.']})]);
    const noPublished=await safetyTrainingCatalogView({userId:1} as never,{});
    expect(noPublished.services[0].residualRequirements[0].trainingItemId).toBeNull();
    expect(noPublished.vendorExtrasCountTowardScore).toBe(false);
    delete catalog.residuals;
  });
  it('projects only the service-specific scope questions rather than every unresolved method',async()=>{
    const catalog=fixtures.catalog as typeof fixtures.catalog&{residuals?:{groups:unknown[]}};
    catalog.residuals={groups:[{groupId:'TG45',title:'Actual method unresolved',courseId:null,role:'Assigned source operator',serviceIds:['VMS-SEISMIC'],vendorEvidenceRequired:['Generic unresolved scope'],practicalAssessmentRequired:['Generic conditional evaluation'],scopeConfirmation:'Generic scope',sourceUrls:[],serviceEvidence:[{serviceId:'VMS-SEISMIC',sourceContext:'Confirm the actual acquisition source.',vendorEvidenceRequired:['Identify whether explosives are used.'],practicalAssessmentRequired:['Evaluate only confirmed source duties.']},{serviceId:'OTHER',sourceContext:'Unrelated mode',vendorEvidenceRequired:['Unrelated passenger credential'],practicalAssessmentRequired:[]}]}]};
    const view=await safetyTrainingCatalogView({userId:1} as never,{}),gap=view.services[0].residualRequirements[0];
    expect(gap.vendorEvidenceRequired).toEqual(['Identify whether explosives are used.']);
    expect(gap.scopeConfirmation).toBe('Confirm the actual acquisition source.');
    expect(gap).not.toHaveProperty('serviceEvidence');
    expect(gap.trainingItemId).toBeNull();
    delete catalog.residuals;
  });
});

