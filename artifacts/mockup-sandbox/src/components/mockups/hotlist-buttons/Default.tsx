import { useState } from "react";
import { Plus, Award, FileText, Copy, ExternalLink, Printer, Trash2 } from "lucide-react";

import btnGrey from "@assets/900x229_Grey_Button_1777067254819.png";
import btnAmber from "@assets/5eb2ccae-d124-40fb-a518-0e89712eb438_1777067094038.png";
import btnBlue from "@assets/900x229_Blue_Button_1777067254818.png";
import btnRed from "@assets/900x229_Red_Button_1777066896414.png";

import statusPillGreen from "@assets/900x229_Green_Pill_1777093057355.png";
import statusPillBlue from "@assets/900x229_Blue_Pill_1777093057350.png";
import statusPillAmber from "@assets/900x229_Amber_Pill_1777093057350.png";
import statusPillRed from "@assets/900x229_Red_Pill_1777093057349.png";
import statusPillDarkGrey from "@assets/900x229_Dark_Grey_Pill_1777093057352.png";
import statusPillLightGrey from "@assets/900x229_Light_Grey_Pill_1777093057356.png";
import statusPillIndigo from "@assets/900x229_Indego_Pill_1777093057356.png";
import statusPillOrange from "@assets/900x229_Orange_Pill_1777093057357.png";
import statusPillPurple from "@assets/900x229_Purple_Pill_1777093057348.png";
import removePillGrey from "@assets/900x229_Light_Grey_Pill_1777093886279.png";
import removePillRed from "@assets/900x229_Red_Pill_1777093057349.png";
import exxonLogo from "@assets/ExxonMobil_Logo_transparent.png";

function PillBg({ src, opacity = 1 }: { src: string; opacity?: number }) {
  return (
    <div
      className="absolute inset-0 flex pointer-events-none transition-opacity duration-200"
      style={{ opacity }}
    >
      <div
        className="h-full shrink-0 overflow-hidden relative"
        style={{ aspectRatio: `${0.15 * (900/229)} / 1` }}
      >
        <img
          src={src}
          alt=""
          draggable={false}
          className="block h-full absolute top-0 left-0"
          style={{ width: "auto", maxWidth: "none" }}
        />
      </div>
      <div className="h-full flex-1 overflow-hidden relative">
        <img
          src={src}
          alt=""
          draggable={false}
          className="block h-full absolute top-0"
          style={{
            width: "calc(100% / 0.7)",
            maxWidth: "none",
            left: "calc(-100% * 0.15 / 0.7)",
          }}
        />
      </div>
      <div
        className="h-full shrink-0 overflow-hidden relative"
        style={{ aspectRatio: `${0.15 * (900/229)} / 1` }}
      >
        <img
          src={src}
          alt=""
          draggable={false}
          className="block h-full absolute top-0 right-0"
          style={{ width: "auto", maxWidth: "none" }}
        />
      </div>
    </div>
  );
}

type Variant = "blue" | "amber" | "grey" | "red";
type ForceState = "idle" | "hover";

