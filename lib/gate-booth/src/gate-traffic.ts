export type PhysicalGate = {id:string;siteId:number;name:string;latitude:number|null;longitude:number|null;version:number;active:boolean;topology?:{kind:'independent'|'series'|'parallel';area:string;parentGateId:string|null;parallelGateId:string|null;destinations?:{id:string;name:string;gateId:string|null;latitude?:number;longitude?:number}[];defaultDestinationId?:string|null}|null};
export function parallelGateGroup(gates:PhysicalGate[],gateId?:string) {
  const group=new Set<string>(gateId?[gateId]:[]);
  let changed=true;
  while(changed){changed=false;for(const gate of gates){const sibling=gate.topology?.parallelGateId;if(sibling&&(group.has(gate.id)||group.has(sibling))){if(!group.has(gate.id)||!group.has(sibling))changed=true;group.add(gate.id);group.add(sibling);}}}
  return group;
}
export function gateCheckInDestinationDefaults(gates:PhysicalGate[],gateId?:string) {
  const gate=gates.find(g=>g.id===gateId),named=gate?.topology?.destinations??[];
  const children=gateId?gates.filter(g=>g.active&&g.topology?.parentGateId===gateId):[];
  return {destinationId:named.length?(gate?.topology?.defaultDestinationId??(named.length===1?named[0].id:undefined)):undefined,destinationGateId:!named.length&&children.length===1?children[0].id:undefined};
}
export type Movement={operationId:string;kind:string;gateId:string;gateName:string;area:string;destination:string;at:string;actorName?:string;actorId?:number;note?:string};
export type AreaVisit={id:number;entryGateId?:string|null;firstName:string;lastName:string;company:string|null;vehiclePlate:string|null;checkInTime?:string;checkOutTime:string|null;movements:Movement[];presence:{currentGateId:string|null;expectedGateId:string|null;expectedSiteExit:boolean;label:string;lastConfirmedGateId?:string|null;lastConfirmedLocation?:string;intendedDestination?:string|null}};
export type GateAreaTrafficResponse = {gates:PhysicalGate[];visits:AreaVisit[];canManage:boolean;movementGateIds:string[]};
