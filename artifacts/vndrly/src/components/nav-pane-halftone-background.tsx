import usHalftone from "@assets/nav-pane-us-halftone.svg";
import type { NavPaneHalftoneVariant } from "@/components/nav-pane-tokens";

interface NavPaneHalftoneBackgroundProps {
  /** Pass false in light mode — pattern is vdark-only. */
  enabled?: boolean;
  variant?: NavPaneHalftoneVariant;
}

/**
 * Subtle halftone lower-48 map on the dark nav pane. Sits at z-0 so the
 * header blur PNG (z-[1]) and interactive chrome (z-10+) stay untouched.
 */
export function NavPaneHalftoneBackground({
  enabled = true,
  variant = "sidebar",
}: NavPaneHalftoneBackgroundProps): React.ReactElement | null {
  if (!enabled) return null;

  const isSidebar = variant === "sidebar";

  return (
    <div
      className="absolute inset-0 pointer-events-none overflow-hidden"
      style={{ zIndex: 0 }}
      aria-hidden
      data-testid="nav-pane-halftone"
    >
      <img
        src={usHalftone}
        alt=""
        draggable={false}
        className="absolute max-w-none select-none"
        style={
          isSidebar
            ? {
                width: "285%",
                height: "195%",
                left: "50%",
                top: "50%",
                transform: "translate(-50%, -50%)",
                opacity: 0.22,
                maskImage:
                  "radial-gradient(ellipse 95% 85% at 50% 52%, black 18%, rgba(0,0,0,0.75) 50%, transparent 100%)",
                WebkitMaskImage:
                  "radial-gradient(ellipse 95% 85% at 50% 52%, black 18%, rgba(0,0,0,0.75) 50%, transparent 100%)",
              }
            : {
                width: "160%",
                height: "115%",
                right: "-42%",
                bottom: "-14%",
                opacity: 0.19,
                maskImage:
                  "linear-gradient(135deg, transparent 0%, rgba(0,0,0,0.25) 32%, black 55%, black 100%)",
                WebkitMaskImage:
                  "linear-gradient(135deg, transparent 0%, rgba(0,0,0,0.25) 32%, black 55%, black 100%)",
              }
        }
      />
      {/* Keep the top/header band calm so the blur layer reads cleanly above. */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "linear-gradient(to bottom, rgba(58,61,66,0.72) 0%, rgba(58,61,66,0.2) 22%, transparent 42%)",
        }}
      />
    </div>
  );
}
