import { useId, type ReactNode, type ButtonHTMLAttributes } from "react";
import { ChevronDown, ChevronRight, type LucideIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { VNDRLY_LOGO_SQUARE } from "@/lib/vndrly-brand-assets";

export function ProfilePanelHeader({ name, title }: { name: string; title: string }) {
  const { i18n } = useTranslation();
  return <header className="flex items-center gap-3" data-testid="profile-panel-header">
    <img src={VNDRLY_LOGO_SQUARE} alt="VNDRLY" className="h-11 w-11 shrink-0 object-contain" />
    <div className="min-w-0 text-sm leading-5">
      <p>{i18n.language.startsWith("es") ? "para" : "for"} <strong className="text-[var(--brand-primary)]">{name}</strong></p>
      <h3 className="text-sm font-normal">{title}</h3>
    </div>
  </header>;
}

export function ProfileActionButton({ color: _color, className = "", ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { color?: string }) {
  return <button type="button" {...props} className={`vendor-mini-card-button inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-[var(--brand-primary)] bg-[#2b2b2f] px-3 py-2 text-xs font-semibold text-[#ececec] hover:bg-[#353539] focus-visible:outline-2 focus-visible:outline-[var(--brand-primary)] disabled:opacity-50 ${className}`} />;
}

export function ProfileCard({ title, icon: Icon, children, className = "" }: { title: string; icon: LucideIcon; children: ReactNode; className?: string }) {
  return <section className={`gate-profile-card ${className}`} data-card-layout>
    <h2 className="flex items-center gap-2 font-bold text-lg mb-3"><Icon className="h-5 w-5 text-[var(--brand-primary)]" aria-hidden />{title}</h2>
    {children}
  </section>;
}

export function ProfileRow({ label, open, onClick, trailing, children, disabled, icon: Icon, unframed = false, anchorId }: {
  label: string; open?: boolean; onClick: () => void; trailing?: ReactNode; children?: ReactNode; disabled?: boolean; icon?: LucideIcon; unframed?: boolean; anchorId?: string;
}) {
  const id = useId();
  const Chevron = open ? ChevronDown : ChevronRight;
  return <div id={anchorId} className="gate-profile-row scroll-mt-24">
    <div className="flex items-center gap-3">
      <button type="button" onClick={onClick} disabled={disabled} className="flex min-h-11 min-w-0 flex-1 items-center gap-3 text-left text-sm disabled:opacity-50"
        aria-expanded={open === undefined ? undefined : Boolean(open)} aria-controls={children ? id : undefined}>
        {Icon ? <Icon className="h-5 w-5 shrink-0 text-[var(--brand-primary)]" aria-hidden /> : <Chevron className="h-4 w-4 shrink-0 text-[var(--brand-primary)]" aria-hidden />}
        <span className="flex-1">{label}</span>{!trailing && <Chevron className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />}
      </button>{trailing}
    </div>
    {children && open && <div id={id} className={unframed ? "space-y-4 pb-4" : "gate-profile-panel"}>{children}</div>}
  </div>;
}

export async function profileRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${import.meta.env.BASE_URL.replace(/\/$/, "")}/api${path}`, {
    ...init, credentials: "include", headers: { ...(init.body ? { "Content-Type": "application/json" } : {}), ...init.headers },
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw Error(body?.message || "Could not save or load this setting. Please try again.");
  return body as T;
}
