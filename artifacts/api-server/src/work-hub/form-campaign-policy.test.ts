import { expect, it } from "vitest";
import {
  campaignDeadline,
  campaignCanSubmit,
  validateCampaignResponse,
  campaignResultsVisible,
  requireCampaignPublicationContent,
} from "./form-campaign-policy";
const now = new Date("2026-10-14T13:00:00Z");
it("uses thirty elapsed days for acknowledgements and twenty-four hours for polls", () => {
  expect(campaignDeadline({ kind: "acknowledgement" }, now).toISOString()).toBe(
    "2026-11-13T13:00:00.000Z",
  );
  expect(campaignDeadline({ kind: "poll" }, now).toISOString()).toBe(
    "2026-10-15T13:00:00.000Z",
  );
});
it("refuses a poll exactly at closing while allowing a late acknowledgement", () => {
  const state = { status: "published", deadline: now.toISOString() };
  expect(campaignCanSubmit({ kind: "poll" }, state, now)).toBe(false);
  expect(campaignCanSubmit({ kind: "acknowledgement" }, state, now)).toBe(true);
  expect(
    campaignCanSubmit(
      { kind: "acknowledgement" },
      { ...state, status: "draft" },
      now,
    ),
  ).toBe(false);
});
it("requires explicit true acknowledgement and validates exact poll choice IDs", () => {
  expect(() =>
    validateCampaignResponse(
      { kind: "acknowledgement" },
      { acknowledged: false },
    ),
  ).toThrow();
  expect(
    validateCampaignResponse(
      { kind: "acknowledgement" },
      { acknowledged: true },
    ),
  ).toEqual({ acknowledged: true });
  const c = {
    kind: "poll",
    choices: [
      { id: "a", label: "A" },
      { id: "b", label: "B" },
    ],
    maxSelections: 1,
  };
  expect(() => validateCampaignResponse(c, { choices: ["a", "b"] })).toThrow();
  expect(() => validateCampaignResponse(c, { choices: ["foreign"] })).toThrow();
  expect(() => validateCampaignResponse(c, { choices: ["a", "a"] })).toThrow();
});
it("keeps vote totals hidden until close unless live results are configured", () => {
  expect(
    campaignResultsVisible(
      { resultsTiming: "at_close" },
      { status: "published", deadline: "2026-10-15T13:00:00Z" },
      now,
    ),
  ).toBe(false);
  expect(
    campaignResultsVisible(
      { resultsTiming: "live" },
      { status: "published" },
      now,
    ),
  ).toBe(true);
});

it("keeps an empty security policy draft unpublished", () => {
  expect(() =>
    requireCampaignPublicationContent({
      kind: "acknowledgement",
      policyText: "",
      policyAttachmentId: null,
    }),
  ).toThrow("Actual policy");
  expect(() =>
    requireCampaignPublicationContent({
      kind: "acknowledgement",
      policyText: "Approved policy",
      policyAttachmentId: null,
    }),
  ).not.toThrow();
});

it("requires a poll question before notifying its audience", () => {
  expect(() =>
    requireCampaignPublicationContent({ kind: "poll", question: "" }),
  ).toThrow("poll question");
  expect(() =>
    requireCampaignPublicationContent({
      kind: "poll",
      question: "Where should the crew meet?",
    }),
  ).not.toThrow();
});

import { validateGeneralCampaignValues } from "./form-campaign-policy";
it("requires known typed fields for general campaigns", () => {
  const fields = [
    { id: "note", label: "Note", type: "text", required: true },
    { id: "confirmed", label: "Confirm", type: "checkbox", required: true },
  ];
  expect(() =>
    validateGeneralCampaignValues(fields, { note: "", confirmed: false }),
  ).toThrow();
  expect(() =>
    validateGeneralCampaignValues(fields, {
      note: "ok",
      confirmed: true,
      extra: "x",
    }),
  ).toThrow();
  expect(
    validateGeneralCampaignValues(fields, { note: "ok", confirmed: true }),
  ).toEqual({ note: "ok", confirmed: true });
});
