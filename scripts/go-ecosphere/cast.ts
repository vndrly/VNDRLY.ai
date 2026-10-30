/** GasGo / FieldGo / FleetGo / GateGo synthetic cast. Every name, plate,
 * address, and contact is fictional. Contact destinations use example.invalid.
 */
export const GO_VERSION = "go-ecosphere-v1";
export const GO_MARKER = `Synthetic VNDRLY test company (${GO_VERSION}). No real work, person, credential, vehicle, or payment is represented.`;
export const GO_TIMEZONE = "America/Chicago";

export type OrgKey = "gasgo" | "fieldgo" | "fleetgo" | "gatego";
export type PersonSpec = {
  key: string;
  first: string;
  last: string;
  title: string;
  org: OrgKey;
  /** users.role */
  userRole: "partner" | "vendor" | "field_employee";
  /** user_org_memberships.role */
  membership: "admin" | "member" | "ap" | "field_employee";
  /** vendor_people.vendor_role (vendors only) */
  vendorRole?: "office" | "field" | "foreman" | "both" | "gatekeeper" | "gate_supervisor";
  operationalRoles?: ("office" | "field_employee" | "foreman" | "gatekeeper" | "gate_supervisor")[];
  extraRoles?: string[];
  crew?: "A" | "B" | "tech";
  hourlyRate?: number;
  surface: "web" | "ios" | "both";
};

export const ORGS = {
  gasgo: {
    name: "GasGo",
    legal: "GasGo Energy Operating, LLC (synthetic)",
    contact: "Dana Whitfield",
    phone: "(432) 555-0100",
    address: "100 Synthetic Plaza, Midland, TX 79701 (fictional)",
    primary: "#0F4C5C",
    accent: "#F28C28",
  },
  fieldgo: {
    name: "FieldGo",
    legal: "FieldGo Oilfield Services, LLC (synthetic)",
    contact: "Ray Castillo",
    phone: "(432) 555-0200",
    address: "200 Synthetic Yard Rd, Stanton, TX 79782 (fictional)",
    primary: "#2E5A27",
    accent: "#F2B705",
    categories: ["field"],
  },
  fleetgo: {
    name: "FleetGo",
    legal: "FleetGo Transport, LLC (synthetic)",
    contact: "Curtis Lyle",
    phone: "(432) 555-0300",
    address: "300 Synthetic Hwy 137, Stanton, TX 79782 (fictional)",
    primary: "#1D3557",
    accent: "#E63946",
    categories: ["fleet"],
  },
  gatego: {
    name: "GateGo",
    legal: "GateGo Site Security, LLC (synthetic)",
    contact: "Sharon Pike",
    phone: "(432) 555-0400",
    address: "400 Synthetic Loop 250, Midland, TX 79705 (fictional)",
    primary: "#3D405B",
    accent: "#81B29A",
    categories: ["gate"],
  },
} as const;

const p = (
  org: OrgKey,
  key: string,
  first: string,
  last: string,
  title: string,
  rest: Omit<PersonSpec, "key" | "first" | "last" | "title" | "org">,
): PersonSpec => ({ org, key, first, last, title, ...rest });

