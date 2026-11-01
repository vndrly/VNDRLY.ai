/** Knowledge-course applicability only. Never a licence, practical qualification,
 * operational permission, tenant check or confirmation of a conditional exposure.
 * Pass reviewed role rules, not a service's flattened familyIds union. Returned
 * conditional rules are candidates: the caller MUST resolve their trigger and
 * requiresExposureConfirmation before assignment or trusted coverage/scoring.
 */
export interface SafetyTrainingPerson {
  roles?: readonly string[];
  operationalRoles?: readonly string[];
  vendorRole?: string | null;
  jobTitle?: string | null;
  membershipRole?: string | null;
}
export interface ReviewedTrainingRoleRule {
  id?: string;
  role: string;
  familyIds: readonly string[];
  rationale: string;
  trigger?: string;
  /** The caller must separately resolve legacy/service scope before trusting coverage. */
  scopeMustBeConfirmed?: boolean;
  /** Caller must confirm the person's actual task/material/process separately. */
  requiresExposureConfirmation?: boolean;
}
export interface CommonTrainingRoleRule {
  id: string;
  roles: readonly string[];
  familyIds: readonly string[];
  purpose: string;
}
export interface SafetyTrainingRoleMatches {
  familyIds: string[];
  matchedRoleRules: Array<{
    ruleId: string;
    role: string;
    familyIds: string[];
    rationale: string;
    matchedCues: string[];
    trigger?: string;
    requiresExposureConfirmation?: boolean;
  }>;
  unresolvedRoles: Array<{ role: string; reason: string }>;
  knowledgeOnly: true;
}

// Mirrors common-training-role-rules.json. Membership admin/member/ap controls
// application access, not safety duties: none implies programme ownership.
export const DEFAULT_COMMON_TRAINING_ROLE_RULES: readonly CommonTrainingRoleRule[] = [
  { id: 'common_worker', roles: ['all_active'], familyIds: ['L02','L03','C02','H22','I01','R01'], purpose: 'Common participation, intervention, induction, ergonomics, reporting and emergency knowledge.' },
  { id: 'program_owner', roles: ['company_leader','safety_program_owner'], familyIds: ['L01','L05','C01','C04','I05','R05','R06'], purpose: 'Assigned company programme ownership and resources.' },
  { id: 'supervision', roles: ['supervisor','crew_lead','mentor'], familyIds: ['C03','I03','I04'], purpose: 'Assigned supervision, unfamiliar-task support and learning follow-through.' },
  { id: 'subcontract_interface', roles: ['subcontract_coordinator'], familyIds: ['L04'], purpose: 'Actual lower-tier procurement/coordination.' },
  { id: 'investigation', roles: ['incident_investigator'], familyIds: ['I02'], purpose: 'Assigned investigation duties.' },
  { id: 'assurance', roles: ['assurance_reviewer'], familyIds: ['R04'], purpose: 'Assigned assurance review duties.' },
  { id: 'medical_interface', roles: ['medical_return_to_work_coordinator'], familyIds: ['I06'], purpose: 'Assigned restricted-record and medical referral interface.' },
  { id: 'training_assurance', roles: ['trainer','practical_assessor','training_program_owner'], familyIds: ['C04'], purpose: 'Assigned teaching, assessment or training governance.' },
];

