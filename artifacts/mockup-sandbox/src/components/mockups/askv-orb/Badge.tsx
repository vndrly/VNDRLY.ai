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

export function Badge() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100">
      <style>{`
        @keyframes askv-badge-pop { 0%,90%,100%{transform: scale(1)} 95%{transform: scale(1.18)} }
        .askv-badge-pop { animation: askv-badge-pop 3s ease-in-out infinite; transform-origin: center; }
      `}</style>
      <div className="relative" style={{ width: 56, height: 56 }}>
        <Orb />
        <span
          aria-hidden
          className="askv-badge-pop absolute flex items-center justify-center font-bold"
          style={{
            top: -4, right: -4,
            width: 20, height: 20, borderRadius: "9999px",
            background: BRAND, color: "#fff",
            fontSize: 11, lineHeight: 1,
            boxShadow: "0 1px 3px rgba(0,0,0,0.35), 0 0 0 2px #f3f4f6",
          }}
        >?</span>
      </div>
    </div>
  );
}
