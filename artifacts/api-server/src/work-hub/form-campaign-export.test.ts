import { expect, it } from "vitest";
import { campaignCsv } from "./form-campaign-export";
it("exports anonymous aggregate counts without employee rows or formula execution", () => {
  const data = {
    config: { anonymous: true, kind: "poll", title: "=unsafe" },
    counts: { responded: 1, pending: 2 },
    totals: [{ label: "=CMD()", votes: 1 }],
    receipts: [
      {
        name: "Private employee",
        email: "private@example.invalid",
        values: { choices: ["a"] },
      },
    ],
  };
  const csv = campaignCsv(data as any);
  expect(csv).not.toContain("Private employee");
  expect(csv).not.toContain("private@example.invalid");
  expect(csv).toContain("'=CMD()");
});

it("exports authorized named general-form values", () => {
  expect(
    campaignCsv({
      config: { kind: "form", anonymous: false },
      counts: { responded: 1 },
      receipts: [
        {
          name: "Casey",
          email: "casey@example.invalid",
          submittedAt: "2026-10-14T00:00:00Z",
          values: { inspection: "Ready" },
        },
      ],
      definition: [],
    } as any),
  ).toContain("Ready");
});
