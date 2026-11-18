import {expect,it} from "vitest";
import {DEFAULT_GATE_COVERAGE_RADIUS_M,gateMapCoverageCircles,gateMapLinkLines,gateMapSiteBoundaryCircles} from "./gate-map-overlays";

const gates=[
  {id:"east",siteId:1,linkGroupId:"spur",latitude:32,longitude:-102},
  {id:"west",siteId:1,linkGroupId:"spur",latitude:32,longitude:-102.01},
  {id:"north",siteId:2,linkGroupId:"spur",latitude:32.01,longitude:-102,active:false},
  {id:"other",siteId:3,latitude:34,longitude:-100},
];
it('centers opted-in boundaries on the well with gate-distance radii and one site circle',()=>{
 const sites=[{id:'outer',siteId:1,latitude:0,longitude:.001,siteLatitude:0,siteLongitude:0,siteRadiusMeters:402,topology:{boundaryCenter:'site' as const}}, {id:'inner',siteId:1,latitude:0,longitude:.0002,siteLatitude:0,siteLongitude:0,siteRadiusMeters:402,topology:{boundaryCenter:'site' as const}}];
 const circles=gateMapSiteBoundaryCircles(sites,'blue');
 expect(circles).toHaveLength(3);expect(circles.every(c=>c.latitude===0&&c.longitude===0)).toBe(true);
 expect(circles.find(c=>c.id==='gate-boundary:outer')?.radiusMeters).toBeCloseTo(111.1949,3);
 expect(circles.find(c=>c.id==='gate-boundary:inner')?.radiusMeters).toBeCloseTo(22.239,3);
 expect(gateMapSiteBoundaryCircles(gates,'blue')).toEqual([]);
 expect(gateMapSiteBoundaryCircles(sites.map(s=>({...s,siteLatitude:null,siteLongitude:null})),'blue')).toEqual([]);
});
it("connects linked gates across sites with N-1 shortest edges and no unlinked gate",()=>{
  const lines=gateMapLinkLines(gates,"#f1b637");
  expect(lines).toHaveLength(2);
  expect(lines.map(line=>line.id).sort()).toEqual(["gate-link:east:north","gate-link:east:west"]);
  expect(lines.find(line=>line.id.includes("north"))?.color).toBe("#9ca3af");
  expect(lines.find(line=>line.id.includes("west"))?.color).toBe("#f1b637");
  expect(gateMapLinkLines([...gates].reverse(),"#f1b637")).toEqual(lines);
});
it("keeps distinct linked groups separate and skips unavailable coordinates",()=>{
  expect(gateMapLinkLines([...gates,{id:"remote",siteId:4,linkGroupId:"other",latitude:32.001,longitude:-102},{id:"unknown",siteId:1,linkGroupId:"spur",latitude:NaN,longitude:0}],"blue")).toHaveLength(2);
});
it("draws a quarter-mile radius around each mapped gate, with inactive coverage grey",()=>{
  const circles=gateMapCoverageCircles(gates,"blue");
  expect(DEFAULT_GATE_COVERAGE_RADIUS_M).toBeCloseTo(402.336,6);
  expect(circles).toHaveLength(4);
  expect(circles.every(circle=>circle.radiusMeters===DEFAULT_GATE_COVERAGE_RADIUS_M)).toBe(true);
  expect(circles.find(circle=>circle.id.endsWith("north"))?.color).toBe("#9ca3af");
});
