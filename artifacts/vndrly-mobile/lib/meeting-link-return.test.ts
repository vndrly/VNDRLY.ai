import { expect,it } from "vitest";
import { rememberMeetingDestination, pendingMeetingDestination, clearMeetingDestination } from "./meeting-link-return";
it("preserves only an exact meeting destination through sign-in",()=>{
 clearMeetingDestination();rememberMeetingDestination("https://evil.test/admin");expect(pendingMeetingDestination()).toBeNull();
 rememberMeetingDestination("/work-hub/meeting/b04608be-31d4-40b0-a5d1-ab39bbde9195");expect(pendingMeetingDestination()).toContain("b04608be");
 clearMeetingDestination();expect(pendingMeetingDestination()).toBeNull();
});