// Exact vocabulary after case/whitespace normalization. No substring, fuzzy,
// job-title similarity or service-name inference. Unknown labels remain visible.
const normalize = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');
const cues: Record<string, readonly string[]> = {};
function cue(labels: string[], values: string[]) {
  for (const label of labels) cues[normalize(label)] = values;
}
cue(['office','office staff','office worker','administrator','payroll','accounts payable','accountant','receptionist','scheduler','dispatcher','dispatch','office dispatcher','transport dispatcher'], ['office']);
cue(['field','field worker','field employee','field_employee','site worker','field staff'], ['field']);
cue(['both'], ['office','field']);
cue(['gatekeeper','gate attendant','gate attendant / security','security guard','site guard','guard'], ['field','gate']);
cue(['gate supervisor'], ['field','gate','supervisor']);
cue(['driver','truck driver','delivery driver','winch truck driver'], ['field','driver']);
cue(['commercial driver','regulated driver','cdl driver'], ['field','driver','commercial_driver']);
cue(['h2s user','h2s exposed worker','personal detector user','assigned detector user'], ['field','h2s_user','detector_user']);
cue(['h2s technician','gas monitoring technician','gas-monitoring technician','gas monitoring installation technician'], ['field','gas_monitor','detector_user']);
cue(['gas tester','designated gas tester','authorized gas tester','permit-atmosphere verifier'], ['field','gas_tester','detector_user']);
cue(['respirator user','assigned respirator user'], ['field','respirator_user']);
cue(['breathing air technician','breathing-air equipment technician'], ['field','breathing_air_technician']);
cue(['h2s rescuer','h2s rescue','h2s rescue team','h2s rescue technician'], ['field','rescuer','h2s_rescuer','respirator_user']);
cue(['rescuer','rescue technician','rescue team member','emergency responder'], ['field','rescuer']);
cue(['rescue planner'], ['rescue_planner']);
cue(['first aider','first aid responder'], ['first_aider']);
cue(['detector calibration technician','detector repair technician'], ['calibration_technician']);
cue(['electrician','electrical technician'], ['field','electrician']);
cue(['instrument technician','instrumentation technician'], ['field','instrument_technician']);
cue(['mechanic','mechanical technician','maintenance mechanic'], ['field','mechanic']);
cue(['supervisor','crew lead','foreman','field supervisor','mentor'], ['supervisor']);
cue(['company leader','company owner','safety program owner','safety programme owner','program owner','safety manager'], ['program_owner']);
cue(['training program owner'], ['training_program_owner']);
cue(['trainer','instructor'], ['trainer']);
cue(['practical assessor','training assessor'], ['practical_assessor']);
cue(['subcontract coordinator','subcontractor coordinator'], ['subcontract_coordinator']);
cue(['incident investigator'], ['incident_investigator']);
cue(['assurance reviewer','safety auditor'], ['assurance_reviewer']);
cue(['medical return to work coordinator','return-to-work coordinator'], ['medical_return_to_work_coordinator']);
cue(['equipment operator','mobile equipment operator','forklift operator','excavator operator','loader operator'], ['field','operator']);
cue(['crane operator','lifting operator'], ['field','operator','lifting_operator']);
cue(['rigger','signal person','signaler','banksman','lift planner'], ['field','lifting_role']);
cue(['well service operator','well-service crew','drilling crew','driller','workover operator'], ['field','well_operator']);
cue(['pressure test technician','pressure operator','pump operator'], ['field','pressure_operator']);
cue(['process operator','plant operator'], ['field','process_operator']);
cue(['welder','cutter'], ['field','welder']);
cue(['fire watch','fire watcher'], ['field','fire_watch']);
cue(['confined space entrant','authorized entrant'], ['field','entrant']);
cue(['confined space attendant','attendant'], ['field','attendant']);
cue(['entry supervisor'], ['field','entry_supervisor','supervisor']);
cue(['isolation technician','authorized isolator'], ['field','isolator']);
cue(['permit issuer','permit authority'], ['field','permit_issuer']);
cue(['scaffolder','rope access technician','height worker'], ['field','height_worker']);
cue(['groundworker','civil construction worker'], ['field','groundworker']);
cue(['surveyor','field surveyor'], ['field','surveyor']);
cue(['inspector','ndt technician','inspection technician'], ['inspector']);
cue(['engineer','design engineer','technical consultant','petroleum engineer'], ['office','engineer']);
cue(['software developer','software engineer','it support','helpdesk','system administrator','security broker'], ['office','it']);
cue(['rental asset custodian','rental dispatcher','asset custodian'], ['rental_custodian']);
cue(['warehouse worker','facility worker','camp worker'], ['facility']);
cue(['laboratory analyst','lab technician','sample handler'], ['laboratory']);
cue(['cleaner','housekeeper'], ['cleaner']);
cue(['vacuum truck operator','hydroblasting operator','hydroblaster'], ['field','specialist_cleaner']);
cue(['waste handler','environmental field worker'], ['field','waste_worker']);
cue(['chemical handler','coating worker','insulation worker','refractory worker'], ['field','chemical_worker']);
cue(['hazmat shipper','hazmat loader','hazmat driver'], ['hazmat_worker']);
cue(['commercial diver','diver'], ['field','diver']);
cue(['marine crew','vessel crew','marine worker'], ['field','marine_worker']);
cue(['rail worker','rail operator'], ['field','rail_worker']);
cue(['radiographer','radiation technician'], ['field','radiation_worker']);
cue(['explosives technician','perforating specialist'], ['field','explosives_worker']);
cue(['remote pilot','drone pilot'], ['field','remote_pilot']);
cue(['gate','gate_attendant'], ['field','gate']);
cue(['gate_supervisor','gate shift lead','gate shift supervisor'], ['field','gate','supervisor']);
cue(['foreman','field_supervisor'], ['field','supervisor']);
cue(['company_leader','safety_program_owner','program_owner'], ['program_owner']);
cue(['crew_lead','mentor'], ['supervisor']);
cue(['subcontract_coordinator'], ['subcontract_coordinator']);
cue(['incident_investigator'], ['incident_investigator']);
cue(['assurance_reviewer'], ['assurance_reviewer']);
cue(['medical_return_to_work_coordinator'], ['medical_return_to_work_coordinator']);
cue(['practical_assessor'], ['practical_assessor']);
cue(['training_program_owner'], ['training_program_owner']);
// Explicitly reviewed against live-role-labels.json. Trade labels establish
// knowledge scope, not the person's practical ability to perform that trade.
cue(['backhoe operator','tracked excavator operator'], ['field','operator','groundworker']);
cue(['blender operator','cementing operator','cementing tech','coiled tubing operator','directional driller','derrickhand','floorhand','flowback operator','frac operator','motorhand','mwd operator','pump down operator','wireline operator','well test operator','solids control tech'], ['field','well_operator']);
cue(['frac crew chief','ct supervisor','toolpusher','drilling manager','rig manager','completions manager','frac ops manager'], ['field','well_operator','supervisor']);
cue(['compressor mechanic','rig mechanic','shop mechanic','pumping unit technician','top drive tech','turbine tech','valve tech','wellhead technician'], ['field','mechanic']);
cue(['compressor operator','generator operator','terminal operator','water transfer tech'], ['field','process_operator']);
cue(['water transfer supervisor','terminal manager'], ['field','process_operator','supervisor']);
cue(['chemical additive tech','chemical tech'], ['field','chemical_worker']);
cue(['civil inspector','testing engineer'], ['field','inspector']);
cue(['completions engineer','drilling fluid engineer','logging engineer'], ['field','engineer']);
cue(['controls tech'], ['field','instrument_technician']);
cue(['data acquisition tech','edr tech','sampling tech'], ['field','surveyor']);
cue(['environmental tech'], ['field','waste_worker']);
cue(['equipment delivery driver','roll-off driver','sand hauler','vacuum truck driver'], ['field','driver']);
cue(['gas tech','h2s tech'], ['field','gas_monitor','detector_user']);
cue(['pipeline welder','rig welder'], ['field','welder']);
cue(['roustabout','laborer','welder helper'], ['field']);
cue(['roustabout lead','crew a foreman','crew b foreman / hse'], ['field','supervisor']);
cue(['safety man','hse / safety officer','hse coordinator','safety compliance officer'], ['safety_advisor']);
cue(['safety director','operations director','regional director','owner','owner/operator'], ['program_owner']);
cue(['area manager','branch manager','district manager','product line manager','project manager','site services mgr','operations manager','office manager','fleet manager','logistics lead'], ['supervisor']);
cue(['applications engineer','compression engineer','district engineer','lead engineer','design coordinator'], ['office','engineer']);
cue(['developer','network specialist'], ['office','it']);
cue(['account executive','chemical sales rep','enterprise account mgr','regional sales mgr','accounts manager','billing','billing & ar','billing specialist','contract admin','customer service rep','dispatch coordinator','field coordinator','field planner','finance manager','hr business partner','inside sales rep','inventory analyst','logistics admin','logistics coordinator','office admin','operations analyst','qa analyst','route coordinator','scheduling coordinator','technical writer','travel coordinator','accounts_payable'], ['office']);
cue(['rental coordinator'], ['office','rental_custodian']);
cue(['training coordinator'], ['office','training_program_owner']);
cue(['sampling lead'], ['field','surveyor','supervisor']);
cue(['food handler','cook','kitchen worker'], ['food_worker']);
cue(['grounds worker','mower operator'], ['field','grounds_worker']);
cue(['heat treatment operator'], ['field','heat_treatment_worker']);
cue(['hvac technician','refrigeration technician'], ['field','hvac_worker']);
cue(['fire system technician','fire-system installer'], ['field','fire_system_worker']);
cue(['hydrovac operator'], ['field','specialist_cleaner','operator']);
cue(['metrology technician','laboratory instrument technician'], ['instrument_technician']);
cue(['machinist','fabricator','pipefitter','plumber'], ['field','mechanic']);
cue(['photographer','videographer'], ['media_worker']);
cue(['pest control applicator'], ['field','pest_worker']);
cue(['seismic acquisition worker'], ['field','surveyor']);
cue(['sanitary technician','water treatment technician'], ['field','water_worker']);
cue(['proppant handler','sand coordinator'], ['field','material_handler']);
cue(['staffing coordinator'], ['office','staffing_coordinator']);
cue(['research scientist','research analyst'], ['research_worker']);
cue(['printing operator','packaging worker'], ['print_worker']);
cue(['well crisis specialist'], ['field','well_operator','rescuer']);
// Supplemental duties need actual function cues, not generic office labels.
cue(['hazmat dispatcher','hazmat shipping clerk','hazmat shipping coordinator','hazardous-material shipping function'], ['shipping_function']);
cue(['nurse','registered nurse','medic','physician','clinical worker'], ['clinical_worker']);
cue(['laundry worker','laundry handler'], ['laundry_worker']);
cue(['personal care worker','care worker'], ['care_worker']);
cue(['blood cleanup worker','contaminated cleanup worker'], ['contaminated_cleaner']);
cue(['funeral attendant','human remains handler','mortuary worker','human-remains handling personnel'], ['human_remains_worker']);
cue(['food handler','chef','cook'], ['food_worker']);
cue(['catering supervisor','food service manager','camp food supervisor'], ['food_worker','supervisor']);
cue(['food safety program owner'], ['food_worker']);
cue(['laboratory instrument technician','laboratory instrument service technician'], ['instrument_technician','laboratory_service']);
cue(['pesticide handler','pesticide applicator','structural pest control technician','grounds pesticide supervisor'], ['field','pest_worker']);