export const PEOPLE: PersonSpec[] = [
  // GasGo — partner / operator office
  p("gasgo", "dana-whitfield", "Dana", "Whitfield", "VP Operations", { userRole: "partner", membership: "admin", surface: "both" }),
  p("gasgo", "marcus-delgado", "Marcus", "Delgado", "Production Superintendent", { userRole: "partner", membership: "admin", surface: "both" }),
  p("gasgo", "earl-tatum", "Earl", "Tatum", "Company Man / Field Representative", { userRole: "partner", membership: "member", surface: "ios" }),
  p("gasgo", "lena-okafor", "Lena", "Okafor", "Production Foreman", { userRole: "partner", membership: "member", surface: "ios" }),
  p("gasgo", "tom-brandt", "Tom", "Brandt", "Completions Engineer", { userRole: "partner", membership: "member", surface: "web" }),
  p("gasgo", "priya-raman", "Priya", "Raman", "Accounts Payable", { userRole: "partner", membership: "ap", surface: "web" }),

  // FieldGo — field operations vendor
  p("fieldgo", "ray-castillo", "Ray", "Castillo", "Owner", { userRole: "vendor", membership: "admin", vendorRole: "office", operationalRoles: ["office"], surface: "both" }),
  p("fieldgo", "brenda-nguyen", "Brenda", "Nguyen", "Office Manager", { userRole: "vendor", membership: "admin", vendorRole: "office", operationalRoles: ["office"], surface: "web" }),
  p("fieldgo", "kim-albright", "Kim", "Albright", "Billing & AR", { userRole: "vendor", membership: "member", vendorRole: "office", operationalRoles: ["office"], extraRoles: ["accounts_payable"], surface: "web" }),
  p("fieldgo", "hector-ruiz", "Hector", "Ruiz", "Crew A Foreman", { userRole: "field_employee", membership: "field_employee", vendorRole: "foreman", operationalRoles: ["foreman", "field_employee"], crew: "A", hourlyRate: 42, surface: "ios" }),
  p("fieldgo", "wade-pruitt", "Wade", "Pruitt", "Crew B Foreman / HSE", { userRole: "field_employee", membership: "field_employee", vendorRole: "foreman", operationalRoles: ["foreman", "field_employee"], extraRoles: ["HSE / Safety Officer"], crew: "B", hourlyRate: 42, surface: "ios" }),
  p("fieldgo", "luis-garza", "Luis", "Garza", "Roustabout", { userRole: "field_employee", membership: "field_employee", vendorRole: "field", operationalRoles: ["field_employee"], crew: "A", hourlyRate: 27, surface: "ios" }),
  p("fieldgo", "cody-harmon", "Cody", "Harmon", "Roustabout", { userRole: "field_employee", membership: "field_employee", vendorRole: "field", operationalRoles: ["field_employee"], crew: "A", hourlyRate: 26, surface: "ios" }),
  p("fieldgo", "andre-wallace", "Andre", "Wallace", "Roustabout Lead", { userRole: "field_employee", membership: "field_employee", vendorRole: "field", operationalRoles: ["field_employee"], crew: "A", hourlyRate: 31, surface: "ios" }),
  p("fieldgo", "jesse-ortiz", "Jesse", "Ortiz", "Roustabout", { userRole: "field_employee", membership: "field_employee", vendorRole: "field", operationalRoles: ["field_employee"], crew: "A", hourlyRate: 25, surface: "ios" }),
  p("fieldgo", "jake-lindell", "Jake", "Lindell", "Welder Helper", { userRole: "field_employee", membership: "field_employee", vendorRole: "field", operationalRoles: ["field_employee"], crew: "A", hourlyRate: 28, surface: "ios" }),
  p("fieldgo", "mateo-silva", "Mateo", "Silva", "Roustabout Lead", { userRole: "field_employee", membership: "field_employee", vendorRole: "field", operationalRoles: ["field_employee"], crew: "B", hourlyRate: 31, surface: "ios" }),
  p("fieldgo", "travis-boone", "Travis", "Boone", "Roustabout", { userRole: "field_employee", membership: "field_employee", vendorRole: "field", operationalRoles: ["field_employee"], crew: "B", hourlyRate: 26, surface: "ios" }),
  p("fieldgo", "darnell-hughes", "Darnell", "Hughes", "Roustabout", { userRole: "field_employee", membership: "field_employee", vendorRole: "field", operationalRoles: ["field_employee"], crew: "B", hourlyRate: 25, surface: "ios" }),
  p("fieldgo", "eli-morrison", "Eli", "Morrison", "Roustabout", { userRole: "field_employee", membership: "field_employee", vendorRole: "field", operationalRoles: ["field_employee"], crew: "B", hourlyRate: 25, surface: "ios" }),
  p("fieldgo", "sam-kowalski", "Sam", "Kowalski", "Wellhead Technician", { userRole: "field_employee", membership: "field_employee", vendorRole: "field", operationalRoles: ["field_employee"], crew: "tech", hourlyRate: 38, surface: "ios" }),
  p("fieldgo", "rosa-mendez", "Rosa", "Mendez", "Instrumentation Technician", { userRole: "field_employee", membership: "field_employee", vendorRole: "field", operationalRoles: ["field_employee"], crew: "tech", hourlyRate: 40, surface: "ios" }),
  p("fieldgo", "nick-fuentes", "Nick", "Fuentes", "Pumping Unit Technician", { userRole: "field_employee", membership: "field_employee", vendorRole: "field", operationalRoles: ["field_employee"], crew: "tech", hourlyRate: 37, surface: "ios" }),
  p("fieldgo", "grady-cole", "Grady", "Cole", "Equipment Operator", { userRole: "field_employee", membership: "field_employee", vendorRole: "field", operationalRoles: ["field_employee"], crew: "tech", hourlyRate: 34, surface: "ios" }),

  // FleetGo — fleet operations vendor
  p("fleetgo", "curtis-lyle", "Curtis", "Lyle", "Owner", { userRole: "vendor", membership: "admin", vendorRole: "office", operationalRoles: ["office"], surface: "both" }),
  p("fleetgo", "tanya-brooks", "Tanya", "Brooks", "Fleet Manager", { userRole: "vendor", membership: "member", vendorRole: "office", operationalRoles: ["office"], surface: "both" }),
  p("fleetgo", "javier-soto", "Javier", "Soto", "Dispatcher", { userRole: "vendor", membership: "member", vendorRole: "office", operationalRoles: ["office"], surface: "both" }),
  p("fleetgo", "monica-reyes", "Monica", "Reyes", "Billing", { userRole: "vendor", membership: "member", vendorRole: "office", operationalRoles: ["office"], surface: "web" }),
  p("fleetgo", "dale-hutchins", "Dale", "Hutchins", "Shop Mechanic", { userRole: "vendor", membership: "member", vendorRole: "office", operationalRoles: ["office"], surface: "ios" }),
  ...([
    ["bobby-jenkins", "Bobby", "Jenkins"],
    ["ray-alvarado", "Ray", "Alvarado"],
    ["kenny-watts", "Kenny", "Watts"],
    ["omar-haddad", "Omar", "Haddad"],
    ["shane-mcbride", "Shane", "McBride"],
    ["victor-pena", "Victor", "Pena"],
    ["trent-dawson", "Trent", "Dawson"],
    ["alicia-romero", "Alicia", "Romero"],
  ] as const).map(([key, first, last]) =>
    p("fleetgo", key, first, last, "CDL Driver", { userRole: "field_employee", membership: "field_employee", vendorRole: "field", operationalRoles: ["field_employee"], hourlyRate: 30, surface: "ios" }),
  ),

  // GateGo — gate operations vendor
  p("gatego", "sharon-pike", "Sharon", "Pike", "Owner", { userRole: "vendor", membership: "admin", vendorRole: "office", operationalRoles: ["office"], surface: "both" }),
  p("gatego", "luis-ortega", "Luis", "Ortega", "Gate Supervisor", { userRole: "field_employee", membership: "field_employee", vendorRole: "gate_supervisor", operationalRoles: ["gate_supervisor", "gatekeeper"], hourlyRate: 26, surface: "both" }),
  p("gatego", "amber-cole", "Amber", "Cole", "Scheduler", { userRole: "vendor", membership: "member", vendorRole: "office", operationalRoles: ["office"], surface: "web" }),
  ...([
    ["dewayne-carter", "DeWayne", "Carter"],
    ["maria-sanchez", "Maria", "Sanchez"],
    ["frank-oneal", "Frank", "O'Neal"],
    ["tasha-greene", "Tasha", "Greene"],
    ["rudy-villarreal", "Rudy", "Villarreal"],
    ["connie-marsh", "Connie", "Marsh"],
    ["isaac-thornton", "Isaac", "Thornton"],
    ["yolanda-price", "Yolanda", "Price"],
    ["pete-schulz", "Pete", "Schulz"],
    ["nadia-farouk", "Nadia", "Farouk"],
    ["glen-whitaker", "Glen", "Whitaker"],
  ] as const).map(([key, first, last]) =>
    p("gatego", key, first, last, "Gatekeeper", { userRole: "field_employee", membership: "field_employee", vendorRole: "gatekeeper", operationalRoles: ["gatekeeper"], hourlyRate: 19, surface: "ios" }),
  ),
];

