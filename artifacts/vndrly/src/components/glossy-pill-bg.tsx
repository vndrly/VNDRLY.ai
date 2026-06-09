import { PillColorLayer } from "@/components/png-pill-chrome";

/** Legacy wrapper — delegates to shared pill chrome. */
export default function GlossyPillBg({
  src,
  opacity = 1,
}: {
  src: string;
  opacity?: number;
}) {
  return (
    <div className="absolute inset-0 pointer-events-none" style={{ opacity }}>
      <PillColorLayer src={src} className="opacity-100" />
    </div>
  );
}
