import { expect, it, vi } from "vitest";
import {
  reviewAssetRegistration,
  recoverAssetRegistration,
  reviewAlias,
  recoverAlias,
} from "./inventory-registration-client";
const id = "11111111-1111-4111-8111-111111111111",
  alias = { kind: "serial", value: "FIXTURE-1" };
const raw = {
  name: "Radio",
  category: "radio",
  legalOwner: "Fixture vendor",
  responsibleOwner: { type: "vendor", id: 7 },
  aliases: [alias],
};
it("retains exact registration and observes matching record without resending", async () => {
  const a = reviewAssetRegistration(raw),
    api = vi.fn().mockResolvedValue({ ...raw, id, version: 1 });
  expect((await recoverAssetRegistration(a, api, () => true)).id).toBe(id);
  expect(api).toHaveBeenCalledOnce();
  expect(Object.isFrozen(a.input.aliases)).toBe(true);
});
it("refuses foreign owner or changed fields", async () => {
  const api = vi
    .fn()
    .mockResolvedValue({
      ...raw,
      id,
      version: 1,
      responsibleOwner: { type: "vendor", id: 8 },
    });
  await expect(
    recoverAssetRegistration(reviewAssetRegistration(raw), api, () => true),
  ).rejects.toThrow("mismatch");
});
it("alias recovery uses exact asset and never resends; absence remains unknown", async () => {
  const a = reviewAlias(id, 2, alias),
    api = vi.fn().mockResolvedValue({ id, version: 4, aliases: [alias] });
  expect(await recoverAlias(a, api, () => true)).toBe(true);
  expect(api).toHaveBeenCalledOnce();
  expect(
    await recoverAlias(
      a,
      vi.fn().mockResolvedValue({ id, version: 2, aliases: [] }),
      () => true,
    ),
  ).toBe(false);
});
