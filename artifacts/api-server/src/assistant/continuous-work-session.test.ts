import { describe, expect, it } from "vitest";
import { ContinuousWorkSession } from "./continuous-work-session";

describe("continuous Ask V work session", () => {
  it.each([
    ["Morning V", "query_workforce_coverage"],
    ["I'm in Texas plate ABC one two three", "prepare_field_trips_action"],
    ["I'm checking out these walkie-talkies", "prepare_asset_custody_action"],
    ["I acknowledge Friday's assignment", "prepare_workforce_coverage_action"],
    ["What's the ETA on my truck?", "query_field_trips"],
    ["That truck slipped through the gate", "query_field_trips"],
    ["Resend Sally's onboarding invite", "prepare_account_invitations_action"],
    ["I was just in an accident", "prepare_incident_response_action"],
  ])("maps %s to the authorized capability", (phrase, expectedTool) => {
    const session = new ContinuousWorkSession({ userId: 1, owner: { type: "vendor", id: 9 }, siteId: 4 });
    expect(session.interpret(phrase).toolName).toBe(expectedTool);
  });

  it("keeps company and site context when switching from a call to an asset action", () => {
    const session = new ContinuousWorkSession({ userId: 1, owner: { type: "vendor", id: 9 }, siteId: 4, communication: { kind: "call", id: "call-1" } });
    const result = session.interpret("Check out this truck to me");
    expect(result.context).toMatchObject({ owner: { type: "vendor", id: 9 }, siteId: 4, communication: { kind: "call", id: "call-1" } });
  });

  it("claims success only from a durable server or offline-queue receipt", () => {
    const session = new ContinuousWorkSession({ userId: 1 });
    expect(session.completionMessage({ status: "applied" })).toMatch(/completed/i);
    expect(session.completionMessage({ status: "queued" })).toMatch(/saved.*sync/i);
    expect(session.completionMessage({ status: "unknown" })).toMatch(/could not confirm/i);
  });
});
