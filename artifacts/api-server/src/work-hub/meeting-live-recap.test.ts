import { describe, expect, it } from "vitest";
import { mergeLiveRecap, type RecapItem, type LiveRecap } from "./meeting-live-recap";
const source = {id:"chat:1",speaker:"Alex",text:"We will use plan A. Which supplier? Decide the budget next week.",time:1};
const item = (id:string,status:RecapItem["status"],text:string):RecapItem => ({id,status,text,sourceId:source.id,evidence:source.text,explicitChange:false,owner:null,due:null});
const initial:LiveRecap = {version:1,summary:"Plan A",actionItems:[],decisions:[item("decision","confirmed","Use plan A"),item("question","open","Which supplier?"),item("later","deferred","Choose budget")],processed:[],updatedAt:""};
describe("live meeting recap retention",()=>{
 it("keeps open, deferred and confirmed items when omitted",()=>{
  expect(mergeLiveRecap(initial,{summary:"Equipment discussed",actionItems:[],decisions:[]},[source]).decisions).toEqual(initial.decisions);
 });
 it("rejects model reconsideration of a confirmed decision",()=>{
  expect(mergeLiveRecap(initial,{summary:"Plan A",actionItems:[],decisions:[item("decision","open","Reconsider plan A")]},[source]).decisions[0]).toEqual(initial.decisions[0]);
 });
 it("requires explicit participant change and exact source evidence",()=>{
  const changed={...source,id:"chat:2",text:"Change the decision: use plan B instead of plan A."};
  const update={...item("decision","confirmed","Use plan B"),sourceId:changed.id,evidence:changed.text,explicitChange:true};
  expect(mergeLiveRecap(initial,{summary:"Plan B",actionItems:[],decisions:[update]},[changed]).decisions[0]).toMatchObject({text:"Use plan B",history:[{text:"Use plan A"}]});
  expect(mergeLiveRecap(initial,{summary:"Plan A",actionItems:[],decisions:[{...update,evidence:"invented"}]},[changed]).decisions[0]).toEqual(initial.decisions[0]);
 });
 it("resolves a question without losing deferred questions",()=>{
  const next=mergeLiveRecap(initial,{summary:"Supplier chosen",actionItems:[],decisions:[item("question","resolved","Supplier chosen")]},[source]);
  expect(next.decisions.find(i=>i.id==="question")?.status).toBe("resolved");
  expect(next.decisions.find(i=>i.id==="later")?.status).toBe("deferred");
 });
 it("adds commitments without duplicates",()=>{
  const action=item("new","open","Confirm delivery");
  const first=mergeLiveRecap(initial,{summary:"Delivery",actionItems:[action],decisions:[]},[source]);
  const next=mergeLiveRecap(first,{summary:"Delivery",actionItems:[action],decisions:[]},[source]);
  expect(next.actionItems).toHaveLength(1);expect(next.processed).toHaveLength(1);
 });
 it("rejects citations outside the supplied new public sources",()=>{
  expect(mergeLiveRecap(initial,{summary:"Plan A",actionItems:[{...item("private","open","Secret"),sourceId:"pm"}],decisions:[]},[source]).actionItems).toEqual([]);
 });
});
