import type { ReactNode } from "react";
import { WorkHubPageHeading, WORK_HUB_CARD_CLASS } from "@/components/work-hub/chrome";
import DashboardTasks from "@/components/work-hub/dashboard-tasks";
import { WorkCrews } from "@/components/work-hub/work-crews";
import "@/components/current-theme-page.css";
import "./managed-crews.css";

export function ManagedCrews({ children, personalTasks }: { scope?: "assigned" | "managed-company"; children?: ReactNode; personalTasks?: ReactNode }) {
  return <div className="managed-crews-page">
    <section className="w-full space-y-5 p-4 md:p-6">
      <WorkHubPageHeading module="managedCrews" title="Tasks & Crews" description="Manage crews, task assignments, and unassigned work." />
      <WorkCrews />
      <DashboardTasks />
      {personalTasks}
      {children && <div data-work-hub-card className={`w-full p-5 ${WORK_HUB_CARD_CLASS}`}>{children}</div>}
    </section>
  </div>;
}
