import { cn } from "@/lib/utils";
import { useBrand } from "@/hooks/use-brand";
import { pickAskVLogo, pickAskVLogoIdle } from "@/lib/pick-askv-logo";

/** Floating launcher footprint — matches 1024×512 AskV PNG aspect (2:1). */
export const ASKV_LAUNCHER_WIDTH = 64;
export const ASKV_LAUNCHER_HEIGHT = 32;

interface AskVLogoProps {
  /** Square fallback when width/height omitted. */
  size?: number;
  width?: number;
  height?: number;
  /** Full vibrancy — modal header icon (active asset, no crossfade). */
  bright?: boolean;
  engaged?: boolean;
  panelOpen?: boolean;
  className?: string;
}

export function AskVLogo({
  size = 56,
  width,
  height,
  bright = false,
  engaged = false,
  panelOpen = false,
  className,
}: AskVLogoProps) {
  const brand = useBrand();
  const w = width ?? size;
  const h = height ?? size;
  const activeSrc = pickAskVLogo(brand.primary, brand.name);

  if (bright) {
    return (
      <img
        src={activeSrc}
        alt=""
        aria-hidden="true"
        draggable={false}
        className={cn("pointer-events-none object-contain", className)}
        style={{ width: w, height: h }}
      />
    );
  }

  return (
    <AskVLogoCrossfade
      width={w}
      height={h}
      showActive={engaged || panelOpen}
      className={className}
    />
  );
}

function AskVLogoCrossfade({
  width,
  height,
  showActive,
  className,
}: {
  width: number;
  height: number;
  showActive: boolean;
  className?: string;
}) {
  const brand = useBrand();
  const idleSrc = pickAskVLogoIdle(brand.primary, brand.name);
  const activeSrc = pickAskVLogo(brand.primary, brand.name);

  return (
    <span
      className={cn("relative inline-block shrink-0", className)}
      style={{ width, height }}
      aria-hidden="true"
    >
      <img
        src={idleSrc}
        alt=""
        draggable={false}
        className={cn(
          "pointer-events-none absolute inset-0 h-full w-full object-contain transition-opacity duration-200",
          showActive ? "opacity-0" : "opacity-100",
        )}
      />
      <img
        src={activeSrc}
        alt=""
        draggable={false}
        className={cn(
          "pointer-events-none absolute inset-0 h-full w-full object-contain transition-opacity duration-200",
          showActive ? "opacity-100" : "opacity-0",
        )}
      />
    </span>
  );
}

/** Launcher mark — grey bubble at rest, brand bubble on hover / open. */
export function AskVFloatingLauncherMark({
  engaged = false,
  panelOpen = false,
}: {
  engaged?: boolean;
  panelOpen?: boolean;
}) {
  return (
    <AskVLogo
      width={ASKV_LAUNCHER_WIDTH}
      height={ASKV_LAUNCHER_HEIGHT}
      engaged={engaged}
      panelOpen={panelOpen}
    />
  );
}
