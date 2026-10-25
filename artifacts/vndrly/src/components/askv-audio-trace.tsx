import { useEffect, useRef } from "react";
import { readAskVWaveform } from "@/lib/askv-audio-waveform";
export default function AskVAudioTrace({active}:{active:boolean}) {
 const path = useRef<SVGPathElement>(null);
 useEffect(() => {
   if (!active) { path.current?.setAttribute("d", "M0 10 L80 10"); return; }
   const draw = () => {
     const samples = readAskVWaveform();
     const d = Array.from({length:80}, (_,i) => {
       const value = samples[Math.floor(i * samples.length / 80)] || 0;
       return (i ? "L" : "M") + i + " " + (10 - Math.max(-1, Math.min(1, value * 3)) * 9).toFixed(2);
     }).join(" ");
     path.current?.setAttribute("d", d);
   };
   draw(); const timer = window.setInterval(draw, 50);
   return () => window.clearInterval(timer);
 },[active]);
 return <svg viewBox="0 0 80 20" preserveAspectRatio="none" className="h-3 w-full" role="img" aria-label="AskV live audio waveform" data-testid="askv-audio-trace"><path ref={path} d="M0 10 L80 10" fill="none" stroke="currentColor" strokeWidth="1.5" /></svg>;
}
