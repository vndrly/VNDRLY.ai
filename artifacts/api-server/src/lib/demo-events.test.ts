import {it,expect,vi} from 'vitest';
import {runInDatabaseRealm} from '@workspace/db/realm';
import {publishWorkHubEvent,workHubEventBus} from '../work-hub/events';
const {query}=vi.hoisted(()=>({query:vi.fn(async()=>{throw Error('No database in event test')})}));
vi.mock('@workspace/db',()=>({pool:{query}}));
import {publishNotificationCreated,subscribeNotificationEvents} from './notification-events';
it('demo events cannot reach shared production buses or their fallback',async()=>{
 const owner={type:'partner' as const,id:611},receive=vi.fn(),notification=vi.fn();
 const stop=workHubEventBus.subscribe({userId:1079,owner},receive);
 const stopNotifications=subscribeNotificationEvents(notification);
 try{
  runInDatabaseRealm('demo',()=>{
   publishWorkHubEvent({type:'synthetic',owner,context:{kind:'organization',id:611},subject:{type:'task',id:1},recipientUserIds:[1079]});
   publishNotificationCreated({userId:1079,notificationId:1,notifType:'synthetic',category:'work_hub',title:'Demo',body:null,link:null,createdAt:new Date().toISOString()});
  });
  await new Promise(resolve=>setTimeout(resolve,20));
  expect(receive).not.toHaveBeenCalled();expect(notification).not.toHaveBeenCalled();expect(query).not.toHaveBeenCalled();
 }finally{stop();stopNotifications();}
});
