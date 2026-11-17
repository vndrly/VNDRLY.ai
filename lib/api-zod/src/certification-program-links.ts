import { EXTERNAL_CERTIFICATION_CATALOG } from './external-certification-catalog';
import { CERTIFICATION_PROGRAM_REFERENCES } from './certification-program-references';

// Navigation crosswalk to the existing certifications-50 program catalog.
// Matching a curriculum never awards a credential or changes acceptance/credit.
const programForCredential: Record<string, string> = {
  'PEC / Veriforce Basic Orientation (SafeLandUSA)': 'Energy Safety Core | Field Safety Orientation',
  'PEC / Veriforce SafeGulf': 'Energy Safety Core | Field Safety Orientation',
  'SafeLand USA': 'Energy Safety Core | Field Safety Orientation',
  'PEC': 'Energy Safety Core | Field Safety Orientation',
  'Veriforce H2S Clear': 'Atmospheric Safety | Hydrogen Sulfide',
  'H2S Clear': 'Atmospheric Safety | Hydrogen Sulfide',
  'H2S Awareness': 'Atmospheric Safety | Hydrogen Sulfide',
  'OPITO Basic H2S Training (9014)': 'Atmospheric Safety | Hydrogen Sulfide',
  'IADC RigPass': 'Rig Safety | Drilling Orientation',
  'IADC WellSharp Drilling': 'Well Control | Drilling and Well Servicing',
  'IADC WellSharp Well Servicing': 'Well Control | Drilling and Well Servicing',
  'IWCF Drilling Well Control': 'Well Control | IWCF Preparation',
  'OSHA Outreach 10-Hour General Industry': 'Safety Foundations | General Industry Worker',
  'OSHA Outreach 30-Hour General Industry': 'Safety Leadership | General Industry Supervisor',
  'HAZWOPER 40-Hour': 'Hazardous Operations | Waste and Emergency Response',
  'HazWoper 40': 'Hazardous Operations | Waste and Emergency Response',
  'HAZWOPER 24-Hour': 'Hazardous Operations | Waste and Emergency Response',
  'HAZWOPER Annual Refresher': 'Hazardous Operations | Waste and Emergency Response',
  'First Aid / CPR / AED': 'Emergency Care | First Aid, CPR and AED',
  'Confined Space Entry Qualification': 'Confined Spaces | Entry Team',
  'Lockout / Tagout Authorized Employee': 'Energy Control | Authorized and Affected Employees',
  'Fall Protection Competent Person': 'Work at Height | Fall Prevention and Protection',
  'Powered Industrial Truck Operator': 'Powered Trucks | Forklift Operation',
  'Mobile Elevating Work Platform Operator': 'Powered Access | MEWP Operation',
  'CCO Mobile Crane Operator': 'Cranes | Mobile Crane Operator',
  'CCO Rigger Level I': 'Lifting Operations | Qualified Rigger',
  'CCO Rigger Level II': 'Lifting Operations | Qualified Rigger',
  'CCO Signalperson': 'Lifting Operations | Signal Person',
  'Commercial Driver License (CDL)': 'Commercial Driving | CDL and Endorsements',
  'CDL Class A': 'Commercial Driving | CDL and Endorsements',
  'Hazmat Endorsement': 'Commercial Driving | CDL and Endorsements',
  'Transportation Worker Identification Credential (TWIC)': 'Maritime Access | TWIC Readiness',
  'Pipeline Operator Qualification (OQ)': 'Pipeline Safety | Operator Qualification',
  'OPITO BOSIET': 'Offshore Safety | Initial Survival',
  'OPITO HUET': 'Offshore Aviation | Helicopter Escape',
  'OPITO FOET': 'Offshore Safety | Survival Refresher',
  'API 510 Pressure Vessel Inspector': 'Asset Integrity | Pressure Vessel Inspection',
  'API 570 Piping Inspector': 'Asset Integrity | Piping Inspection',
  'API 653 Aboveground Storage Tank Inspector': 'Asset Integrity | Storage Tank Inspection',
  'API 1169 Pipeline Construction Inspector': 'Pipeline Construction | Inspection',
  'API 571 Corrosion and Materials': 'Asset Integrity | Damage Mechanisms',
  'API 580 Risk Based Inspection': 'Asset Integrity | Risk-Based Inspection',
  'AWS Certified Welding Inspector (CWI)': 'Welding Quality | Inspector Preparation',
  'AWS Certified Welder': 'Fabrication | Welder Qualification',
  'ASNT NDT Level II': 'Inspection Methods | NDT Level II Preparation',
  'AMPP Basic Coatings Inspector': 'Corrosion Protection | Coating Inspection',
  'AMPP Certified Coatings Inspector': 'Corrosion Protection | Coating Inspection',
  'AMPP Senior Certified Coatings Inspector': 'Corrosion Protection | Coating Inspection',
  'OPITO Authorised Gas Tester Training (9240)': 'Atmospheric Safety | Gas Testing',
  'OPITO Authorised Gas Tester Training Digital Delivery (9242)': 'Atmospheric Safety | Gas Testing',
};

export type CertificationProgram = typeof CERTIFICATION_PROGRAM_REFERENCES[number];
const programsById = new Map<string, CertificationProgram>(
  CERTIFICATION_PROGRAM_REFERENCES.map(program => [program.id, program]),
);
export function certificationProgramById(id: string) {
  return programsById.get(id);
}
const normalize = (value: string) => value.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
// Resolve the crosswalk once; no company library or assignment lookup is involved.
const programsByName = new Map<string, CertificationProgram>();
for (const [name, title] of Object.entries(programForCredential)) {
  const program = CERTIFICATION_PROGRAM_REFERENCES.find(entry => entry.title === `VNDRLY/U | ${title}`);
  if (!program) throw new Error(`Unknown certification program: ${title}`);
  programsByName.set(normalize(name), program);
  const credential = EXTERNAL_CERTIFICATION_CATALOG.find(entry => entry.name === name);
  for (const alias of credential?.aliases ?? []) programsByName.set(normalize(alias), program);
}
export function certificationProgram(name: string) {
  return programsByName.get(normalize(name));
}
