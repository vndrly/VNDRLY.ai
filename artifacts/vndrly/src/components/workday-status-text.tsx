export default function WorkdayStatusText({ active, label, disabled, onClick }: { active: boolean; label: string; disabled?: boolean; onClick: () => void }) {
  return <button type="button" aria-pressed={active} disabled={disabled} className={`workday-status-text${active ? " is-active" : ""}`} onClick={onClick}>{label}</button>;
}
