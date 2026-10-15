import { expect,it } from "vitest";
import { meetingCalendarProjection } from "./meeting-lobby-projection";
it("does not expose signaling or room credentials through a calendar invitation",()=>{
 const source={meeting:{admissionMode:"host_approval"},occurrence:{id:"meeting",runtime:{signals:[{payload:"private"}],startedAt:"now"},providerRoomId:"room-secret",recordingState:"active",transcriptState:"active"}};
 const publicItem=meetingCalendarProjection(source);
 expect(publicItem.occurrence.runtime).toEqual({});expect(publicItem.occurrence.providerRoomId).toBeNull();
 expect(source.occurrence.runtime.signals).toHaveLength(1);
});
