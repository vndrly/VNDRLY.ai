interface TintedPillBgProps {
  src: string;
  color: string;
  /**
   * Optional CSS `background-image` value layered on top of `color`
   * inside the same pill silhouette mask. Use to paint a gradient
   * (e.g. a top-half white gloss like the EN/ES toggle) over a solid
   * brand color without it bleeding past the rounded pill shape.
   */
  backgroundImage?: string;
  className?: string;
  style?: React.CSSProperties;
}

/**
 * Tinted 3-slice pill background.
 *
 * Mirrors the geometry of <PillBg> (left cap / stretched middle / right cap)
 * but renders each slice as a solid-color div whose shape comes from the
 * source image used as a CSS mask. This lets us color the pill with any
 * value (CSS variable, hex, rgb, etc.) — including dynamic brand colors —
 * instead of relying on a pre-tinted PNG per state.
 *
 * Mask geometry mirrors PillBg:
 *  - Left cap:   aspect 0.6:1, mask sized auto-by-height, anchored left.
 *  - Middle:     mask scaled so the source's middle 70% spans the slice.
 *  - Right cap:  same as left cap, anchored right.
 */
export default function TintedPillBg({
  src,
  color,
  backgroundImage,
  className = "",
  style,
}: TintedPillBgProps) {
  const maskBase: React.CSSProperties = {
    backgroundColor: color,
    ...(backgroundImage ? { backgroundImage } : {}),
    WebkitMaskImage: `url(${src})`,
    maskImage: `url(${src})`,
    WebkitMaskRepeat: "no-repeat",
    maskRepeat: "no-repeat",
  };
  return (
    <div
      className={`absolute inset-0 flex pointer-events-none ${className}`}
      style={style}
    >
      {/* Left cap */}
      <div
        className="h-full shrink-0"
        style={{
          aspectRatio: "0.6 / 1",
          ...maskBase,
          WebkitMaskSize: "auto 100%",
          maskSize: "auto 100%",
          WebkitMaskPosition: "left center",
          maskPosition: "left center",
        }}
      />
      {/* Stretched middle: mask-size width is 1/0.7 of the slice so that the
          source image's middle 70% maps exactly onto the visible 100%, with
          mask-position 50% centering the overflow on both sides. A 2px
          negative margin on each side lets the middle's flat-mask edge
          slip over the cap/middle boundary by 2 pixels so any sub-pixel
          seam there is fully filled in without overrunning the cap's
          beveled rounded corner. (Started at 1px but the hover pill on
          the Vendors page still showed a faint vertical seam at certain
          widths; 2px reliably covers the rounding gap on every layer in
          the stack.) */}
      <div
        className="h-full flex-1"
        style={{
          ...maskBase,
          WebkitMaskSize: "calc(100% / 0.7) 100%",
          maskSize: "calc(100% / 0.7) 100%",
          WebkitMaskPosition: "50% 50%",
          maskPosition: "50% 50%",
          marginLeft: -2,
          marginRight: -2,
        }}
      />
      {/* Right cap */}
      <div
        className="h-full shrink-0"
        style={{
          aspectRatio: "0.6 / 1",
          ...maskBase,
          WebkitMaskSize: "auto 100%",
          maskSize: "auto 100%",
          WebkitMaskPosition: "right center",
          maskPosition: "right center",
        }}
      />
    </div>
  );
}