// Exact reviewed role labels, including mixed-role labels from the 963-service
// map. Matching one branch never awards another branch's specialist families.
const ruleCues: Record<string, readonly string[]> = {};
function rule(labels: string[], values: string[]) {
  for (const label of labels) ruleCues[normalize(label)] = values;
}
rule(['Office-based service professional','Office advisors, administrators and professional reviewers','Desk analysts, advisors or coordinators within this service','Finance, insurance, banking and economics personnel','Transport brokers, freight planners and coordinators'], ['office']);
rule(['Design engineer or technical consultant','Design engineers, interpreters, analysts and technical approvers','Pipeline/process/HVAC engineers and technical reviewers'], ['engineer']);
rule(['Software/helpdesk/system-administration worker','Desk IT, support and systems personnel'], ['it']);
rule(['Site worker or visiting professional','On-site execution personnel','All assigned workers','All assigned personnel'], ['field']);
rule(['Site guard, gate attendant or security worker','Guards and access-control supervisors','Security personnel, lone field workers and supervisors'], ['gate']);
rule(['Driver or load-handling transport worker','Drivers, loading personnel and transport supervisors','Drivers, transport dispatch and loaders'], ['driver','commercial_driver']);
rule(['Worker exposed to H2S who wears an assigned personal detector'], ['h2s_user','detector_user']);
rule(['Gas-monitoring installation and monitoring technician'], ['gas_monitor']);
rule(['Designated gas tester or permit-atmosphere verifier'], ['gas_tester']);
rule(['Breathing-air equipment technician or assigned respirator user'], ['breathing_air_technician','respirator_user']);
rule(['Assigned H2S rescue/response team'], ['h2s_rescuer']);
rule(['Detector calibration/repair technician'], ['calibration_technician']);
rule(['Electrical or instrument technician','Electrical/instrument technicians, commissioning personnel and supervisors'], ['electrician','instrument_technician']);
rule(['Qualified electrical technicians and electrical work authority'], ['electrician']);
rule(['Mechanical maintenance or fabrication worker','Mechanical maintenance technicians and technical release owners','Mechanics, installers and maintenance supervisors'], ['mechanic']);
rule(['Lifting or mobile-equipment worker','Assigned equipment operators, spotters and supervisors'], ['operator','lifting_operator','lifting_role']);
rule(['Lift planners, riggers, signal persons and relevant equipment inspectors'], ['lifting_operator','lifting_role']);
rule(['Well-service or drilling crew member','Well construction, drilling, fishing, plugging and running-tool crews','Wellsite execution crew, service supervisors and technical decision roles','Well stimulation, gravel-pack, nitrogen or sand-control crews'], ['well_operator']);
rule(['Pressure equipment operator or technician','Qualified pressure-test technicians and test supervisors'], ['pressure_operator']);
rule(['Assigned process operators, maintenance roles and site management','Fuel, gas and process operating or maintenance roles'], ['process_operator','mechanic']);
rule(['Welder, cutter or fire-watch worker','Fabricators, welders, trade supervisors and inspectors'], ['welder','fire_watch']);
rule(['Authorized entrants, attendants, entry supervisors and task technicians'], ['entrant','attendant','entry_supervisor']);
rule(['Height-work or scaffold crew member'], ['height_worker']);
rule(['Civil construction or groundworks worker','Civil crew, excavator operators and site supervisor','Civil construction crews and assigned plant/lifting roles'], ['groundworker','operator']);
rule(['Survey field crew member','Surveyors, measurement crews and field supervisors','Field surveyors, sampling personnel and inspectors'], ['surveyor']);
rule(['Inspection or NDT technician','Method-qualified NDT personnel and technical reviewers','Technical inspectors, certifiers and assessors','Technical inspectors, examiners and certification decision makers'], ['inspector']);
rule(['Rental asset custodian or handover worker','Rental asset custodian and dispatch personnel','Rental dispatch and asset custodian','Rental dispatch; Rental asset custodian','Specialist rental asset custodian','Vehicle or trailer rental custodian and dispatch personnel','Tank, pipeline or compressor rental custodian'], ['rental_custodian']);
rule(['Facility, camp or warehouse worker','Warehouse staff, loading personnel and supervisors','Facilities coordinators and actual maintenance personnel'], ['facility']);
rule(['Laboratory analyst or sample handler','Laboratory analysts and sample handlers'], ['laboratory']);
rule(['Cleaning, housekeeping and personal-service workers','Hospitality, housekeeping, laundry and personal-service personnel'], ['cleaner','laundry_worker','care_worker','contaminated_cleaner']);
rule(['Cleaning or vacuum/hydroblasting crew member','Hydroblasting crews and qualified service supervisors','Industrial cleaners and tank or truck rinse-out personnel','Waste handlers, vacuum-service personnel and disposal operators'], ['specialist_cleaner','cleaner','waste_worker']);
rule(['Waste handling or environmental field worker','Waste handlers, environmental field personnel and operating supervisors','Waste treatment and landfill operators'], ['waste_worker']);
rule(['Coating, insulation or refractory worker','Insulation, coating, blasting and fit-out crews','Chemical handlers, cleaners, coating crew and exposure assessor'], ['chemical_worker']);
rule(['Hazmat shipper, loader or driver'], ['hazmat_worker']);
rule(['Commercial diver or subsea operating team'], ['diver']);
rule(['Marine operations or vessel-side worker','Vessel masters, crew, navigation or mooring personnel and passengers within actual role'], ['marine_worker']);
rule(['Rail worker or rail-freight operating personnel','Rail roadway workers or passenger-rail operating personnel within actual role'], ['rail_worker']);
rule(['Radiography or radioactive-decontamination worker','Licensed nuclear/radioactive-waste personnel and radiation protection roles'], ['radiation_worker']);
rule(['Explosives/perforating specialist'], ['explosives_worker']);
rule(['Remote pilot and assigned flight crew'], ['remote_pilot']);
rule(['Instructor or assessor','Safety trainers, practical assessors and training owner'], ['trainer','practical_assessor','training_program_owner']);
rule(['Company leader; Program owner','Company leader and program owner','Accountable manager / program owner'], ['program_owner']);
rule(['Supervisor; Crew lead','Supervisor or service interface lead'], ['supervisor']);
rule(['Subcontract coordinator'], ['subcontract_coordinator']);
rule(['Investigator; Assurance reviewer','Incident investigators and evidence custodians'], ['incident_investigator','assurance_reviewer']);
rule(['Medical/return-to-work coordinator'], ['medical_return_to_work_coordinator']);
rule(['Licensed clinical personnel and medical interface coordinator'], ['clinical_worker','medical_return_to_work_coordinator']);
rule(['Gate attendant / staffed admission worker'], ['gate']);
rule(['Gate shift lead / handover coordinator'], ['gate','supervisor']);
rule(['Assigned first aider or responder','Assigned responders, fire-service personnel and response coordinators'], ['first_aider','rescuer']);
rule(['Gate worker with actual H2S exposure / assigned detector use'], ['gate','h2s_user','detector_user']);
rule(['Actual manufacturing/filling personnel'], ['process_operator']);
rule(['Assigned oil-spill responders and response supervisors'], ['rescuer']);
rule(['Construction workers and supervising personnel','Pipeline construction crews, plant and lifting roles'], ['groundworker','operator']);
rule(['Fire-system installer or maintenance technician'], ['fire_system_worker']);
rule(['Food handlers, kitchen staff and camp supervisors'], ['food_worker']);
rule(['Generator maintenance technicians and responsible electrical/mechanical specialists'], ['electrician','mechanic']);
rule(['Grounds workers and assigned mower operators'], ['grounds_worker']);
rule(['Guides, interpreters and travel coordinators'], ['office']);
rule(['Hardware installers and service technicians'], ['instrument_technician','electrician']);
rule(['Heat-treatment operators and technicians'], ['heat_treatment_worker']);
rule(['HVAC installers and service technicians','Refrigeration technicians and service supervisor'], ['hvac_worker']);
rule(['Hydrovac operators, drivers and field supervisors'], ['specialist_cleaner','driver']);
rule(['Instrument technicians, metrology personnel and measurement reviewers'], ['instrument_technician']);
rule(['Laboratory instrument service technicians'], ['laboratory_service']);
rule(['Logistics or project coordinators and field interface leads'], ['office','supervisor']);
rule(['LPG production, cylinder-handling or hot-repair personnel'], ['process_operator','hazmat_worker','welder']);
rule(['Lubrication or material-treatment technical and operating personnel'], ['mechanic','process_operator']);
rule(['Machinists, fabricators and assigned lifting or hot-work personnel','Pipefitters, plumbers and mechanical service technicians'], ['mechanic','welder','lifting_role']);
rule(['Marine installation crews, lifting roles and construction supervisors'], ['marine_worker','lifting_role']);
rule(['Marine or ice-management advisors and technical planners'], ['engineer']);
rule(['Marine surveyors, cargo assessors and inspection personnel'], ['surveyor','inspector']);
rule(['Material handlers and explicitly supplied grader or roller operators','Proppant/material-handling worker'], ['material_handler','operator']);
rule(['Mud engineers, laboratory or plant personnel within actual assignment'], ['engineer','laboratory','process_operator']);
rule(['Pest-control applicators and responsible supervisor'], ['pest_worker']);
rule(['Photographers and media personnel'], ['media_worker']);
rule(['Pigging and inline-inspection crews and process authority','Pipeline operating personnel and control authority'], ['process_operator']);
rule(['Pressure-vessel or load-test inspectors within their actual method'], ['inspector','pressure_operator']);
rule(['Printing, packaging and mailing personnel'], ['print_worker']);
rule(['Research scientists, analysts and research program owner'], ['research_worker']);
rule(['Safety advisors and program reviewers'], ['safety_advisor','assurance_reviewer']);
rule(['Sanitary or water-treatment technician'], ['water_worker']);
rule(['Seismic acquisition crew and field supervisor'], ['surveyor']);
rule(['Staffing coordinator and host supervisor'], ['staffing_coordinator','supervisor']);
rule(['Waste/environmental managers, investigators and field samplers within scope'], ['waste_worker','surveyor','incident_investigator']);
rule(['Well logging, MWD/LWD and operations-geology field personnel'], ['well_operator']);
rule(['Well-crisis specialist or emergency coordinator'], ['well_operator','rescuer']);
rule(['Assigned hazardous-material shipping/dispatch function'], ['shipping_function','hazmat_worker']);
rule(['Human-remains handling personnel'], ['human_remains_worker']);

