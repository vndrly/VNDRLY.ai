const BRAND = "#ceb673";

function shade(hex: string, pct: number) {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 0xff;
  const g = (n >> 8) & 0xff;
  const b = n & 0xff;
  const adj = (c: number) =>
    Math.max(0, Math.min(255, Math.round(c + (pct < 0 ? c : 255 - c) * pct)));
  const to = (c: number) => adj(c).toString(16).padStart(2, "0");
  return `#${to(r)}${to(g)}${to(b)}`;
}

const TOP = shade(BRAND, 0.18);
const BOTTOM = shade(BRAND, -0.22);
const BORDER = shade(BRAND, -0.35);

function Pill({ icon, label }: { icon: string; label: string }) {
  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        height: 36,
        paddingLeft: 16,
        paddingRight: 16,
        borderRadius: 9999,
        background: `linear-gradient(180deg, ${TOP} 0%, ${BRAND} 50%, ${BOTTOM} 100%)`,
        border: `1px solid ${BORDER}`,
        boxShadow:
          "0 2px 4px rgba(0,0,0,0.25), inset 0 1px 0 rgba(255,255,255,0.45), inset 0 -1px 0 rgba(0,0,0,0.18)",
      }}
    >
      <span
        style={{
          color: "#ffffff",
          fontSize: 14,
          lineHeight: 1,
          textShadow: "0 2px 4px rgba(0,0,0,0.63)",
        }}
      >
        {icon}
      </span>
      <span
        style={{
          color: "#ffffff",
          fontFamily:
            "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
          fontWeight: 600,
          fontSize: 13,
          lineHeight: 1,
          textShadow: "0 2px 4px rgba(0,0,0,0.63)",
        }}
      >
        {label}
      </span>
    </div>
  );
}

export function Winchester() {
  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#f5f5f5",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 28,
        padding: 32,
      }}
    >
      <div style={{ fontSize: 12, color: "#666", letterSpacing: 1 }}>
        TogglePill2 — Winchester #ceb673
      </div>
      <Pill icon="＋" label="Start New Job" />
      <Pill icon="✓" label="Check In" />
      <Pill icon="↻" label="Refresh" />
      <Pill icon="$" label="Mark Awaiting Payment" />
    </div>
  );
}
