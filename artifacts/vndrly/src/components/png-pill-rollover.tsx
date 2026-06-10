import { cn } from "@/lib/utils";
import { useBrand } from "@/hooks/use-brand";
import {
  PILL_ACTION,
  PILL_BRAND,
  PILL_IDLE,
  PILL_TOGGLE_IDLE,
  pillAmber,
  pillBlue,
  pillGreen,
  pillRed,
} from "@/lib/pill-palette-assets";
import {
  PILL_HEIGHT_CLASS,
  PILL_HEIGHT_PX,
  PILL_LABEL_CLASS,
  PILL_LABEL_HOVER_REVEAL_CLASS,
  PILL_LABEL_ON_LIGHT_CLASS,
  PILL_WRAPPER_CLASS,
  pillLabelToneClass,
} from "@/lib/pill-doctrine";
import { PillColorLayer } from "@/components/png-pill-chrome";

/** Inactive half of EN/ES + dark/light inline toggles. */
export const HALF_TOGGLE_IDLE_SRC = PILL_TOGGLE_IDLE;

type HueEntry = { hex: string; src: string };

const HUE_PILL_PALETTE: HueEntry[] = [
  { hex: "#D80B0B", src: pillRed },
  { hex: "#F39C1A", src: pillAmber },
  { hex: "#149F3D", src: pillGreen },
  { hex: "#1E5BD0", src: pillBlue },
];

function hexToRgb(hex: string): [number, number, number] | null {
  const cleaned = hex.trim().replace(/^#/, "");
  const full =
    cleaned.length === 3
      ? cleaned
          .split("")
          .map((c) => c + c)
          .join("")
      : cleaned;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return null;
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ];
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  const d = max - min;
  if (d !== 0) {
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === rn) h = (gn - bn) / d + (gn < bn ? 6 : 0);
    else if (max === gn) h = (bn - rn) / d + 2;
    else h = (rn - gn) / d + 4;
    h *= 60;
  }
  return [h, s, l];
}

function hueDistance(a: number, b: number): number {
  const d = Math.abs(a - b);
  return d > 180 ? 360 - d : d;
}

/** Nearest amber/blue/green/red pill for a brand hex (grey if unsaturated). */
export function brandHuePillSrc(brandColor: string | null | undefined): string {
  if (!brandColor) return PILL_IDLE;
  const rgb = hexToRgb(brandColor);
  if (!rgb) return PILL_IDLE;
  const [h, s, l] = rgbToHsl(rgb[0], rgb[1], rgb[2]);
  if (s < 0.12) return PILL_IDLE;
  let bestSrc = HUE_PILL_PALETTE[0].src;
  let bestScore = Infinity;
  for (const entry of HUE_PILL_PALETTE) {
    const erRgb = hexToRgb(entry.hex);
    if (!erRgb) continue;
    const [eh, es, el] = rgbToHsl(erRgb[0], erRgb[1], erRgb[2]);
    const score =
      (hueDistance(h, eh) / 180) * 3 +
      Math.abs(s - es) * 1 +
      Math.abs(l - el) * 0.5;
    if (score < bestScore) {
      bestScore = score;
      bestSrc = entry.src;
    }
  }
  return bestSrc;
}

/** Brand-named overrides, then hue match — for progress bars, sidebar, etc. */
export function brandImagePillSrc(
  brandColor: string | null | undefined,
  brandName: string | null | undefined,
): string {
  const name = brandName?.toLowerCase() ?? "";
  if (name.includes("baker")) return PILL_BRAND.baker;
  if (name.includes("winchester")) return PILL_BRAND.winchester;
  if (name.includes("vndrly")) return PILL_BRAND.vndrly;
  return brandHuePillSrc(brandColor);
}

export const PNG_PILL_COLORS = {
  brand: "var(--brand-primary)",
  blue: "#3260CD",
  green: "#15803D",
  red: "#DC2626",
  amber: "#F59E0B",
} as const;

export type PngPillColor = keyof typeof PNG_PILL_COLORS;

function coloredSrcForChip(color: PngPillColor): string {
  if (color === "red") return PILL_ACTION.red;
  if (color === "green") return PILL_ACTION.green;
  if (color === "amber") return PILL_ACTION.amber;
  return PILL_ACTION.blue;
}

function hoverSrcForColor(
  color: PngPillColor | "image",
  activeSrc: string | undefined,
  brandName: string | null | undefined,
): string {
  if (activeSrc) return activeSrc;
  if (color === "red") return PILL_ACTION.red;
  if (color === "green") return PILL_ACTION.green;
  if (color === "amber") return PILL_ACTION.amber;
  if (color === "blue") return PILL_ACTION.blue;
  const name = brandName?.toLowerCase() ?? "";
  if (name.includes("baker")) return PILL_BRAND.baker;
  if (name.includes("winchester")) return PILL_BRAND.winchester;
  if (name.includes("vndrly")) return PILL_BRAND.vndrly;
  return PILL_ACTION.blue;
}

