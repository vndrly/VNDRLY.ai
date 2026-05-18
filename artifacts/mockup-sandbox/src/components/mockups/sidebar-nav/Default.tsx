import { useState } from "react";
import {
  LayoutDashboard,
  Handshake,
  Users,
  UserCheck,
  MapPin,
  FileText,
  UserPlus,
  BarChart3,
  LogOut,
} from "lucide-react";

import btnGrey from "@assets/900x229_Grey_Button_1777067254819.png";
import btnAmber from "@assets/5eb2ccae-d124-40fb-a518-0e89712eb438_1777067094038.png";
import btnBlue from "@assets/900x229_Blue_Button_1777067254818.png";

type State = "inactive" | "hover" | "active";

function NavButton({
  state,
  icon: Icon,
  label,
  forceState,
}: {
  state?: State;
  icon: React.ElementType;
  label: string;
  forceState?: State;
}) {
  const [isHover, setIsHover] = useState(false);
  const resolved: State =
    forceState ??
    state ??
    (isHover ? "hover" : "inactive");
  return (
    <div
      className="relative h-[36px] cursor-pointer select-none"
      onMouseEnter={() => setIsHover(true)}
      onMouseLeave={() => setIsHover(false)}
    >
      <img
        src={btnGrey}
        alt=""
        draggable={false}
        className="absolute inset-0 h-full w-full transition-opacity duration-200"
        style={{
          objectFit: "fill",
          opacity: resolved === "inactive" ? 0.5 : 0,
        }}
      />
      <img
        src={btnBlue}
        alt=""
        draggable={false}
        className="absolute inset-0 h-full w-full transition-opacity duration-200"
        style={{ objectFit: "fill", opacity: resolved === "hover" ? 1 : 0 }}
      />
      <img
        src={btnAmber}
        alt=""
        draggable={false}
        className="absolute inset-0 h-full w-full transition-opacity duration-200"
        style={{ objectFit: "fill", opacity: resolved === "active" ? 1 : 0 }}
      />
      <div
        className="relative z-10 flex items-center gap-3 px-4 h-full text-sm font-semibold transition-colors"
        style={{
          color: resolved === "inactive" ? "rgba(243,244,246,0.9)" : "#fff",
          textShadow: resolved === "active" ? "0 1px 1px rgba(0,0,0,0.35)" : undefined,
        }}
      >
        <Icon className="w-4 h-4" />
        {label}
      </div>
    </div>
  );
}

function Sidebar({ activeKey }: { activeKey: string }) {
  const items: { key: string; label: string; icon: React.ElementType }[] = [
    { key: "dashboard", label: "Dashboard", icon: LayoutDashboard },
    { key: "partner", label: "Partner", icon: Handshake },
    { key: "vendors", label: "Vendors", icon: Users },
    { key: "employees", label: "Field Employees", icon: UserCheck },
    { key: "site-locations", label: "Site Locations", icon: MapPin },
    { key: "tracking", label: "Tracking", icon: FileText },
    { key: "visitors", label: "Visitors", icon: UserPlus },
    { key: "analytics", label: "Analytics", icon: BarChart3 },
  ];
  return (
    <div
      className="w-64 p-3 space-y-[5px] rounded-md"
      style={{ background: "#1f2937" }}
    >
      {items.map((item) => (
        <NavButton
          key={item.key}
          icon={item.icon}
          label={item.label}
          state={item.key === activeKey ? "active" : "inactive"}
        />
      ))}
      <div className="h-px bg-white/10 my-2" />
      <NavButton icon={LogOut} label="Sign Out" state="inactive" />
    </div>
  );
}

export default function SidebarNavPreview() {
  return (
    <div
      className="min-h-screen p-8 flex flex-col gap-8"
      style={{ fontFamily: "Inter, system-ui, sans-serif", background: "#f8fafc" }}
    >
      <div>
        <h2 className="text-base font-semibold text-gray-900 mb-1">
          Sidebar nav buttons — new pill set
        </h2>
        <p className="text-xs text-gray-500">
          Grey at 50% = inactive · Amber = active · Blue = hover. Stretch-to-fit on a 36px tall row.
        </p>
      </div>

      <div className="flex gap-6 items-start">
        <div>
          <span className="text-[11px] uppercase tracking-wide text-gray-500 font-semibold block mb-2">
            States — try hover
          </span>
          <div
            className="w-64 p-3 space-y-[5px] rounded-md"
            style={{ background: "#1f2937" }}
          >
            <NavButton icon={LayoutDashboard} label="Inactive (50% grey)" forceState="inactive" />
            <NavButton icon={Handshake} label="Hover (blue)" forceState="hover" />
            <NavButton icon={UserCheck} label="Active (amber)" forceState="active" />
            <NavButton icon={MapPin} label="Hover me →" />
          </div>
        </div>

        <div>
          <span className="text-[11px] uppercase tracking-wide text-gray-500 font-semibold block mb-2">
            Full sidebar — Tracking active
          </span>
          <Sidebar activeKey="tracking" />
        </div>
      </div>
    </div>
  );
}
