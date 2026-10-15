import { expect, it } from "vitest";
import { campaignActorCurrent } from "./form-campaign-access";
const actor = { userId: 7, sv: 2, activeMembershipId: 15, vendorId: 12 };
const user = {
  id: 7,
  sessionVersion: 2,
  activeMembershipId: 15,
  suspendedAt: null,
  mustChangePassword: false,
};
const member = { id: 15, userId: 7, orgType: "vendor", vendorId: 12 };
it("requires exact current signed session, company membership and active context", () => {
  expect(
    campaignActorCurrent(actor, user, member, { type: "vendor", id: 12 }),
  ).toBe(true);
  expect(
    campaignActorCurrent({ ...actor, sv: 1 }, user, member, {
      type: "vendor",
      id: 12,
    }),
  ).toBe(false);
  expect(
    campaignActorCurrent(actor, { ...user, activeMembershipId: 16 }, member, {
      type: "vendor",
      id: 12,
    }),
  ).toBe(false);
  expect(
    campaignActorCurrent(
      actor,
      user,
      { ...member, vendorId: 13 },
      { type: "vendor", id: 12 },
    ),
  ).toBe(false);
  expect(
    campaignActorCurrent(actor, { ...user, suspendedAt: new Date() }, member, {
      type: "vendor",
      id: 12,
    }),
  ).toBe(false);
});
