/**
 * hotlist-section.tsx — inline button-palette PNG rollovers from git HEAD.
 * No TogglePill / RolloverButton / pickPillForBrand / pill-button-palette.
 */
import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(root, "artifacts/vndrly/src/components/hotlist-section.tsx");

let c = execSync("git show HEAD:artifacts/vndrly/src/components/hotlist-section.tsx", {
  cwd: root,
  encoding: "utf8",
});

c = c.replace(
  /^import TogglePill[^\n]+\n/m,
  "",
);

c = c.replace(
  /^import statusPillAmber[^\n]+\nimport statusPillBlue[^\n]+\nimport statusPillGreen[^\n]+\nimport statusPillRed[^\n]+\nimport statusPillLightGrey[^\n]+\nimport directAwardActivePill[^\n]+\n/m,
  "",
);

c = c.replace(
  /^import RemovePill from "@\/components\/remove-pill";\nimport PillBg from "@\/components\/pill-bg";\n/m,
  `import RemovePill from "@/components/remove-pill";
import PillBg from "@/components/pill-bg";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { useTranslation } from "react-i18next";
import { translateApiError } from "@/lib/api-error";
import { hotlistApi, isVendorListResponse, type HotlistJobRow, type HotlistBidRow } from "@/lib/hotlist-api";
import { Link } from "wouter";
import {
  useListPartners,
  useGetDirectAwardCandidates,
  getGetDirectAwardCandidatesQueryKey,
  type DirectAwardCandidate,
  type HotlistJobStatus,
  type HotlistBidStatus,
} from "@workspace/api-client-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import btnIdlePill from "@assets/button-palette/900x229_Light-grey_v2r_Pill.png";
import btnBluePill from "@assets/button-palette/900x229_blue_Pill_v3.png";
import btnGreenPill from "@assets/button-palette/900x229_green_Pill_v3.png";
import btnRedPill from "@assets/button-palette/900x229_red_Pill_v2.png";
import btnAmberPill from "@assets/button-palette/900x229_Amber_Pill_v4.png";
import directAwardActivePill from "@assets/button-palette/900x229_orange_Pill_v2.png";

const HOTLIST_BTN_AR = 900 / 229;
const statusPillGreen = btnGreenPill;
const statusPillAmber = btnAmberPill;
const statusPillBlue = btnBluePill;
const statusPillRed = btnRedPill;
const statusPillLightGrey = btnIdlePill;

const hotlistBtnShell =
  "relative inline-flex items-center select-none cursor-pointer group bg-transparent border-0 p-0 transition-transform active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed";
const hotlistBtnLabel =
  "relative z-10 flex items-center justify-center gap-1.5 w-full h-full px-4 text-xs font-bold whitespace-nowrap text-gray-800/85 group-hover:text-white group-hover:[text-shadow:0_1px_1px_rgba(0,0,0,0.7)]";

`,
);

