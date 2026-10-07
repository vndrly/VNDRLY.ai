import type {Href} from "expo-router";
import {openNotificationDestination} from "./notification-deep-links";
export function isFleetPushNotification(data:unknown):boolean{
 if(!data||typeof data!=="object")return false;const row=data as Record<string,unknown>;return row.type==="fleet_run_event"||row.source==="fleet_run_event";
}
/** Push identifiers are hints. Resolve the owned notification and render its current run before read acknowledgement. */
export async function openFleetPushNotification(data:unknown,router:{push(href:Href):void|Promise<void>}):Promise<"opened"|"unavailable">{
 if(!isFleetPushNotification(data))return "unavailable";
 const value=(data as Record<string,unknown>).notificationId;
 const id=typeof value==="number"?value:typeof value==="string"&&/^[1-9]\d*$/.test(value)?Number(value):NaN;
 if(!Number.isSafeInteger(id)||id<1)return "unavailable";
 return openNotificationDestination({id,type:"fleet_run_event",category:"crew",title:"",body:null,link:null,isRead:false,createdAt:""},router,"fleet");
}
