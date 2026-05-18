interface PillBgProps {
  src: string;
  /**
   * Natural width:height of the source pill image. The cap slices keep
   * their natural aspect so they don't squash; the middle slice is
   * stretched horizontally. Defaults to 4 (e.g. a 256x64 source) so
   * existing callers that don't pass the prop keep their previous look.
   */
  imageAspect?: number;
  /**
   * If true, bypass the 3-slice geometry and render the source image
   * as a single full-stretch layer (object-fit: fill). Use this for
   * the *diagonal-gloss* PNG (`pillGloss`) whose features cover the
   * middle 70% of the source — under 3-slice the gloss in the middle
   * gets compressed/stretched to a different angle than the caps,
   * leaving a visible discontinuity at the cap/middle seam on wide
   * pills (long role labels, full-width submit pills, etc.). Stretch
   * mode adapts the diagonal angle uniformly across the pill so there
   * is no boundary mismatch. The grey-base PNG (`pillBase`) MUST stay
   * in 3-slice mode — its rounded caps are the silhouette and would
   * distort under stretch.
   */
  stretch?: boolean;
  className?: string;
  style?: React.CSSProperties;
}

/**
 * 3-slice pill background.
 * Source pill image has natural aspect `imageAspect` (default 4:1).
 * We preserve the leftmost 15% and rightmost 15% as fixed caps (their
 * natural aspect, scaled to button height), and stretch the middle 70%
 * horizontally to fill remaining space.
 *
 * Cap aspect ratio = 0.15 * imageAspect (width:height).
 * Middle is implemented by rendering the full natural-aspect image at
 * width = container_width / 0.7 and shifting it left by 15% of that, so the
 * 70% middle slice exactly fills the container.
 */
export default function PillBg({ src, imageAspect = 4, stretch = false, className = "", style }: PillBgProps) {
  if (stretch) {
    return (
      <img
        src={src}
        alt=""
        draggable={false}
        className={`absolute inset-0 block w-full h-full pointer-events-none ${className}`}
        style={{ objectFit: "fill", ...style }}
      />
    );
  }
  const capAspect = 0.15 * imageAspect;
  return (
    <div className={`absolute inset-0 flex pointer-events-none ${className}`} style={style}>
      {/* Left cap */}
      <div
        className="h-full shrink-0 overflow-hidden relative"
        style={{ aspectRatio: `${capAspect} / 1` }}
      >
        <img
          src={src}
          alt=""
          draggable={false}
          className="block h-full absolute top-0 left-0"
          style={{ width: "auto", maxWidth: "none" }}
        />
      </div>
      {/* Stretched middle. A 1px negative margin on each side lets the
          middle slip over the cap/middle boundary by exactly one pixel so
          any sub-pixel seam there is filled in without overrunning the
          cap's beveled rounded corner. */}
      <div
        className="h-full flex-1 overflow-hidden relative"
        style={{ marginLeft: -1, marginRight: -1 }}
      >
        <img
          src={src}
          alt=""
          draggable={false}
          className="block h-full absolute top-0"
          style={{
            width: "calc(100% / 0.7)",
            maxWidth: "none",
            left: "calc(-100% * 0.15 / 0.7)",
          }}
        />
      </div>
      {/* Right cap */}
      <div
        className="h-full shrink-0 overflow-hidden relative"
        style={{ aspectRatio: `${capAspect} / 1` }}
      >
        <img
          src={src}
          alt=""
          draggable={false}
          className="block h-full absolute top-0 right-0"
          style={{ width: "auto", maxWidth: "none" }}
        />
      </div>
    </div>
  );
}
