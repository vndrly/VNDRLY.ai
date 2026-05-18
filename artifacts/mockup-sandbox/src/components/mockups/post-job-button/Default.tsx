import { Plus } from "lucide-react";
import { useState } from "react";

import btnIdle from "@assets/download_1776968252374.png";
import btnHoverLeft from "@assets/36_BlueV2_Left_1776383130190.png";
import btnHoverCenter from "@assets/36_BlueV2_Center_1776383130190.png";
import btnHoverRight from "@assets/36_BlueV2_Right_1776383130190.png";

function PostJobButton({ forceHover = false, dimmed = false }: { forceHover?: boolean; dimmed?: boolean }) {
  const [isHover, setIsHover] = useState(false);
  const showHover = forceHover || isHover;
  const opacity = dimmed && !showHover ? 0.5 : 1;
  return (
    <button
      type="button"
      onMouseEnter={() => setIsHover(true)}
      onMouseLeave={() => setIsHover(false)}
      className="relative h-[36px] cursor-pointer inline-flex items-center"
      style={{ width: 140, opacity, transition: "opacity 200ms" }}
    >
      <div
        className="absolute inset-0 flex"
        style={{ opacity: showHover ? 0 : 1, transition: "opacity 200ms" }}
      >
        <div className="h-full w-[20px] shrink-0 overflow-hidden">
          <img src={btnIdle} alt="" className="block h-full" style={{ width: "auto", maxWidth: "none" }} draggable={false} />
        </div>
        <div className="h-full flex-1 overflow-hidden">
          <img
            src={btnIdle}
            alt=""
            className="block h-full"
            style={{ width: "calc(100% * 144 / 104)", maxWidth: "none", marginLeft: "calc(-100% * 20 / 104)" }}
            draggable={false}
          />
        </div>
        <div className="h-full w-[20px] shrink-0 overflow-hidden flex justify-end">
          <img src={btnIdle} alt="" className="block h-full" style={{ width: "auto", maxWidth: "none" }} draggable={false} />
        </div>
      </div>
      <div
        className="absolute inset-0 flex"
        style={{ opacity: showHover ? 1 : 0, transition: "opacity 200ms" }}
      >
        <img src={btnHoverLeft} alt="" className="h-full w-[8px] shrink-0" draggable={false} />
        <img src={btnHoverCenter} alt="" className="h-full flex-1 object-fill" draggable={false} />
        <img src={btnHoverRight} alt="" className="h-full w-[8px] shrink-0" draggable={false} />
      </div>
      <span
        className="relative z-10 flex items-center justify-center gap-2 px-4 h-full w-full text-sm font-bold whitespace-nowrap"
        style={{ color: showHover ? "#fff" : "#374151", transition: "color 200ms" }}
      >
        <Plus className="w-4 h-4" />Post Job
      </span>
    </button>
  );
}

export default function PostJobButtonPreview() {
  return (
    <div className="min-h-screen bg-white p-8 flex flex-col gap-8" style={{ fontFamily: "Inter, system-ui, sans-serif" }}>
      <div>
        <h2 className="text-base font-semibold text-gray-900 mb-1">Post Job button — partner hotlist</h2>
        <p className="text-xs text-gray-500">Idle is dimmed to 50% so the button recedes; full color on hover signals it's actionable.</p>
      </div>

      <div className="grid grid-cols-3 gap-6">
        <div className="flex flex-col items-start gap-2 p-4 rounded-md border border-gray-200">
          <span className="text-[11px] uppercase tracking-wide text-gray-500 font-semibold">Before — idle</span>
          <PostJobButton />
          <span className="text-[11px] text-gray-400">100% opacity</span>
        </div>
        <div className="flex flex-col items-start gap-2 p-4 rounded-md border border-amber-300 bg-amber-50">
          <span className="text-[11px] uppercase tracking-wide text-amber-700 font-semibold">After — idle</span>
          <PostJobButton dimmed />
          <span className="text-[11px] text-amber-700">50% opacity</span>
        </div>
        <div className="flex flex-col items-start gap-2 p-4 rounded-md border border-gray-200">
          <span className="text-[11px] uppercase tracking-wide text-gray-500 font-semibold">After — hover</span>
          <PostJobButton dimmed forceHover />
          <span className="text-[11px] text-gray-400">100% opacity, blue treatment</span>
        </div>
      </div>

      <div>
        <h3 className="text-xs font-semibold text-gray-700 mb-2">Try it</h3>
        <div className="inline-flex p-4 rounded-md border border-gray-200 bg-gray-50">
          <PostJobButton dimmed />
        </div>
        <p className="text-[11px] text-gray-500 mt-2">Hover to see the live transition.</p>
      </div>
    </div>
  );
}
