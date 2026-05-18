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

export function Rings() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100">
      <style>{`
        @keyframes askv-ring { 0%{transform: scale(0.9); opacity:0.7} 100%{transform: scale(1.9); opacity:0} }
        .askv-ring { animation: askv-ring 2.4s cubic-bezier(0,0,.2,1) infinite; }
      `}</style>
      <div className="relative flex items-center justify-center" style={{ width: 140, height: 140 }}>
        <span aria-hidden className="askv-ring absolute" style={{ width: 56, height: 56, borderRadius: "9999px", border: `2px solid ${BRAND}`, pointerEvents: "none" }} />
        <span aria-hidden className="askv-ring absolute" style={{ width: 56, height: 56, borderRadius: "9999px", border: `2px solid ${BRAND}`, animationDelay: "1.2s", pointerEvents: "none" }} />
        <Orb />
      </div>
    </div>
  );
}
