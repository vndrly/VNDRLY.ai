import {describe,it,expect,vi,beforeEach} from 'vitest';
const state=vi.hoisted(()=>({may:vi.fn(),read:vi.fn()}));
vi.mock('../services/gate-staffing-alerts',()=>({staffingNotificationMayDeliver:state.may,staffingAlertForNotification:state.read}));
import {staffingDeliveryAllowed,staffingSmsCode} from './staffing-notification-policy';
beforeEach(()=>{state.may.mockReset();state.read.mockReset();});
describe('shared staffing state governs every delivery attempt',()=>{
 it('leaves unrelated delivery free of incident reads',async()=>{expect(await staffingDeliveryAllowed({id:3,type:'work_hub_message'})).toBe(true);expect(state.may).not.toHaveBeenCalled();});
 it('rechecks shared state for a later queued attempt and fails closed on storage failure',async()=>{const n={id:7,type:'gate_coverage_uncovered'};state.may.mockResolvedValueOnce(true).mockResolvedValueOnce(false).mockRejectedValueOnce(Error('storage'));expect(await staffingDeliveryAllowed(n)).toBe(true);expect(await staffingDeliveryAllowed(n)).toBe(false);expect(await staffingDeliveryAllowed(n)).toBe(false);expect(state.may).toHaveBeenCalledTimes(3);});
 it('never permits staffing send without an exact positive notification ID',async()=>{expect(await staffingDeliveryAllowed({id:NaN,type:'gate_watch_radar'})).toBe(false);expect(await staffingDeliveryAllowed({id:0,type:'gate_watch_radar'})).toBe(false);expect(state.may).not.toHaveBeenCalled();});
 it('SMS code is from the saved owned open incident only, never an acknowledgment or held one',async()=>{const n={id:7,userId:9,type:'gate_coverage_uncovered'};state.read.mockResolvedValueOnce({code:'A123B456C7',status:'open',notificationsPaused:false}).mockResolvedValueOnce({code:'A123B456C7',status:'acknowledged',notificationsPaused:false}).mockResolvedValueOnce({code:'A123B456C7',status:'open',notificationsPaused:true});expect(await staffingSmsCode(n)).toBe('A123B456C7');expect(await staffingSmsCode(n)).toBeUndefined();expect(await staffingSmsCode(n)).toBeUndefined();expect(state.read).toHaveBeenCalledWith(7,9);});
});
