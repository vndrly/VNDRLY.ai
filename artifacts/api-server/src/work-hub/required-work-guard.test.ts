import { expect, it, vi } from "vitest";
import {
  assertRequiredWorkClear,
  RequiredWorkError,
} from "./required-work-guard";
const metadata = {
  version: 0,
  assignmentId: "10000000-0000-4000-8000-000000000001",
  sourceItemId: "10000000-0000-4000-8000-000000000002",
  contentVersion: 1,
  membershipId: 7,
  requiredBeforeWork: true,
  assignedAt: "2026-10-14T12:00:00Z",
  dueAt: "2026-11-14T12:00:00Z",
};
it("rechecks current membership and locks the obligation in the start transaction", async () => {
  const client = {
    query: vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ id: 7 }] }).mockResolvedValueOnce({rows:[]})
      .mockResolvedValueOnce({
        rows: [
          {
            id: "required",
            title: "Orientation",
            template_version: 1,
            assignment_metadata: metadata,
          },
        ],
      }),
  };
  await expect(
    assertRequiredWorkClear(client as any, 9, { type: "vendor", id: 12 }),
  ).rejects.toBeInstanceOf(RequiredWorkError);
  expect(client.query.mock.calls[0][1]).toEqual([9, "vendor", 12]);
  expect(client.query.mock.calls[2][0]).toContain("FOR SHARE OF i");
});
it("an audited exemption clears work requirements without recording an employee response", async () => {
  const client = {
    query: vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ id: 7 }] }).mockResolvedValueOnce({rows:[]})
      .mockResolvedValueOnce({
        rows: [
          {
            id: "exempt",
            title: "Orientation",
            template_version: 1,
            assignment_metadata: { ...metadata, status: "exempted" },
          },
        ],
      }),
  };
  await expect(
    assertRequiredWorkClear(client as any, 9, { type: "vendor", id: 12 }),
  ).resolves.toBeUndefined();
  expect(client.query).toHaveBeenCalledTimes(3);
});

it("blocks a new hire before required onboarding has been materialized",async()=>{const client={query:vi.fn().mockResolvedValueOnce({rows:[{id:7}]}).mockResolvedValueOnce({rows:[{id:"bundle",title:"Required orientation"}]})};await expect(assertRequiredWorkClear(client as any,9,{type:"vendor",id:12})).rejects.toMatchObject({assignments:[{id:"bundle",title:"Required orientation"}]});expect(client.query).toHaveBeenCalledTimes(2);});
