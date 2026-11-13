/** Common oil-and-gas credential/qualification types, not a statistical ranking.
 * Record the issuing body's actual scope and dates; selection grants no credit.
 * Sources and selection rationale: docs/external-certification-catalog.md.
 */
export type ExternalCredential = { name: string; fields: string[]; source: string; nonExpiring?: boolean };
const api = 'https://www.api.org/products-and-services/individual-certification-programs';
const osha = 'https://www.osha.gov/training/outreach/faq';
const opito = 'https://opito.com/for-learners-opito';
const cco = 'https://www.nccco.org/nccco/certification-programs';
const well = ['Level / role', 'Surface / subsea scope', 'Training center'];
export const EXTERNAL_CERTIFICATION_CATALOG: ExternalCredential[] = [
  {name:'PEC / Veriforce Basic Orientation (SafeLandUSA)',fields:['Course version','Training provider','Onshore / offshore modules'],source:'https://veriforce.com/course/basic-orientation',nonExpiring:true},
  {name:'PEC / Veriforce SafeGulf',fields:['Course version','Training provider','Offshore module'],source:'https://veriforce.com/course/basic-orientation',nonExpiring:true},
  {name:'Veriforce H2S Clear',fields:['Training provider','Practical assessment scope'],source:'https://veriforce.com/course/h2s-clear'},
  {name:'IADC RigPass',fields:['Training provider','Onshore / offshore endorsement'],source:'https://iadc.org/accreditation/rigpass/'},
  {name:'IADC WellSharp Drilling',fields:well,source:'https://iadc.org/accreditation/wellsharp/'},
  {name:'IADC WellSharp Well Servicing',fields:['Service discipline','Level / role','Training center'],source:'https://iadc.org/accreditation/wellsharp/'},
  {name:'IWCF Drilling Well Control',fields:well,source:'https://www.iwcf.org/programmes/'},
  {name:'IWCF Well Intervention Pressure Control',fields:['Level','Wireline / coiled tubing / snubbing scope','Training center'],source:'https://www.iwcf.org/programmes/well-intervention-pressure-control-programme/'},
  ...['10-Hour General Industry','30-Hour General Industry','10-Hour Construction','30-Hour Construction'].map(scope=>({name:`OSHA Outreach ${scope}`,fields:['Authorized trainer / provider','Course completion date'],source:osha,nonExpiring:true})),
  {name:'HAZWOPER 40-Hour',fields:['Provider','Supervised field experience','Latest refresher date'],source:'https://www.osha.gov/emergency-preparedness/hazardous-waste-operations/preparedness'},
  {name:'HAZWOPER 24-Hour',fields:['Provider','Supervised field experience','Latest refresher date'],source:'https://www.osha.gov/emergency-preparedness/hazardous-waste-operations/preparedness'},
  {name:'HAZWOPER Annual Refresher',fields:['Provider','Underlying qualification','Refresher completion date'],source:'https://www.osha.gov/emergency-preparedness/hazardous-waste-operations/preparedness'},
  {name:'First Aid / CPR / AED',fields:['Provider','Adult / pediatric scope','Hands-on assessment date'],source:'https://www.redcross.org/take-a-class/first-aid'},
  {name:'Confined Space Entry Qualification',fields:['Entrant / attendant / supervisor','Employer / evaluator','Practical scope'],source:'https://www.osha.gov/confined-spaces'},
  {name:'Confined Space Rescue Qualification',fields:['Rescue team / employer','Rescue techniques','Last practical drill'],source:'https://www.osha.gov/confined-spaces'},
  {name:'Lockout / Tagout Authorized Employee',fields:['Employer','Equipment / procedures','Evaluation date'],source:'https://www.osha.gov/control-hazardous-energy'},
  {name:'Fall Protection Competent Person',fields:['Employer / evaluator','Systems covered','Practical assessment date'],source:'https://www.osha.gov/fall-protection'},
  {name:'Respirator Fit Test',fields:['Respirator make / model / size','Qualitative / quantitative method','Evaluator'],source:'https://www.osha.gov/respiratory-protection'},
  {name:'Powered Industrial Truck Operator',fields:['Truck types','Employer / evaluator','Practical evaluation date'],source:'https://www.osha.gov/powered-industrial-trucks'},
  {name:'Mobile Elevating Work Platform Operator',fields:['Equipment categories','Employer / evaluator','Practical evaluation date'],source:'https://www.osha.gov/aerial-lifts'},
  {name:'CCO Mobile Crane Operator',fields:['Crane designations','Restrictions'],source:cco},
  {name:'CCO Rigger Level I',fields:['Testing organization','Restrictions'],source:cco},
  {name:'CCO Rigger Level II',fields:['Testing organization','Restrictions'],source:cco},
  {name:'CCO Signalperson',fields:['Signal methods','Restrictions'],source:cco},
  {name:'NCCER Rigger / Signal Person',fields:['Qualification discipline','Level','Assessment center'],source:'https://www.nccer.org/rigger-signal-certifications/'},
  {name:'Commercial Driver License (CDL)',fields:['Issuing state','Class','Endorsements','Restrictions'],source:'https://www.fmcsa.dot.gov/registration/commercial-drivers-license/drivers'},
  {name:'Transportation Worker Identification Credential (TWIC)',fields:['Card status'],source:'https://www.tsa.gov/for-industry/twic'},
  {name:'Pipeline Operator Qualification (OQ)',fields:['Pipeline operator','Covered task IDs','Evaluator / qualification provider','Task reevaluation dates'],source:'https://www.phmsa.dot.gov/pipeline/operator-qualifications/operator-qualification'},
  ...['BOSIET','FOET','HUET'].map(name=>({name:`OPITO ${name}`,fields:['Product code','EBS / CA-EBS / tropical variant','Approved center'],source:opito})),
  ...['510 Pressure Vessel Inspector','570 Piping Inspector','653 Aboveground Storage Tank Inspector','571 Corrosion and Materials','577 Welding Inspection and Metallurgy','580 Risk Based Inspection','936 Refractory Personnel','1169 Pipeline Construction Inspector'].map(name=>({name:`API ${name}`,fields:['Credential status','Endorsements / restrictions'],source:api})),
  {name:'AWS Certified Welding Inspector (CWI)',fields:['Code endorsement','Restrictions'],source:'https://www.aws.org/Certification-and-Education/Professional-Certification/Certified-Welding-Inspector/'},
  {name:'AWS Certified Welder',fields:['Welding process','Code / WPS','Position / material scope','Continuity date'],source:'https://www.aws.org/certification-and-education/professional-certification/certified-welder-program/'},
  {name:'ASNT NDT Level II',fields:['Method(s)','Certification scheme','Employer authorization'],source:'https://www.asnt.org/certification'},
  {name:'ASNT NDT Level III',fields:['Method(s)','Certification scheme','Employer authorization'],source:'https://www.asnt.org/certification'},
  {name:'AMPP Basic Coatings Inspector',fields:['Program / legacy NACE or SSPC designation','Restrictions'],source:'https://www.ampp.org/education/education-resources/courses-by-program/coating-inspector-program'},
  {name:'AMPP Certified Coatings Inspector',fields:['Program / legacy NACE or SSPC designation','Restrictions'],source:'https://www.ampp.org/education/education-resources/courses-by-program/coating-inspector-program'},
  {name:'AMPP Senior Certified Coatings Inspector',fields:['Program / legacy NACE or SSPC designation','Restrictions'],source:'https://www.ampp.org/education/education-resources/courses-by-program/coating-inspector-program'},
  {name:'AMPP Corrosion Technician',fields:['Program designation','Restrictions'],source:'https://ampp.org/education/education-resources/courses-by-program/general-corrosion/corrosion-technician'},
];
