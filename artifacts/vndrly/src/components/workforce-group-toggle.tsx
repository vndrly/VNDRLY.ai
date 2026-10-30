import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";

export default function WorkforceGroupToggle({ open, onToggle, children }: {
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return <button type="button" className="workforce-group-toggle" aria-expanded={open} onClick={onToggle}>
    {children}<ChevronRight aria-hidden="true" className={open ? "workforce-group-chevron is-open" : "workforce-group-chevron"} />
  </button>;
}
