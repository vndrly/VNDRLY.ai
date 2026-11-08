import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
const state=vi.hoisted(()=>({data:{percentLabel:'37%',people:[
 {userId:7,name:'Zoe',percentLabel:'41%',status:{color:'#f59e0b',label:'Needs attention · over 7 days',rank:1},courses:[{id:'c',title:'L01 — leadership',assignedAt:'2000-01-01T00:00:00Z',complete:false}]},
 {userId:8,name:'Alex',percentLabel:'100%',status:{color:'#22c55e',label:'Completed',rank:2},courses:[]},
]}}));
vi.mock("@tanstack/react-query", () => ({ useQuery: () => ({ dataUpdatedAt: Date.now(), data: state.data }) }));
vi.mock("./repository-client", () => ({ useRepository: () => ({ user: { userId: 1 }, owner: { type: "vendor", id: 1 } }) }));
import TeamTrainingProgress from "./team-training-progress";
afterEach(cleanup);
it('renders saved percentages and status instead of deriving them from dates or course counts',()=>{
 render(<TeamTrainingProgress/>);
 fireEvent.click(screen.getByText('Team Training'));
 fireEvent.click(screen.getByText('Zoe'));
 expect(screen.getByText('37%')).toBeTruthy();
 expect(screen.getByText('41%')).toBeTruthy();
 expect(screen.getByText('Needs attention · over 7 days')).toBeTruthy();
 expect(screen.queryByText('Falling behind · over 14 days')).toBeNull();
});
it('preserves persisted person order and renders collapsed course lists without steppers',()=>{
 render(<TeamTrainingProgress/>);
 expect(document.querySelector('details[open]')).toBeNull();
 fireEvent.click(screen.getByText('Team Training'));
 fireEvent.click(screen.getByText('Zoe'));
 expect(screen.getByRole('list',{name:'Zoe courses'})).toBeTruthy();
 expect(screen.getByText('L01 | Leadership')).toBeTruthy();
 const summaries=[...document.querySelectorAll('summary')].map(x=>x.textContent);
 expect(summaries[1]).toContain('Zoe');
 expect(summaries[2]).toContain('Alex');
 expect(document.querySelector('[aria-current=step]')).toBeNull();
});
