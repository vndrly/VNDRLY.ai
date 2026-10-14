import { expect, it } from "vitest";
import {
  projectCampaignReceipts,
  publicCampaignState,
} from "./form-campaign-projection";
const instances = [{ id: "instance", assigneeUserId: 7 }],
  people = [
    { userId: 7, name: "Private employee", email: "private@example.invalid" },
  ],
  latest = new Map([
    [
      "instance",
      {
        submittedAt: new Date("2026-10-15T13:00:00Z"),
        values: { choices: ["a"] },
      },
    ],
  ]),
  state = {
    deadline: "2026-10-15T12:00:00Z",
    policyAttachmentSnapshot: {
      storageKey: "private-object",
      checksumSha256: "digest",
    },
  };
it("anonymous polls never produce employee identity or answer rows", () => {
  expect(
    projectCampaignReceipts(
      { kind: "poll", anonymous: true },
      state,
      instances,
      people,
      latest,
      true,
    ),
  ).toBeNull();
});
it("named polls keep answers hidden until totals may be shown and mark late receipts", () => {
  const before = projectCampaignReceipts(
    { kind: "poll", anonymous: false },
    state,
    instances,
    people,
    latest,
    false,
  );
  expect(before?.[0]).not.toHaveProperty("values");
  expect(before?.[0].late).toBe(true);
  expect(
    projectCampaignReceipts(
      { kind: "poll", anonymous: false },
      state,
      instances,
      people,
      latest,
      true,
    )?.[0].values,
  ).toEqual({ choices: ["a"] });
});
it("removes private object locators from public campaign state", () => {
  expect(publicCampaignState(state)).toEqual({ deadline: state.deadline });
});

it("named reusable forms expose submitted fields to their authorized owner", () => {
  expect(
    projectCampaignReceipts(
      { kind: "form", anonymous: false },
      state,
      instances,
      people,
      latest,
      false,
    )?.[0].values,
  ).toEqual({ choices: ["a"] });
});
