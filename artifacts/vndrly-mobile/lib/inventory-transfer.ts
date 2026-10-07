import {
  AssetTransferInputSchema,
  AssetTransferReadbackSchema,
  type AssetTransferInput,
} from "@workspace/api-zod";
export type TransferAttempt = Readonly<{
  assetId: string;
  input: AssetTransferInput;
  body: string;
  actorUserId: number;
  fromHolderUserId: number;
  fingerprint: string;
}>;
export function makeTransferAttempt(
  assetId: string,
  raw: unknown,
  actorUserId: number,
  fromHolderUserId: number,
  fingerprint: string,
): TransferAttempt {
  if (
    !/^[a-f0-9-]{36}$/i.test(assetId) ||
    !Number.isInteger(actorUserId) ||
    actorUserId < 1 ||
    !Number.isInteger(fromHolderUserId) ||
    fromHolderUserId < 1 ||
    !/^[a-f0-9]{64}$/.test(fingerprint)
  )
    throw Error("Invalid transfer identity");
  const input = AssetTransferInputSchema.parse(raw);
  if (input.toHolderUserId === fromHolderUserId)
    throw Error("Recipient already holds asset");
  return Object.freeze({
    assetId,
    input: Object.freeze({
      ...input,
      photos: Object.freeze([...input.photos]) as unknown as string[],
    }),
    body: JSON.stringify(input),
    actorUserId,
    fromHolderUserId,
    fingerprint,
  });
}
export class AbsentTransferConflict extends Error {}
export async function submitTransferAttempt(
  attempt: TransferAttempt,
  api: (
    path: string,
    init?: { method: string; body: string },
  ) => Promise<unknown>,
  current: () => boolean,
) {
  const check = () => {
    if (!current()) throw Error("Account changed");
  };
  const path = "/api/implementation-a/assets/" + attempt.assetId;
  async function read() {
    check();
    const result = AssetTransferReadbackSchema.parse(
      await api(path + "/transfers/" + attempt.input.operationId),
    );
    check();
    const r = result.receipt;
    if (
      r &&
      (r.assetId !== attempt.assetId ||
        r.operationId !== attempt.input.operationId ||
        r.actorUserId !== attempt.actorUserId ||
        r.fromHolderUserId !== attempt.fromHolderUserId ||
        r.toHolderUserId !== attempt.input.toHolderUserId ||
        r.condition !== attempt.input.condition ||
        r.commandFingerprint !== attempt.fingerprint)
    )
      throw Error("Transfer receipt mismatch");
    if (!r && result.currentVersion !== attempt.input.expectedVersion)
      throw new AbsentTransferConflict(
        "Original transfer absent; asset version changed",
      );
    return r;
  }
  const saved = await read();
  if (saved) return saved;
  check();
  await api(path + "/transfer", { method: "POST", body: attempt.body });
  check();
  const receipt = await read();
  if (!receipt) throw Error("Transfer unverified");
  return receipt;
}