function PillButton({
  variant,
  children,
  forceState,
  disabled,
  className = "",
  height = 36,
}: {
  variant: Variant;
  children: React.ReactNode;
  forceState?: ForceState;
  disabled?: boolean;
  className?: string;
  height?: number;
}) {
  const [isHover, setIsHover] = useState(false);
  const state: ForceState = disabled ? "idle" : forceState ?? (isHover ? "hover" : "idle");

  const idleSrc =
    variant === "amber"
      ? btnAmber
      : variant === "grey"
        ? removePillGrey
        : btnGrey;
  const hoverSrc =
    variant === "blue"
      ? btnBlue
      : variant === "amber"
        ? btnAmber
        : variant === "grey"
          ? removePillRed
          : btnRed;
  const idleOpacity = variant === "amber" ? 1 : state === "idle" ? 0.5 : 0;
  const hoverOpacity =
    variant === "amber"
      ? state === "hover"
        ? 1
        : 0
      : state === "hover"
        ? 1
        : 0;
  const textColor =
    variant === "amber" ? "#fff" : state === "hover" ? "#fff" : "#374151";
  const textShadow =
    variant === "amber" || state === "hover"
      ? "0 1px 1px rgba(0,0,0,0.30)"
      : undefined;

  return (
    <button
      type="button"
      disabled={disabled}
      onMouseEnter={() => setIsHover(true)}
      onMouseLeave={() => setIsHover(false)}
      className={`relative inline-flex items-center select-none ${disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"} ${className}`}
      style={{ minWidth: 110, height }}
    >
      <PillBg src={idleSrc} opacity={idleOpacity} />
      {variant !== "amber" && <PillBg src={hoverSrc} opacity={hoverOpacity} />}
      <span
        className="relative z-10 flex items-center justify-center gap-2 px-4 h-full w-full text-sm whitespace-nowrap transition-colors"
        style={{
          color: textColor,
          textShadow,
          fontWeight: variant === "amber" ? 600 : 700,
        }}
      >
        {children}
      </span>
    </button>
  );
}

function Tile({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col items-start gap-2 p-4 rounded-md border border-gray-200 bg-white">
      <span className="text-[11px] uppercase tracking-wide text-gray-500 font-semibold">{label}</span>
      <div className="flex items-center gap-2">{children}</div>
    </div>
  );
}

type StatusKey =
  | "open"
  | "pending"
  | "submitted"
  | "awarded"
  | "declined"
  | "closed"
  | "cancelled"
  | "expired"
  | "archived";

function StatusPill({ status }: { status: StatusKey }) {
  const map: Record<StatusKey, { src: string; light?: boolean }> = {
    open:      { src: statusPillGreen },
    pending:   { src: statusPillAmber },
    submitted: { src: statusPillIndigo },
    awarded:   { src: statusPillBlue },
    declined:  { src: statusPillRed },
    closed:    { src: statusPillDarkGrey },
    cancelled: { src: statusPillLightGrey, light: true },
    expired:   { src: statusPillOrange },
    archived:  { src: statusPillPurple },
  };
  const cfg = map[status];
  const label = status.charAt(0).toUpperCase() + status.slice(1);
  return (
    <span className="relative inline-flex items-center justify-center h-[28px] min-w-[110px] align-middle pointer-events-none select-none">
      <PillBg src={cfg.src} opacity={cfg.light ? 0.5 : 1} />
      <span
        className={`relative z-10 px-3 text-xs font-bold ${cfg.light ? "text-gray-700" : "text-white"}`}
        style={cfg.light ? undefined : { textShadow: "0 1px 1px rgba(0,0,0,0.35)" }}
      >
        {label}
      </span>
    </span>
  );
}

function AdminJobRow({
  title,
  partner,
  logoUrl,
  location,
  deadline,
  status,
}: {
  title: string;
  partner: string;
  logoUrl?: string;
  location: string;
  deadline: string;
  status: StatusKey;
}) {
  return (
    <div className="border rounded-md p-3 flex items-center gap-3">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            className="font-semibold text-gray-700 hover:text-amber-600 hover:underline focus:text-amber-600 truncate text-left transition-colors"
          >
            {title}
          </button>
          {logoUrl ? (
            <img
              src={logoUrl}
              alt={partner}
              className="h-5 w-auto max-w-[80px] object-contain shrink-0"
            />
          ) : (
            <span className="text-xs text-gray-500">· {partner}</span>
          )}
        </div>
        <div className="flex flex-wrap gap-3 text-xs text-gray-500 mt-1">
          <span>{location}</span>
          <span>{deadline}</span>
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <StatusPill status={status} />
        <PillButton variant="grey" height={28} className="!min-w-[110px] !text-xs"><Trash2 className="w-3 h-3" />Remove</PillButton>
      </div>
    </div>
  );
}

