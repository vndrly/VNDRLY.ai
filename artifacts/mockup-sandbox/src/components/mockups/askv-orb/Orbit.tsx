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

export function Orbit() {
  const ringSize = 76;
  const dot = 8;
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100">
      <style>{`
        @keyframes askv-orbit-spin { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }
        .askv-orbit-spin { animation: askv-orbit-spin 4.5s linear infinite; transform-origin: center; }
      `}</style>
      <div className="relative flex items-center justify-center" style={{ width: ringSize + 16, height: ringSize + 16 }}>
        <span aria-hidden className="absolute" style={{ width: ringSize, height: ringSize, borderRadius: "9999px", border: `1px solid ${BRAND}55`, pointerEvents: "none" }} />
        <div className="absolute askv-orbit-spin" style={{ width: ringSize, height: ringSize, pointerEvents: "none" }}>
          <span aria-hidden className="absolute" style={{ top: -dot/2, left: ringSize/2 - dot/2, width: dot, height: dot, borderRadius: "9999px", background: BRAND, boxShadow: `0 0 6px ${BRAND}` }} />
        </div>
        <Orb />
      </div>
    </div>
  );
}
