import { z } from "zod/v4";
import { AssetCustodyCommandSchema } from "./implementation-a/assets";
export const CustodyActionSchema = z.enum([
  "checkout",
  "return",
  "verify-issued",
]);
const IdentitySchema = z
  .object({
    assetId: z.uuid(),
    actorUserId: z.number().int().positive(),
    holderUserId: z.number().int().positive().nullable(),
    action: CustodyActionSchema,
    input: AssetCustodyCommandSchema.strict(),
  })
  .strict();
export type CustodyAttempt = Readonly<
  z.infer<typeof IdentitySchema> & { body: string; fingerprint: string }
>;
export function custodyFingerprintValues(raw: unknown) {
  const a = IdentitySchema.parse(raw),
    i = a.input;
  return [
    a.action,
    a.assetId,
    a.actorUserId,
    a.action === "checkout" ? null : a.holderUserId,
    a.action === "return"
      ? null
      : a.action === "checkout"
        ? a.actorUserId
        : a.holderUserId,
    i.condition,
    i.note?.trim() ?? "",
    [...i.photos].sort(),
    i.expectedReturnAt ? new Date(i.expectedReturnAt).toISOString() : null,
  ];
}
export function makeCustodyAttempt(
  raw: unknown,
  fingerprint: string,
): CustodyAttempt {
  const a = IdentitySchema.parse(raw);
  if (!/^[a-f0-9]{64}$/.test(fingerprint)) throw Error("Invalid fingerprint");
  if (a.action !== "checkout" && !a.holderUserId)
    throw Error("Asset has no holder");
  return Object.freeze({
    ...a,
    input: Object.freeze({
      ...a.input,
      photos: Object.freeze([...a.input.photos]) as unknown as string[],
    }),
    body: JSON.stringify(a.input),
    fingerprint,
  });
}
const EventSchema = z
  .object({
    id: z.uuid(),
    type: CustodyActionSchema,
    actorUserId: z.number().int().positive(),
    commandFingerprint: z.string(),
    condition: z.string(),
    fromHolderUserId: z.number().nullable(),
    toHolderUserId: z.number().nullable(),
    occurredAt: z.iso.datetime(),
  })
  .passthrough();
const DetailSchema = z
  .object({
    id: z.uuid(),
    version: z.number().int().positive(),
    history: z.array(z.unknown()),
  })
  .passthrough();
export class CustodyAbsentConflict extends Error {}
export async function submitCustodyAttempt(
  a: CustodyAttempt,
  api: (
    path: string,
    init?: { method: string; body: string },
  ) => Promise<unknown>,
  current: () => boolean,
) {
  const check = () => {
    if (!current()) throw Error("Account changed");
  };
  const path = "/api/implementation-a/assets/" + a.assetId;
  const read = async () => {
    check();
    const d = DetailSchema.parse(await api(path));
    check();
    if (d.id !== a.assetId) throw Error("Asset mismatch");
    const raw = d.history.find(
      (e) =>
        !!e &&
        typeof e === "object" &&
        (e as { id?: string }).id === a.input.operationId,
    );
    if (raw) {
      const e = EventSchema.parse(raw),
        v = custodyFingerprintValues({
          assetId: a.assetId,
          actorUserId: a.actorUserId,
          holderUserId: a.holderUserId,
          action: a.action,
          input: a.input,
        });
      if (
        e.type !== a.action ||
        e.actorUserId !== a.actorUserId ||
        e.commandFingerprint !== a.fingerprint ||
        e.condition !== a.input.condition ||
        e.fromHolderUserId !== v[3] ||
        e.toHolderUserId !== v[4]
      )
        throw Error("Custody receipt mismatch");
      return e;
    }
    if (d.version !== a.input.expectedVersion)
      throw new CustodyAbsentConflict(
        "Original operation absent; asset changed",
      );
    return null;
  };
  const prior = await read();
  if (prior) return prior;
  check();
  try {
    await api(path + "/" + a.action, { method: "POST", body: a.body });
  } catch (error) {
    check();
    try {
      const saved = await read();
      if (saved) return saved;
    } catch (recovery) {
      throw recovery;
    }
    throw error;
  }
  check();
  const saved = await read();
  if (!saved) throw Error("Custody outcome unverified");
  return saved;
}
