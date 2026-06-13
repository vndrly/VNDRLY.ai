import headerBg from "@assets/VNDRLY_Header_Blur_4_1776220762025.png";

interface NavPaneHeaderBlurProps {
  /** Blur band height in px — matches existing login/sidebar treatment. */
  height?: number;
}

/** Top-of-pane blur PNG. z-[1] so it stacks above the halftone (z-0). */
export function NavPaneHeaderBlur({ height = 200 }: NavPaneHeaderBlurProps): React.ReactElement {
  return (
    <div
      className="absolute top-0 left-0 right-0 pointer-events-none z-[1]"
      style={{
        backgroundImage: `url(${headerBg})`,
        backgroundSize: "cover",
        backgroundPosition: "center top",
        opacity: 0.85,
        height: `${height}px`,
        maskImage: "linear-gradient(to bottom, black 0%, transparent 100%)",
        WebkitMaskImage: "linear-gradient(to bottom, black 0%, transparent 100%)",
      }}
      aria-hidden
    />
  );
}
