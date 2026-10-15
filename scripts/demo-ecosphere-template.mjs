/** One fictional baseline shared by review, screenshots, and public demos.
 * Keys are stable; dates are anchored to an explicit day for repeatable imports.
 * No real organizations, employees, plates, addresses, or contact destinations.
 */
export const DEMO_VERSION = 'prairie-horizon-v1';
export function makeDemoEcosphere(anchor = '2026-10-10') {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(anchor) || Number.isNaN(Date.parse(anchor))) throw new Error('Invalid anchor day');
  const time = (day, hour, minute = 0) => new Date(Date.parse(`${anchor}T00:00:00Z`) - day * 86400000 + hour * 3600000 + minute * 60000).toISOString();
  const vendors = [
    { key: 'field', name: 'Copper Creek Field Services — Demo', service: 'Field Ops', primary: '#245B7A', accent: '#E5A34C', rate: 125 },
    { key: 'fleet', name: 'Blue Horizon Logistics — Demo', service: 'Fleet Ops', primary: '#266879', accent: '#55C9CE', rate: 145 },
    { key: 'gate', name: 'Sentinel Prairie Gate Services — Demo', service: 'Gate', primary: '#51536F', accent: '#B4A1DA', rate: 65 },
  ];
  const names = [['Riley','Brooks'],['Jordan','Reed'],['Casey','Morgan'],['Avery','Lane'],['Taylor','Hayes'],['Cameron','Ellis'],['Dakota','Wells'],['Quinn','Harper'],['Rowan','Parker'],['Skyler','Bennett'],['Reese','Cole'],['Finley','Blake']];
  const people = names.map(([firstName,lastName], i) => ({ key: `person-${i+1}`, firstName, lastName, vendorKey: vendors[Math.floor(i/4)].key, email: `person-${i+1}@example.invalid`, jobTitle: ['Field Technician','Fleet Driver','Gate Attendant'][Math.floor(i/4)], hourlyRate: [36,32,25][Math.floor(i/4)] }));
  const sites = [
    { key:'cedar', name:'Cedar Draw 14 — Demo', address:'Fictional Cedar Draw lease, Oklahoma', latitude:35.5329, longitude:-97.9551 },
    { key:'prairie', name:'Prairie Ridge 7 — Demo', address:'Fictional Prairie Ridge lease, Oklahoma', latitude:35.5842, longitude:-97.8964 },
    { key:'mesa', name:'Red Mesa 22 — Demo', address:'Fictional Red Mesa lease, Oklahoma', latitude:35.4871, longitude:-97.8841 },
  ];
  const workTypes = [
    { key:'field', name:'Wellsite inspection and maintenance — Demo', category:'Field Ops' },
    { key:'fleet', name:'Equipment delivery and fleet transport — Demo', category:'Fleet Ops' },
    { key:'gate', name:'Gate coverage and visitor logging — Demo', category:'Gate' },
  ];
  const tickets=[], runs=[], visits=[], shifts=[], invoices=[];
  const historicalStatuses=['funds_dispersed','approved','awaiting_payment','submitted','pending_review','kicked_back','approved'];
  for(let day=29;day>=0;day--) {
    for(let lane=0;lane<3;lane++) {
      const vendor=vendors[lane], site=sites[(day+lane)%3], person=people[lane*4+day%4];
      const key=`day-${String(29-day+1).padStart(2,'0')}-${vendor.key}`;
      const status=day===0?['in_progress','initiated','awaiting_acceptance'][lane]:historicalStatuses[(day+lane)%historicalStatuses.length];
      const terminal=day>0;
      const started=terminal||status==='in_progress';
      const ticket={key, vendorKey:vendor.key, siteKey:site.key, personKey:person.key, workTypeKey:vendor.key, status, lifecycleState:terminal?'off_site':status==='in_progress'?'on_site':lane===1?'en_route':'pending_arrival', description:`${workTypes[lane].name}: ${site.name}`, notes:'Synthetic product demonstration. No real service or payment occurred.', createdAt:time(day,11), scheduledAt:time(day,13), checkInAt:started?time(day,14,lane*10):null, checkOutAt:terminal?time(day,20,lane*10):null, approvedAt:['approved','awaiting_payment','funds_dispersed'].includes(status)?time(day,21):null, hours:6+day%3, unitPrice:vendor.rate};
      tickets.push(ticket);
      visits.push({key:`visit-${key}`,ticketKey:key,siteKey:site.key,vendorKey:vendor.key,personKey:person.key,checkInAt:time(day,14,lane*10),checkOutAt:terminal?time(day,20,lane*10):null,plate:`DEMO${lane+1}${String(day+1).padStart(2,'0')}`,purpose:vendor.service,notes:'Fictional visitor record for the VNDRLY demo.'});
      if(lane===1) runs.push({key:`run-${key}`,ticketKey:key,siteKey:site.key,vendorKey:vendor.key,personKey:person.key,vehicleKey:`vehicle-${day%4+1}`,startedAt:time(day,13),completedAt:terminal?time(day,20):null,trackingState:terminal?'completed':'active',presenceState:terminal?'off_site':'en_route',latitude:terminal?site.latitude:site.latitude-0.03,longitude:terminal?site.longitude:site.longitude-0.025});
      if(lane===2) shifts.push({key:`shift-${key}`,siteKey:site.key,personKey:person.key,startedAt:time(day,12),endedAt:terminal?time(day,23):null});
      if(day>2&&['funds_dispersed','approved','awaiting_payment'].includes(status)) invoices.push({key:`invoice-${key}`,ticketKey:key,vendorKey:vendor.key,siteKey:site.key,total:(ticket.hours*vendor.rate).toFixed(2),status:status==='funds_dispersed'?'paid':'ready',date:time(day,21)});
    }
  }
  const vehicles=Array.from({length:4},(_,i)=>({key:`vehicle-${i+1}`,name:['Transport Unit 01 — Demo','Service Truck 02 — Demo','Flatbed Unit 03 — Demo','Crew Truck 04 — Demo'][i],vendorKey:'fleet',plate:`DEMOT${i+1}`,status:'available'}));
  const hotlist=tickets.filter((_,i)=>i%3===0||i>=84).map((t,i)=>({key:`hotlist-${t.key}`,vendorKey:t.vendorKey,workTypeKey:t.workTypeKey,siteKey:t.siteKey,ticketKey:t.key,title:`${workTypes.find(w=>w.key===t.workTypeKey).name}: ${sites.find(s=>s.key===t.siteKey).name}`,status:i%4===0?'open':'awarded',amount:(t.hours*t.unitPrice).toFixed(2),createdAt:t.createdAt,deadline:time(-2,18).slice(0,10)}));
  const schedules=tickets.map(t=>({key:`schedule-${t.key}`,vendorKey:t.vendorKey,personKey:t.personKey,siteKey:t.siteKey,ticketKey:t.key,title:t.description,startsAt:t.scheduledAt,endsAt:new Date(Date.parse(t.scheduledAt)+t.hours*3600000).toISOString(),createdAt:t.createdAt}));
  // Include upcoming work as well as history so current calendars are useful.
  for(let day=-1;day>=-7;day--)for(const vendor of vendors){const person=people.find(p=>p.vendorKey===vendor.key);schedules.push({key:`upcoming-${-day}-${vendor.key}`,vendorKey:vendor.key,personKey:person.key,siteKey:sites[-day%3].key,title:`${vendor.service} scheduled coverage — Demo`,startsAt:time(day,13),endsAt:time(day,21),createdAt:time(0,11)});}
  const messages=tickets.map((t,i)=>({key:`message-${t.key}`,vendorKey:t.vendorKey,personKey:t.personKey,body:[`Crew briefing complete for ${sites.find(s=>s.key===t.siteKey).name}. PPE and job plan reviewed.`,`Equipment delivery confirmed. Dispatch and the gate attendant have the arrival window.`,`Shift handoff recorded. Visitor log reconciled and next crew notified.`][i%3]+' Synthetic demo.',createdAt:t.createdAt}));
  const tasks=tickets.map((t,i)=>({key:`task-${t.key}`,vendorKey:t.vendorKey,personKey:t.personKey,title:['Review service ticket and field evidence — Demo','Confirm transport and equipment return — Demo','Reconcile gate visitor log — Demo'][i%3],status:i<81?'completed':i%2?'in_progress':'open',priority:i%9===0?'high':'normal',dueAt:t.checkOutAt??t.scheduledAt,createdAt:t.createdAt}));
  return {version:DEMO_VERSION,anchor,synthetic:true,partner:{key:'partner',name:'Prairie Horizon Energy — Demo',contactName:'Morgan Ellis — Demo',email:'partner@example.invalid',primary:'#214B67',accent:'#E5A34C'},vendors,people,sites,workTypes,vehicles,tickets,runs,visits,shifts,invoices,hotlist,schedules,messages,tasks};
}
