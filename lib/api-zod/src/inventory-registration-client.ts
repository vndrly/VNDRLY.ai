import { z } from "zod/v4";
import { CreateAssetSchema, AssetAliasSchema } from "./implementation-a/assets";
const normalized = (s: string) =>
  s
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
export function assetAliasMatches(
  a: z.infer<typeof AssetAliasSchema>,
  b: z.infer<typeof AssetAliasSchema>,
) {
  return (
    a.kind === b.kind &&
    (a.jurisdiction?.trim().toUpperCase() ?? "") ===
      (b.jurisdiction?.trim().toUpperCase() ?? "") &&
    normalized(a.value) === normalized(b.value)
  );
}
export function reviewAssetRegistration(raw: unknown) {
  const input = CreateAssetSchema.strict().parse(raw);
  if (input.aliases.length !== 1)
    throw Error("One exact primary identifier required");
  const frozen = Object.freeze({
    ...input,
    responsibleOwner: Object.freeze(input.responsibleOwner),
    aliases: Object.freeze(
      input.aliases.map((a) => Object.freeze(a)),
    ) as unknown as typeof input.aliases,
  });
  return Object.freeze({ input: frozen, body: JSON.stringify(input) });
}
export function reviewAlias(
  assetId: string,
  expectedVersion: number,
  raw: unknown,
) {
  const input = z
    .object({
      alias: AssetAliasSchema,
      expectedVersion: z.number().int().positive(),
    })
    .strict()
    .parse({ alias: raw, expectedVersion });
  z.uuid().parse(assetId);
  return Object.freeze({
    assetId,
    input: Object.freeze({ ...input, alias: Object.freeze(input.alias) }),
    body: JSON.stringify(input),
  });
}
type Api = (path: string) => Promise<unknown>;
const RecordSchema = CreateAssetSchema.extend({
  id: z.uuid(),
  version: z.number().int().positive(),
}).passthrough();
export async function recoverAssetRegistration(
  a: ReturnType<typeof reviewAssetRegistration>,
  api: Api,
  current: () => boolean,
) {
  if (!current()) throw Error("Account changed");
  const alias = a.input.aliases[0],
    query = Object.entries({
      kind: alias.kind,
      value: alias.value,
      ...(alias.jurisdiction ? { jurisdiction: alias.jurisdiction } : {}),
    }).map(([key, value]) => encodeURIComponent(key) + "=" + encodeURIComponent(value)).join("&");
  const d = RecordSchema.parse(
    await api("/api/implementation-a/assets/find?" + query),
  );
  if (!current()) throw Error("Account changed");
  if (
    d.responsibleOwner.type !== a.input.responsibleOwner.type ||
    d.responsibleOwner.id !== a.input.responsibleOwner.id ||
    d.name !== a.input.name ||
    d.category !== a.input.category ||
    d.legalOwner !== a.input.legalOwner ||
    d.provisional !== a.input.provisional ||
    !d.aliases.some((x) => assetAliasMatches(x, alias))
  )
    throw Error("Registration record mismatch");
  return d;
}
export async function recoverAlias(
  a: ReturnType<typeof reviewAlias>,
  api: Api,
  current: () => boolean,
) {
  if (!current()) throw Error("Account changed");
  const d = z
    .object({
      id: z.uuid(),
      version: z.number().int().positive(),
      aliases: z.array(AssetAliasSchema),
    })
    .passthrough()
    .parse(await api("/api/implementation-a/assets/" + a.assetId));
  if (!current()) throw Error("Account changed");
  if (d.id !== a.assetId) throw Error("Asset mismatch");
  return d.aliases.some((x) => assetAliasMatches(x, a.input.alias));
}
