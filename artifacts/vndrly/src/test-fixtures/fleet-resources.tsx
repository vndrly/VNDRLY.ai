import React,{useState} from "react";
import {createRoot} from "react-dom/client";
import {QueryClient,QueryClientProvider} from "@tanstack/react-query";
import {FleetDetailBuilder,FleetRigPackageBuilder} from "../components/fleet-details";
import {FleetRouteFields} from "../components/fleet-route-fields";
import {FleetDestinationsPage} from "../components/fleet-destinations";
import i18n from "../lib/i18n";
import type {FleetRoutePlan,FleetDestination} from "@workspace/api-zod";
import "../pages/fleet.css";
const group="11111111-1111-4111-8111-111111111111",truck="22222222-2222-4222-8222-222222222222",trailer="33333333-3333-4333-8333-333333333333";
const equipment=[{id:truck,name:"Synthetic Truck 12",category:"truck",status:"available",dispatchable:true},{id:trailer,name:"Synthetic Crude Trailer",category:"trailer",status:"available",dispatchable:true}];
const locations=[{id:"44444444-4444-4444-8444-444444444444",revision:1,name:"Synthetic Yard",kind:"pickup",address:"Synthetic manual address",latitude:null,longitude:null,materials:[],hours:"",instructions:"",active:true,ownerType:"vendor",ownerId:7},{id:"55555555-5555-4555-8555-555555555555",revision:1,name:"Synthetic Terminal",kind:"delivery",address:"Synthetic delivery address",latitude:null,longitude:null,materials:[],hours:"",instructions:"",active:true,ownerType:"vendor",ownerId:7}] as FleetDestination[];
function Assembly(){const [route,setRoute]=useState<FleetRoutePlan|null>(null);return <main className="fleet-workspace" style={{padding:20,maxWidth:1200,margin:"auto",display:"grid",gap:16}}><div className="fleet-detail-tools"><FleetDetailBuilder companyId={7} accessGroupIds={[group]} resources={{drivers:[{userId:2,name:"Bob Villa",fleetIds:[group]}],equipment,tickets:[]}} rigPackages={[]} assessments={{[`vehicle:${truck}`]:{status:"red",label:"Compliance unverified"},"driver:2":{status:"red",label:"Compliance unverified"}}} onSave={async()=>{}}/><FleetRigPackageBuilder companyId={7} equipment={equipment} onSave={async()=>{}}/></div><section className="fleet-panel"><FleetRouteFields value={route} destinations={locations} onChange={setRoute}/></section></main>;}
/** Synthetic visual/keyboard fixture imported only by the isolated browser tests. */
export async function mountFleetResourceFixture(language:string,directory=false){await i18n.changeLanguage(language);const root=document.createElement("div");document.body.replaceChildren(root);createRoot(root).render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}>{directory?<FleetDestinationsPage identity="synthetic-visual"/>:<Assembly/>}</QueryClientProvider>);}