function FakeBidRow({ vendorName, amount, eta }: { vendorName: string; amount: string; eta: string }) {
  return (
    <div className="flex items-center gap-3 p-2 rounded bg-white border">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-blue-600">{vendorName}</span>
          <span className="inline-flex items-center justify-center h-[20px] px-2 rounded-full bg-amber-100 text-amber-800 text-[10px] font-semibold">Pending</span>
        </div>
        <div className="text-xs text-gray-500 mt-0.5">
          <span className="font-semibold text-gray-900">{amount}</span>
          <span className="ml-2">ETA {eta}</span>
        </div>
      </div>
      <PillButton variant="amber" height={32}>
        <Award className="w-3 h-3" />Award
      </PillButton>
    </div>
  );
}

export default function HotlistButtonsPreview() {
  return (
    <div
      className="min-h-screen p-8 flex flex-col gap-8"
      style={{ fontFamily: "Inter, system-ui, sans-serif", background: "#f8fafc" }}
    >
      <div>
        <h2 className="text-base font-semibold text-gray-900 mb-1">
          Hotlist card buttons — true 3-slice (15% / 70% / 15%)
        </h2>
        <p className="text-xs text-gray-500">
          Left and right caps preserve their natural aspect; only the middle 70% stretches. Compare a wide and a narrow button — the rounded ends stay crisp at every width.
        </p>
      </div>

      <div className="grid grid-cols-4 gap-4">
        <Tile label="Blue — Idle">
          <PillButton variant="blue" forceState="idle"><Plus className="w-4 h-4" />Post Job</PillButton>
        </Tile>
        <Tile label="Blue — Hover">
          <PillButton variant="blue" forceState="hover"><Plus className="w-4 h-4" />Post Job</PillButton>
        </Tile>
        <Tile label="Amber (primary)">
          <PillButton variant="amber"><Award className="w-4 h-4" />Award</PillButton>
        </Tile>
        <Tile label="Grey → Red on hover">
          <PillButton variant="grey"><Copy className="w-4 h-4" />Copy summary</PillButton>
        </Tile>
        <Tile label="Red — Cancel idle">
          <PillButton variant="red" forceState="idle">Cancel</PillButton>
        </Tile>
        <Tile label="Red — Cancel hover">
          <PillButton variant="red" forceState="hover">Cancel</PillButton>
        </Tile>
        <Tile label="Disabled">
          <PillButton variant="grey" disabled>Out of radius</PillButton>
        </Tile>
        <Tile label="Try hover">
          <PillButton variant="blue"><FileText className="w-4 h-4" />Create Ticket</PillButton>
        </Tile>
      </div>

      <div>
        <h3 className="text-xs font-semibold text-gray-700 mb-2 uppercase tracking-wide">Width comparison — caps stay crisp</h3>
        <div className="flex items-center gap-4">
          <PillButton variant="blue" forceState="hover" className="!min-w-0" >Go</PillButton>
          <PillButton variant="blue" forceState="hover">Save changes</PillButton>
          <PillButton variant="blue" forceState="hover" className="!min-w-[280px]">Save changes and continue to next step</PillButton>
        </div>
      </div>

      <div>
        <h3 className="text-xs font-semibold text-gray-700 mb-2 uppercase tracking-wide">In context — partner hotlist card</h3>
        <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
          <div className="flex items-center justify-between p-4 border-b border-gray-100">
            <div>
              <div className="flex items-center gap-2 text-base font-semibold text-gray-900">
                <span className="text-amber-500">🔥</span>Hotlist
              </div>
              <p className="text-xs text-gray-500 mt-0.5">Post jobs and review incoming vendor bids</p>
            </div>
            <div className="flex items-center gap-2">
              <PillButton variant="blue"><Printer className="w-4 h-4" />Print</PillButton>
              <PillButton variant="blue"><Plus className="w-4 h-4" />Post Job</PillButton>
            </div>
          </div>
          <div className="p-4 space-y-3">
            <div className="border rounded-md">
              <div className="p-3">
                <div className="flex items-center gap-2">
                  <span className="font-medium">Pump jack inspection — Site 14</span>
                  <span className="inline-flex items-center justify-center h-[20px] px-2 rounded-full bg-green-100 text-green-700 text-[10px] font-semibold">Open</span>
                </div>
                <div className="text-xs text-gray-500 mt-1">3 bids · 12 mi · Apr 30</div>
              </div>
              <div className="border-t px-3 py-3 bg-gray-50/40 space-y-2">
                <FakeBidRow vendorName="Precision Drilling" amount="$4,200" eta="2d" />
                <FakeBidRow vendorName="Triton Field Services" amount="$3,950" eta="3d" />
              </div>
            </div>
            <div className="border rounded-md">
              <div className="p-3">
                <div className="flex items-center gap-2">
                  <span className="font-medium">Tank battery cleanup — Site 7</span>
                  <span className="inline-flex items-center justify-center h-[20px] px-2 rounded-full bg-blue-100 text-blue-700 text-[10px] font-semibold">Awarded</span>
                </div>
                <div className="text-xs text-gray-500 mt-1">Awarded · 8 mi · May 4</div>
              </div>
              <div className="border-t px-3 py-3 bg-gray-50/40">
                <div className="flex items-center gap-3 p-2 rounded bg-white border">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-blue-600">Precision Drilling</span>
                      <span className="inline-flex items-center justify-center h-[20px] px-2 rounded-full bg-blue-100 text-blue-700 text-[10px] font-semibold">Awarded</span>
                    </div>
                    <div className="text-xs text-gray-500 mt-0.5">
                      <span className="font-semibold text-gray-900">$5,800</span>
                      <span className="ml-2">ETA 4d</span>
                    </div>
                  </div>
                  <PillButton variant="blue" height={32}>
                    <FileText className="w-3 h-3" />Create Ticket
                  </PillButton>
                </div>
                <div className="flex flex-wrap gap-2 mt-3">
                  <PillButton variant="grey" height={32}><Copy className="w-3 h-3" />Copy summary</PillButton>
                  <PillButton variant="grey" height={32}><Copy className="w-3 h-3" />Copy description</PillButton>
                  <PillButton variant="blue" height={32}><ExternalLink className="w-3 h-3" />Go to Tracking</PillButton>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div>
        <h3 className="text-xs font-semibold text-gray-700 mb-2 uppercase tracking-wide">In context — admin hotlist row (new)</h3>
        <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
          <div className="flex items-center justify-between p-4 border-b border-gray-100">
            <div>
              <div className="flex items-center gap-2 text-base font-semibold text-gray-900">
                <span className="text-amber-500">🔥</span>Hotlist
              </div>
              <p className="text-xs text-gray-500 mt-0.5">All Hotlist jobs across partners</p>
            </div>
            <div className="flex items-center gap-2">
              <PillButton variant="blue"><Printer className="w-4 h-4" />Print</PillButton>
              <PillButton variant="blue"><Plus className="w-4 h-4" />Post Job</PillButton>
            </div>
          </div>
          <div className="p-4 space-y-3">
            <AdminJobRow title="Pump jack inspection — Site 14" partner="ExxonMobil" logoUrl={exxonLogo} location="Midland, TX" deadline="Apr 30" status="open" />
            <AdminJobRow title="Tank battery cleanup — Site 7" partner="Chevron" location="Odessa, TX" deadline="May 4" status="awarded" />
            <AdminJobRow title="Wellhead valve replacement — Pad 22" partner="Shell" location="Pecos, TX" deadline="May 12" status="pending" />
          </div>
        </div>
        <p className="text-[11px] text-gray-500 mt-2">
          Title is an amber clickable link → opens a Job Particulars dialog with the full description.
          Status pill (new glossy buttons) sits next to the Remove pill on the right.
        </p>
      </div>
    </div>
  );
}
