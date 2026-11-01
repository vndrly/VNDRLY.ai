import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { WorkHubPageHeading, WORK_HUB_CARD_CLASS } from "@/components/work-hub/chrome";
import type { WorkHubModuleKey } from "@/components/work-hub/chrome";
import "@/components/current-theme-page.css";

export function ImplementationSurface({ module, title, description, children, preview = false, currentTheme = false }: { module: WorkHubModuleKey; title: string; description: string; children: ReactNode; preview?: boolean; icon?: LucideIcon; currentTheme?: boolean }) {
  return <section className={`w-full space-y-5 p-4 md:p-6${currentTheme ? " current-theme-page inventory-page" : ""}`}><WorkHubPageHeading module={module} title={title} description={description} />{preview && <p role="status" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm">Preview only. Ask an administrator to activate this workflow.</p>}<div data-work-hub-card className={currentTheme ? "inventory-page-content" : `w-full p-5 ${WORK_HUB_CARD_CLASS}`}>{children}</div></section>;
}
export function EmptyState({ children }: { children: ReactNode }) { return <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">{children}</p>; }
