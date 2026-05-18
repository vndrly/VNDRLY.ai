import { pgSequence } from "drizzle-orm/pg-core";

export const ticketEventsSeq = pgSequence("ticket_events_seq");
export const hotlistCommentEventsSeq = pgSequence("hotlist_comment_events_seq");
export const liveLocationEventsSeq = pgSequence("live_location_events_seq");
export const visitEventsSeq = pgSequence("visit_events_seq");
