const PILL_NATURAL_ASPECT = 900 / 229;
const PILL_CAP_FRACTION = 0.15;
const PILL_CAP_ASPECT = PILL_CAP_FRACTION * PILL_NATURAL_ASPECT;
const PILL_MIDDLE_FRACTION = 1 - 2 * PILL_CAP_FRACTION;

/**
 * 3-slice glossy pill background. Source PNG is 900x229 with the leftmost
 * 15% and rightmost 15% acting as fixed-aspect end caps; the middle 70%
 * is stretched horizontally to fill remaining space.
 *
 * Used by `StatusBadge` and `GlossyAmberButton` so the dashboard "Direct
 * Award" button visually matches the Site Locations status pills.
 */
export default function GlossyPillBg({
  src,
  opacity = 1,
}: {
  src: string;
  opacity?: number;
}) {
  return (
    <div
      className="absolute inset-0 flex pointer-events-none"
      style={{ opacity }}
    >
      <div
        className="h-full shrink-0 overflow-hidden relative"
        style={{ aspectRatio: `${PILL_CAP_ASPECT} / 1` }}
      >
        <img
          src={src}
          alt=""
          draggable={false}
          className="block h-full absolute top-0 left-0"
          style={{ width: "auto", maxWidth: "none" }}
        />
      </div>
      <div className="h-full flex-1 overflow-hidden relative">
        <img
          src={src}
          alt=""
          draggable={false}
          className="block h-full absolute top-0"
          style={{
            width: `calc(100% / ${PILL_MIDDLE_FRACTION})`,
            maxWidth: "none",
            left: `calc(-100% * ${PILL_CAP_FRACTION} / ${PILL_MIDDLE_FRACTION})`,
          }}
        />
      </div>
      <div
        className="h-full shrink-0 overflow-hidden relative"
        style={{ aspectRatio: `${PILL_CAP_ASPECT} / 1` }}
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
