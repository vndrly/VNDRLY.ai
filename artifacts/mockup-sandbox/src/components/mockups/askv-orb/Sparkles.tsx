const BRAND = "#E1241B";
const BLANK = "/__mockup/images/askv/blank.png";
const BLANK2 = "/__mockup/images/askv/blank2.png";
const HIGHLIGHT = "/__mockup/images/askv/highlight.png";
const ICON = "/__mockup/images/askv/icon.png";

function Orb() {
  return (
    <div className="relative" style={{ width: 56, height: 56 }} aria-label="ask V">
      <img src={BLANK2} alt="" aria-hidden style={{ position: "absolute", inset: 0, width: "100%", height: "100%", opacity: 0.2, pointerEvents: "none" }} />
      <span aria-hidden className="askv-pulse" style={{ position: "absolute", inset: 0, WebkitMaskImage: `url("${BLANK}")`, maskImage: `url("${BLANK}")`, WebkitMaskSize: "100% 100%", maskSize: "100% 100%", WebkitMaskRepeat: "no-repeat", maskRepeat: "no-repeat", WebkitMaskPosition: "center", maskPosition: "center", backgroundColor: BRAND, pointerEvents: "none" }} />
      <img src={HIGHLIGHT} alt="" aria-hidden style={{ position: "absolute", inset: 0, width: "100%", height: "100%", opacity: 0.7, pointerEvents: "none" }} />
      <img src={ICON} alt="ask V" draggable={false} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "contain", pointerEvents: "none" }} className="relative z-10" />
    </div>
  );
}

export function Sparkles() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100">
      <style>{`
        @keyframes askv-pulse { 0%,50%{opacity:1} 75%{opacity:0} 100%{opacity:1} }
        .askv-pulse { animation: askv-pulse 6s ease-in-out infinite; }
        @keyframes spk { 0%,100%{opacity:0; transform: scale(.6) rotate(0deg)} 50%{opacity:1; transform: scale(1) rotate(20deg)} }
        .spk { animation: spk 2.4s ease-in-out infinite; transform-origin: center; }
      `}</style>
      <div className="relative" style={{ width: 56, height: 56 }}>
        <Orb />
        <svg className="absolute pointer-events-none" style={{ top: -14, right: -14, width: 22, height: 22, color: BRAND, animationDelay: "0s" }} viewBox="0 0 24 24" fill="currentColor"><path className="spk" d="M12 2l2.4 6.6L21 11l-6.6 2.4L12 20l-2.4-6.6L3 11l6.6-2.4L12 2z" /></svg>
        <svg className="absolute pointer-events-none" style={{ top: 4, right: -22, width: 14, height: 14, color: BRAND }} viewBox="0 0 24 24" fill="currentColor"><path className="spk" style={{ animationDelay: "0.6s" } as React.CSSProperties} d="M12 2l2.4 6.6L21 11l-6.6 2.4L12 20l-2.4-6.6L3 11l6.6-2.4L12 2z" /></svg>
        <svg className="absolute pointer-events-none" style={{ top: -22, right: 6, width: 12, height: 12, color: BRAND }} viewBox="0 0 24 24" fill="currentColor"><path className="spk" style={{ animationDelay: "1.2s" } as React.CSSProperties} d="M12 2l2.4 6.6L21 11l-6.6 2.4L12 20l-2.4-6.6L3 11l6.6-2.4L12 2z" /></svg>
      </div>
    </div>
  );
}
