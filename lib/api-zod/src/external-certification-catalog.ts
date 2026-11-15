/** Common oil-and-gas credential/qualification types, not a statistical ranking.
 * Record the issuing body's actual scope and dates; selection grants no credit.
 * Sources and selection rationale: docs/external-certification-catalog.md.
 */
export type ExternalCredential = { name: string; fields: string[]; source: string; nonExpiring?: boolean; aliases?: readonly string[]; recordNumberOptional?: boolean };
const api = 'https://www.api.org/products-and-services/individual-certification-programs';
const osha = 'https://www.osha.gov/training/outreach/faq';
const opito = 'https://opito.com/for-learners-opito';
const cco = 'https://www.nccco.org/nccco/certification-programs';
const well = ['Level / role', 'Surface / subsea scope', 'Training center'];
const opitoLibrary = 'https://opito.com/standards-and-qualifications/industry-standards-library';
const opitoTechnical = `${opitoLibrary}/oil-and-gas/technical-roles`;
const opitoHelideck = `${opitoLibrary}/oil-and-gas/specialist-emergency-response/helideck-and-emergency-response-teams`;
const opitoEmergency = `${opitoLibrary}/oil-and-gas/specialist-emergency-response/management-of-emergency-response`;
const amppCathodic = 'https://www.ampp.org/education/cathodic-protection-roles-and-responsibilities';