c = c.replace(
  /^import \{ useAuth \}[^\n]+\nimport \{ useToast \}[^\n]+\nimport \{ useTranslation \}[^\n]+\nimport \{ translateApiError \}[^\n]+\nimport \{ hotlistApi[^\n]+\nimport \{ Link \}[^\n]+\nimport \{[\s\S]*?\} from "@workspace\/api-client-react";\nimport \{[\s\S]*?\} from "@\/components\/ui\/alert-dialog";\nimport \{ Select[^\n]+\n/m,
  "",
);

c = c.replace(
  /^import \{ type PillColor \}[^\n]+\n/m,
  "",
);

c = c.replace(
  /\/\/ Mirror the `SiteLocationStatus`[\s\S]*?function StatusBadge\([\s\S]*?\n\}\n\n/,
  "",
);

function hoverVarFromAttrs(attrs) {
  const active = attrs.match(/activeSrc=\{([^}]+)\}/);
  if (active) return active[1].trim();
  const color = attrs.match(/color="(\w+)"/);
  switch (color?.[1]) {
    case "red":
      return "btnRedPill";
    case "green":
      return "btnGreenPill";
    case "amber":
      return "btnAmberPill";
    case "blue":
    default:
      return "btnBluePill";
  }
}

function extractJsxAttr(attrs, name) {
  const key = `${name}=`;
  const idx = attrs.indexOf(key);
  if (idx === -1) {
    if (name === "disabled" && /\bdisabled(?:\s|\/|>)/.test(attrs)) return "disabled";
    return null;
  }
  let i = idx + key.length;
  if (attrs[i] === '"') {
    const end = attrs.indexOf('"', i + 1);
    return attrs.slice(i, end + 1);
  }
  if (attrs[i] === "{") {
    let depth = 0;
    for (let j = i; j < attrs.length; j++) {
      if (attrs[j] === "{") depth++;
      else if (attrs[j] === "}") {
        depth--;
        if (depth === 0) return attrs.slice(i, j + 1);
      }
    }
  }
  return null;
}

function toInlineButton(attrs, inner) {
  const hoverVar = hoverVarFromAttrs(attrs);
  const type = attrs.match(/type="(button|submit|reset)"/)?.[1] ?? "button";
  const classMatch = attrs.match(/className="([^"]*)"/);
  const extraClass = classMatch?.[1] ?? "";
  const testIdRaw = extractJsxAttr(attrs, "data-testid");
  const onClickRaw = extractJsxAttr(attrs, "onClick");
  const disabledRaw = extractJsxAttr(attrs, "disabled");

  let disabled = "";
  if (disabledRaw === "disabled") disabled = " disabled";
  else if (disabledRaw?.startsWith("{")) disabled = ` disabled=${disabledRaw}`;

  const testAttr = testIdRaw
    ? testIdRaw.startsWith("{")
      ? ` data-testid=${testIdRaw}`
      : ` data-testid=${testIdRaw}`
    : "";

  const onClick = onClickRaw ? ` onClick=${onClickRaw}` : "";

  return `<button
                type="${type}"
                className={\`\${hotlistBtnShell}${extraClass ? ` ${extraClass}` : ""}\`}
                style={{ height: 22 }}${onClick}${disabled}${testAttr}
              >
                <PillBg src={btnIdlePill} imageAspect={HOTLIST_BTN_AR} className="transition-opacity duration-200 opacity-100 group-hover:opacity-0" />
                <PillBg src={${hoverVar}} imageAspect={HOTLIST_BTN_AR} className="transition-opacity duration-200 opacity-0 group-hover:opacity-100" />
                <span className={hotlistBtnLabel}>${inner.trim()}</span>
              </button>`;
}

function findTagEnd(s, start) {
  let i = start;
  let depth = 0;
  let inString = null;
  while (i < s.length) {
    const ch = s[i];
    if (inString) {
      if (ch === inString && s[i - 1] !== "\\") inString = null;
      i++;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      inString = ch;
      i++;
      continue;
    }
    if (ch === "{") depth++;
    else if (ch === "}") depth--;
    else if (ch === ">" && depth === 0) return i;
    i++;
  }
  throw new Error("unclosed TogglePillButton tag");
}

function replaceTogglePillButtons(c) {
  const tag = "TogglePillButton";
  let out = "";
  let i = 0;
  while (i < c.length) {
    const start = c.indexOf(`<${tag}`, i);
    if (start === -1) {
      out += c.slice(i);
      break;
    }
    out += c.slice(i, start);
    const openEnd = findTagEnd(c, start);
    const attrs = c.slice(start + tag.length + 1, openEnd);
    const closeTag = `</${tag}>`;
    const closeStart = c.indexOf(closeTag, openEnd + 1);
    if (closeStart === -1) throw new Error("missing closing TogglePillButton");
    const inner = c.slice(openEnd + 1, closeStart);
    out += toInlineButton(attrs, inner);
    i = closeStart + closeTag.length;
  }
  return out;
}

c = replaceTogglePillButtons(c);

c = c.replace(/<StatusBadge status=\{([^}]+)\} \/>/g, "<HotlistStatusPill status={$1} />");

fs.writeFileSync(out, c);
console.log("wrote", out);
