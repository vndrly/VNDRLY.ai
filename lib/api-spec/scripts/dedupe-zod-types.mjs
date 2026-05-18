#!/usr/bin/env node
// Post-codegen pass for `@workspace/api-zod`.
//
// orval's `components.{schemas,responses,requestBodies,parameters}.suffix`
// only renames TS interfaces derived from `components.*` entries. Inline
// operation parameters bypass that path, so a handful of `*Params` TS
// interfaces in `lib/api-zod/src/generated/types/` still share names with
// the zod consts in `generated/api.ts`. Suffix those holdouts here so
// `lib/api-zod/src/index.ts` can flat-`export *` from the types module
// without TS2308 collisions.
//
// Approach: read every emitted name from `generated/api.ts`, scan
// `generated/types/*.ts` for `export interface|type|enum <Name>` whose
// <Name> appears in api.ts, and rename the declaration plus every
// reference to it (including the file's own filename and the barrel
// `index.ts` re-export). This is intentionally based on the actual emitted
// names rather than a hardcoded list so future spec changes don't need
// follow-up edits here.
import { readFileSync, writeFileSync, renameSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ZOD_GENERATED = join(__dirname, "..", "..", "api-zod", "src", "generated");
const API_FILE = join(ZOD_GENERATED, "api.ts");
const TYPES_DIR = join(ZOD_GENERATED, "types");
const SUFFIX = "Type";

const apiSrc = readFileSync(API_FILE, "utf8");
const apiNames = new Set(
  Array.from(apiSrc.matchAll(/^export\s+const\s+([A-Za-z0-9_]+)\b/gm), (m) => m[1]),
);

const typeFiles = readdirSync(TYPES_DIR).filter(
  (f) => f.endsWith(".ts") && f !== "index.ts",
);

const renames = new Map(); // oldName -> newName

for (const file of typeFiles) {
  const filePath = join(TYPES_DIR, file);
  const src = readFileSync(filePath, "utf8");
  const decl = src.match(
    /^export\s+(?:interface|type|enum|const)\s+([A-Za-z0-9_]+)\b/m,
  );
  if (!decl) continue;
  const name = decl[1];
  if (!apiNames.has(name)) continue;
  if (name.endsWith(SUFFIX)) continue;
  renames.set(name, `${name}${SUFFIX}`);
}

if (renames.size === 0) {
  process.exit(0);
}

const replaceWord = (src, from, to) =>
  src.replace(new RegExp(`\\b${from}\\b`, "g"), to);

// Apply renames inside every type file (declarations + cross-references).
const allTypeFilePaths = typeFiles.map((f) => join(TYPES_DIR, f));
for (const filePath of allTypeFilePaths) {
  let src = readFileSync(filePath, "utf8");
  let changed = false;
  for (const [from, to] of renames) {
    if (src.includes(from)) {
      const next = replaceWord(src, from, to);
      if (next !== src) {
        src = next;
        changed = true;
      }
    }
  }
  if (changed) writeFileSync(filePath, src);
}

// Rename the files themselves so the filename matches the lower-camel of
// the new export name (orval's convention for `mode: "split"`).
for (const [from, to] of renames) {
  const lcFrom = from.charAt(0).toLowerCase() + from.slice(1);
  const lcTo = to.charAt(0).toLowerCase() + to.slice(1);
  const oldFile = join(TYPES_DIR, `${lcFrom}.ts`);
  const newFile = join(TYPES_DIR, `${lcTo}.ts`);
  try {
    renameSync(oldFile, newFile);
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
  }
}

// Patch the barrel index so its `export * from "./oldName"` lines point at
// the renamed files.
const indexPath = join(TYPES_DIR, "index.ts");
let indexSrc = readFileSync(indexPath, "utf8");
for (const [from, to] of renames) {
  const lcFrom = from.charAt(0).toLowerCase() + from.slice(1);
  const lcTo = to.charAt(0).toLowerCase() + to.slice(1);
  indexSrc = indexSrc.replace(
    new RegExp(`(["'])\\./${lcFrom}\\1`, "g"),
    `$1./${lcTo}$1`,
  );
}
writeFileSync(indexPath, indexSrc);

console.log(
  `dedupe-zod-types: suffixed ${renames.size} TS type(s) with "${SUFFIX}" to avoid clashing with zod consts: ${Array.from(renames.keys()).join(", ")}`,
);
