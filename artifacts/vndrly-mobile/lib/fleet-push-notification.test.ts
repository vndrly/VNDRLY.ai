import {afterEach,expect,it,vi} from "vitest";
const open=vi.hoisted(()=>vi.fn());vi.mock("./notification-deep-links",()=>({openNotificationDestination:open}));
import {isFleetPushNotification,openFleetPushNotification} from "./fleet-push-notification";
afterEach(()=>open.mockReset());
it("uses only the notification receipt and requires a current Fleet destination, ignoring pushed account/run assertions",async()=>{
 open.mockResolvedValue("opened");const router={push:vi.fn()};expect(await openFleetPushNotification({type:"fleet_run_event",notificationId:42,runId:"foreign",companyId:999,link:"https://evil.invalid"},router)).toBe("opened");
 expect(open).toHaveBeenCalledWith(expect.objectContaining({id:42,link:null}),router,"fleet");expect(router.push).not.toHaveBeenCalled();
});
it("refuses missing, fractional or unsafe receipt IDs without reads or navigation",async()=>{
 const router={push:vi.fn()};for(const notificationId of [undefined,0,1.2,"1.2",Number.MAX_SAFE_INTEGER+1])expect(await openFleetPushNotification({source:"fleet_run_event",notificationId},router)).toBe("unavailable");expect(open).not.toHaveBeenCalled();expect(isFleetPushNotification({type:"ticket_assigned"})).toBe(false);
});