// Deliberately unresolved mixed/technical labels: the source supplies neither
// a single executable duty nor enough scope to select a safe branch by title.
const unresolvedRuleReasons: Record<string, string> = Object.fromEntries([
  ['Aviation operator, flight crew and passenger-interface personnel', 'Separate flight crew, aircraft support and passenger interface; aviation knowledge is not interchangeable.'],
  ['Marine/aviation personnel and coordinating supervisors', 'Confirm transport mode and actual crew versus coordinating duty.'],
  ['Passenger-service coordinators and mode-qualified operating personnel', 'Confirm passenger coordinator versus actual mode-specific operator.'],
  ['Lift-equipment service technicians after exact equipment scope review', 'Confirm equipment type and actual servicing versus statutory inspection duty.'],
  ['Nitrogen service engineers and actual execution personnel after scope review', 'Confirm desk engineering versus pressure-system execution and actual nitrogen method.'],
  ['Specialist leak-sealing technicians and process authority', 'Confirm actual leak-sealing technical method and process authority before selecting execution knowledge.'],
].map(([label, reason]) => [normalize(label!), reason!]));

const unresolvedPersonReasons: Record<string, string> = Object.fromEntries([
  ['BOP Tech', 'Confirm BOP function, maintenance versus pressure-control operation and actual assigned duties.'],
  ['HBIC', 'Informal title establishes neither company safety ownership nor an operational duty.'],
  ['Generator Tech', 'Confirm mechanical versus electrical servicing and voltage-specific duties.'],
  ['Light Tower Tech', 'Confirm mechanical setup, electrical work, delivery and height duties separately.'],
  ['Lab Field Tech', 'Confirm laboratory analysis versus field sampling and actual material/exposure.'],
  ['Reel Operator', 'Confirm reel equipment, stored energy and actual wireline, tubing or material-handling method.'],
  ['Operations', 'Department label does not identify a worker task or supervision responsibility.'],
  ['Operator', 'Identify the actual equipment or process; no specialist operation is inferred.'],
  ['Processing Tech', 'Identify the process/material and the actual operating or maintenance duties.'],
  ['Field Service Tech', 'Field attendance is not a technical discipline; confirm trade and assigned task.'],
  ['Field Tech', 'Field attendance is not a technical discipline; confirm trade and assigned task.'],
  ['Service Technician', 'Confirm equipment, trade and task; generic technician is not a gas/electrical/rescue endorsement.'],
  ['Technician', 'Generic technician does not identify the technical discipline or actual duties.'],
  ['Installation Tech', 'Confirm installed system and physical/electrical/height duties.'],
  ['Wellsite Installer', 'Confirm what is installed and actual equipment, energy and access duties.'],
  ['Deployment Specialist', 'Confirm administrative deployment versus physical equipment work.'],
  ['Support Specialist', 'Confirm desk support versus physical technical service.'],
].map(([label, reason]) => [normalize(label!), reason!]));

