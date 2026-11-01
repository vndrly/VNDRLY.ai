/** Authored safety requirement families; service applicability never grants readiness or credit. */
export const SAFETY_LIBRARY_REQUIREMENTS = [
  {
    "id": "L01",
    "title": "Leadership commitment and accountable safety roles",
    "category": "leadership",
    "applicability": "Common"
  },
  {
    "id": "L02",
    "title": "Worker participation and safety meetings",
    "category": "leadership",
    "applicability": "Common"
  },
  {
    "id": "L03",
    "title": "Stop-work and safe restart",
    "category": "leadership",
    "applicability": "Common"
  },
  {
    "id": "L04",
    "title": "Subcontractor selection and safety bridging",
    "category": "leadership",
    "applicability": "Common process; activate for subcontracted work"
  },
  {
    "id": "L05",
    "title": "Service applicability, legal obligations and controlled documents",
    "category": "leadership",
    "applicability": "Common"
  },
  {
    "id": "H01",
    "title": "Task risk assessment and JSA/JHA",
    "category": "hazards",
    "applicability": "Common; detail follows tasks"
  },
  {
    "id": "H02",
    "title": "Critical-control checks and line of fire",
    "category": "hazards",
    "applicability": "Common risk-screen; service controls conditional"
  },
  {
    "id": "H03",
    "title": "Permit to work and SIMOPS coordination",
    "category": "hazards",
    "applicability": "Service-specific: construction, maintenance, production and hazardous work"
  },
  {
    "id": "H04",
    "title": "Hazardous energy isolation / LOTO",
    "category": "hazards",
    "applicability": "Service-specific: maintenance, electrical, machinery and pressure systems"
  },
  {
    "id": "H05",
    "title": "Confined-space entry",
    "category": "hazards",
    "applicability": "Service-specific: tanks, pits, vessels, sewers and similar spaces"
  },
  {
    "id": "H06",
    "title": "Hot work and fire watch",
    "category": "hazards",
    "applicability": "Service-specific: welding, cutting, grinding and ignition-producing tasks"
  },
  {
    "id": "H07",
    "title": "Lifting, rigging and suspended loads",
    "category": "hazards",
    "applicability": "Service-specific: crane, hoist and rigging work"
  },
  {
    "id": "H08",
    "title": "Work at height, scaffolds and dropped objects",
    "category": "hazards",
    "applicability": "Service-specific: elevated work, scaffolding and rope access"
  },
  {
    "id": "H09",
    "title": "Excavation and underground services",
    "category": "hazards",
    "applicability": "Service-specific: civil works, trenching, grading and digging"
  },
  {
    "id": "H10",
    "title": "Pressure pumping, testing and exclusion zones",
    "category": "hazards",
    "applicability": "Service-specific: wellsite, pressure, production and testing services"
  },
  {
    "id": "H11",
    "title": "Breaking containment and process handback",
    "category": "hazards",
    "applicability": "Service-specific: piping, vessels, maintenance and production"
  },
  {
    "id": "H12",
    "title": "Electrical work and arc-flash controls",
    "category": "hazards",
    "applicability": "Service-specific: electrical/instrumentation; basic awareness for exposed workers"
  },
  {
    "id": "H13",
    "title": "H2S and hazardous-atmosphere awareness",
    "category": "hazards",
    "applicability": "Service-specific: sour gas, production, tanks and affected support staff"
  },
  {
    "id": "H14",
    "title": "Chemicals, SDS and exposure assessment",
    "category": "hazards",
    "applicability": "Common screening; chemical controls conditional"
  },
  {
    "id": "H15",
    "title": "Respiratory protection",
    "category": "hazards",
    "applicability": "Service-specific: airborne exposure requiring respirators"
  },
  {
    "id": "H16",
    "title": "Silica, asbestos, lead and coating hazards",
    "category": "hazards",
    "applicability": "Service-specific: concrete, demolition, blasting, painting and abatement"
  },
  {
    "id": "H17",
    "title": "Noise and hearing conservation",
    "category": "hazards",
    "applicability": "Service-specific: noisy equipment and work areas"
  },
  {
    "id": "H18",
    "title": "Heat, cold and severe weather",
    "category": "hazards",
    "applicability": "Common exposure screening; controls by climate/workload"
  },
  {
    "id": "H19",
    "title": "Driving, journey planning and fatigue",
    "category": "hazards",
    "applicability": "Service-specific: business driving and transport; screen all Vendors"
  },
  {
    "id": "H20",
    "title": "Traffic, gate access and pedestrian separation",
    "category": "hazards",
    "applicability": "Service-specific: gate/site support, yards and mobile equipment interfaces"
  },
  {
    "id": "H21",
    "title": "Lone work, workplace violence and remote check-ins",
    "category": "hazards",
    "applicability": "Service-specific: gate/security, remote support and isolated maintenance"
  },
  {
    "id": "H22",
    "title": "Manual handling and ergonomics",
    "category": "hazards",
    "applicability": "Common exposure screening; task controls conditional"
  },
  {
    "id": "H23",
    "title": "Machine guarding, hand tools and housekeeping",
    "category": "hazards",
    "applicability": "Service-specific: shops, fabrication, maintenance and yards"
  },
  {
    "id": "H24",
    "title": "Specialist hazards: radiation, explosives, diving, marine and rail",
    "category": "hazards",
    "applicability": "Service-specific only when actual services/exposure trigger"
  },
  {
    "id": "C01",
    "title": "Role/task competence matrix and authorization",
    "category": "competence",
    "applicability": "Common"
  },
  {
    "id": "C02",
    "title": "Induction, orientation and understandable communication",
    "category": "competence",
    "applicability": "Common company induction; Partner adds site orientation"
  },
  {
    "id": "C03",
    "title": "Short-service workers and supervision",
    "category": "competence",
    "applicability": "Common process; activate for inexperienced or changed-role workers"
  },
  {
    "id": "C04",
    "title": "Training delivery and practical assessor assurance",
    "category": "competence",
    "applicability": "Common"
  },
  {
    "id": "C05",
    "title": "Commercial drivers and transport authorization",
    "category": "competence",
    "applicability": "Service-specific: regulated transport and designated drivers"
  },
  {
    "id": "C06",
    "title": "Mobile equipment, forklift and lifting-role assessment",
    "category": "competence",
    "applicability": "Service-specific: operators, riggers and signal persons"
  },
  {
    "id": "C07",
    "title": "Permit, isolation, gas-test and electrical role endorsements",
    "category": "competence",
    "applicability": "Service-specific: designated high-risk work roles"
  },
  {
    "id": "C08",
    "title": "Emergency responders and occupational first aid",
    "category": "competence",
    "applicability": "Service-specific roles; common coverage planning"
  },
  {
    "id": "E01",
    "title": "Asset register and preventive maintenance",
    "category": "equipment",
    "applicability": "Common asset screening; requirements by asset"
  },
  {
    "id": "E02",
    "title": "Pre-use inspections, defects and out-of-service control",
    "category": "equipment",
    "applicability": "Common where equipment is used"
  },
  {
    "id": "E03",
    "title": "Vehicles, trailers, load securement and recovery",
    "category": "equipment",
    "applicability": "Service-specific: transport, hauling and mobile services"
  },
  {
    "id": "E04",
    "title": "Gas detectors and measurement assurance",
    "category": "equipment",
    "applicability": "Service-specific: gas testing and exposure detection"
  },
  {
    "id": "E05",
    "title": "Pressure equipment, hoses and relief devices",
    "category": "equipment",
    "applicability": "Service-specific: pressure/production, compressed systems and testing"
  },
  {
    "id": "E06",
    "title": "Lifting gear, access equipment and fall protection inspection",
    "category": "equipment",
    "applicability": "Service-specific: lifting and elevated work"
  },
  {
    "id": "E07",
    "title": "PPE assessment, issue and care",
    "category": "equipment",
    "applicability": "Common needs assessment; specialist PPE conditional"
  },
  {
    "id": "E08",
    "title": "Shop and facility readiness",
    "category": "equipment",
    "applicability": "Service-specific: shops, yards and commercial premises"
  },
  {
    "id": "E09",
    "title": "Vacuum, hydroblasting and specialist service equipment",
    "category": "equipment",
    "applicability": "Service-specific: industrial cleaning and vacuum services"
  },
  {
    "id": "I01",
    "title": "Incident, near-miss and hazard reporting",
    "category": "learning",
    "applicability": "Common"
  },
  {
    "id": "I02",
    "title": "Investigation and causal analysis",
    "category": "learning",
    "applicability": "Common process; depth proportional to potential harm"
  },
  {
    "id": "I03",
    "title": "Corrective actions and effectiveness verification",
    "category": "learning",
    "applicability": "Common"
  },
  {
    "id": "I04",
    "title": "Learning alerts and post-job review",
    "category": "learning",
    "applicability": "Common; content relevant to service"
  },
  {
    "id": "I05",
    "title": "Incident history and exposure-data integrity",
    "category": "learning",
    "applicability": "Common; separate outcome measure"
  },
  {
    "id": "I06",
    "title": "Medical response, restricted records and return-to-work interfaces",
    "category": "learning",
    "applicability": "Common response process; exposure/medical detail conditional"
  },
  {
    "id": "R01",
    "title": "Emergency plan and site interface",
    "category": "emergency",
    "applicability": "Common company plan; scenarios/service and site details conditional"
  },
  {
    "id": "R02",
    "title": "Rescue plans and emergency equipment readiness",
    "category": "emergency",
    "applicability": "Service-specific: confined spaces, height, water and other rescue exposure"
  },
  {
    "id": "R03",
    "title": "Drills, exercises and after-action improvement",
    "category": "emergency",
    "applicability": "Common schedule; actual scenarios risk-based"
  },
  {
    "id": "R04",
    "title": "Assurance audits and critical-control observations",
    "category": "emergency",
    "applicability": "Common; depth follows service risk"
  },
  {
    "id": "R05",
    "title": "Management review and improvement objectives",
    "category": "emergency",
    "applicability": "Common"
  },
  {
    "id": "R06",
    "title": "Management of change and renewal review",
    "category": "emergency",
    "applicability": "Common change screening; technical MOC conditional"
  },
  {
    "id": "R07",
    "title": "Environmental release and spill emergency interface",
    "category": "emergency",
    "applicability": "Service-specific: fuels, chemicals, pressure/production, transport and waste"
  }
] as const;

export const SAFETY_LIBRARY_RESOURCE_TYPES = ["policy", "form", "training", "evidence-examples"] as const;
export type SafetyLibraryResourceType = typeof SAFETY_LIBRARY_RESOURCE_TYPES[number];
export const SAFETY_LIBRARY_RESOURCE_LABELS: Record<SafetyLibraryResourceType, string> = { policy: "Policy", form: "Form", training: "Training", "evidence-examples": "Evidence examples" };
