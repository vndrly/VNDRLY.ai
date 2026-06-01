/** Fix bad imports left by purge-toggle-pills.mjs */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(ROOT, "artifacts", "vndrly", "src");

function walk(dir, out = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.name === "node_modules" || ent.name === "dist") continue;
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(ent.name)) out.push(p);
  }
  return out;
}

function ensureImport(c, line) {
  if (c.includes(line)) return c;
  const m = c.match(/^import .+\r?\n/m);
  if (m) return c.replace(m[0], m[0] + line + "\r\n");
  return line + "\r\n" + c;
}

function fixFile(filePath) {
  if (filePath.endsWith("pill-button-palette.ts")) return;
  let c = fs.readFileSync(filePath, "utf8");
  const orig = c;

  c = c.replace(
    /import \{\r?\nimport RolloverButton[^\r\n]+\r?\nimport \{ PILL_IDLE_SRC[^\r\n]+\r?\nimport \{ pickPillForBrand[^\r\n]+\r?\n  useGetDashboardSummary,/,
    "import {\r\n  useGetDashboardSummary,",
  );
  c = c.replace(
    /import \{\r?\nimport \{ PILL_IDLE_SRC[^\r\n]+\r?\nimport RolloverButton[^\r\n]+\r?\n  useGetDashboardSummary,/,
    "import {\r\n  useGetDashboardSummary,",
  );

  c = c.replace(
    /^import ReadonlyPill, \{\r?\n  RolloverButton,\r?\n  type ActionTone,\r?\n\} from "@\/lib\/pill-gloss";\r?\n/gm,
    "",
  );

  const badLines = [
    /^import ReadonlyPill, \{ RolloverButton, type ActionTone \} from "@\/lib\/pill-gloss";\r?\n/gm,
    /^import ReadonlyPill, \{ RolloverButton \} from "@\/lib\/pill-gloss";\r?\n/gm,
    /^import ReadonlyPill, \{ type ActionTone \} from "@\/lib\/pill-gloss";\r?\n/gm,
    /^import ReadonlyPill from "@\/lib\/pill-gloss";\r?\n/gm,
    /^import \{ RolloverButton \} from "@\/lib\/pill-gloss";\r?\n/gm,
  ];
  for (const re of badLines) c = c.replace(re, "");

  const usesRollover = /\bRolloverButton\b/.test(c);
  const usesReadonly = /\bReadonlyPill\b/.test(c);
  const usesPalette =
    /\bPILL_IDLE_SRC\b/.test(c) || /\bhoverPillForTone\b/.test(c);
  const usesActionTone = /\bActionTone\b/.test(c);

  if (usesRollover) {
    c = ensureImport(c, 'import RolloverButton from "@/components/rollover-button";');
  }
  if (usesReadonly) {
    c = ensureImport(c, 'import ReadonlyPill from "@/components/readonly-pill";');
  }
  if ((usesPalette || usesActionTone) && !c.includes("@/lib/pill-button-palette")) {
    const names = [];
    if (usesPalette) names.push("PILL_IDLE_SRC", "hoverPillForTone");
    if (usesActionTone) names.push("type ActionTone");
    c = ensureImport(
      c,
      `import { ${names.join(", ")} } from "@/lib/pill-button-palette";`,
    );
  }

  if (c !== orig) {
    fs.writeFileSync(filePath, c);
    console.log("fixed:", path.relative(ROOT, filePath));
  }
}

for (const f of walk(SRC)) fixFile(f);
console.log("import fix complete");
