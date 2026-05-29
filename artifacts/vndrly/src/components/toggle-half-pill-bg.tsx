import PillBg from "@/components/pill-bg";
import { TOGGLE_PILL_IMAGE_ASPECT } from "@/lib/pick-toggle-pill";

/**
 * One half of a split toggle (EN/ES, Dark/Light, etc.). Uses PillBg
 * 3-slice geometry inside a 200%-width clip so the endcaps keep their
 * circular aspect while only the middle stretches.
 */
export default function ToggleHalfPillBg({
  src,
  side,
  className = "",
}: {
  src: string;
  side: "left" | "right";
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={`absolute inset-0 overflow-hidden pointer-events-none ${className}`}
    >
      <div
        className="absolute inset-y-0 h-full w-[200%] relative"
        style={side === "left" ? { left: 0 } : { right: 0 }}
      >
        <PillBg src={src} imageAspect={TOGGLE_PILL_IMAGE_ASPECT} />
      </div>
    </span>
  );
}
