import { expect, it } from "vitest";
import { sortGateMapStaff } from "./gate-map-staff-sort";
const people = [
  { userId:1, name:"Amy", fresh:false, location:null, onCallStartedAt:null },
  { userId:2, name:"Zoe", fresh:true, location:{latitude:32.01,longitude:-102}, onCallStartedAt:"2026-10-30T15:00:00Z" },
  { userId:3, name:"Bob", fresh:true, location:{latitude:33,longitude:-102}, onCallStartedAt:"2026-10-30T13:00:00Z" },
];
it("puts nearest current locations first and missing or stale locations last",()=>{
  expect(sortGateMapStaff(people,"nearest",{latitude:32,longitude:-102},"en").map(p=>p.name)).toEqual(["Zoe","Bob","Amy"]);
  expect(sortGateMapStaff(people,"nearest",null,"en").map(p=>p.name)).toEqual(["Amy","Bob","Zoe"]);
});
it("sorts call start times in either direction without inventing missing times",()=>{
  expect(sortGateMapStaff(people,"first",null,"en").map(p=>p.name)).toEqual(["Bob","Zoe","Amy"]);
  expect(sortGateMapStaff(people,"latest",null,"en").map(p=>p.name)).toEqual(["Zoe","Bob","Amy"]);
});
