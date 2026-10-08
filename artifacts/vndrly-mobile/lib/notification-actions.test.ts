import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ generation: 1, api: vi.fn(), open: vi.fn() }));
vi.mock("./api", () => ({ apiFetch: state.api }));
vi.mock("./auth", () => ({ captureAuthScope: () => ({ generation: state.generation }), isAuthScopeCurrent: (scope: {generation:number}) => scope.generation === state.generation }));
vi.mock("./notification-deep-links", () => ({ openNotificationDestination: state.open }));
import { handleNotificationAction, NOTIFICATION_ACTIONS, notificationCategoryDefinitions } from "./notification-actions";
const meeting = "11111111-1111-4111-8111-111111111111";
describe("authorized notification actions", () => {
 it("offers foreground review/read actions without RSVP, capture or consent acceptance",()=>{
  expect(notificationCategoryDefinitions.map(category=>category.identifier)).toEqual(["vndrly_record","vndrly_meeting","vndrly_assignment","vndrly_message"]);
  expect(notificationCategoryDefinitions.every(category=>category.actions.every(action=>action.options.opensAppToForeground))).toBe(true);
  expect(notificationCategoryDefinitions[1].actions.map(action=>action.identifier)).toEqual([NOTIFICATION_ACTIONS.meeting,NOTIFICATION_ACTIONS.read]);
 });
 beforeEach(() => { state.generation++; state.api.mockReset(); state.open.mockReset(); });
 it("resolves current ownership before exact idempotent mark-read, sharing duplicate responses", async () => {
  state.api.mockResolvedValue({href:`/work-hub/meetings/${meeting}`});
  const router={push:vi.fn()};
  expect(await Promise.all([handleNotificationAction(NOTIFICATION_ACTIONS.read,{notificationId:42},router),handleNotificationAction(NOTIFICATION_ACTIONS.read,{notificationId:42},router)])).toEqual(["handled","handled"]);
  expect(state.api.mock.calls.map(call=>call[0])).toEqual(["/api/notifications/42/resolve","/api/notifications/42/read"]);
  expect(state.api.mock.calls.every(call=>call[2].generation===state.generation)).toBe(true);
  expect(router.push).not.toHaveBeenCalled();
 });
 it("meeting response only opens the freshly authorized exact review; never writes RSVP or media consent", async () => {
  state.api.mockResolvedValueOnce({href:`/work-hub/meetings/${meeting}`}).mockResolvedValueOnce({item:{occurrence:{id:meeting}}});
  const router={push:vi.fn()};
  expect(await handleNotificationAction(NOTIFICATION_ACTIONS.meeting,{notificationId:43,link:"/invented",role:"admin"},router)).toBe("handled");
  expect(router.push).toHaveBeenCalledWith({pathname:"/work-hub/meeting/[occurrenceId]",params:{occurrenceId:meeting}});
  expect(state.api.mock.calls.map(call=>call[0])).toEqual(["/api/notifications/43/resolve",`/api/work-hub/calendar/items/meeting/${meeting}`]);
  expect(state.open).not.toHaveBeenCalled();
 });
 it("refuses a substituted series/occurrence ID before navigation",async()=>{
  state.api.mockResolvedValueOnce({href:`/work-hub/meetings/${meeting}`}).mockResolvedValueOnce({item:{meeting:{id:meeting},occurrence:{id:"different"}}});
  const router={push:vi.fn()};
  expect(await handleNotificationAction(NOTIFICATION_ACTIONS.meeting,{notificationId:49},router)).toBe("unavailable");
  expect(router.push).not.toHaveBeenCalled();
 });
 it("rejects denied, malformed, wrong-kind and unknown actions without effects", async () => {
  state.api.mockRejectedValueOnce(new Error("403"));
  expect(await handleNotificationAction(NOTIFICATION_ACTIONS.read,{notificationId:44},{push:vi.fn()})).toBe("unavailable");
  state.api.mockResolvedValue({href:"/work-hub/tasks/11111111-1111-4111-8111-111111111111"});
  expect(await handleNotificationAction(NOTIFICATION_ACTIONS.meeting,{notificationId:45},{push:vi.fn()})).toBe("unavailable");
  expect(await handleNotificationAction("invented",{notificationId:45},{push:vi.fn()})).toBe("unavailable");
  expect(state.api.mock.calls.some(call=>call[0].endsWith("/read"))).toBe(false);expect(state.open).not.toHaveBeenCalled();
 });
 it("fences a switched account before any write or navigation", async () => {
  state.api.mockImplementation(async()=>{state.generation++;return {href:`/work-hub/meetings/${meeting}`};});
  expect(await handleNotificationAction(NOTIFICATION_ACTIONS.read,{notificationId:46},{push:vi.fn()})).toBe("unavailable");
  expect(state.api).toHaveBeenCalledTimes(1);expect(state.open).not.toHaveBeenCalled();
 });
 it("Open waits for canonical destination rendering and does not preemptively mark read",async()=>{
  state.api.mockResolvedValue({href:`/work-hub/meetings/${meeting}`});state.open.mockResolvedValue("unavailable");
  expect(await handleNotificationAction(NOTIFICATION_ACTIONS.open,{notificationId:48,link:"/invented"},{push:vi.fn()})).toBe("unavailable");
  expect(state.api.mock.calls.map(call=>call[0])).toEqual(["/api/notifications/48/resolve"]);
  expect(state.open).toHaveBeenCalledWith(expect.objectContaining({id:48}),expect.anything(),"meeting");
 });
 it("unknown read result retries the same notification id, never an inferred subject mutation", async()=>{
  state.api.mockImplementation(async(path:string)=>{if(path.endsWith("/read"))throw new Error("network");return {href:`/work-hub/meetings/${meeting}`};});
  const router={push:vi.fn()};
  await handleNotificationAction(NOTIFICATION_ACTIONS.read,{notificationId:47},router);
  await handleNotificationAction(NOTIFICATION_ACTIONS.read,{notificationId:47},router);
  expect(state.api.mock.calls.filter(call=>call[0].endsWith("/read")).map(call=>call[0])).toEqual(["/api/notifications/47/read","/api/notifications/47/read"]);
 });
});
