import{describe,it,expect,vi}from"vitest";
vi.mock("@/hooks/use-auth",()=>({useAuth:vi.fn()}));vi.mock("./api",()=>({apiFetch:vi.fn()}));vi.mock("./use-unified-work-calendar",()=>({useUnifiedWorkCalendar:vi.fn()}));
import{myWorkItems,dailySummary,attentionNotices,type DailySources}from"./daily-workspace";
const fixture=():DailySources=>({tasks:[{id:"task",title:"Assigned work",status:"open"}],safety:[{id:1,title:"Open incident",status:"investigating"}],notices:[{id:4,type:"safety_event_submitted",title:"Incident notice",category:"safety",link:"/safety/1",isRead:true,body:null,createdAt:"2026-01-01"}],calendar:{shifts:[],meetings:[]},tickets:[],notificationLimited:false,safetyLimited:false});
describe("shared daily attention",()=>{it("keeps open safety work after its notification is read without double counting",()=>{const s=fixture();expect(attentionNotices(s)).toHaveLength(0);expect(dailySummary(s).attentionCount).toBe(2);});it("removes resolved work but keeps review-required credential alerts even if read",()=>{const s=fixture();s.safety![0].status="resolved";s.tasks![0].status="completed";s.notices!.push({...s.notices![0],id:5,type:"cert_expired",link:"/profile?credentialId=5"});expect(dailySummary(s).attentionCount).toBe(1);});it("does not describe an unavailable source as zero",()=>{const s=fixture();s.safety=null;expect(dailySummary(s).safetyCount).toBeNull();expect(dailySummary(s).attentionCount).toBeNull();expect(dailySummary(s).myWorkCount).toBe(1);});});

it("merges unticketed tasks, tickets, driver runs and shifts by assignment rather than work start",()=>{
 const source=fixture(); source.tasks=[{id:"task",title:"Unticketed",status:"open",createdAt:"2026-10-12T00:00:00Z"} as any];
 source.tickets=[{id:1,status:"initiated",createdAt:"2026-01-01",assignedAt:"2026-10-14T12:00:00Z"}];
 source.runs=[{id:"run",title:"Delivery",status:"dispatched",events:[{type:"dispatch",recordedAt:"2026-10-13T00:00:00Z"}]}];
 source.shifts=[{shift:{id:"shift",startsAt:"2026-11-01",title:"Gate"},assignment:{status:"assigned",createdAt:"2026-10-14T13:00:00Z"}}];
 expect(myWorkItems(source).map(item=>item.kind)).toEqual(["shift","ticket","run","task"]);
 source.shifts[0].assignment.status="cancelled";expect(myWorkItems(source).some(item=>item.kind==="shift")).toBe(false);
});
