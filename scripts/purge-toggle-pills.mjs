/**
 * Purge TogglePill / TogglePillButton — replace with RolloverButton +
 * ReadonlyPill + button-palette PNGs. Run once: node scripts/purge-toggle-pills.mjs
 */
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

function stripProp(attrs, name) {
  const re = new RegExp(
    `\\s+${name}=(?:"[^"]*"|'[^']*'|\\{[^}]*\\})`,
    "g",
  );
  return attrs.replace(re, "");
}

function extractProp(attrs, name) {
  const m = attrs.match(
    new RegExp(`${name}=(?:"([^"]*)"|'([^']*)'|\\{([^}]*)\\})`),
  );
  if (!m) return null;
  return m[1] ?? m[2] ?? `{${m[3]}}`;
}

function hoverToneFromColor(colorVal) {
  if (!colorVal) return '"image"';
  if (/^["'](\w+)["']$/.test(colorVal)) return colorVal;
  if (colorVal.startsWith("{")) return colorVal.slice(1, -1);
  return `"${colorVal}"`;
}

function transformRolloverTag(full, attrs) {
  if (attrs.includes("idleSrc=")) return full;

  let a = attrs;
  const activeSrc = extractProp(a, "activeSrc");
  a = stripProp(a, "activeSrc");
  a = stripProp(a, "activeTextShadowClass");
  a = stripProp(a, "hoverTextShadowClass");
  a = stripProp(a, "attention");
  a = stripProp(a, "size");

  const color = extractProp(a, "color");
  a = stripProp(a, "color");

  let pngProps;
  if (activeSrc) {
    pngProps = ` idleSrc={PILL_IDLE_SRC} hoverSrc={${activeSrc.replace(/^\{|\}$/g, "") || activeSrc}}`;
    if (!activeSrc.startsWith("{")) pngProps = ` idleSrc={PILL_IDLE_SRC} hoverSrc={${activeSrc}}`;
    else pngProps = ` idleSrc={PILL_IDLE_SRC} hoverSrc=${activeSrc}`;
  } else {
    const tone = hoverToneFromColor(color);
    pngProps = ` idleSrc={PILL_IDLE_SRC} hoverSrc={hoverPillForTone(${tone})}`;
  }

  return `<RolloverButton${pngProps}${a}>`;
}

function transformReadonlyTag(full, attrs) {
  if (attrs.includes("src=")) return full;

  let a = attrs;

  // hotlist pattern: color + rest together
  const restVal = extractProp(a, "rest");
  const colorVal = extractProp(a, "color");
  a = stripProp(a, "rest");
  a = stripProp(a, "color");

  let srcProp;
  if (restVal && colorVal) {
    const colorExpr = colorVal.startsWith("{")
      ? colorVal.slice(1, -1)
      : `"${colorVal}"`;
    const restExpr = restVal.startsWith("{") ? restVal.slice(1, -1) : restVal;
    srcProp = ` src={${restExpr} ? PILL_IDLE_SRC : hoverPillForTone(${colorExpr})}`;
  } else if (restVal === "rest" || restVal === "{true}" || restVal === "true") {
    srcProp = ` src={PILL_IDLE_SRC}`;
  } else if (restVal?.startsWith("{")) {
    const restExpr = restVal.slice(1, -1);
    srcProp = ` src={${restExpr} ? PILL_IDLE_SRC : hoverPillForTone("brand")}`;
  } else if (colorVal) {
    const tone = hoverToneFromColor(colorVal);
    srcProp = ` src={hoverPillForTone(${tone})}`;
  } else {
    srcProp = ` src={PILL_IDLE_SRC}`;
  }

  return `<ReadonlyPill${srcProp}${a}>`;
}

function transformContent(content, filePath) {
  if (
    !content.includes("toggle-pill") &&
    !content.includes("TogglePill") &&
    !content.includes("pick-toggle-pill") &&
    !content.includes("TOGGLE_PILL_GLOSS")
  ) {
    return null;
  }

  const orig = content;
  const hadButton = /\bTogglePillButton\b/.test(orig);
  const hadPill = /\bTogglePill\b(?!Button)/.test(orig);
  const hadType = /\bTogglePillColor\b/.test(orig);

  let c = content;

  c = c.replace(/\bTogglePillColor\b/g, "ActionTone");
  c = c.replace(/\bTogglePillButton\b/g, "RolloverButton");
  c = c.replace(/\bTogglePill\b(?!Button)/g, "ReadonlyPill");

  c = c.replace(/<\/RolloverButton>/g, "</RolloverButton>");
  c = c.replace(/<\/ReadonlyPill>/g, "</ReadonlyPill>");

  c = c.replace(/<RolloverButton([^>]*(?:\n[^>]*)*)>/g, (m, attrs) =>
    transformRolloverTag(m, attrs),
  );
  c = c.replace(/<ReadonlyPill([^>]*(?:\n[^>]*)*)>/g, (m, attrs) =>
    transformReadonlyTag(m, attrs),
  );

  c = c.replace(
    /^import\s+[^\n]*from\s+["']@\/components\/toggle-pill["'];?\n/gm,
    "",
  );

  c = c.replace(
    /import\s*\{[^}]*\}\s*from\s+["']@\/components\/toggle-pill["'];?\n/g,
    "",
  );

  c = c.replace(
    /import\s*\{[^}]*\}\s*from\s+["']@\/lib\/pick-toggle-pill["'];?\n/g,
    "",
  );

  c = c.replace(/\bpickTogglePillSrc\b/g, "pickPillForBrand");
  c = c.replace(/\bTOGGLE_IDLE_PILL_SRC\b/g, "PILL_IDLE_SRC");
  c = c.replace(/\bTOGGLE_PILL_GLOSS_GRADIENT\b/g, "PILL_GLOSS_GRADIENT");
  c = c.replace(
    /from\s+["']@\/components\/toggle-pill["']/g,
    'from "@/lib/pill-gloss"',
  );

  if (c.includes("pickPillForBrand") && !c.includes("@/lib/pick-pill-for-brand")) {
    c = c.replace(
      /^(import .+\n)/,
      '$1import { pickPillForBrand } from "@/lib/pick-pill-for-brand";\n',
    );
  }

  if (c.includes("PILL_GLOSS_GRADIENT") && !c.includes("@/lib/pill-gloss")) {
    c = c.replace(
      /^(import .+\n)/,
      '$1import { PILL_GLOSS_GRADIENT } from "@/lib/pill-gloss";\n',
    );
  }

  const needsPalette =
    (hadButton || hadPill || c.includes("PILL_IDLE_SRC")) &&
    !c.includes("@/lib/pill-button-palette");

  const importBlock = [];
  if (hadButton && !c.includes('rollover-button')) {
    importBlock.push('import RolloverButton from "@/components/rollover-button";');
  }
  if (hadPill && !c.includes('readonly-pill')) {
    importBlock.push('import ReadonlyPill from "@/components/readonly-pill";');
  }
  if (needsPalette) {
    const paletteNames = ["PILL_IDLE_SRC", "hoverPillForTone"];
    if (hadType || orig.includes("TogglePillColor")) paletteNames.push("type ActionTone");
    importBlock.push(
      `import { ${paletteNames.join(", ")} } from "@/lib/pill-button-palette";`,
    );
  }

  if (importBlock.length) {
    const firstImport = c.match(/^import .+\n/m);
    if (firstImport) {
      c = c.replace(firstImport[0], firstImport[0] + importBlock.join("\n") + "\n");
    } else {
      c = importBlock.join("\n") + "\n" + c;
    }
  }

  // ticket-route-map: pickPillForBrand needs shape arg
  if (filePath.includes("ticket-route-map")) {
    c = c.replace(
      /pickPillForBrand\(brand\.primary\)/g,
      'pickPillForBrand(brand.primary, "pill")',
    );
  }

  return c === orig ? null : c;
}

const files = walk(SRC);
let changed = 0;
for (const f of files) {
  const content = fs.readFileSync(f, "utf8");
  const next = transformContent(content, f);
  if (next) {
    fs.writeFileSync(f, next);
    changed++;
    console.log("updated:", path.relative(ROOT, f));
  }
}

const toDelete = [
  path.join(SRC, "components", "toggle-pill.tsx"),
  path.join(SRC, "components", "toggle-half-pill-bg.tsx"),
  path.join(SRC, "lib", "pick-toggle-pill.ts"),
  path.join(SRC, "lib", "half-pill-background.ts"),
];

for (const f of toDelete) {
  if (fs.existsSync(f)) {
    fs.unlinkSync(f);
    console.log("deleted:", path.relative(ROOT, f));
  }
}

console.log(`\nDone. ${changed} files updated.`);
