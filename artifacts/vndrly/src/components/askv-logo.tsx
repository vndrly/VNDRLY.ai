import { cn } from "@/lib/utils";
import { useBrand } from "@/hooks/use-brand";
import { pickAskVLogo } from "@/lib/pick-askv-logo";

const BRIGHT_FILTER = "saturate(1.45) brightness(1.08) contrast(1.05)";

/** Floating launcher footprint — matches 1024×512 AskV PNG aspect (2:1). */
export const ASKV_LAUNCHER_WIDTH = 64;
export const ASKV_LAUNCHER_HEIGHT = 32;

interface AskVLogoProps {
  /** Square fallback when width/height omitted. */
  size?: number;
  width?: number;
  height?: number;
  /** Full vibrancy — modal header icon. */
  bright?: boolean;
  /** Slow opacity breathe (optional idle motion). */
  breathing?: boolean;
  /** Gentle vertical float while idle. */
  bob?: boolean;
  engaged?: boolean;
  panelOpen?: boolean;
  className?: string;
}

export function AskVLogo({
  size = 56,
  width,
  height,
  bright = false,
  breathing = false,
  bob = false,
  engaged = false,
  panelOpen = false,
  className,
}: AskVLogoProps) {
  const brand = useBrand();
  const w = width ?? size;
  const h = height ?? size;

  const motionClass =
    bob && !engaged && !panelOpen
      ? "assistant-launcher-bob"
      : breathing && !engaged && !panelOpen
        ? "assistant-launcher-breathe-6s"
        : undefined;

  return (
    <img
      src={pickAskVLogo(brand.primary, brand.name)}
      alt=""
      aria-hidden="true"
      draggable={false}
      className={cn("pointer-events-none object-contain", motionClass, className)}
      style={{
        width: w,
        height: h,
        opacity: bright ? 1 : panelOpen ? 0.35 : engaged ? 1 : undefined,
        filter: bright || engaged ? BRIGHT_FILTER : undefined,
      }}
    />
  );
}

/** Launcher mark — logo only (no ring ripples; idle bob handled on the img). */
export function AskVFloatingLauncherMark({
  engaged = false,
  panelOpen = false,
}: {
  engaged?: boolean;
  panelOpen?: boolean;
}) {
  const idle = !engaged && !panelOpen;

  return (
    <AskVLogo
      width={ASKV_LAUNCHER_WIDTH}
      height={ASKV_LAUNCHER_HEIGHT}
      bob={idle}
      engaged={engaged}
      panelOpen={panelOpen}
    />
  );
}
