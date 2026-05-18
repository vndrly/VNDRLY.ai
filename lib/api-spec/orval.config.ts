import { defineConfig, InputTransformerFn } from "orval";
import path from "path";

const root = path.resolve(__dirname, "..", "..");
const apiClientReactSrc = path.resolve(root, "lib", "api-client-react", "src");
const apiZodSrc = path.resolve(root, "lib", "api-zod", "src");

// Our exports make assumptions about the title of the API being "Api" (i.e. generated output is `api.ts`).
const titleTransformer: InputTransformerFn = (config) => {
  config.info ??= {};
  config.info.title = "Api";

  return config;
};

export default defineConfig({
  "api-client-react": {
    input: {
      target: "./openapi.yaml",
      override: {
        transformer: titleTransformer,
      },
    },
    output: {
      workspace: apiClientReactSrc,
      target: "generated",
      client: "react-query",
      mode: "split",
      baseUrl: "/api",
      clean: true,
      prettier: true,
      override: {
        fetch: {
          includeHttpResponseReturnType: false,
        },
        mutator: {
          path: path.resolve(apiClientReactSrc, "custom-fetch.ts"),
          name: "customFetch",
        },
      },
    },
  },
  zod: {
    input: {
      target: "./openapi.yaml",
      override: {
        transformer: titleTransformer,
      },
    },
    output: {
      workspace: apiZodSrc,
      client: "zod",
      target: "generated",
      schemas: { path: "generated/types", type: "typescript" },
      mode: "split",
      clean: true,
      prettier: true,
      override: {
        zod: {
          coerce: {
            query: ['boolean', 'number', 'string'],
            param: ['boolean', 'number', 'string'],
            body: ['bigint', 'date'],
            response: ['bigint', 'date'],
          },
        },
        useDates: true,
        useBigInt: true,
        // The `zod` client emits value-level schemas in `generated/api.ts`
        // (e.g. `export const UpdateSiteAssignmentBody = zod.object(...)`).
        // The companion `schemas: { type: "typescript" }` output emits TS
        // interfaces in `generated/types/*.ts` keyed off the same operation
        // names. Without a suffix on one side, the two `export *` lines in
        // `lib/api-zod/src/index.ts` collide on every overlapping symbol and
        // `tsc --build` fails with TS2308. Suffix the TS interfaces (from
        // `components.*`) with `Type` so the value and type surfaces are
        // disjoint by name. Note that orval does NOT route inline operation
        // parameters through `components.parameters.suffix`, so a handful of
        // `*Params` TS types still share names with their zod counterparts;
        // `lib/api-zod/src/index.ts` re-exports the types module with
        // `export type *` so those remaining cases stay in the type
        // namespace only and don't collide with the value exports.
        components: {
          schemas: { suffix: "Type" },
          responses: { suffix: "Type" },
          requestBodies: { suffix: "Type" },
          parameters: { suffix: "Type" },
        },
      },
    },
  },
});
