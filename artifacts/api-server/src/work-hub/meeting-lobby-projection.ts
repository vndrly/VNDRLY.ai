/** Calendar/lobby discovery never carries live signaling or media credentials. */
export function meetingCalendarProjection<T extends {meeting:{admissionMode?:string|null};occurrence:Record<string,unknown>}>(item:T):T {
  if(!item.meeting.admissionMode)return item;
  return {...item,occurrence:{...item.occurrence,runtime:{},providerRoomId:null,recordingState:"off",transcriptState:"off",askvInvitedAt:null,askvInvitedById:null}} as T;
}
