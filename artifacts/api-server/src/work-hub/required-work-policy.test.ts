import { expect, it } from "vitest";
import { pendingRequiredWork } from "./required-work-policy";
const base = {
  membershipId: 7,
  contentVersion: 2,
  requiredBeforeWork: true,
  status: "assigned",
};
it("blocks only unresolved requirements for the current membership and pinned version", () => {
  const rows = [
    {
      id: "required",
      title: "Orientation",
      templateVersion: 2,
      assignment: base,
    },
    {
      id: "optional",
      title: "Poll",
      templateVersion: 2,
      assignment: { ...base, requiredBeforeWork: false },
    },
    {
      id: "old",
      title: "Old membership",
      templateVersion: 2,
      assignment: { ...base, membershipId: 6 },
    },
    ...["completed", "cancelled", "exempted"].map((status) => ({
      id: status,
      title: status,
      templateVersion: 2,
      assignment: { ...base, status },
    })),
  ];
  expect(pendingRequiredWork(rows, 7).map((r) => r.id)).toEqual(["required"]);
});
it("fails closed for a required obligation with inconsistent content versions", () => {
  expect(() =>
    pendingRequiredWork(
      [{ id: "x", title: "Orientation", templateVersion: 1, assignment: base }],
      7,
    ),
  ).toThrow("version");
});
