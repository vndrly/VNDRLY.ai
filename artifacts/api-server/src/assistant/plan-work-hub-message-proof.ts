import {createHash} from 'node:crypto';
import {z} from 'zod/v4';
import type {PlanIdentity,PlanStepInput} from './coordinated-plan';
const messageSchema=z.object({id:z.string().uuid(),channelId:z.string().uuid(),authorUserId:z.number().int().positive(),body:z.string(),kind:z.literal('text'),version:z.number().int().positive(),deletedAt:z.string().datetime().nullable(),parentMessageId:z.string().uuid().nullable(),rootMessageId:z.string().uuid().nullable(),clientOperationId:z.string().uuid()}).passthrough();
function savedMessage(value:unknown){
 const action=z.object({state:z.literal('completed'),toolName:z.literal('send_work_hub_message'),executionFingerprint:z.string().min(1),arguments:z.object({owner:z.object({type:z.enum(['vendor','partner']),id:z.number().int().positive()}),channelId:z.string().uuid(),body:z.string(),replyToId:z.string().uuid().optional(),payload:z.record(z.string(),z.unknown()).optional()}),result:z.string()}).parse(value);
 const receipt=z.object({operationId:z.string().uuid(),appliedAt:z.string().datetime(),resource:messageSchema}).passthrough().parse(JSON.parse(action.result));
 if(receipt.error||receipt.ok===false)throw Error('Message action failed');
 return {action,receipt};
}
export function savedWorkHubMessageTarget(value:unknown){const {receipt}=savedMessage(value);return {channelId:receipt.resource.channelId,messageId:receipt.resource.id};}
/** Verifies a saved text record; never a delivery, read receipt or physical action assertion. */
export function verifySavedWorkHubMessageCompletion(step:PlanStepInput,value:unknown,currentValue:unknown,identity:PlanIdentity){
 if(step.completion?.kind!=='canonical_work_hub_message_saved'||step.toolNames.length!==1||step.toolNames[0]!=='send_work_hub_message')throw Error('Unsupported message intent');
 const desired=step.completion,{action,receipt}=savedMessage(value);
 const current=z.object({source:z.literal('vndrly'),authority:z.literal('work_hub_message'),channel:z.object({id:z.string().uuid(),ownerOrgType:z.enum(['vendor','partner']),ownerOrgId:z.number().int().positive()}),message:messageSchema}).parse(currentValue);
 const saved=receipt.resource,reply=desired.replyToId??null;
 if(`${action.arguments.owner.type}:${action.arguments.owner.id}`!==identity.organizationKey||`${current.channel.ownerOrgType}:${current.channel.ownerOrgId}`!==identity.organizationKey||current.channel.id!==desired.channelId||action.arguments.channelId!==desired.channelId||action.arguments.body!==desired.body||(action.arguments.replyToId??null)!==reply)throw Error('Message intent or company mismatch');
 if(current.message.id!==saved.id||[saved,current.message].some(m=>m.channelId!==desired.channelId||m.authorUserId!==identity.userId||m.body!==desired.body||m.version!==1||m.deletedAt!==null||m.parentMessageId!==reply||m.rootMessageId!==reply||m.clientOperationId!==receipt.operationId))throw Error('Saved message outcome changed');
 return {resourceId:saved.id,operationId:receipt.operationId,evidenceHash:createHash('sha256').update(JSON.stringify({executionFingerprint:action.executionFingerprint,arguments:action.arguments,receipt,current})).digest('hex')};
}
