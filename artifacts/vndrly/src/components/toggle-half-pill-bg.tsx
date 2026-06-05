import { toggleHalfPillBgStyle } from "@/lib/pick-toggle-pill";

/**
 * Absolute background layer for one half of a split toggle pill.
 * Prefer {@link SplitToggleHalf} for new toggles.
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
      className={`absolute inset-0 pointer-events-none ${className}`}
      style={toggleHalfPillBgStyle(src, side)}
    />
  );
}
