import {expect,it} from "vitest";
import {attentionItems} from "./needs-attention";
const now=Date.parse("2026-11-22T18:00:00Z");const recent="2026-11-22T17:00:00Z";
it("caps the combined list at ten, deduplicates sources, and ranks imminent meetings first",()=>{
 const channels=Array.from({length:20},(_,i)=>({id:String(i),name:`Chat ${i}`,unreadCount:1,updatedAt:recent}));
 const items=attentionItems({channels:[...channels,channels[0]],meetings:[{item:{meeting:{title:"Briefing"},occurrence:{id:"meeting",startsAt:"2026-11-22T20:00:00Z"}}}]},now);
 expect(items).toHaveLength(10);expect(items[0].title).toBe("Briefing");expect(items[0].reason).toBe("Starts in 2 hours");expect(new Set(items.map(i=>i.id)).size).toBe(10);
});
it("excludes handled calls, read voicemail, completed polls and expired meetings",()=>{
 expect(attentionItems({calls:[{id:"missed",incoming:true,status:"missed",callerUserId:9,createdAt:recent},{id:"return",incoming:false,recipientUserId:9,createdAt:"2026-11-22T17:30:00Z"}],voicemail:[{id:"vm",readAt:recent,createdAt:recent}],polls:[{instanceId:"p",completed:true,state:{status:"published"}}],meetings:[{item:{meeting:{title:"Old"},occurrence:{id:"old",startsAt:recent}}}]},now)).toEqual([]);
});
it("flags reply requests as suggestions and excludes automated emails",()=>{
 const account={id:"a",provider:"gmail" as const,label:"me@example.com",status:"connected"};
 const items=attentionItems({emails:[{account,items:[{id:"yes",from:"person@example.com",subject:"Can you confirm?",text:"",date:recent,unread:true},{id:"no",from:"noreply@example.com",subject:"Can you confirm?",text:"",date:recent,unread:true}]}]},now);
 expect(items).toHaveLength(1);expect(items[0].reason).toContain("May need a reply");expect(items[0].source.account).toEqual(account);
});
it("includes each supported communication type without padding an empty list",()=>{
 const items=attentionItems({calls:[{id:"c",incoming:true,status:"missed",callerName:"Pat",createdAt:recent}],voicemail:[{id:"v",senderName:"Sam",createdAt:recent}],notifications:[{id:1,title:"Notice",createdAt:recent,isRead:false}],polls:[{campaignId:"p",instanceId:"i",title:"Vote",state:{status:"published"}}],channels:[{id:"chat",name:"Crew",unreadCount:2}]},now);
 expect(items.map(i=>i.kind)).toEqual(expect.arrayContaining(["call","voicemail","notification","poll","conversation"]));expect(items).toHaveLength(5);expect(attentionItems({},now)).toEqual([]);
});
