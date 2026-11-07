import { cn } from "@/lib/utils";

export const BRANDED_CIRCLE_GLOSS =
  "linear-gradient(to bottom, rgba(255,255,255,0.5) 0%, rgba(255,255,255,0.5) 50%, transparent 50%, transparent 100%)";

export const BRANDED_CIRCLE_HOVER_CLASS =
  "transition-[transform,filter] duration-200 ease-out hover:-translate-y-0.5 hover:scale-[1.04] hover:drop-shadow-[0_6px_10px_rgba(0,0,0,0.35)] group-hover:-translate-y-0.5 group-hover:scale-[1.04] group-hover:drop-shadow-[0_6px_10px_rgba(0,0,0,0.35)] active:translate-y-0 active:scale-[0.98] group-active:translate-y-0 group-active:scale-[0.98] motion-reduce:transform-none";

interface BrandedCircleChromeProps {
  backgroundMaskSrc: string;
  overlaySrc: string;
  size: number;
  className?: string;
  testIdPrefix?: string;
}

/** Brand-tinted circular image chrome with a preserved artwork overlay. */
export default function BrandedCircleChrome({
  backgroundMaskSrc,
  overlaySrc,
  size,
  className,
  testIdPrefix,
}: BrandedCircleChromeProps) {
  const maskStyle: React.CSSProperties = {
    WebkitMaskImage: `url(${backgroundMaskSrc})`,
    maskImage: `url(${backgroundMaskSrc})`,
    WebkitMaskRepeat: "no-repeat",
    maskRepeat: "no-repeat",
    WebkitMaskSize: "100% 100%",
    maskSize: "100% 100%",
    backgroundColor: "var(--brand-primary)",
  };

  return (
    <span
      aria-hidden="true"
      className={cn(
        "relative inline-block shrink-0 align-middle",
        BRANDED_CIRCLE_HOVER_CLASS,
        className,
      )}
      style={{ width: size, height: size }}
      data-testid={testIdPrefix ? `${testIdPrefix}-circle` : undefined}
    >
      <span
        className="absolute inset-0"
        style={maskStyle}
        data-testid={testIdPrefix ? `${testIdPrefix}-brand-layer` : undefined}
      />
      <img
        src={overlaySrc}
        alt=""
        draggable={false}
        className="pointer-events-none absolute inset-0 h-full w-full select-none transition-[filter] duration-200 group-hover:brightness-110"
        data-testid={testIdPrefix ? `${testIdPrefix}-overlay` : undefined}
      />
    </span>
  );
}
