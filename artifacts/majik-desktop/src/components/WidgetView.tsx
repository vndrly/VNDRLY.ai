import { formatMajikRelativeTime, type MajikCircleSnapshot } from "@workspace/majik";
import { getCurrentWindow } from "@tauri-apps/api/window";

interface WidgetViewProps {
  snapshot: MajikCircleSnapshot;
  selfUserId: number;
  busy: boolean;
  onUp: () => void;
  onDown: () => void;
  onLogout: () => void;
}

function memberLabel(
  updatedAt: string | null,
  state: "up" | "stale" | "down",
): string {
  if (state === "down") return "down";
  if (state === "stale") return "stale";
  if (!updatedAt) return "up";
  return formatMajikRelativeTime(new Date(updatedAt));
}

export function WidgetView({
  snapshot,
  selfUserId,
  busy,
  onUp,
  onDown,
  onLogout,
}: WidgetViewProps) {
  const self = snapshot.members.find((m) => m.userId === selfUserId);

  return (
    <div className="app-shell">
      <div className="titlebar">
        <div>
          <div className="brand">Majik</div>
          <div className="subtitle">
            {snapshot.upCount}/{snapshot.memberCount} up
          </div>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <button
            type="button"
            className="icon-btn"
            aria-label="Minimize"
            onClick={() => void getCurrentWindow().minimize()}
          >
            –
          </button>
          <button type="button" className="icon-btn" aria-label="Sign out" onClick={onLogout}>
            ×
          </button>
        </div>
      </div>

      <div className="member-list">
        {snapshot.members.map((member) => (
          <div className="member-row" key={member.userId}>
            <span className={`dot ${member.state}`} aria-hidden />
            <span>
              {member.displayName}
              {member.userId === selfUserId ? " (you)" : ""}
            </span>
            <span className="member-meta">{memberLabel(member.updatedAt, member.state)}</span>
          </div>
        ))}
      </div>

      <div className="actions">
        <button
          type="button"
          className="primary-btn"
          disabled={busy || self?.state === "up"}
          onClick={onUp}
        >
          I'm Up
        </button>
        <button type="button" className="secondary-btn" disabled={busy} onClick={onDown}>
          I'm down
        </button>
      </div>
    </div>
  );
}
