import { z } from "zod/v4";
import {
  InventoryPolicyCommandSchema,
  InventoryMergeCommandSchema,
  InventoryOwnerSchema,
  InventoryPolicyReadSchema,
  InventoryManagementReadbackSchema,
  type InventoryManagementReceipt,
} from "./inventory-management";
const AttemptSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("policy"),
      actorUserId: z.number().int().positive(),
      owner: InventoryOwnerSchema,
      targetId: z.string().trim().min(1).max(80),
      input: InventoryPolicyCommandSchema,
    })
    .strict(),
  z
    .object({
      action: z.literal("merge"),
      actorUserId: z.number().int().positive(),
      owner: InventoryOwnerSchema,
      targetId: z.uuid(),
      input: InventoryMergeCommandSchema,
    })
    .strict(),
]);
export type InventoryManagementAttempt = Readonly<
  z.infer<typeof AttemptSchema> & { body: string; fingerprint: string }
>;
export function reviewInventoryManagement(
  raw: unknown,
  fingerprint: string,
): InventoryManagementAttempt {
  const a = AttemptSchema.parse(raw);
  z.string()
    .regex(/^[a-f0-9]{64}$/)
    .parse(fingerprint);
  if (a.action === "policy") Object.freeze(a.input.policy);
  Object.freeze(a.input);
  Object.freeze(a.owner);
  return Object.freeze({ ...a, body: JSON.stringify(a.input), fingerprint });
}
export class InventoryManagementAbsentConflict extends Error {}
type Api = (
  method: "GET" | "POST" | "PUT",
  path: string,
  body?: string,
) => Promise<unknown>;
export async function submitInventoryManagement(
  a: InventoryManagementAttempt,
  api: Api,
  current: () => void,
): Promise<InventoryManagementReceipt> {
  const op = `/api/implementation-a/assets/management/operations/${a.input.operationId}`;
  async function read() {
    current();
    const result = InventoryManagementReadbackSchema.parse(
      await api("GET", op),
    );
    current();
    const r = result.receipt;
    if (
      r &&
      (r.actorUserId !== a.actorUserId ||
        r.operationId !== a.input.operationId ||
        r.owner.type !== a.owner.type ||
        r.owner.id !== a.owner.id ||
        r.action !== a.action ||
        r.targetId !== a.targetId ||
        r.commandFingerprint !== a.fingerprint ||
        r.previousVersion !== a.input.expectedVersion ||
        r.version !== a.input.expectedVersion + 1 ||
        (a.action === "merge" &&
          (r.mergedAssetId !== a.input.mergedAssetId ||
            r.mergedPreviousVersion !== a.input.mergedExpectedVersion ||
            r.mergedVersion !== a.input.mergedExpectedVersion + 1)) ||
        (a.action === "policy" &&
          JSON.stringify(r.policy) !== JSON.stringify(a.input.policy)))
    )
      throw Error("Inventory receipt mismatch");
    return r;
  }
  const saved = await read();
  if (saved) return saved;
  if (a.action === "policy") {
    const p = InventoryPolicyReadSchema.parse(
      await api(
        "GET",
        `/api/implementation-a/assets/policies/${encodeURIComponent(a.targetId)}`,
      ),
    );
    current();
    if (
      p.owner.type !== a.owner.type ||
      p.owner.id !== a.owner.id ||
      p.category !== a.targetId
    )
      throw Error("Inventory policy mismatch");
    if (p.version !== a.input.expectedVersion)
      throw new InventoryManagementAbsentConflict("Fresh review required");
  } else {
    for (const [id, version] of [
      [a.targetId, a.input.expectedVersion],
      [a.input.mergedAssetId, a.input.mergedExpectedVersion],
    ] as const) {
      const r = z
        .object({
          id: z.uuid(),
          version: z.number().int().positive(),
          responsibleOwner: InventoryOwnerSchema,
        })
        .passthrough()
        .parse(await api("GET", `/api/implementation-a/assets/${id}`));
      current();
      if (
        r.id !== id ||
        r.responsibleOwner.type !== a.owner.type ||
        r.responsibleOwner.id !== a.owner.id
      )
        throw Error("Inventory asset mismatch");
      if (r.version !== version)
        throw new InventoryManagementAbsentConflict("Fresh review required");
    }
  }
  current();
  try {
    await api(
      a.action === "policy" ? "PUT" : "POST",
      a.action === "policy"
        ? `/api/implementation-a/assets/policies/${encodeURIComponent(a.targetId)}`
        : `/api/implementation-a/assets/${a.targetId}/merge`,
      a.body,
    );
    current();
  } catch (error) {
    const recovered = await read();
    if (recovered) return recovered;
    throw error;
  }
  const result = await read();
  if (!result) throw Error("Saved outcome not verified");
  return result;
}