export const EXTERNAL_CERTIFICATION_CATALOG: ExternalCredential[] = [
  {name:'PEC / Veriforce Basic Orientation (SafeLandUSA)',aliases:['Basic Orientation Version 7.0','SafeLandUSA','PEC Basic Orientation'],fields:['Course version','Training provider','Onshore / offshore modules'],source:'https://veriforce.com/course/basic-orientation',nonExpiring:true},
  {name:'PEC / Veriforce SafeGulf',fields:['Course version','Training provider','Offshore module'],source:'https://veriforce.com/course/basic-orientation',nonExpiring:true},
  {name:'Veriforce H2S Clear',aliases:['H₂S Clear™','PEC H2S Clear for Energy'],fields:['Training provider','Course completion date','Practical assessment scope'],source:'https://veriforce.com/course/h2s-clear'},
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
  {name:'Respirator Fit Test',recordNumberOptional:true,fields:['Respirator make / model / style / size','Qualitative / quantitative method','Test date','Pass/fail or fit factor','Evaluator'],source:'https://www.osha.gov/laws-regs/regulations/standardnumber/1910/1910.134'},
  {name:'Powered Industrial Truck Operator',recordNumberOptional:true,fields:['Truck types','Employer','Trainer / evaluator name','Training date','Evaluation date'],source:'https://www.osha.gov/laws-regs/regulations/standardnumber/1910/1910.178'},
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
  {name:'OPITO Basic H2S Training (9014)',fields:['Approved center','Course completion date'],aliases:['Basic H₂S Training','OPITO 9014'],source:'https://opito.com/standards-and-qualifications/industry-standards-library/basic-h2-s-training'},
  ...[
    '1184 Pipeline Facility Construction Inspector',
    '982 Refractory Inspector',
    'BFJA Bolted Flange Joint Assembler',
    'BFJI Bolted Flange Joint Inspector',
    'SIFE Source Inspector - Fixed Equipment',
    'SIRE Source Inspector - Rotating Equipment',
    'SIEE Source Inspector - Electrical Equipment',
    'QUPA Qualification of UT Examiners (Phased Array)',
    'QUSE Qualification of UT Examiners (Sizing)',
    'QUSEPA Qualification of UT Examiners (Crack Sizing)',
    'QUTE Qualification of UT Examiners (Detection)',
    'QUTE (M) Qualification of UT Examiners (Manual)',
    'QUTE (PA) Qualification of UT Examiners (Phased Array)',
    'QUTETM Qualification of UT Examiners (Thickness Measurement)',
    'LSP Long Seam Pipeline',
  ].map(name => ({ name: `API ${name}`, fields: ['Endorsements / restrictions'], source: 'https://directorysearch.api.org/Search?handler=Search' })),
  ...[
    'Tower Crane Operator',
    'Overhead Crane Operator',
    'Articulating Crane Operator',
    'Digger Derrick Operator',
    'Drill Rig Operator',
    'Concrete Pump Operator',
    'Telehandler Operator',
    'Crane Inspector',
    'Lift Director',
  ].map(name => ({ name: `CCO ${name}`, fields: ['Designations / specialty', 'Restrictions'], source: cco })),
  {name:'IWCF Enhanced Well Control',fields:well,source:'https://www.iwcf.org/programmes/enhanced-well-control/'},
  {name:'IWCF Well Control in Design and Lifecycle Management',fields:['Training center'],source:'https://www.iwcf.org/programmes/well-control-in-design-and-lifecycle-management/'},
  {name:'IWCF Well Operations Crew Resource Management (WOCRM)',fields:['Completion date'],source:'https://www.iwcf.org/programmes/well-operations-crew-resource-management-wocrm/',nonExpiring:true},
  {name:'IWCF Level 1 Well Control Awareness',fields:['Completion date'],source:'https://www.iwcf.org/faq/',nonExpiring:true},
  ...[
    ['5312', 'International Minimum Industry Safety Training (IMIST)', `${opitoLibrary}/international-minimum-industry-safety-training-imist-standard`],
    ['9116', 'Application of Insulation Systems Training (Level 1)', opitoTechnical],
    ['9117', 'Application of Insulation Systems Competence Assessment (Level 2)', opitoTechnical],
    ['9055', 'Assessor Initial Training', opitoTechnical],
    ['9240', 'Authorised Gas Tester Training', opitoTechnical],
    ['9242', 'Authorised Gas Tester Training Digital Delivery', opitoTechnical],
    ['9067', 'Banksman and Slinger Initial Training', opitoTechnical],
    ['9068', 'Banksman & Slinger Competence Assessment', opitoTechnical],
    ['9069', 'Banksman & Slinger Competence Reassessment', opitoTechnical],
    ['9015', 'Blaster/Sprayer Training (Level 1)', opitoTechnical],
    ['4552', 'Fire Warden Competence Assessment', opitoHelideck],
    ['4651', 'Further Onshore Fire/Emergency Response Team Leader', opitoHelideck],
    ['4551', 'Further Onshore Fire/Emergency Response Team Member', opitoHelideck],
    ['7055', 'Helicopter Administrator Training', opitoHelideck],
    ['7056', 'Helicopter Administrator Workplace Competence Assessment', opitoHelideck],
    ['7046', 'Helicopter Landing Officer (HLO) Workplace Competence Assessment', opitoHelideck],
    ['7048', 'Helicopter Landing Officer (HLO) for Normally Unattended Installation (NUI) Operations Initial Training', opitoHelideck],
    ['7049', 'Helicopter Landing Officer (HLO) for Normally Unattended Installation (NUI) Operations Further Training', opitoHelideck],
    ['7051', 'HLO / Helicopter Emergency Response Team Leader Workplace Competence Assessment for NUIs', opitoHelideck],
    ['9255', 'Helicopter Refuelling Training', opitoHelideck],
    ['9004', 'Control Room Operator Emergency Response', opitoEmergency],
    ['7228', 'Major Emergency Management - Initial Response Training', opitoEmergency],
    ['7057', 'Offshore Muster Checker Workplace Competence Assessment', opitoEmergency],
    ['7058', 'Offshore Muster Coordinator Workplace Competence Assessment', opitoEmergency],
    ['7025', 'OIM Controlling Emergencies', opitoEmergency],
    ['7031', 'Onshore Control Room Operator Emergency Response', opitoEmergency],
    ['9030', 'Plant Manager/Incident Commander Initial Response Training', opitoEmergency],
  ].map(([code, title, source]) => ({
    name: `OPITO ${title} (${code})`,
    aliases: [`OPITO ${code}`],
    fields: ['Approved centre', 'Completion / assessment date', 'Scope or restrictions shown'],
    source,
  })),
  ...[
    ['CP1', 'Cathodic Protection Tester'],
    ['CP2', 'Cathodic Protection Technician'],
    ['CP3', 'Cathodic Protection Technologist'],
    ['CP4', 'Cathodic Protection Specialist'],
  ].map(([code, title]) => ({
    name: `AMPP ${title} (${code})`, aliases: [`NACE ${code}`],
    fields: ['Program designation as shown', 'Restrictions'], source: amppCathodic,
  })),
  {name:'ASNT 9712 Level II',fields:['Test method (MT / PT / RT / UT)','Practical technique shown','Restrictions'],source:'https://certification.asnt.org/certification/asnt-9712-level-ii'},
  {name:'EPA Section 608 Technician Certification',fields:['Certification type (I / II / III / Universal)','EPA-approved certifying organization'],nonExpiring:true,source:'https://www.epa.gov/section608/section-608-technician-certification-requirements'},
  {name:'FAA Remote Pilot Certificate (Part 107)',fields:['Most recent recurrent training date','Operating limitations shown'],source:'https://www.faa.gov/uas/commercial_operators/become_a_drone_pilot'},
  {name:'USCG Merchant Mariner Credential (MMC)',fields:['National endorsements','STCW endorsements','Capacity / route / limitations shown'],source:'https://www.dco.uscg.mil/national_maritime_center/merchant_mariner-credential/'},
];

export const CREDENTIAL_HOLDER_FIELD = "Name on credential";

export function searchExternalCredentials(query: string) {
  const normalize = (value: string) => value.normalize("NFKC").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const terms = normalize(query).split(" ").filter(Boolean);
  return EXTERNAL_CERTIFICATION_CATALOG.filter(credential => {
    const searchable = normalize([credential.name, ...(credential.aliases ?? [])].join(" "));
    return terms.every(term => searchable.includes(term));
  });
}

export function credentialRequiresRecordNumber(name: string) {
  return !EXTERNAL_CERTIFICATION_CATALOG.find(item => item.name === name)?.recordNumberOptional;
}
