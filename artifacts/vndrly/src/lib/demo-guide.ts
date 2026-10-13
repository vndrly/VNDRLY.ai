export const DEMO_VIEWS = {
  partner:{label:'Energy producer / Partner',company:'Prairie Horizon Energy',userId:1081},
  field:{label:'Field Ops vendor',company:'Copper Creek Field Services',userId:1084},
  fleet:{label:'Fleet Ops vendor',company:'Blue Horizon Logistics',userId:1085},
  gate:{label:'Gate vendor',company:'Sentinel Prairie Gate Services',userId:1086},
} as const;
export type DemoPersona=keyof typeof DEMO_VIEWS;
export const DEMO_ENTRY_PATHS:Record<DemoPersona,string>={partner:'/site-locations',field:'/tickets',fleet:'/fleet',gate:'/gate/change-over'};
export type DemoStep={title:string;text:string;path:string;status?:string};
const ticket=(title:string,text:string,status:string):DemoStep=>({title,text,status,path:'/tickets'});
const finish:DemoStep[]=[
  ticket('Submit the work','After checking out, Close for Review hands the ticket and field evidence to the office. Mileage is optional unless the vendor requires it. Workers stop at office review unless corrections are requested.','pending_review'),
  ticket('Office and partner review','The office checks the evidence and the partner reviews the work. A correction can be kicked back for revision; approval moves it toward billing.','approved'),
  ticket('Invoice and payment','Approved work can be invoiced, marked awaiting payment and finally funds dispersed. This demo shows fictional records; it does not send invoices or move money.','funds_dispersed'),
];
export const DEMO_STEPS:Record<DemoPersona,DemoStep[]>={
  partner:[{title:'Request and assign work',text:'The producer manages sites, chooses vendor services and assigns authorized vendors. Hotlist requests can collect bids before selecting a vendor.',path:'/site-locations'},
    ticket('Monitor field progress','Office status tracks acceptance and review. Separately, field lifecycle tracks en route, arrival, on site and off site. Work marked in progress is on site and on the clock.','in_progress'),
    ...finish,
    {title:'Coordinate across companies',text:'Work Hub brings schedules, tasks, conversations and handoffs together while each company sees its permitted work.',path:'/work-hub/calendar'}],
  field:[ticket('Accept an assignment','The vendor accepts assigned work and schedules a qualified worker. Awaiting acceptance and initiated tickets precede travel.','awaiting_acceptance'),
    ticket('Travel and arrive','The worker travels to the site, then checks in. En route and on location describe movement and arrival; they are separate from office approval status.','initiated'),
    ticket('Perform and record work','On-site work is in progress. The worker records labor, materials and notes, then checks out to end the on-site period.','in_progress'),...finish],
  fleet:[{title:'Fleet board and dispatch',text:'The Fleet workspace organizes drivers, trucks and trailers, and runs by site. These are recorded synthetic examples; the public demo does not dispatch real work.',path:'/fleet'},
    {title:'Site-locked tickets and destinations',text:'Each ticket belongs to one originating site. Batch tickets collect several runs; Singles use one ticket per run. Approved disposal or delivery destinations are selected before departure, and office review checks the billing evidence.',path:'/tickets'},
    {title:'Map and recorded route history',text:'The Fleet map shows authorized recorded positions. Route replay uses captured points and timestamps; stale or missing GPS is identified rather than invented. Historical demo positions are not live drivers.',path:'/fleet/history'},
    ticket('Confirm pickup and travel','A fleet run records its pickup, route and delivery context. Location history supports the run; the service ticket records the work for review and billing.','initiated'),
    ticket('Complete delivery','The driver records delivery and completion evidence. Finishing the run and leaving the location ends the field phase before office review.','pending_review'),...finish],
  gate:[{title:'Prepare the gate shift',text:'Review the assigned site, shift coverage and handoff notes before taking responsibility for the gate.',path:'/gate/change-over'},
    {title:'Gate map and shift history',text:'The coverage map combines authorized gates and duty records. Select a historical date to inspect a recorded shift. Missing or stale GPS is labeled; this public demo never tracks real employees or sends escalations.',path:'/gate/change-over'},
    {title:'Check arrivals and credentials',text:'Gate staff identify visitors, confirm site authorization and review required credentials before recording entry. These are fictional visits, not clearance for real people.',path:'/gate/history?range=30d'},
    {title:'Record departure and handoff',text:'Departure closes a visit. Shift notes preserve exceptions and pass responsibility to the next shift. Visit records and service tickets are separate records.',path:'/gate/shift-notes'},
    ticket('Submit the gate service ticket','The gate vendor records staffed service time and submits its service ticket for review. Visitor entry itself is not an invoice.','submitted'),...finish.slice(1)],
};
export const DEMO_STORAGE_KEY='vndrly.public-demo.v1';
export function demoPersona(value:unknown):DemoPersona|undefined{return typeof value==='string'&&Object.hasOwn(DEMO_VIEWS,value)?value as DemoPersona:undefined;}
