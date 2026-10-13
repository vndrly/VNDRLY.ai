import {it,expect,vi,afterEach} from 'vitest';
import {runInDatabaseRealm} from '@workspace/db/realm';
import {sendTransactionalSms} from './twilio';
import {sendPasswordResetEmail} from './sendgrid';
import {sendExpoPushDestination} from './expo-push';
afterEach(()=>vi.unstubAllGlobals());
it('actual provider senders cannot use live credentials from demo context',async()=>{
 const send=vi.fn();vi.stubGlobal('fetch',send);
 await runInDatabaseRealm('demo',async()=>{
  await expect(sendTransactionalSms({to:'+14055550100',body:'Synthetic test'})).rejects.toThrow('External effects disabled');
  await expect(sendPasswordResetEmail('demo@example.invalid','https://vndrly.ai/','Demo')).rejects.toThrow('External effects disabled');
  await expect(sendExpoPushDestination('ExponentPushToken[demo]',{title:'Demo',body:'Synthetic'})).rejects.toThrow('External effects disabled');
 });
 expect(send).not.toHaveBeenCalled();
});