/** Cross-company reviewer: admin in all four, mirrors the Prairie review identity. */
export const REVIEWER = { key: "review", first: "Go", last: "Reviewer", title: "Cross-company test reviewer" };

export type SiteSpec = {
  key: string;
  name: string;
  kind: "pad" | "ctb" | "yard";
  lat: number;
  lng: number;
  county: string;
  gated: boolean;
  fleetMode: "batch" | "singles";
  afe: string;
};

export const SITES: SiteSpec[] = [
  { key: "adr-ctb", name: "Antelope Draw Central Tank Battery", kind: "ctb", lat: 32.229, lng: -101.9702, county: "Martin", gated: true, fleetMode: "batch", afe: "AFE-26-0410" },
  { key: "crg-ctb", name: "Coyote Ridge 9 Central Tank Battery", kind: "ctb", lat: 32.3105, lng: -101.8841, county: "Martin", gated: true, fleetMode: "batch", afe: "AFE-26-0422" },
  { key: "stanton-yard", name: "GasGo Stanton Field Office & Yard", kind: "yard", lat: 32.1338, lng: -101.8122, county: "Martin", gated: true, fleetMode: "singles", afe: "AFE-26-0001" },
  { key: "adr-12-1h", name: "Antelope Draw 12-1H Pad", kind: "pad", lat: 32.2412, lng: -101.9876, county: "Martin", gated: false, fleetMode: "singles", afe: "AFE-26-0411" },
  { key: "adr-12-2h", name: "Antelope Draw 12-2H Pad", kind: "pad", lat: 32.2468, lng: -101.9791, county: "Martin", gated: false, fleetMode: "singles", afe: "AFE-26-0412" },
  { key: "rbl-7-3h", name: "Red Bluff 7 Unit 3H Pad", kind: "pad", lat: 32.2875, lng: -101.9124, county: "Martin", gated: false, fleetMode: "batch", afe: "AFE-26-0430" },
  { key: "shl-22-3h", name: "Sand Hill 22-3H Pad", kind: "pad", lat: 32.1951, lng: -101.9433, county: "Martin", gated: false, fleetMode: "singles", afe: "AFE-26-0441" },
  { key: "mft-4-1h", name: "Mustang Flats 4-1H Pad", kind: "pad", lat: 32.3348, lng: -101.8513, county: "Martin", gated: false, fleetMode: "batch", afe: "AFE-26-0452" },
  { key: "dck-31-2h", name: "Dry Creek 31-2H Pad", kind: "pad", lat: 32.1622, lng: -101.8804, county: "Martin", gated: false, fleetMode: "singles", afe: "AFE-26-0463" },
  { key: "cpk-15-4h", name: "Caprock 15-4H Pad", kind: "pad", lat: 32.3561, lng: -101.9307, county: "Martin", gated: false, fleetMode: "singles", afe: "AFE-26-0474" },
  { key: "wml-18-1h", name: "Windmill 18-1H Pad", kind: "pad", lat: 32.2117, lng: -101.8457, county: "Martin", gated: false, fleetMode: "batch", afe: "AFE-26-0485" },
];

