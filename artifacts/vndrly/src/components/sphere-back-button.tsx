import { cn } from "@/lib/utils";
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
 *   3. White arrow icon laid on top with mix-blend-mode: screen. The
 *      source PNG is a white left-arrow on a black background, so
 *      the black completely disappears over the brand color and the
 *      white arrow pops at full brightness.
 *
 * This component renders only the visual icon. Wrap it in a <Link>,
 * <button>, or shadcn <Button> at the call site and add the `group`
 * class to that wrapper so hovering the whole control (including any
 * adjacent text label) triggers the gray overlay.
 */
interface SphereBackButtonProps {
  size?: number;
  className?: string;
}

export default function SphereBackButton({
  size = 32,
  className,
}: SphereBackButtonProps) {
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
        className,
      )}
      style={{ width: size, height: size }}
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
      <img
        src={hoverGlossSphere}
        alt=""
        draggable={false}
        className="absolute inset-0 w-full h-full pointer-events-none select-none opacity-0 group-hover:opacity-100 transition-opacity duration-200"
      />
      {/* 3. White arrow PNG laid on top with `screen` blend so the
          black background drops out and the white arrow pops at full
          brightness over the brand sphere. */}
      <img
        src={backIcon}
        alt=""
        draggable={false}
        className="absolute inset-0 w-full h-full pointer-events-none select-none"
        style={{ mixBlendMode: "screen" }}
      />
    </span>
  );
}
