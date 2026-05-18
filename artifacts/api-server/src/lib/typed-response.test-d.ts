// Type-only tests for the typed-response bridge. This file lives under
// `src/` (which `tsconfig.json` includes), so `tsc --noEmit` — the
// package's `typecheck` script and the canonical CI gate — actually
// checks it. The naming convention `*.test-d.ts` is just a hint to
// readers that the file contains no runtime assertions; the file
// extension is plain `.ts`, NOT `.d.ts`, so it is fully typechecked
// (verified by adding a sentinel error and observing it in `typecheck`
// output during Task #557).
//
// Each `// @ts-expect-error` line asserts that the compiler rejects the
// call below it. Regressing the bridge — e.g. by removing the `Loose<>`
// or the `NoInfer<>` wrapper from the body parameter — would surface
// here as either a propagated error (if the negative test starts type-
// checking) or as an "unused @ts-expect-error directive" diagnostic.

import type { Response } from "express";
import { z } from "zod";
import { sendResponse, type Loose } from "./typed-response";

// A schema shaped like a typical API response: required scalar, nullable
// scalar, enum (string-literal union), nested array of objects.
const Schema = z.object({
  id: z.number(),
  name: z.string(),
  tag: z.string().nullable(),
  status: z.enum(["active", "inactive"]),
  optional: z.string().nullish(),
  createdAt: z.coerce.date(),
  items: z.array(
    z.object({
      id: z.number(),
      label: z.string(),
    }),
  ),
});

declare const res: Response;

// Drizzle-shaped input: enum column comes back as plain `string`, nullable
// columns as `string | null`, timestamp as `Date`. The bridge must accept
// this even though the schema narrows `status` to a literal union.
const okBody = {
  id: 1,
  name: "row",
  tag: null as string | null,
  status: "active" as string,
  createdAt: new Date(),
  items: [{ id: 1, label: "a" }],
};
sendResponse(res, Schema, okBody);

// Optional fields can be set, omitted, or set to null/undefined.
sendResponse(res, Schema, { ...okBody, optional: "x" });
sendResponse(res, Schema, { ...okBody, optional: null });
sendResponse(res, Schema, { ...okBody, optional: undefined });

// --- Negative tests: each call below must fail typecheck. ---

// Missing required `name`.
// @ts-expect-error name is required
sendResponse(res, Schema, {
  id: 1,
  tag: null,
  status: "active",
  createdAt: new Date(),
  items: [],
});

// Missing required `items` array.
// @ts-expect-error items is required
sendResponse(res, Schema, {
  id: 1,
  name: "row",
  tag: null,
  status: "active",
  createdAt: new Date(),
});

// Nested item missing required `label`.
sendResponse(res, Schema, {
  ...okBody,
  // @ts-expect-error nested label is required
  items: [{ id: 1 }],
});

// Wrong primitive type — number where string is required.
sendResponse(res, Schema, {
  ...okBody,
  // @ts-expect-error name must be a string
  name: 123,
});

// `NoInfer<>` regression guard: even when the body is structurally
// LOOSER than the schema, S must be inferred from `schema` only, never
// widened by the body argument. Without `NoInfer`, TS could in theory
// pick an S whose output type matches the (smaller) body — silently
// accepting a missing-column projection. With `NoInfer`, the body is
// measured against the schema's S, so the call below must error.
// @ts-expect-error body is missing required `name` (NoInfer keeps S anchored to Schema)
sendResponse(res, Schema, {
  id: 1,
  tag: null as string | null,
  status: "active" as string,
  createdAt: new Date(),
  items: [],
});

// --- Loose<T> shape sanity checks ---

// Enum unions widen to their primitive base.
type LooseEnum = Loose<"a" | "b">;
const _enum: LooseEnum = "anything-goes";
void _enum;

// Date is preserved (not walked as a structural object).
type LooseDate = Loose<Date>;
const _date: LooseDate = new Date();
void _date;

// Nullable enums widen to `string | null`, not `null` alone.
type LooseNullableEnum = Loose<"a" | "b" | null>;
const _ne1: LooseNullableEnum = "x";
const _ne2: LooseNullableEnum = null;
void _ne1;
void _ne2;
