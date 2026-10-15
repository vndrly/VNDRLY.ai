import { describe, expect, it } from "vitest";

import {
  notificationIdFromPushData,
  routeForPushData,
} from "@/lib/pushDeepLinks";

describe("routeForPushData", () => {
  it("opens the exact validated meeting from push links",()=>{
    const id="b04608be-31d4-40b0-a5d1-ab39bbde9195";
    expect(routeForPushData({type:"work_hub_meeting_invite",link:`/work-hub/meetings/${id}`})).toEqual({type:"route",path:`/work-hub/meeting/${id}`});
    expect(routeForPushData({link:"/work-hub/meetings/../../admin"})).toEqual({type:"none"});
  });
  it("routes crew_removed to home", () => {
    expect(routeForPushData({ type: "crew_removed" })).toEqual({
      type: "route",
      path: "/(tabs)",
    });
  });

  it("routes crew_added with ticketId to ticket detail", () => {
    expect(routeForPushData({ type: "crew_added", ticketId: 224 })).toEqual({
      type: "route",
      path: "/ticket/224",
    });
  });

  it("parses ticket id from link when ticketId missing", () => {
    expect(
      routeForPushData({ type: "ticket_note_added", link: "/tickets/231#note" }),
    ).toEqual({ type: "route", path: "/ticket/231" });
  });

  it("falls back to notifications inbox for schedule without ticket", () => {
    expect(routeForPushData({ type: "schedule_changed" })).toEqual({
      type: "route",
      path: "/notifications",
    });
  });
});

describe("notificationIdFromPushData", () => {
  it("extracts numeric notification id", () => {
    expect(notificationIdFromPushData({ notificationId: 42 })).toBe(42);
    expect(notificationIdFromPushData({ notificationId: "99" })).toBe(99);
  });
});

it("opens exact training and checklist push destinations",()=>{
 for(const kind of ["training","checklist"]){const path=`/work-hub/${kind}/10000000-0000-4000-8000-000000000001`;expect(routeForPushData({link:path})).toEqual({type:"route",path});}
 expect(routeForPushData({link:"/work-hub/training/not-a-uuid"})).toEqual({type:"none"});
});