function isLightPillSrc(src: string): boolean {
  return src === PILL_IDLE;
}

/** Primary/destructive actions: grey idle, colored on hover. */
function actionHoverRevealSrc(
  color: PngPillColor | "image",
): string | undefined {
  if (color === "blue") return PILL_ACTION.blue;
  if (color === "red") return PILL_ACTION.red;
  if (color === "green") return PILL_ACTION.green;
  if (color === "amber") return PILL_ACTION.amber;
  return undefined;
}

interface PngPillProps {
  children: React.ReactNode;
  color?: PngPillColor;
  rest?: boolean;
  height?: number;
  size?: "xs" | "sm";
  className?: string;
  /** Allow nested controls (e.g. crew-chip remove button). */
  interactive?: boolean;
  "data-testid"?: string;
  "aria-label"?: string;
}

/** Read-only pill — single PNG layer, gloss baked into asset. */
export default function PngPill({
  children,
  color = "brand",
  rest = false,
  height = PILL_HEIGHT_PX,
  size: _size = "xs",
  className,
  interactive = false,
  ...props
}: PngPillProps) {
  const src = rest ? PILL_IDLE : coloredSrcForChip(color);

  return (
    <div
      className={cn(
        PILL_WRAPPER_CLASS,
        PILL_HEIGHT_CLASS,
        !interactive && "pointer-events-none",
        className,
      )}
      style={{ height }}
      data-testid={props["data-testid"]}
      aria-label={props["aria-label"]}
    >
      <PillColorLayer src={src} />
      <span className={cn(PILL_LABEL_CLASS, "h-full gap-1.5", pillLabelToneClass(rest))}>
        {children}
      </span>
    </div>
  );
}

interface PngPillButtonProps {
  children: React.ReactNode;
  color?: PngPillColor | "image";
  activeSrc?: string;
  idleSrc?: string;
  idleOpacity?: number;
  fullWidth?: boolean;
  /** @deprecated CSS shadows removed — kept for call-site compat. */
  activeTextShadowClass?: string;
  /** @deprecated CSS shadows removed — kept for call-site compat. */
  hoverTextShadowClass?: string;
  onClick?: () => void;
  type?: "button" | "submit";
  disabled?: boolean;
  height?: number;
  size?: "xs" | "sm";
  /** @deprecated Visual pulse removed — dirty-state cue TBD in unified pass. */
  attention?: boolean;
  className?: string;
  title?: string;
  "data-testid"?: string;
}

/** Interactive pill — single PNG layer; PillsV1 art carries shine/shadow. */
export function PngPillButton({
  children,
  color = "image",
  activeSrc,
  idleSrc,
  idleOpacity: _idleOpacity = 1,
  fullWidth = false,
  activeTextShadowClass: _activeTextShadowClass,
  hoverTextShadowClass: _hoverTextShadowClass,
  onClick,
  type = "button",
  disabled,
  height = PILL_HEIGHT_PX,
  size: _size = "xs",
  attention: _attention = false,
  className,
  title,
  ...props
}: PngPillButtonProps) {
  const brand = useBrand();
  const actionHoverSrc = actionHoverRevealSrc(color);
  const actionHoverReveal = !!actionHoverSrc;
  const resolvedActiveSrc = activeSrc ?? actionHoverSrc;
  const coloredSrc = hoverSrcForColor(color, resolvedActiveSrc, brand.name);
  const restSrc = actionHoverReveal ? PILL_IDLE : (idleSrc ?? PILL_IDLE);
  const hoverReveal =
    (color === "image" && !!resolvedActiveSrc) || actionHoverReveal;
  const displaySrc =
    color === "image" && !resolvedActiveSrc ? restSrc : coloredSrc;
  const light = hoverReveal ? true : isLightPillSrc(displaySrc);

  const labelClass = hoverReveal
    ? cn(PILL_LABEL_CLASS, "h-full gap-1.5", PILL_LABEL_ON_LIGHT_CLASS, PILL_LABEL_HOVER_REVEAL_CLASS)
    : cn(PILL_LABEL_CLASS, "h-full gap-1.5", pillLabelToneClass(light));

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={cn(
        PILL_WRAPPER_CLASS,
        PILL_HEIGHT_CLASS,
        "group cursor-pointer bg-transparent border-0 p-0",
        fullWidth && "w-full",
        "disabled:opacity-50 disabled:cursor-not-allowed",
        className,
      )}
      style={{ height }}
      data-testid={props["data-testid"]}
    >
      {hoverReveal ? (
        <>
          <PillColorLayer
            src={resolvedActiveSrc!}
            className="opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-active:opacity-100 group-disabled:opacity-0"
          />
          <PillColorLayer
            src={restSrc}
            className="opacity-100 transition-opacity duration-200 group-hover:opacity-0 group-active:opacity-0 group-disabled:opacity-100"
          />
        </>
      ) : (
        <PillColorLayer src={displaySrc} />
      )}
      <span className={labelClass}>{children}</span>
    </button>
  );
}
