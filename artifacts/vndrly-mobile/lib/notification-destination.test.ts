import {beforeEach,it,expect,vi} from "vitest";
const fetcher=vi.hoisted(()=>vi.fn());
vi.mock("./api",()=>({apiFetch:fetcher}));
import {parseNotificationTarget,loadNotificationDestination} from "./notification-destination";
beforeEach(()=>fetcher.mockReset());
it("opens a watch assignment at its exact gate on mobile",()=>{expect(parseNotificationTarget("/gate/change-over?siteId=399&stationId=44c6bfee-e3a1-4a49-a1f0-b3ff58ffb82c")).toEqual({kind:"gate",id:"44c6bfee-e3a1-4a49-a1f0-b3ff58ffb82c",siteId:"399",stationId:"44c6bfee-e3a1-4a49-a1f0-b3ff58ffb82c"});});
it.each(["/tickets/41","/ticket/41","/(tabs)/tickets/41"])("parses exact numeric ticket pointer %s",href=>{expect(parseNotificationTarget(href)).toEqual({kind:"ticket",id:"41"});});
it.each(["/tickets","/tickets/0","/tickets/-1","/tickets/1.5","/tickets/9007199254740992","/tickets/41?siteId=99","/tickets/41#data","/tickets/41/delete","//evil.invalid/tickets/41","/tickets/%2e%2e/41"])("rejects noncanonical ticket link %s",href=>{expect(parseNotificationTarget(href)).toBeNull();});
it("loads current ticket content via canonical reader without marking acknowledgement",async()=>{fetcher.mockResolvedValue({id:41,ticketNumber:"SYN-41",status:"initiated",siteName:"Synthetic site",workTypeName:"Repair",scheduledStartAt:"2026-10-13T12:00:00Z"});expect(await loadNotificationDestination({kind:"ticket",id:"41"})).toMatchObject({subjectId:"41",kind:"ticket",title:"SYN-41",lines:["initiated","Synthetic site","Repair","2026-10-13T12:00:00Z"]});expect(fetcher).toHaveBeenCalledExactlyOnceWith("/api/tickets/41");});
it("rejects changed ticket identity, missing content, and revoked canonical read access",async()=>{fetcher.mockResolvedValueOnce({id:42});await expect(loadNotificationDestination({kind:"ticket",id:"41"})).rejects.toThrow("notification.unavailable");fetcher.mockResolvedValueOnce(null);await expect(loadNotificationDestination({kind:"ticket",id:"41"})).rejects.toThrow();fetcher.mockRejectedValueOnce(new Error("Current assignment removed"));await expect(loadNotificationDestination({kind:"ticket",id:"41"})).rejects.toThrow("Current assignment removed");});

const shiftId="11111111-1111-4111-8111-111111111111",stationId="22222222-2222-4222-8222-222222222222";
const staffingHref=`/work-hub/calendar?siteId=399&stationId=${stationId}&shiftId=${shiftId}&date=2026-11-09`;
it("preserves the exact staffing calendar destination and its shift-local date",()=>{
 expect(parseNotificationTarget(staffingHref)).toEqual({kind:"staffing",id:shiftId,siteId:"399",stationId,date:"2026-11-09",href:staffingHref});
});
it.each([staffingHref.replace("2026-11-09","2026-02-30"),staffingHref+"&siteId=400",staffingHref.replace("siteId=399","siteId=0"),staffingHref.replace("&stationId="+stationId,"")])("rejects incomplete or ambiguous staffing context %s",href=>expect(parseNotificationTarget(href)).toBeNull());
it("loads only the freshly authorized matching staffing shift",async()=>{
 const target=parseNotificationTarget(staffingHref)!;
 fetcher.mockResolvedValueOnce({item:{id:shiftId,title:"East gate watch",siteLocationId:399,gateStationId:stationId,startsAt:"2026-11-09T12:00:00Z"}});
 expect(await loadNotificationDestination(target)).toMatchObject({subjectId:shiftId,title:"East gate watch",kind:"staffing"});
 expect(fetcher).toHaveBeenCalledExactlyOnceWith(`/api/work-hub/calendar/items/shift/${shiftId}`);
 fetcher.mockResolvedValueOnce({item:{id:shiftId,title:"Other gate",siteLocationId:400,gateStationId:stationId}});
 await expect(loadNotificationDestination(target)).rejects.toThrow("notification.unavailable");
});
