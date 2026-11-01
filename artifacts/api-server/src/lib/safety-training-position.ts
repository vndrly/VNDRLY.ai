const normalized=(value:string)=>value.trim().replace(/\s+/g,' ').toLowerCase();
export type TrainingPosition={id:string;label:string;aliases?:string[]};
export function trainingPositionIds(person:{jobTitle:string|null;roles:string[];vendorRole:string;membershipRole?:string},positions:TrainingPosition[]){
 const labels=[person.jobTitle??'',...person.roles].map(normalized).filter(Boolean);
 const accountIds=[...(person.membershipRole==="admin"?["account:admin"]:[]),...(["office","both"].includes(person.vendorRole)?["account:office_staff"]:[]),...(person.vendorRole==="gate_supervisor"||person.roles.includes("gate_supervisor")?["account:gate_supervisor"]:person.vendorRole==="gatekeeper"||person.roles.includes("gatekeeper")?["account:gatekeeper"]:[])];
 return [...new Set([...accountIds,`operation:${normalized(person.vendorRole)}`,...person.roles.map(r=>`operation:${normalized(r)}`),...(person.jobTitle?[`title:${normalized(person.jobTitle)}`]:[]),...positions.filter(p=>[p.label,...(p.aliases??[])].some(label=>labels.includes(normalized(label)))).map(p=>`staff:${p.id}`)])];
}