export const DESTINATIONS = [
  { key: "lone-mesa-swd", name: "Lone Mesa SWD #2", kind: "disposal" as const, lat: 32.1702, lng: -101.9311, materials: ["produced water", "flowback"], hours: "24/7 — synthetic" },
  { key: "cr1200-swd", name: "County Road 1200 SWD", kind: "disposal" as const, lat: 32.2803, lng: -101.7655, materials: ["produced water"], hours: "05:00–22:00 — synthetic" },
  { key: "midland-crude", name: "Midland Crude Terminal (fictional)", kind: "delivery" as const, lat: 32.045, lng: -101.98, materials: ["crude oil"], hours: "06:00–20:00 — synthetic" },
  { key: "fleetgo-yard", name: "FleetGo Stanton Yard", kind: "yard" as const, lat: 32.118, lng: -101.789, materials: ["equipment"], hours: "Shop 06:00–18:00 — synthetic" },
];

export type WorkTypeSpec = {
  key: string;
  name: string;
  category: "Field Ops" | "Fleet Ops" | "Gate";
  vendor: OrgKey;
  unit: "per_hour" | "per_job" | "per_day";
  price: number;
  weight: number;
  crewSize: [number, number];
  hours: [number, number];
  certs?: string[];
  parts?: [string, number][];
};

