import { Clock, Plus, MapPin, Wrench, Layers, User, QrCode, Home as HomeIcon } from "lucide-react";

const palette = {
  background: "#000000",
  surface: "#0a0a0a",
  card: "#0d0d0d",
  border: "#1f1f1f",
  foreground: "#ffffff",
  mutedForeground: "#8b8b8b",
  primary: "#f59e0b",
  primaryForeground: "#0a0a0a",
  accent: "#3a2a05",
  accentForeground: "#fbbf24",
  tabBarBg: "#070707",
  tabBarBorder: "#1a1a1a",
  statusBarBg: "#000000",
};

const tickets = [
  { id: 91, status: "in progress", site: "Delaware Basin Pad 7", workType: "Workover Rig Service", partner: "ExxonMobil" },
  { id: 90, status: "in progress", site: "Delaware Basin Pad 7", workType: "Wireline Logging", partner: "ExxonMobil" },
  { id: 87, status: "pending review", site: "Permian Basin Well #42", workType: "Drilling Operations", partner: "ExxonMobil" },
  { id: 84, status: "in progress", site: "Eagle Ford 12B", workType: "Pressure Testing", partner: "Chevron" },
];

export function OledBlack() {
  return (
    <div
      className="font-['Inter'] flex flex-col"
      style={{ width: 390, height: 844, background: palette.background, color: palette.foreground, margin: "0 auto" }}
    >
      {/* iOS status bar */}
      <div className="flex justify-between items-center px-6 pt-3 pb-1 text-[13px] font-semibold" style={{ background: palette.statusBarBg }}>
        <span>9:41</span>
        <div className="flex items-center gap-1.5 text-[11px]">
          <span>•••</span>
          <span>📶</span>
          <span>🔋</span>
        </div>
      </div>

      {/* Header */}
      <div className="flex items-center justify-between px-4 pt-3 pb-2">
        <h1 className="text-[22px] font-bold" style={{ color: palette.foreground, fontFamily: "Inter" }}>
          Tracking Numbers
        </h1>
        <div className="flex gap-2">
          <button
            className="flex items-center gap-1.5 px-3 py-2 rounded-[10px] text-[13px] font-semibold"
            style={{ background: "transparent", border: `1px solid ${palette.border}`, color: palette.foreground }}
          >
            <Clock size={14} />
            History
          </button>
          <button
            className="flex items-center gap-1.5 px-3 py-2 rounded-[10px] text-[13px] font-semibold"
            style={{ background: palette.primary, color: palette.primaryForeground }}
          >
            <Plus size={16} />
            New
          </button>
        </div>
      </div>

      {/* Ticket list */}
      <div className="flex-1 overflow-hidden p-4 space-y-2.5">
        {tickets.map((tk) => (
          <div
            key={tk.id}
            className="rounded-[12px] p-[14px]"
            style={{ background: palette.card, border: `1px solid ${palette.border}` }}
          >
            <div className="flex items-center justify-between mb-2">
              <span className="text-[14px] font-semibold" style={{ color: palette.foreground }}>
                #{String(tk.id).padStart(4, "0")}
              </span>
              <span
                className="px-2 py-[3px] rounded-md text-[11px] font-medium capitalize"
                style={{ background: palette.accent, color: palette.accentForeground }}
              >
                {tk.status}
              </span>
            </div>
            <div className="text-[16px] font-semibold mb-1 flex items-center gap-1.5" style={{ color: palette.foreground }}>
              <MapPin size={13} style={{ color: palette.mutedForeground }} />
              {tk.site}
            </div>
            <div className="text-[13px]" style={{ color: palette.mutedForeground }}>
              <Wrench size={11} className="inline mr-1.5 mb-0.5" />
              {tk.workType} · {tk.partner}
            </div>
          </div>
        ))}
      </div>

      {/* Tab bar */}
      <div className="flex items-stretch border-t" style={{ background: palette.tabBarBg, borderColor: palette.tabBarBorder }}>
        {[
          { icon: HomeIcon, label: "Home", active: true },
          { icon: QrCode, label: "Scan", active: false },
          { icon: User, label: "Profile", active: false },
        ].map((t) => (
          <div key={t.label} className="flex-1 flex flex-col items-center pt-2 pb-5 gap-0.5">
            <t.icon size={22} style={{ color: t.active ? palette.primary : palette.mutedForeground }} />
            <span className="text-[10px] font-medium" style={{ color: t.active ? palette.primary : palette.mutedForeground }}>
              {t.label}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
