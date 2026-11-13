import { expect, it } from "vitest";
import { siteRadiusCircles } from "./site-radius-circles";
it("uses actual site coordinates and saved radii once per site, including sites without gates",()=>{
 const site={id:1,latitude:32,longitude:-102,siteRadiusMeters:735};
 expect(siteRadiusCircles([site,site,{id:2,latitude:33,longitude:-101,siteRadiusMeters:100}])).toMatchObject([{id:"site-radius:1",latitude:32,longitude:-102,radiusMeters:735},{id:"site-radius:2",radiusMeters:100}]);
});
it("does not invent radii or render missing, inactive or invalid site positions",()=>{
 const site={id:1,latitude:32,longitude:-102,siteRadiusMeters:100};
 expect(siteRadiusCircles([{...site,latitude:null},{...site,id:2,siteRadiusMeters:null},{...site,id:3,isActive:false},{...site,id:4,latitude:91},{...site,id:5,siteRadiusMeters:-1}])).toEqual([]);
});