export const WORK_TYPES: WorkTypeSpec[] = [
  { key: "roustabout", name: "Roustabout crew labor", category: "Field Ops", vendor: "fieldgo", unit: "per_hour", price: 62, weight: 22, crewSize: [3, 5], hours: [6, 11], certs: ["SafeLand USA", "H2S Clear"], parts: [["2\" ball valve", 86], ["Teflon tape (case)", 24], ["Pipe dope (qt)", 18]] },
  { key: "wellhead", name: "Wellhead maintenance & repair", category: "Field Ops", vendor: "fieldgo", unit: "per_hour", price: 95, weight: 12, crewSize: [1, 2], hours: [3, 8], certs: ["H2S Clear"], parts: [["Wellhead gasket kit", 145], ["Packing rings (set)", 92], ["Needle valve", 64]] },
  { key: "pumping-unit", name: "Pumping unit service", category: "Field Ops", vendor: "fieldgo", unit: "per_hour", price: 105, weight: 10, crewSize: [1, 2], hours: [3, 9], certs: ["H2S Clear"], parts: [["Gearbox oil (5 gal)", 118], ["Polished rod clamp", 210], ["V-belt set", 176]] },
  { key: "flowline", name: "Flowline repair", category: "Field Ops", vendor: "fieldgo", unit: "per_hour", price: 85, weight: 9, crewSize: [2, 4], hours: [4, 10], certs: ["SafeLand USA"], parts: [["3\" poly pipe (20 ft)", 140], ["Weld fittings", 75], ["Repair clamp 3\"", 58]] },
  { key: "tank-battery", name: "Tank battery maintenance", category: "Field Ops", vendor: "fieldgo", unit: "per_hour", price: 78, weight: 9, crewSize: [2, 4], hours: [4, 10], certs: ["H2S Clear"], parts: [["Thief hatch gasket", 48], ["Level float switch", 132]] },
  { key: "valve", name: "Valve replacement", category: "Field Ops", vendor: "fieldgo", unit: "per_job", price: 650, weight: 6, crewSize: [1, 2], hours: [2, 5], parts: [["3\" gate valve", 420], ["Flange bolts (set)", 38]] },
  { key: "cleanup", name: "Location cleanup & housekeeping", category: "Field Ops", vendor: "fieldgo", unit: "per_hour", price: 55, weight: 8, crewSize: [2, 4], hours: [4, 9] },
  { key: "instrumentation", name: "Instrumentation & automation", category: "Field Ops", vendor: "fieldgo", unit: "per_hour", price: 115, weight: 7, crewSize: [1, 1], hours: [3, 8], parts: [["Pressure transmitter", 385], ["RTU battery", 96], ["Solar charge controller", 154]] },
  { key: "backhoe", name: "Backhoe & equipment operation", category: "Field Ops", vendor: "fieldgo", unit: "per_hour", price: 125, weight: 5, crewSize: [1, 2], hours: [3, 9] },
  { key: "spill", name: "Spill response", category: "Field Ops", vendor: "fieldgo", unit: "per_hour", price: 140, weight: 2, crewSize: [3, 5], hours: [5, 12], parts: [["Absorbent boom (10 ft)", 62], ["Absorbent pads (bale)", 88]] },
  { key: "pw-haul", name: "Produced water haul — per load", category: "Fleet Ops", vendor: "fleetgo", unit: "per_job", price: 185, weight: 70, crewSize: [1, 1], hours: [1, 3], certs: ["CDL Class A", "DOT Medical Card"] },
  { key: "crude-haul", name: "Crude oil transport — per load", category: "Fleet Ops", vendor: "fleetgo", unit: "per_job", price: 340, weight: 20, crewSize: [1, 1], hours: [2, 4], certs: ["CDL Class A", "Hazmat Endorsement"] },
  { key: "hotshot", name: "Hotshot equipment delivery", category: "Fleet Ops", vendor: "fleetgo", unit: "per_hour", price: 95, weight: 10, crewSize: [1, 1], hours: [2, 5], certs: ["DOT Medical Card"] },
  { key: "gate-coverage", name: "Gate attendant coverage", category: "Gate", vendor: "gatego", unit: "per_hour", price: 32, weight: 1, crewSize: [1, 1], hours: [12, 12], certs: ["Texas Level II Security"] },
];

