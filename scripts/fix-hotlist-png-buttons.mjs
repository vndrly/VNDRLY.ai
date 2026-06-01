/**
 * hotlist-section.tsx — direct button-palette PNG rollovers, no wrappers.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const p = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../artifacts/vndrly/src/components/hotlist-section.tsx",
);
let c = fs.readFileSync(p, "utf8");

c = c.replace(
  /^import RolloverButton[^\n]+\nimport ReadonlyPill[^\n]+\nimport \{ PILL_IDLE_SRC, hoverPillForTone, type ActionTone \}[^\n]+\n/m,
  "",
);

if (!c.includes('btnIdlePill from "@assets/button-palette')) {
  c = c.replace(
    /^import \{ useCallback/m,
    `import btnIdlePill from "@assets/button-palette/900x229_Light-grey_v2r_Pill.png";
import btnBluePill from "@assets/button-palette/900x229_blue_Pill_v3.png";
import btnGreenPill from "@assets/button-palette/900x229_green_Pill_v3.png";
import btnRedPill from "@assets/button-palette/900x229_red_Pill_v2.png";
import btnAmberPill from "@assets/button-palette/900x229_Amber_Pill_v4.png";
import directAwardActivePill from "@assets/button-palette/900x229_orange_Pill_v2.png";

const HOTLIST_BTN_AR = 900 / 229;
const hotlistBtnShell =
  "relative inline-flex items-center select-none cursor-pointer group bg-transparent border-0 p-0 transition-transform active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed";
const hotlistBtnLabel =
  "relative z-10 flex items-center justify-center gap-1.5 w-full h-full px-4 text-xs font-bold whitespace-nowrap text-gray-800/85 group-hover:text-white group-hover:[text-shadow:0_1px_1px_rgba(0,0,0,0.7)]";

import { useCallback`,
  );
}

c = c.replace(
  /import statusPillAmber from "@assets\/900x229_Amber_Pill_v4[^"]+";\nimport statusPillBlue from "@assets\/NewPillPallet[^"]+";\nimport statusPillGreen from "@assets\/NewPillPallet[^"]+";\nimport statusPillRed from "@assets\/900x229_red_Pill[^"]+";\nimport statusPillLightGrey from "@assets\/Vndrly[^"]+";\nimport directAwardActivePill from "@assets\/NewPillPallet[^"]+";\n/,
  "",
);

if (!c.includes("const statusPillGreen = btnGreenPill")) {
  c = c.replace(
    "const HOTLIST_BTN_AR = 900 / 229;",
    `const HOTLIST_BTN_AR = 900 / 229;
const statusPillGreen = btnGreenPill;
const statusPillAmber = btnAmberPill;
const statusPillBlue = btnBluePill;
const statusPillRed = btnRedPill;
const statusPillLightGrey = btnIdlePill;`,
  );
}

c = c.replace(
  /const PILL_COLOR_TO_TOGGLE:[\s\S]*?function StatusBadge\([\s\S]*?\n\}\n\n/,
  `function StatusBadge({ status }: { status: HotlistJobStatus | HotlistBidStatus }) {
  return <HotlistStatusPill status={status} />;
}

`,
);

function hoverToVar(expr) {
  if (expr.includes("directAwardActivePill")) return "directAwardActivePill";
  if (expr.includes('"blue"') || expr.includes("'blue'")) return "btnBluePill";
  if (expr.includes('"green"') || expr.includes("'green'")) return "btnGreenPill";
  if (expr.includes('"red"') || expr.includes("'red'")) return "btnRedPill";
  if (expr.includes('"amber"') || expr.includes("'amber'")) return "btnAmberPill";
  if (expr.includes('"image"') || expr.includes("'image'")) return "btnBluePill";
  return "btnBluePill";
}

function toButton(openTag, inner) {
  const hoverMatch = openTag.match(/hoverSrc=\{([^}]+)\}/);
  const hoverVar = hoverMatch ? hoverToVar(hoverMatch[1]) : "btnBluePill";
  let attrs = openTag
    .replace(/<\/?RolloverButton/g, "")
    .replace(/idleSrc=\{PILL_IDLE_SRC\}\s*/g, "")
    .replace(/hoverSrc=\{[^}]+\}\s*/g, "")
    .replace(/activeSrc=\{[^}]+\}\s*/g, "")
    .replace(/activeTextShadowClass=\{[^}]+\}\s*/g, "")
    .replace(/hoverTextShadowClass=\{[^}]+\}\s*/g, "")
    .replace(/^>/, "")
    .trim();
  if (attrs.startsWith(">")) attrs = attrs.slice(1).trim();
  const typeMatch = attrs.match(/type="(button|submit|reset)"/);
  const type = typeMatch ? typeMatch[1] : "button";
  attrs = attrs.replace(/type="(?:button|submit|reset)"\s*/g, "");
  const classMatch = attrs.match(/className="([^"]*)"/);
  const extraClass = classMatch ? classMatch[1] : "";
  attrs = attrs.replace(/className="[^"]*"\s*/g, "");
  const testMatch = attrs.match(/data-testid="([^"]*)"/);
  const testId = testMatch ? testMatch[1] : null;
  attrs = attrs.replace(/data-testid="[^"]*"\s*/g, "");
  const disabled = /disabled(?:=\{[^}]+\}|(?=\s|>))/.test(openTag);
  const onClickMatch = openTag.match(/onClick=\{([^}]+(?:\{[^}]*\}[^}]*)*)\}/);
  const onClick = onClickMatch ? ` onClick={${onClickMatch[1]}}` : "";
  const disabledAttr = disabled ? " disabled={disabled}" : openTag.includes("disabled={") ? ` disabled={${openTag.match(/disabled=\{([^}]+)\}/)?.[1]}}` : "";

  return `<button
                    type="${type}"
                    className={\`\${hotlistBtnShell}${extraClass ? ` ${extraClass}` : ""}\`}
                    style={{ height: 22 }}${onClick}${disabledAttr}${testId ? ` data-testid="${testId}"` : ""}${attrs ? ` ${attrs.trim()}` : ""}
                  >
                    <PillBg src={btnIdlePill} imageAspect={HOTLIST_BTN_AR} className="transition-opacity duration-200 opacity-100 group-hover:opacity-0" />
                    <PillBg src={${hoverVar}} imageAspect={HOTLIST_BTN_AR} className="transition-opacity duration-200 opacity-0 group-hover:opacity-100" />
                    <span className={hotlistBtnLabel}>${inner.trim()}</span>
                  </button>`;
}

c = c.replace(/<RolloverButton([\s\S]*?)>([\s\S]*?)<\/RolloverButton>/g, (_, open, inner) =>
  toButton(`<RolloverButton${open}>`, inner),
);

fs.writeFileSync(p, c);
console.log("hotlist-section.tsx updated");
