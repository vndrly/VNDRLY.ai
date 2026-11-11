import { describe, expect, it } from "vitest";
import { continuationContext } from "./continuation-context";
describe("saved continuation observations", () => {
  const call = { organizationKey: "vendor:2", name: "list_work_hub_tasks", input: { status: "open", cursor: "previous" }, output: JSON.stringify({ items: [{ id: "exact" }], nextCursor: "next" }) };
  const row = { id: 1, createdAt: new Date(0), toolCalls: [call] };
  it("preserves query, cursor and ordered result references after refresh", () => {
    expect(JSON.parse(continuationContext([row], new Set([call.name]), "vendor:2"))[0]).toMatchObject({ arguments: call.input, result: { nextCursor: "next", items: [{ id: "exact" }] } });
  });
  it("does not replay another organization's data or revoked tool access", () => {
    expect(continuationContext([row], new Set([call.name]), "vendor:3")).toBe("[]");
    expect(continuationContext([row], new Set(), "vendor:2")).toBe("[]");
  });
  it("excludes legacy unscoped and private results", () => {
    expect(continuationContext([{ ...row, toolCalls: [{ ...call, organizationKey: undefined }, { ...call, output: '{"privatePersonalResult":true}' }] }], new Set([call.name]), "vendor:2")).toBe("[]");
  });
});

it("keeps independent list filters and ordered pages paired after a refresh", () => {
  const rows = [
    {id:1,createdAt:new Date(0),toolCalls:[{organizationKey:"vendor:2",name:"tasks",input:{filter:"open",cursor:null},output:JSON.stringify({items:[{id:"a"}],nextCursor:"open-2"})}]},
    {id:2,createdAt:new Date(1),toolCalls:[{organizationKey:"vendor:2",name:"sites",input:{search:"San Roman"},output:JSON.stringify({items:[{id:"site-b"}],nextCursor:"sites-2"})}]},
    {id:3,createdAt:new Date(2),toolCalls:[{organizationKey:"vendor:2",name:"tasks",input:{filter:"open",cursor:"open-2"},output:JSON.stringify({items:[{id:"b"}],nextCursor:null})}]},
  ];
  const state=JSON.parse(continuationContext(rows,new Set(["tasks","sites"]),"vendor:2"));
  expect(state.map((x:any)=>[x.tool,x.arguments,x.result.nextCursor])).toEqual([
    ["tasks",{filter:"open",cursor:null},"open-2"],["sites",{search:"San Roman"},"sites-2"],["tasks",{filter:"open",cursor:"open-2"},null],
  ]);
});
it("bounds history without returning broken JSON or half a receipt", () => {
  const rows=Array.from({length:30},(_,id)=>({id,createdAt:new Date(id),toolCalls:[{organizationKey:"vendor:2",name:"tasks",input:{cursor:String(id)},output:JSON.stringify({items:[{id,detail:"x".repeat(4000)}],nextCursor:String(id+1)})}]}));
  const serialized=continuationContext(rows,new Set(["tasks"]),"vendor:2");
  expect(serialized.length).toBeLessThanOrEqual(24000);
  const state=JSON.parse(serialized);
  expect(state.at(-1).result.nextCursor).toBe("30");
  expect(state.every((x:any)=>Number(x.arguments.cursor)+1===Number(x.result.nextCursor))).toBe(true);
});
