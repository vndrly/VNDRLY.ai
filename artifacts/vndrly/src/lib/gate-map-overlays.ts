import type { MapboxCircle, MapboxLine } from "@/components/mapbox-map";

export const DEFAULT_GATE_COVERAGE_RADIUS_M = 1609.344 / 4;
export type GateMapLocation = {
  id:string; siteId:number; linkGroupId?:string|null; active?:boolean;
  latitude?:number|null; longitude?:number|null; siteLatitude?:number|null; siteLongitude?:number|null;
};
function located(gate:GateMapLocation) {
  const latitude=gate.latitude??gate.siteLatitude,longitude=gate.longitude??gate.siteLongitude;
  return typeof latitude==="number"&&typeof longitude==="number"&&Number.isFinite(latitude)&&Number.isFinite(longitude)&&Math.abs(latitude)<=90&&Math.abs(longitude)<=180
    ? {...gate,latitude,longitude}:null;
}
function distance(a:{latitude:number;longitude:number},b:{latitude:number;longitude:number}) {
  const rad=Math.PI/180,lat=(b.latitude-a.latitude)*rad,lng=(b.longitude-a.longitude)*rad;
  return Math.sin(lat/2)**2+Math.cos(a.latitude*rad)*Math.cos(b.latitude*rad)*Math.sin(lng/2)**2;
}
/** One minimum spanning tree per authorized linked group, including gates at other sites. */
export function gateMapLinkLines(gates:GateMapLocation[],brand:string):MapboxLine[] {
  const groups=new Map<string,NonNullable<ReturnType<typeof located>>[]>();
  for(const gate of gates){const point=located(gate);if(!point||!gate.linkGroupId)continue;const group=groups.get(gate.linkGroupId)??[];group.push(point);groups.set(gate.linkGroupId,group);}
  const lines:MapboxLine[]=[];
  for(const points of groups.values()){
    points.sort((a,b)=>a.id.localeCompare(b.id));if(points.length<2)continue;
    const included=new Set([0]),best=points.map((point,index)=>({from:0,cost:index?distance(points[0],point):Infinity}));
    while(included.size<points.length){
      let next=-1;
      for(let i=0;i<points.length;i++)if(!included.has(i)&&(next<0||best[i].cost<best[next].cost))next=i;
      const a=points[best[next].from],b=points[next];
      lines.push({id:`gate-link:${[a.id,b.id].sort().join(":")}`,coordinates:[[a.latitude,a.longitude],[b.latitude,b.longitude]],color:a.active===false||b.active===false?"#9ca3af":brand,width:2,opacity:.65});
      included.add(next);
      for(let i=0;i<points.length;i++){if(included.has(i))continue;const cost=distance(b,points[i]);if(cost<best[i].cost)best[i]={from:next,cost};}
    }
  }
  return lines;
}
export function gateMapCoverageCircles(gates:GateMapLocation[],brand:string):MapboxCircle[] {
  return gates.flatMap(gate=>{const point=located(gate);return point?[{id:`gate-coverage:${gate.id}`,latitude:point.latitude,longitude:point.longitude,radiusMeters:DEFAULT_GATE_COVERAGE_RADIUS_M,color:gate.active===false?"#9ca3af":brand,opacity:.045}]:[];});
}