const familyCues: Record<string, readonly string[]> = {
  G04: ['clinical_worker','first_aider','rescuer','laundry_worker','care_worker','contaminated_cleaner','human_remains_worker'],
  G06: ['laboratory','laboratory_service','research_worker'],
  L01: ['program_owner'], L04: ['subcontract_coordinator'], L05: ['program_owner'],
  C01: ['program_owner','practical_assessor'], C03: ['supervisor'], C04: ['program_owner','training_program_owner','trainer','practical_assessor'],
  C05: ['commercial_driver'], C06: ['operator','lifting_operator','lifting_role'], C07: ['gas_tester','electrician','isolator','permit_issuer'], C08: ['rescuer','first_aider'],
  H02: ['field'], H03: ['field'], H04: ['electrician','isolator','mechanic','well_operator','pressure_operator','process_operator'],
  H05: ['entrant','attendant','entry_supervisor'], H06: ['welder','fire_watch'], H07: ['lifting_operator','lifting_role'], H08: ['height_worker'],
  H09: ['groundworker'], H10: ['pressure_operator','well_operator'], H11: ['mechanic','pressure_operator','well_operator','process_operator','specialist_cleaner'],
  H12: ['electrician'], H13: ['h2s_user','gas_monitor','gas_tester','h2s_rescuer','well_operator','process_operator'],
  H15: ['respirator_user','breathing_air_technician'], H18: ['field'], H19: ['driver'], H20: ['field','driver'],
  H24: ['diver','marine_worker','rail_worker','radiation_worker','explosives_worker'],
  E01: ['rental_custodian','mechanic','calibration_technician','electrician'], E03: ['driver','rental_custodian'],
  E04: ['detector_user','gas_monitor','gas_tester','calibration_technician','instrument_technician','inspector','surveyor'],
  E05: ['mechanic','pressure_operator','well_operator','process_operator','rental_custodian'],
  E06: ['lifting_role','lifting_operator','height_worker','rental_custodian'], E08: ['mechanic','facility','laboratory'], E09: ['specialist_cleaner'],
  I02: ['incident_investigator'], I03: ['supervisor','program_owner'], I04: ['supervisor','program_owner'], I05: ['program_owner'], I06: ['medical_return_to_work_coordinator'],
  R02: ['rescuer','rescue_planner'], R04: ['assurance_reviewer'], R05: ['program_owner'],
};

