const BRAND = "#E1241B";
const BLANK = "/__mockup/images/askv/blank.png";
const BLANK2 = "/__mockup/images/askv/blank2.png";
const HIGHLIGHT = "/__mockup/images/askv/highlight.png";
const ICON = "/__mockup/images/askv/icon.png";

function Orb() {
  return (
    <div className="relative" style={{ width: 56, height: 56 }} aria-label="ask V">
      <img src={BLANK2} alt="" aria-hidden style={{ position: "absolute", inset: 0, width: "100%", height: "100%", opacity: 0.2, pointerEvents: "none" }} />
      <span aria-hidden style={{ position: "absolute", inset: 0, WebkitMaskImage: `url("${BLANK}")`, maskImage: `url("${BLANK}")`, WebkitMaskSize: "100% 100%", maskSize: "100% 100%", WebkitMaskRepeat: "no-repeat", maskRepeat: "no-repeat", WebkitMaskPosition: "center", maskPosition: "center", backgroundColor: BRAND, opacity: 0.9, pointerEvents: "none" }} />
      <img src={HIGHLIGHT} alt="" aria-hidden style={{ position: "absolute", inset: 0, width: "100%", height: "100%", opacity: 0.7, pointerEvents: "none" }} />
      <img src={ICON} alt="ask V" draggable={false} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "contain", pointerEvents: "none" }} className="relative z-10" />
    </div>
  );
}

export function Halo() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100">
      <style>{`
        @keyframes askv-halo { 0%,100%{opacity:0.35; transform: scale(1)} 50%{opacity:0.85; transform: scale(1.15)} }
        .askv-halo { animation: askv-halo 3.2s ease-in-out infinite; }
      `}</style>
      <div className="relative flex items-center justify-center" style={{ width: 120, height: 120 }}>
        <span aria-hidden className="askv-halo absolute" style={{ width: 110, height: 110, borderRadius: "9999px", background: `radial-gradient(circle, ${BRAND}66 0%, ${BRAND}22 45%, transparent 70%)`, filter: "blur(4px)", pointerEvents: "none" }} />
        <Orb />
      </div>
    </div>
  );
}
