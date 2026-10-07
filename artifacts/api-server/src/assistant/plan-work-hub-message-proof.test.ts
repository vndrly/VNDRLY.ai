import {expect,it} from 'vitest';
import {savedWorkHubMessageTarget,verifySavedWorkHubMessageCompletion} from './plan-work-hub-message-proof';
const channelId='11111111-1111-4111-8111-111111111111',id='22222222-2222-4222-8222-222222222222',op='33333333-3333-4333-8333-333333333333';
const identity={userId:17,organizationKey:'vendor:4'},owner={type:'vendor',id:4};
const message={id,channelId,authorUserId:17,body:'Please review the saved ticket.',kind:'text',version:1,deletedAt:null,parentMessageId:null,rootMessageId:null,clientOperationId:op};
const action={state:'completed',toolName:'send_work_hub_message',executionFingerprint:'durable-exact',arguments:{owner,channelId,body:message.body,payload:{}},result:JSON.stringify({operationId:op,appliedAt:'2026-10-07T12:00:00.000Z',resource:message})};
const step={id:'message',specialist:'workday',toolNames:['send_work_hub_message'],dependsOn:[],completion:{kind:'canonical_work_hub_message_saved' as const,channelId,body:message.body}};
const current={source:'vndrly',authority:'work_hub_message',channel:{id:channelId,ownerOrgType:'vendor',ownerOrgId:4},message};
it('requires saved own exact text message plus currently authorized exact channel/message read, not delivery',()=>{
 expect(savedWorkHubMessageTarget(action)).toEqual({channelId,messageId:id});
 expect(verifySavedWorkHubMessageCompletion(step,action,current,identity).resourceId).toBe(id);
});
it('refuses wrong sender/channel/company/text/reply, edited/deleted or pending receipts',()=>{
 for(const changed of [{authorUserId:18},{channelId:op},{body:'different'},{version:2},{deletedAt:'2026-10-07T12:10:00.000Z'},{parentMessageId:op}])expect(()=>verifySavedWorkHubMessageCompletion(step,action,{...current,message:{...message,...changed}},identity)).toThrow();
 expect(()=>verifySavedWorkHubMessageCompletion(step,{...action,state:'pending'},current,identity)).toThrow();
 expect(()=>verifySavedWorkHubMessageCompletion(step,action,{...current,channel:{...current.channel,ownerOrgId:5}},identity)).toThrow();
});
