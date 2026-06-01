import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = path.join(root, "artifacts/vndrly/src");

function walk(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) {
      if (name === "node_modules") continue;
      walk(p, out);
    } else if (/\.(tsx|ts)$/.test(name)) {
      out.push(p);
    }
  }
  return out;
}

let n = 0;
for (const file of walk(src)) {
  let c = fs.readFileSync(file, "utf8");
  if (!c.includes("toggle-pill")) continue;

  c = c.replace(/@\/components\/toggle-pill/g, "@/components/png-pill-rollover");
  c = c.replace(/\bTogglePillButton\b/g, "PngPillButton");
  c = c.replace(/\bTogglePillColor\b/g, "PngPillColor");
  c = c.replace(/\bTOGGLE_PILL_GLOSS_GRADIENT\b/g, "PNG_PILL_GLOSS_GRADIENT");
  c = c.replace(/\bTOGGLE_PILL_TEXT_SHADOW\b/g, "PNG_PILL_TEXT_SHADOW");
  c = c.replace(/\bTOGGLE_PILL_COLORS\b/g, "PNG_PILL_COLORS");
  c = c.replace(/import TogglePill from/g, "import PngPill from");
  c = c.replace(/import TogglePill,/g, "import PngPill,");
  c = c.replace(/,\s*TogglePill\b/g, ", PngPill");
  c = c.replace(/<TogglePill(\s|>|\/)/g, "<PngPill$1");
  c = c.replace(/<\/TogglePill>/g, "</PngPill>");

  fs.writeFileSync(file, c);
  n++;
  console.log("updated", path.relative(root, file));
}

const togglePill = path.join(src, "components/toggle-pill.tsx");
if (fs.existsSync(togglePill)) {
  fs.unlinkSync(togglePill);
  console.log("deleted toggle-pill.tsx");
}

console.log(`done — ${n} files`);
