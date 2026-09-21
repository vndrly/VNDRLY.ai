import { expect, it } from "vitest";
import { issueHandoffProof, readHandoffProof } from "./gate-change-over-auth";
const claims = {
  outgoingId: 1,
  outgoingVersion: 2,
  incomingId: 3,
  incomingVersion: 4,
  membershipId: 5,
  stationId: "gate",
  preparationId: "prep",
  revision: "abc",
};
it("binds proof to the authenticated participants and handoff, rejecting tampering and expiry", () => {
  const token = issueHandoffProof(claims, 1000);
  expect(readHandoffProof(token, 1001)).toMatchObject(claims);
  expect(readHandoffProof(token + "0", 1001)).toBeNull();
  expect(readHandoffProof(token, 1000 + 300001)).toBeNull();
  expect(readHandoffProof("bad", 1001)).toBeNull();
});
