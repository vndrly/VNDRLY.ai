import type { ReactNode } from "react";
import { Link } from "wouter";
import { ChevronRight, type LucideIcon } from "lucide-react";
import "./home.css";

export function WorkspaceRow({ icon: Icon, label, value, href, onClick, expanded, testId }: { icon: LucideIcon; label: string; value?: string; href?: string; onClick?: () => void; expanded?: boolean; testId?: string }) {
  const contents = <><Icon aria-hidden="true" className="hub-row-icon" /><span className="hub-row-label">{label}</span>{value && <span className="hub-row-value">{value}</span>}<ChevronRight aria-hidden="true" className="hub-chevron" /></>;
  return href ? <Link href={href} className="hub-home-row" data-testid={testId}>{contents}</Link> : <button type="button" className="hub-home-row" onClick={onClick} aria-expanded={expanded} data-testid={testId}>{contents}</button>;
}

export function WorkspacePanel({ title, subtitle, icon: Icon, children }: { title: string; subtitle: string; icon: LucideIcon; children: ReactNode }) {
  return <section className="hub-home-card" aria-label={title}><header className="hub-card-heading"><span className="hub-card-icon"><Icon aria-hidden="true" /></span><div><h2>{title}</h2><p>{subtitle}</p></div></header>{children}</section>;
}