const commonAliases: Record<string, string> = {
  company_leader: 'program_owner', safety_program_owner: 'program_owner',
  crew_lead: 'supervisor', mentor: 'supervisor',
};

export function matchSafetyTrainingRoles(
  person: SafetyTrainingPerson,
  roleRules: readonly ReviewedTrainingRoleRule[],
  commonRules: readonly CommonTrainingRoleRule[] = DEFAULT_COMMON_TRAINING_ROLE_RULES,
): SafetyTrainingRoleMatches {
  const result: SafetyTrainingRoleMatches = { familyIds: [], matchedRoleRules: [], unresolvedRoles: [], knowledgeOnly: true };
  const held = new Set<string>();
  const unknown = new Set<string>();
  for (const label of [...(person.roles ?? []), ...(person.operationalRoles ?? []), person.vendorRole ?? '', person.jobTitle ?? '']) {
    const key = normalize(label);
    if (!key || ['admin','member','ap','team member','visitor notifications'].includes(key)) continue;
    const values = cues[key];
    if (values) values.forEach(value => held.add(value));
    else if (!unknown.has(key)) {
      unknown.add(key);
      result.unresolvedRoles.push({ role: label, reason: unresolvedPersonReasons[key] ?? 'No explicit reviewed person-role cue; confirm actual duties rather than infer a specialty from this label.' });
    }
  }
  // A membership role establishes access only. Even field_employee is not a
  // gas tester, driver, rescuer, supervisor or programme owner endorsement.
  if (person.membershipRole && !['admin','member','ap','field_employee','partner','vendor'].includes(normalize(person.membershipRole))) {
    result.unresolvedRoles.push({ role: person.membershipRole, reason: 'Unknown membership access role; safety duties must be supplied separately.' });
  }
  const applicable = (family: string) => !familyCues[family] || familyCues[family].some(c => held.has(c));
  const add = (ruleId: string, role: string, families: readonly string[], rationale: string, matched: string[], trigger?: string, requiresExposureConfirmation?: boolean) => {
    const selected = [...new Set(families.filter(applicable))].sort();
    if (!selected.length) return;
    result.matchedRoleRules.push({ ruleId, role, familyIds: selected, rationale, matchedCues: matched, ...(trigger ? { trigger } : {}), ...(requiresExposureConfirmation === undefined ? {} : { requiresExposureConfirmation }) });
    result.familyIds.push(...selected);
  };
  for (const common of commonRules) {
    const matched = common.roles.filter(c => c === 'all_active' || held.has(commonAliases[c] ?? c));
    if (matched.length) add(common.id, common.roles.join('; '), common.familyIds, common.purpose, matched);
  }
  for (const [index, reviewed] of roleRules.entries()) {
    const accepted = ruleCues[normalize(reviewed.role)];
    if (!accepted) {
      result.unresolvedRoles.push({ role: reviewed.role, reason: unresolvedRuleReasons[normalize(reviewed.role)] ?? 'Reviewed rule label has no explicit executable cue mapping; manual role/exposure resolution is required.' });
      continue;
    }
    const label = normalize(reviewed.role);
    // These legacy combined labels require both duties; a gate presence alone
    // establishes neither supervision nor H2S detector use.
    if (label === 'gate shift lead / handover coordinator' && !(held.has('gate') && held.has('supervisor'))) continue;
    if (label === 'gate worker with actual h2s exposure / assigned detector use' && !(held.has('gate') && (held.has('h2s_user') || held.has('detector_user')))) continue;
    const matched = accepted.filter(c => held.has(c));
    if (!matched.length) continue;
    add(reviewed.id ?? `reviewed:${index}`, reviewed.role, reviewed.familyIds,
      reviewed.rationale + ' Knowledge only; specialist families are limited to separately identified duties. The stated trigger still requires confirmation.', matched, reviewed.trigger, reviewed.requiresExposureConfirmation);
  }
  if ([...(person.roles ?? []), ...(person.operationalRoles ?? []), person.jobTitle ?? ''].some(label => ['equipment operator','mobile equipment operator'].includes(normalize(label)))) {
    result.unresolvedRoles.push({ role: 'equipment operator', reason: 'Operating duty is identified but machine/method scope is unspecified; confirm the actual equipment role before claiming complete applicability.' });
  }
  if (!held.size) result.unresolvedRoles.push({ role: person.jobTitle || person.membershipRole || 'unspecified', reason: 'No actual safety duty established; membership permissions alone cannot establish service-role coverage.' });
  result.familyIds = [...new Set(result.familyIds)].sort();
  return result;
}
