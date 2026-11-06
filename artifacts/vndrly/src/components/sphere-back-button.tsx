import { ArrowLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import { BRANDED_CIRCLE_HOVER_CLASS } from "@/components/branded-circle-chrome";
import brandSphere from "@assets/VNDRLYai-Button-blank_1777361718577.png";
import hoverGlossSphere from "@assets/download_1777663665476.png";
import backIcon from "@assets/Symbol_Arrow_Left_1777371273492.png";

/**
 * Three-layer glossy sphere "Back" icon.
 *
 * Layer stack (bottom -> top):
 *   1. Brand sphere — sphere mask tinted var(--brand-primary). Always
 *      visible; this is the foundation of the button's color.
 *   2. Hover highlight — sphere mask tinted white, opacity 0 at rest
 *      and ~25% on hover. Adds a subtle bright wash over the brand
 *      color so the button feels responsive without losing the brand
 *      hue.
 *   3. A directional arrow with contrast against the brand sphere.
 *
 * This component renders only the visual icon. Wrap it in a <Link>,
 * <button>, or shadcn <Button> at the call site and add the `group`
 * class to that wrapper so hovering the whole control (including any
 * adjacent text label) triggers the gray overlay.
 */
interface SphereBackButtonProps {
  size?: number;
  className?: string;
  direction?: "left" | "right" | "up";
  overlay?: React.ReactNode;
}

export default function SphereBackButton({
  size = 32,
  className,
  direction,
  overlay,
}: SphereBackButtonProps) {
  const isBack = !direction && !overlay;
  const maskCommon: React.CSSProperties = {
    WebkitMaskRepeat: "no-repeat",
    maskRepeat: "no-repeat",
    WebkitMaskSize: "100% 100%",
    maskSize: "100% 100%",
  };
  return (
    <span
      aria-hidden="true"
      className={cn(
        "relative inline-block shrink-0 align-middle",
        isBack
          ? "motion-safe:transition-transform motion-safe:duration-150 motion-safe:hover:scale-110 motion-safe:group-hover:scale-110"
          : BRANDED_CIRCLE_HOVER_CLASS,
        className,
      )}
      style={{ width: size, height: size }}
      data-testid="sphere-back-circle"
    >
      {/* 1. Brand sphere (bottom) — always visible, tinted with the
          active partner/vendor's primary brand color. */}
      <span
        className="absolute inset-0"
        style={{
          ...maskCommon,
          WebkitMaskImage: `url(${brandSphere})`,
          maskImage: `url(${brandSphere})`,
          backgroundColor: "var(--brand-primary)",
        }}
      />
      {/* 2. Hover highlight — full black-sphere-with-gloss PNG laid on
          top, fading in on hover. Unlike the prior mask-tinted wash,
          this asset has its own baked-in gloss + dark body, so it
          renders as a rich glossy overlay rather than a flat tint. */}
      {!isBack && <img
        src={hoverGlossSphere}
        alt=""
        draggable={false}
        className="absolute inset-0 w-full h-full pointer-events-none select-none opacity-0 group-hover:opacity-100 transition-opacity duration-200"
      />}
      {/* 3. The default arrow or a caller-provided white overlay icon. */}
      {overlay ? (
        <span
          data-testid="sphere-button-overlay"
          className="pointer-events-none absolute inset-0 flex select-none items-center justify-center text-white"
        >
          {overlay}
        </span>
      ) : isBack ? (
        <ArrowLeft className="absolute inset-[18%] size-[64%] text-[var(--brand-icon-color,#242426)]" strokeWidth={3} />
      ) : (
        <img
          src={backIcon}
          alt=""
          draggable={false}
          className="absolute inset-0 w-full h-full pointer-events-none select-none"
          style={{ mixBlendMode: "screen", transform: direction === "up" ? "rotate(90deg)" : direction === "right" ? "rotate(180deg)" : undefined }}
        />
      )}
    </span>
  );
}