export const FLEET_ASSETS = [
  { key: "u101", name: "Unit 101 — 2019 Peterbilt 389 Vacuum Truck (130 bbl)", category: "truck", plate: "FGT-4101", vin: "1XPWD49X0KD000101", kind: "vac" },
  { key: "u102", name: "Unit 102 — 2020 Kenworth T880 Vacuum Truck (130 bbl)", category: "truck", plate: "FGT-4102", vin: "1NKZL40X0LJ000102", kind: "vac" },
  { key: "u103", name: "Unit 103 — 2018 Peterbilt 567 Vacuum Truck (130 bbl)", category: "truck", plate: "FGT-4103", vin: "1XPCD49X0JD000103", kind: "vac" },
  { key: "u104", name: "Unit 104 — 2021 Kenworth T880 Vacuum Truck (130 bbl)", category: "truck", plate: "FGT-4104", vin: "1NKZL40X0MJ000104", kind: "vac" },
  { key: "u105", name: "Unit 105 — 2017 Mack Granite Vacuum Truck (110 bbl)", category: "truck", plate: "FGT-4105", vin: "1M2AX07C0HM000105", kind: "vac" },
  { key: "u201", name: "Unit 201 — 2022 Peterbilt 579 Tractor", category: "truck", plate: "FGT-4201", vin: "1XPBD49X0ND000201", kind: "tractor" },
  { key: "u202", name: "Unit 202 — 2019 Freightliner Cascadia Tractor", category: "truck", plate: "FGT-4202", vin: "3AKJHHDR0KS000202", kind: "tractor" },
  { key: "u301", name: "Unit 301 — 2021 Ford F-550 Hotshot", category: "truck", plate: "FGT-4301", vin: "1FDUF5HT0MD000301", kind: "hotshot" },
  { key: "t11", name: "Trailer T-11 — Polar 180 bbl Crude Tank", category: "trailer", plate: "FGR-1011", vin: "1PMS21000PL000011", kind: "crude-trailer" },
  { key: "t12", name: "Trailer T-12 — Polar 180 bbl Crude Tank", category: "trailer", plate: "FGR-1012", vin: "1PMS21000PL000012", kind: "crude-trailer" },
  { key: "t21", name: "Trailer T-21 — 40 ft Gooseneck Flatbed", category: "trailer", plate: "FGR-1021", vin: "4ZEGH4020M1000021", kind: "flatbed" },
  { key: "t31", name: "Trailer T-31 — 130 bbl Vacuum Pup", category: "trailer", plate: "FGR-1031", vin: "1S9VT2026L1000031", kind: "vac-trailer" },
  { key: "t32", name: "Trailer T-32 — 130 bbl Vacuum Pup", category: "trailer", plate: "FGR-1032", vin: "1S9VT2026L1000032", kind: "vac-trailer" },
  { key: "t41", name: "Trailer T-41 — 500 bbl Frac Tank (staged)", category: "trailer", plate: "FGR-1041", vin: "1F9FT5000K1000041", kind: "frac-tank" },
];

export const FIELD_ASSETS = [
  { key: "ct1", name: "Crew Truck A1 — 2022 Ford F-350", category: "vehicle", plate: "FDG-2201" },
  { key: "ct2", name: "Crew Truck A2 — 2021 Ford F-250", category: "vehicle", plate: "FDG-2202" },
  { key: "ct3", name: "Crew Truck B1 — 2023 Ram 3500", category: "vehicle", plate: "FDG-2203" },
  { key: "ct4", name: "Crew Truck B2 — 2020 Chevy 2500HD", category: "vehicle", plate: "FDG-2204" },
  { key: "ct5", name: "Tech Truck T1 — 2022 Ford F-250", category: "vehicle", plate: "FDG-2205" },
  { key: "ct6", name: "Tech Truck T2 — 2021 Toyota Tundra", category: "vehicle", plate: "FDG-2206" },
  { key: "bh1", name: "Backhoe — 2019 CAT 420F2", category: "equipment", plate: "FDG-EQ01" },
  { key: "wr1", name: "Welding Rig — 2020 F-350 w/ Miller Bobcat", category: "vehicle", plate: "FDG-2207" },
];
