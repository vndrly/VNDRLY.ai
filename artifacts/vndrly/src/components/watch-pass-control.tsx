import { ArrowRight, KeyRound } from "lucide-react";

/** Watch custody is an explicit receive/pass action, never a binary switch. */
export default function WatchPassControl({ active, label, disabled, onClick }: { active: boolean; label: string; disabled?: boolean; onClick: () => void }) {
  return <button type="button" className={`watch-pass-control${active ? " is-holding-watch" : ""}`} disabled={disabled} onClick={onClick}>
    <span className="watch-pass-symbol" aria-hidden="true"><KeyRound className="watch-pass-key" /><ArrowRight className="watch-pass-arrow" /></span>
    <span>{label}</span>
  </button>;
}
