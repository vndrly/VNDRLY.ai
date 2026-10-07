import { expect, it, vi } from "vitest";
import {
  makeCustodyAttempt,
  submitCustodyAttempt,
  CustodyAbsentConflict,
  custodyFingerprintValues,
} from "./inventory-custody-client";
const id = "11111111-1111-4111-8111-111111111111",
  op = "22222222-2222-4222-8222-222222222222";
const input = {
  operationId: op,
  expectedVersion: 2,
  condition: "good",
  confirmed: true,
  photos: [],
};
const attempt = () =>
  makeCustodyAttempt(
    {
      assetId: id,
      actorUserId: 17,
      holderUserId: null,
      action: "checkout",
      input,
    },
    "a".repeat(64),
  );
const detail = (history: unknown[] = [], version = 2) => ({
  id,
  version,
  history,
});
const event = {
  id: op,
  type: "checkout",
  actorUserId: 17,
  commandFingerprint: "a".repeat(64),
  condition: "good",
  fromHolderUserId: null,
  toHolderUserId: 17,
  occurredAt: "2026-10-07T10:00:00Z",
};
it("captures immutable body and recovers a dropped committed response without resending", async () => {
  const a = attempt();
  const api = vi
    .fn()
    .mockResolvedValueOnce(detail())
    .mockRejectedValueOnce(Error("lost"))
    .mockResolvedValueOnce(detail([event], 3));
  expect(await submitCustodyAttempt(a, api, () => true)).toEqual(event);
  expect(api).toHaveBeenCalledTimes(3);
  expect(api.mock.calls[1][1].body).toBe(a.body);
  expect(Object.isFrozen(a.input.photos)).toBe(true);
  const recovered = vi.fn().mockResolvedValue(detail([event], 8));
  expect(await submitCustodyAttempt(a, recovered, () => true)).toEqual(event);
  expect(recovered).toHaveBeenCalledOnce();
});
it("refuses changed CAS when exact operation is absent before POST", async () => {
  const api = vi.fn().mockResolvedValue(detail([], 3));
  await expect(
    submitCustodyAttempt(attempt(), api, () => true),
  ).rejects.toBeInstanceOf(CustodyAbsentConflict);
  expect(api).toHaveBeenCalledOnce();
});
it.each([401, 403, 404])(
  "denied recovery retains no-send boundary %s",
  async (status) => {
    const api = vi.fn().mockRejectedValue({ status });
    await expect(
      submitCustodyAttempt(attempt(), api, () => true),
    ).rejects.toEqual({ status });
    expect(api).toHaveBeenCalledOnce();
  },
);
it("rejects wrong actor/fingerprint and changed account", async () => {
  const api = vi
    .fn()
    .mockResolvedValue(detail([{ ...event, actorUserId: 18 }], 3));
  await expect(
    submitCustodyAttempt(attempt(), api, () => true),
  ).rejects.toThrow("mismatch");
  let current = true;
  const switched = vi.fn(async () => {
    current = false;
    return detail();
  });
  await expect(
    submitCustodyAttempt(attempt(), switched, () => current),
  ).rejects.toThrow("Account changed");
  expect(switched).toHaveBeenCalledOnce();
});

it.each(["return", "verify-issued"] as const)("binds %s to the original holder and exact command fingerprint", async action => {
  const raw={assetId:id,actorUserId:17,holderUserId:18,action,input:{...input,note:" reviewed ",photos:["https://example.test/b","https://example.test/a"],expectedReturnAt:"2026-10-08T10:00:00Z"}};
  const values=custodyFingerprintValues(raw);
  expect(values).toEqual([action,id,17,18,action==="return"?null:18,"good","reviewed",["https://example.test/a","https://example.test/b"],"2026-10-08T10:00:00.000Z"]);
  const a=makeCustodyAttempt(raw,"a".repeat(64)),saved={...event,type:action,fromHolderUserId:18,toHolderUserId:action==="return"?null:18};
  expect(await submitCustodyAttempt(a,vi.fn().mockResolvedValue(detail([saved],7)),()=>true)).toEqual(saved);
  const wrong=vi.fn().mockResolvedValue(detail([{...saved,commandFingerprint:"b".repeat(64)}],7));
  await expect(submitCustodyAttempt(a,wrong,()=>true)).rejects.toThrow("mismatch");expect(wrong).toHaveBeenCalledOnce();
});
