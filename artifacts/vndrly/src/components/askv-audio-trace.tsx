import { useEffect, useRef, useState } from "react";
import { readAskVWaveform } from "@/lib/askv-audio-waveform";
function ovalTrace(width: number, samples?: Float32Array) {
 const radius = 16, left = 20, right = width - 20, straight = right - left;
 const arc = Math.PI * radius, perimeter = 2 * (straight + arc);
 return Array.from({length:160}, (_, i) => {
   let distance = i * perimeter / 160, x: number, y: number, nx = 0, ny = -1;
   if (distance < straight) { x = left + distance; y = 6; }
   else if ((distance -= straight) < arc) {
     const angle = -Math.PI / 2 + distance / radius;
     nx = Math.cos(angle); ny = Math.sin(angle); x = right + radius * nx; y = 22 + radius * ny;
   } else if ((distance -= arc) < straight) { x = right - distance; y = 38; ny = 1; }
   else {
     const angle = Math.PI / 2 + (distance - straight) / radius;
     nx = Math.cos(angle); ny = Math.sin(angle); x = left + radius * nx; y = 22 + radius * ny;
   }
   const value = samples?.[Math.floor(i * samples.length / 160)] || 0;
   const displacement = Math.max(-1, Math.min(1, value * 3)) * 3;
   return (i ? "L" : "M") + (x + nx * displacement).toFixed(2) + " " + (y + ny * displacement).toFixed(2);
 }).join(" ") + " Z";
}
export default function AskVAudioTrace({active, shape = "line"}:{active:boolean; shape?:"line"|"oval"}) {
 const path = useRef<SVGPathElement>(null);
 const svg = useRef<SVGSVGElement>(null);
 const [width, setWidth] = useState(128);
 useEffect(() => {
   if (shape !== "oval" || !svg.current) return;
   const update = () => { const next = svg.current?.getBoundingClientRect().width; if (next && next >= 40) setWidth(next); };
   update();
   if (typeof ResizeObserver === "undefined") return;
   const observer = new ResizeObserver(update); observer.observe(svg.current);
   return () => observer.disconnect();
 }, [shape]);
 useEffect(() => {
   if (!active) { path.current?.setAttribute("d", shape === "oval" ? ovalTrace(width) : "M0 10 L80 10"); return; }
   const draw = () => {
     const samples = readAskVWaveform();
     const d = shape === "oval" ? ovalTrace(width, samples) : Array.from({length:80}, (_,i) => {
       const value = samples[Math.floor(i * samples.length / 80)] || 0;
       return (i ? "L" : "M") + i + " " + (10 - Math.max(-1, Math.min(1, value * 3)) * 9).toFixed(2);
     }).join(" ");
     path.current?.setAttribute("d", d);
   };
   draw(); const timer = window.setInterval(draw, 50);
   return () => window.clearInterval(timer);
 },[active, shape, width]);
 return <svg ref={svg} viewBox={shape === "oval" ? `0 0 ${width} 44` : "0 0 80 20"} preserveAspectRatio="none" className={shape === "oval" ? "h-full w-full" : "h-3 w-full"} role="img" aria-label="AskV live audio waveform" data-testid="askv-audio-trace"><path ref={path} d={shape === "oval" ? ovalTrace(width) : "M0 10 L80 10"} fill="none" stroke="currentColor" strokeWidth="1.5" vectorEffect={shape === "oval" ? "non-scaling-stroke" : undefined} /></svg>;
}
