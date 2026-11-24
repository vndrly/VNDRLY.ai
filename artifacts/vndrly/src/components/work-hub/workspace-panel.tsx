import { useId, useState, type ReactNode } from "react";
import { Link } from "wouter";
import { ChevronRight, type LucideIcon } from "lucide-react";
import { useDashboardRowPulse } from "@/hooks/use-dashboard-row-pulse";
import "./home.css";

export function WorkspaceRow({ icon: Icon, label, value, href, onClick, expanded, testId, pulseKey, pulseValue }: { icon: LucideIcon; label: string; value?: ReactNode; href?: string; onClick?: () => void; expanded?: boolean; testId?: string; pulseKey?: string; pulseValue?: string }) {
  const pulseRef = useDashboardRowPulse<HTMLButtonElement>(pulseKey, pulseValue);
  const contents = <><Icon aria-hidden="true" className="hub-row-icon" /><span className="hub-row-label">{label}</span>{value && <span className="hub-row-value">{value}</span>}<ChevronRight aria-hidden="true" className="hub-chevron" /></>;
  return href ? <Link href={href} className="hub-home-row" data-testid={testId}>{contents}</Link> : <button ref={pulseRef} type="button" className="hub-home-row" onClick={onClick} aria-expanded={expanded} data-testid={testId}>{contents}</button>;
}

export function WorkspacePanel({ title, titleContent, subtitle, icon: Icon, children, actions, className = "" }: { title: string; titleContent?: ReactNode; subtitle: string; icon: LucideIcon; children: ReactNode; actions?: ReactNode; className?: string }) {
  return <section className={`hub-home-card ${className}`} aria-label={title}><header data-card-header-row className="hub-card-heading"><span className="hub-card-icon"><Icon aria-hidden="true" /></span><div><h2>{titleContent ?? title}</h2>{subtitle && <p>{subtitle}</p>}</div>{actions && <div className="hub-panel-actions">{actions}</div>}</header>{children}</section>;
}

/** Row content expands in place; the card heading remains a heading. */
export function WorkspaceDisclosure({ icon: Icon, label, value, children }: { icon: LucideIcon; label: string; value?: ReactNode; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return <div className={`hub-row-disclosure${open ? " is-open" : ""}`}><button type="button" className="hub-home-row" aria-expanded={open} aria-controls={id} onClick={() => setOpen(value => !value)}><Icon aria-hidden="true" className="hub-row-icon" /><span className="hub-row-label">{label}</span><span className="hub-row-value">{value}</span><ChevronRight aria-hidden="true" className="hub-chevron" /></button>{open && <div id={id} role="region" aria-label={`${label} items`} className="hub-inline-panel">{children}</div>}</div>;
}
