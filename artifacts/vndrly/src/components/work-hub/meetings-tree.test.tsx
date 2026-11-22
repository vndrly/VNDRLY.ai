import {expect,it} from "vitest";
import {splitMeetings,type MeetingEntry} from "./meetings-tree";
it("keeps past invitations without attendance and orders both lists",()=>{
 const make=(id:string,startsAt:string,status="scheduled"):MeetingEntry=>({item:{meeting:{title:id},occurrence:{id,startsAt,status}}});
 const groups=splitMeetings([make("later","2026-11-24T12:00:00Z"),make("absent","2026-11-20T12:00:00Z","ended"),make("next","2026-11-23T12:00:00Z"),make("older","2026-11-19T12:00:00Z")],Date.parse("2026-11-22T12:00:00Z"));
 expect(groups.upcoming.map(r=>r.item.occurrence.id)).toEqual(["next","later"]);
 expect(groups.past.map(r=>r.item.occurrence.id)).toEqual(["absent","older"]);
});
