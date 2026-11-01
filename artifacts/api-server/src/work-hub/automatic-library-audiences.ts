export const automaticLibraryAudiences=[
 {id:'audience:admin',name:'Admin'},
 {id:'audience:all-hands',name:'All Hands'},
 {id:'audience:office-staff',name:'Office Staff'},
 {id:'audience:gate-supervisors',name:'Gate Supervisor'},
 {id:'audience:gatekeepers',name:'Gatekeepers'},
];
type Person={userId:number;role:string;vendorPeopleId:number|null};
type Staff={id:number;userId:number|null;vendorRole:string;roles:string[]};
export function automaticAudienceMembers(id:string,people:Person[],staff:Staff[]){
 if(!automaticLibraryAudiences.some(a=>a.id===id))throw new Error('Unknown automatic audience');
 return people.filter(person=>{
  const worker=staff.find(s=>s.id===person.vendorPeopleId||s.userId===person.userId);
  const roles=worker?[worker.vendorRole,...worker.roles].map(r=>r.trim().toLowerCase().replace(/[\s-]+/g,'_')):[];
  if(person.vendorPeopleId!==null&&!worker)return false;
  if(id==='audience:all-hands')return true;
  if(id==='audience:admin')return person.role==='admin';
  if(id==='audience:office-staff')return roles.some(r=>r==='office'||r==='office_staff');
  if(id==='audience:gate-supervisors')return roles.includes('gate_supervisor');
  return roles.includes('gatekeeper');
 }).map(p=>p.userId);
}
