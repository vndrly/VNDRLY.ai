/** The existing duty action, presented as a grey/green slider switch. */
export default function WorkdayStatusSwitch({ active, label, accessibilityLabel = label, disabled, onClick }: { active: boolean; label: string; accessibilityLabel?: string; disabled?: boolean; onClick: () => void }) {
  return <button type="button" role="switch" aria-checked={active} aria-label={accessibilityLabel} disabled={disabled} className={`workday-status-text workday-status-switch${active ? " is-active" : ""}`} onClick={onClick}>
    {label && <span className="workday-switch-label">{label}</span>}
    <span className="workday-switch-track" aria-hidden="true"><span className="workday-switch-dot" /></span>
  </button>;
}
